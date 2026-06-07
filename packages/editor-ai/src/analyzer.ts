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
import {
  catalogForPrompt,
  defaultEditorSystemPath,
  defaultEditorUserTemplatePath,
  fillEditorUserTemplate,
  loadCatalog,
  motionGraphicTemplateIds,
  type EditorCatalog,
} from "./catalog.js";
import { generateStructuredJson, uploadVideoFile } from "./geminiClient.js";
import {
  EDITOR_ORCHESTRATOR_RESPONSE_SCHEMA,
  EDITOR_SCHEMA_VERSION,
  EDL_RESPONSE_SCHEMA,
  SCHEMA_VERSION,
} from "./schema.js";
import type { Edl } from "./types.js";
import type { TranscriptWord } from "./transcript.js";

const DEFAULT_MODEL = "gemini-2.5-flash";

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

export interface AnalyzeEditsOptions {
  videoPath: string;
  transcriptWords: TranscriptWord[];
  /** Creative brief for editor-in-chief decisions. */
  userGuidance?: string;
  apiKey?: string;
  model?: string;
  cacheDir?: string;
  /** Orchestrator system prompt. Defaults to config/editor-system.md. */
  systemPromptPath?: string;
  /** Per-run user message template. Defaults to config/editor-user-template.md. */
  userTemplatePath?: string;
  /** Tool catalog. Defaults to config/catalog.json. */
  catalogPath?: string;
  manifestPath?: string;
  force?: boolean;
}

const configFile = (name: string): string =>
  fileURLToPath(new URL(`../config/${name}`, import.meta.url));
const defaultCacheDir = (): string => fileURLToPath(new URL("../.cache/", import.meta.url));

/**
 * Legacy full analyzer: Gemini watches video and emits EDL including its own captions.
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
  const video = await uploadVideoFile(apiKey, videoPath);
  const edl = await generateStructuredJson<Edl>({
    apiKey,
    model,
    systemInstruction: instructions,
    userText:
      "Analyze this video end-to-end and produce the EDL per your instructions. " +
      "Watch the whole clip before deciding cuts.\n\n" +
      `ASSET MANIFEST (choose asset_id values only from these):\n${manifestJson}`,
    responseSchema: EDL_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    video,
    temperature: 0.2,
  });

  validateEdl(edl, assetIds(manifest));

  await mkdir(cacheDir, { recursive: true });
  await writeFile(cachePath, JSON.stringify(edl, null, 2), "utf-8");
  return edl;
}

/**
 * Editor-in-chief pass: video + corrected whisper transcript + user guidance → EDL.
 * Does not emit spoken-word captions (those are merged from the transcript downstream).
 */
export async function analyzeEdits(opts: AnalyzeEditsOptions): Promise<Edl> {
  const {
    videoPath,
    transcriptWords,
    userGuidance = "",
    apiKey = process.env.GEMINI_API_KEY,
    model = DEFAULT_MODEL,
    cacheDir = defaultCacheDir(),
    systemPromptPath = defaultEditorSystemPath(),
    userTemplatePath = defaultEditorUserTemplatePath(),
    catalogPath = configFile("catalog.json"),
    manifestPath = configFile("asset-manifest.json"),
    force = false,
  } = opts;

  const [videoBytes, systemPrompt, userTemplate, catalog, manifest] = await Promise.all([
    readFile(videoPath),
    readFile(systemPromptPath, "utf-8"),
    readFile(userTemplatePath, "utf-8"),
    loadCatalog(catalogPath),
    loadAssetManifest(manifestPath),
  ]);

  const transcriptJson = JSON.stringify(transcriptWords, null, 2);
  const catalogJson = JSON.stringify(catalogForPrompt(catalog), null, 2);
  const userText = fillEditorUserTemplate(userTemplate, {
    userGuidance,
    transcriptJson,
    catalogJson,
  });

  const hash = createHash("sha256")
    .update(videoBytes)
    .update(systemPrompt)
    .update(userTemplate)
    .update(catalogJson)
    .update(EDITOR_SCHEMA_VERSION)
    .update(transcriptJson)
    .update(userGuidance)
    .update(model)
    .digest("hex");
  const cachePath = join(cacheDir, `editor-${hash}.json`);

  if (!force && existsSync(cachePath)) {
    try {
      const cached = JSON.parse(await readFile(cachePath, "utf-8")) as Edl;
      return stripOrchestratorOutput(cached);
    } catch {
      // fall through
    }
  }

  if (!apiKey) {
    throw new Error(
      "Gemini API key required: pass opts.apiKey or set GEMINI_API_KEY (no cache hit available).",
    );
  }

  const video = await uploadVideoFile(apiKey, videoPath);
  const edl = await generateStructuredJson<Edl>({
    apiKey,
    model,
    systemInstruction: systemPrompt,
    userText,
    responseSchema: EDITOR_ORCHESTRATOR_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
    video,
    temperature: 0.2,
  });

  const cleaned = stripOrchestratorOutput(edl);
  validateOrchestratorEdl(cleaned, assetIds(manifest), catalog);

  await mkdir(cacheDir, { recursive: true });
  await writeFile(cachePath, JSON.stringify(cleaned, null, 2), "utf-8");
  return cleaned;
}

function stripOrchestratorOutput(edl: Edl): Edl {
  return {
    ...edl,
    cuts: [],
    punch_ins: [],
    sfx: [],
    graphics: (edl.graphics ?? []).filter((g) => g.type !== "caption"),
    motion_graphic_requests: edl.motion_graphic_requests ?? [],
  };
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

function validateOrchestratorEdl(
  edl: Edl,
  validAssetIds: Set<string>,
  catalog: EditorCatalog,
): void {
  if (!edl || typeof edl !== "object") throw new Error("EDL is not an object.");
  if (!Number.isFinite(edl.source_duration)) throw new Error("EDL.source_duration is not finite.");
  if (!edl.style_decisions) throw new Error("EDL.style_decisions is missing.");

  for (const g of edl.graphics ?? []) {
    if (!Number.isFinite(g.start) || !Number.isFinite(g.end) || g.end <= g.start) {
      throw new Error(`Invalid graphic span: ${JSON.stringify(g)}`);
    }
    if (g.type === "image" && (!g.asset_id || !validAssetIds.has(g.asset_id))) {
      throw new Error(`Graphic image references unknown asset_id: ${g.asset_id}`);
    }
  }

  const templates = motionGraphicTemplateIds(catalog);

  for (const r of edl.motion_graphic_requests ?? []) {
    if (!Number.isFinite(r.start) || !Number.isFinite(r.end) || r.end <= r.start) {
      throw new Error(`Invalid motion_graphic_request span: ${JSON.stringify(r)}`);
    }
    if (!templates.has(r.template_id)) {
      throw new Error(`motion_graphic_request unknown template_id: ${r.template_id}`);
    }
    if (r.coverage !== "half" && r.coverage !== "full") {
      throw new Error(`motion_graphic_request invalid coverage: ${r.coverage}`);
    }
  }
}

/** @deprecated Use defaultEditorSystemPath from catalog.ts */
export const defaultEditorInstructionsPath = defaultEditorSystemPath;
