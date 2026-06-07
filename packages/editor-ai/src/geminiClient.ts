/**
 * Shared Gemini helpers: retries, file upload, structured JSON generation.
 */

const UPLOAD_POLL_INTERVAL_MS = 2_000;
const UPLOAD_TIMEOUT_MS = 5 * 60_000;
const MAX_RETRIES = 5;
const RETRY_BASE_MS = 2_000;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number }).status;
      if (attempt === MAX_RETRIES || (status !== undefined && !RETRYABLE_STATUS.has(status))) {
        throw err;
      }
      const waitMs = RETRY_BASE_MS * 2 ** attempt;
      console.warn(
        `Gemini transient error${status ? ` (${status})` : ""}; retrying in ${waitMs / 1000}s ` +
          `(attempt ${attempt + 1}/${MAX_RETRIES})...`,
      );
      await sleep(waitMs);
    }
  }
  throw lastErr;
}

export interface UploadedVideo {
  uri: string;
  mimeType: string;
}

export async function uploadVideoFile(apiKey: string, videoPath: string): Promise<UploadedVideo> {
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });
  const uploaded = await ai.files.upload({ file: videoPath, config: { mimeType: "video/mp4" } });
  return waitForActiveFile(ai, uploaded.name);
}

async function waitForActiveFile(
  ai: {
    files: {
      get: (a: {
        name: string;
      }) => Promise<{ name?: string; uri?: string; mimeType?: string; state?: string }>;
    };
  },
  name: string | undefined,
): Promise<UploadedVideo> {
  if (!name) throw new Error("File upload did not return a file name.");

  const deadline = Date.now() + UPLOAD_TIMEOUT_MS;
  for (;;) {
    const file = await ai.files.get({ name });
    if (file.state === "ACTIVE") {
      if (!file.uri || !file.mimeType) {
        throw new Error("Uploaded file is ACTIVE but missing uri/mimeType.");
      }
      return { uri: file.uri, mimeType: file.mimeType };
    }
    if (file.state === "FAILED") throw new Error("Gemini failed to process the uploaded video.");
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for video to become ACTIVE (last state: ${file.state}).`);
    }
    await sleep(UPLOAD_POLL_INTERVAL_MS);
  }
}

export interface GenerateStructuredJsonArgs<_T> {
  apiKey: string;
  model: string;
  systemInstruction: string;
  userText: string;
  responseSchema: Record<string, unknown>;
  /** Optional video already uploaded via File API. */
  video?: UploadedVideo;
  temperature?: number;
}

export async function generateStructuredJson<T>(args: GenerateStructuredJsonArgs<T>): Promise<T> {
  const { GoogleGenAI, createPartFromUri } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: args.apiKey });

  const parts: Array<{ text: string } | ReturnType<typeof createPartFromUri>> = [];
  if (args.video) {
    parts.push(createPartFromUri(args.video.uri, args.video.mimeType));
  }
  parts.push({ text: args.userText });

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: args.model,
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction: args.systemInstruction,
        responseMimeType: "application/json",
        responseSchema: args.responseSchema,
        temperature: args.temperature ?? 0.2,
      },
    }),
  );

  const text = response.text;
  if (!text) throw new Error("Gemini returned an empty response.");
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new Error(`Gemini response was not valid JSON: ${(err as Error).message}`);
  }
}
