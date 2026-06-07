/**
 * Stage A: Semantic Editor — transcript-only LLM pass (word IDs only).
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateStructuredJson } from "./geminiClient.js";
import {
  SEMANTIC_CUTS_RESPONSE_SCHEMA,
  SEMANTIC_CUTS_SCHEMA_VERSION,
} from "./semanticCutsSchema.js";
import { assignWordIds, type TranscriptWord } from "./transcript.js";
import type { SemanticCutsDecision } from "./types.js";

const DEFAULT_MODEL = "gemini-2.5-flash";

const defaultSystemPath = (): string =>
  fileURLToPath(new URL("../config/cuts-system.md", import.meta.url));

const defaultDesignPath = (): string =>
  fileURLToPath(new URL("../config/cutsdesign.md", import.meta.url));

export interface ProposeSemanticCutsOptions {
  words: TranscriptWord[];
  userGuidance?: string;
  apiKey?: string;
  model?: string;
  systemPath?: string;
  designPath?: string;
  cacheDir?: string;
  force?: boolean;
}

function buildWordIdSet(words: TranscriptWord[]): Set<string> {
  return new Set(words.map((w) => w.id ?? "").filter(Boolean));
}

function validateSpanIds(
  words: TranscriptWord[],
  decision: SemanticCutsDecision,
): SemanticCutsDecision {
  const ids = buildWordIdSet(words);
  const checkSpan = (from: string, to: string, label: string) => {
    if (!ids.has(from) || !ids.has(to)) {
      throw new Error(`${label}: unknown word id (${from}..${to})`);
    }
    const fromIdx = wordIndex(from);
    const toIdx = wordIndex(to);
    if (fromIdx > toIdx) {
      throw new Error(`${label}: from_word must be <= to_word (${from}..${to})`);
    }
  };

  for (const r of decision.remove ?? []) {
    checkSpan(r.from_word, r.to_word, "remove");
  }
  for (const e of decision.emphasize ?? []) {
    checkSpan(e.from_word, e.to_word, "emphasize");
  }
  for (const p of decision.pace ?? []) {
    checkSpan(p.from_word, p.to_word, "pace");
    if (p.action !== "hold") {
      throw new Error(`pace: unsupported action ${p.action}`);
    }
  }

  return {
    remove: decision.remove ?? [],
    emphasize: decision.emphasize ?? [],
    pace: decision.pace ?? [],
  };
}

function wordIndex(id: string): number {
  const m = /^w(\d+)$/.exec(id);
  if (!m) throw new Error(`Invalid word id: ${id}`);
  return Number.parseInt(m[1]!, 10);
}

export async function proposeSemanticCuts(
  opts: ProposeSemanticCutsOptions,
): Promise<SemanticCutsDecision> {
  const {
    words: inputWords,
    userGuidance = "",
    apiKey = process.env.GEMINI_API_KEY,
    model = DEFAULT_MODEL,
    systemPath = defaultSystemPath(),
    designPath = defaultDesignPath(),
    cacheDir,
    force = false,
  } = opts;

  const words = assignWordIds(inputWords);
  if (words.length === 0) {
    return { remove: [], emphasize: [], pace: [] };
  }

  const [systemPrompt, designDoc] = await Promise.all([
    readFile(systemPath, "utf-8"),
    readFile(designPath, "utf-8"),
  ]);
  const systemInstruction = `${systemPrompt}\n\n---\n\n${designDoc}`;
  const transcriptJson = JSON.stringify(words, null, 2);

  const hash = createHash("sha256")
    .update(transcriptJson)
    .update(systemInstruction)
    .update(SEMANTIC_CUTS_SCHEMA_VERSION)
    .update(userGuidance)
    .update(model)
    .digest("hex");

  const cachePath = cacheDir ? join(cacheDir, `semantic-cuts-${hash}.json`) : undefined;

  if (!force && cachePath && existsSync(cachePath)) {
    try {
      const cached = JSON.parse(await readFile(cachePath, "utf-8")) as SemanticCutsDecision;
      return validateSpanIds(words, cached);
    } catch {
      // corrupt cache — regenerate
    }
  }

  if (!apiKey) {
    throw new Error(
      "Gemini API key required for semantic cuts: set GEMINI_API_KEY or pass opts.apiKey.",
    );
  }

  const guidanceBlock = userGuidance.trim() ? `USER GUIDANCE:\n${userGuidance.trim()}\n\n` : "";

  const result = await generateStructuredJson<SemanticCutsDecision>({
    apiKey,
    model,
    systemInstruction,
    userText:
      `${guidanceBlock}TRANSCRIPT:\n${transcriptJson}\n\n` +
      "Decide remove[], emphasize[], and pace[] by word id only. No timestamps.",
    responseSchema: SEMANTIC_CUTS_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    temperature: 0.1,
  });

  const validated = validateSpanIds(words, {
    remove: result.remove ?? [],
    emphasize: result.emphasize ?? [],
    pace: result.pace ?? [],
  });

  if (cachePath && cacheDir) {
    await mkdir(cacheDir, { recursive: true });
    await writeFile(cachePath, JSON.stringify(validated, null, 2), "utf-8");
  }

  return validated;
}
