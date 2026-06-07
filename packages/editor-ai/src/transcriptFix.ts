/**
 * Gemini pass 1 (text-only): fix whisper.cpp transcript wording without changing timing.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateStructuredJson } from "./geminiClient.js";
import {
  TRANSCRIPT_FIX_RESPONSE_SCHEMA,
  TRANSCRIPT_FIX_SCHEMA_VERSION,
} from "./transcriptFixSchema.js";
import { assertTimingsPreserved, assignWordIds, type TranscriptWord } from "./transcript.js";

const DEFAULT_MODEL = "gemini-2.5-flash";

const defaultInstructionsPath = (): string =>
  fileURLToPath(new URL("../config/transcript-fix-instructions.md", import.meta.url));

export interface FixTranscriptOptions {
  words: TranscriptWord[];
  apiKey?: string;
  model?: string;
  instructionsPath?: string;
  cacheDir?: string;
  force?: boolean;
}

interface FixTranscriptResponse {
  words: TranscriptWord[];
}

export async function fixTranscript(opts: FixTranscriptOptions): Promise<TranscriptWord[]> {
  const {
    words: inputWords,
    apiKey = process.env.GEMINI_API_KEY,
    model = DEFAULT_MODEL,
    instructionsPath = defaultInstructionsPath(),
    cacheDir,
    force = false,
  } = opts;

  const normalized = assignWordIds(inputWords);
  if (normalized.length === 0) return normalized;

  const instructions = await readFile(instructionsPath, "utf-8");
  const payload = JSON.stringify(normalized, null, 2);

  const hash = createHash("sha256")
    .update(payload)
    .update(instructions)
    .update(TRANSCRIPT_FIX_SCHEMA_VERSION)
    .update(model)
    .digest("hex");

  const cachePath = cacheDir ? join(cacheDir, `transcript-fix-${hash}.json`) : undefined;

  if (!force && cachePath && existsSync(cachePath)) {
    try {
      const cached = JSON.parse(await readFile(cachePath, "utf-8")) as TranscriptWord[];
      assertTimingsPreserved(normalized, cached);
      return cached;
    } catch {
      // corrupt cache — regenerate
    }
  }

  if (!apiKey) {
    throw new Error(
      "Gemini API key required for transcript cleanup: set GEMINI_API_KEY or pass opts.apiKey.",
    );
  }

  const result = await generateStructuredJson<FixTranscriptResponse>({
    apiKey,
    model,
    systemInstruction: instructions,
    userText:
      "Fix ONLY broken or nonsensical words in this whisper.cpp transcript. " +
      "Preserve every id, start, and end exactly.\n\n" +
      `INPUT TRANSCRIPT JSON:\n${payload}`,
    responseSchema: TRANSCRIPT_FIX_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    temperature: 0.1,
  });

  const corrected = assignWordIds(result.words ?? []);
  assertTimingsPreserved(normalized, corrected);

  if (cachePath && cacheDir) {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cachePath, JSON.stringify(corrected, null, 2), "utf-8");
  }

  return corrected;
}
