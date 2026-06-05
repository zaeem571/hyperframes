/**
 * LLM analyzer: raw .mp4 -> deterministic EDL JSON.
 *
 * Pipeline:
 *   1. Hash (mp4 bytes + instructions.md + schema version + model) -> cache key.
 *   2. If a cached EDL exists for that key, return it (no API call, no upload).
 *   3. Otherwise upload the video via the Gemini File API, wait until ACTIVE,
 *      and call generateContent with a strict responseSchema + low temperature.
 *   4. Validate the result and write it to the cache keyed by the hash.
 *
 * Only this module touches `@google/genai` (an optional dependency). It is imported
 * dynamically so that mapper.ts / timeline.ts stay pure and importable without the SDK.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { assetIds, loadAssetManifest } from "./assets.js";
import { EDL_RESPONSE_SCHEMA, SCHEMA_VERSION } from "./schema.js";
import type { Edl } from "./types.js";

const DEFAULT_MODEL = "gemini-2.5-flash";
const UPLOAD_POLL_INTERVAL_MS = 2_000;
const UPLOAD_TIMEOUT_MS = 5 * 60_000;
const MAX_RETRIES = 5;
const RETRY_BASE_MS = 2_000;
// Transient server-side / rate-limit statuses worth retrying with backoff.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export interface AnalyzeOptions {
  /** Absolute or relative path to the raw .mp4 to analyze. */
  videoPath: string;
  /** Gemini API key. Defaults to process.env.GEMINI_API_KEY. */
  apiKey?: string;
  /** Model id. Defaults to "gemini-2.5-flash". */
  model?: string;
  /** Directory for cached EDLs. Defaults to <package>/.cache. */
  cacheDir?: string;
  /** Path to the style-guide instructions. Defaults to <package>/config/instructions.md. */
  instructionsPath?: string;
  /** Path to the asset manifest. Defaults to <package>/config/asset-manifest.json. */
  manifestPath?: string;
  /** Bypass the cache and force a fresh API call. */
  force?: boolean;
}

const configFile = (name: string): string =>
  fileURLToPath(new URL(`../config/${name}`, import.meta.url));
const defaultCacheDir = (): string => fileURLToPath(new URL("../.cache/", import.meta.url));

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Retry a call on transient Gemini errors (503 overloaded, 429 rate-limit, 5xx) with exponential backoff. */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
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

/**
 * Analyze a raw video and return its EDL, using the on-disk cache when possible.
 */
export async function analyze(opts: AnalyzeOptions): Promise<Edl> {
  const {
    videoPath,
    apiKey = process.env.GEMINI_API_KEY,
    model = DEFAULT_MODEL,
    cacheDir = defaultCacheDir(),
    instructionsPath = configFile("instructions.md"),
    manifestPath = configFile("asset-manifest.json"),
    force = false,
  } = opts;

  const [videoBytes, instructions, manifest] = await Promise.all([
    readFile(videoPath),
    readFile(instructionsPath, "utf-8"),
    loadAssetManifest(manifestPath),
  ]);

  // Cache key folds in everything that changes the model's output: the video, the
  // prompt, the schema shape, and the model. Editing any of them busts the cache.
  const hash = createHash("sha256")
    .update(videoBytes)
    .update(instructions)
    .update(SCHEMA_VERSION)
    .update(model)
    .digest("hex");
  const cachePath = join(cacheDir, `${hash}.json`);

  if (!force && existsSync(cachePath)) {
    try {
      return JSON.parse(await readFile(cachePath, "utf-8")) as Edl;
    } catch {
      // Corrupt cache entry — fall through and regenerate.
    }
  }

  if (!apiKey) {
    throw new Error(
      "Gemini API key required: pass opts.apiKey or set GEMINI_API_KEY (no cache hit available).",
    );
  }

  const manifestJson = JSON.stringify(manifest, null, 2);
  const edl = await callGemini({ videoPath, apiKey, model, instructions, manifestJson });

  validateEdl(edl, assetIds(manifest));

  await mkdir(cacheDir, { recursive: true });
  await writeFile(cachePath, JSON.stringify(edl, null, 2), "utf-8");
  return edl;
}

interface CallGeminiArgs {
  videoPath: string;
  apiKey: string;
  model: string;
  instructions: string;
  manifestJson: string;
}

async function callGemini(args: CallGeminiArgs): Promise<Edl> {
  const { videoPath, apiKey, model, instructions, manifestJson } = args;
  const { GoogleGenAI, createPartFromUri } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey });

  // Upload via the File API and wait until the video is processed.
  const uploaded = await ai.files.upload({ file: videoPath, config: { mimeType: "video/mp4" } });
  const ready = await waitForActiveFile(ai, uploaded.name);

  const response = await withRetry(() =>
    ai.models.generateContent({
      model,
      contents: [
        {
          role: "user",
          parts: [
            createPartFromUri(ready.uri, ready.mimeType),
            {
              text:
                "Analyze this video end-to-end and produce the EDL per your instructions. " +
                "Watch the whole clip before deciding cuts.\n\n" +
                `ASSET MANIFEST (choose asset_id values only from these):\n${manifestJson}`,
            },
          ],
        },
      ],
      config: {
        // The editing rules go in systemInstruction — the model adheres to these more
        // strictly than to rules buried in the user turn.
        systemInstruction: instructions,
        responseMimeType: "application/json",
        responseSchema: EDL_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
        temperature: 0.2,
      },
    }),
  );

  const text = response.text;
  if (!text) throw new Error("Gemini returned an empty response.");
  try {
    return JSON.parse(text) as Edl;
  } catch (err) {
    throw new Error(`Gemini response was not valid JSON: ${(err as Error).message}`);
  }
}

/** Poll the File API until the uploaded video is ACTIVE; throw on FAILED or timeout. */
async function waitForActiveFile(
  ai: {
    files: {
      get: (a: {
        name: string;
      }) => Promise<{ name?: string; uri?: string; mimeType?: string; state?: string }>;
    };
  },
  name: string | undefined,
): Promise<{ uri: string; mimeType: string }> {
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

/** Light structural guard: finite times, end>start, and known asset ids. */
function validateEdl(edl: Edl, validAssetIds: Set<string>): void {
  if (!edl || typeof edl !== "object") throw new Error("EDL is not an object.");
  if (!Number.isFinite(edl.source_duration)) throw new Error("EDL.source_duration is not finite.");
  if (!edl.style_decisions) throw new Error("EDL.style_decisions is missing.");

  for (const c of edl.cuts ?? []) {
    if (!Number.isFinite(c.start) || !Number.isFinite(c.end) || c.end <= c.start) {
      throw new Error(`Invalid cut span: ${JSON.stringify(c)}`);
    }
  }
  for (const p of edl.punch_ins ?? []) {
    if (!Number.isFinite(p.start) || !Number.isFinite(p.end) || p.end <= p.start) {
      throw new Error(`Invalid punch_in span: ${JSON.stringify(p)}`);
    }
  }
  for (const g of edl.graphics ?? []) {
    if (!Number.isFinite(g.start) || !Number.isFinite(g.end) || g.end <= g.start) {
      throw new Error(`Invalid graphic span: ${JSON.stringify(g)}`);
    }
    if (g.type === "image" && (!g.asset_id || !validAssetIds.has(g.asset_id))) {
      throw new Error(`Graphic image references unknown asset_id: ${g.asset_id}`);
    }
  }
  for (const s of edl.sfx ?? []) {
    if (!Number.isFinite(s.time)) throw new Error(`Invalid sfx time: ${JSON.stringify(s)}`);
    if (!validAssetIds.has(s.asset_id)) {
      throw new Error(`Sfx references unknown asset_id: ${s.asset_id}`);
    }
  }
}
