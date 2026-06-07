/**
 * Editor pipeline:
 *   1. whisper.cpp — word-level transcription (local)
 *   2. Gemini (text) — fix broken words only, preserve timestamps
 *   3. Gemini (text) — Stage A semantic cuts by word ID
 *   4. cutResolver — Stage B deterministic cuts / punch_ins / pace
 *   5. Gemini (video + transcript) — editor-in-chief style + motion graphics
 *   6. Deterministic captions from post-cut kept words (OUTPUT timeline)
 *   7. mapper — HyperFrames composition
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeEdits } from "./analyzer.js";
import { resolveCuts } from "./cutResolver.js";
import { buildProject } from "./mapper.js";
import { proposeSemanticCuts } from "./semanticCuts.js";
import { fixTranscript } from "./transcriptFix.js";
import {
  buildPostCutCaptionGraphics,
  defaultCaptionStyleFromTranscript,
  mergeEdlWithTranscriptCaptions,
} from "./transcriptToGraphics.js";
import { loadSubtitleStylesMenu, resolveSubtitleStyleId } from "./subtitleStyles.js";
import type { Edl } from "./types.js";
import type { TranscriptWord } from "./transcript.js";
import { transcribeWithWhisper, writeTranscriptJson } from "./whisperTranscribe.js";

const defaultWorkSubdir = "pipeline-work";

export interface RunEditorPipelineOptions {
  videoPath: string;
  outDir: string;
  /** Creative brief for semantic cuts + editor-in-chief passes. */
  userGuidance?: string;
  apiKey?: string;
  model?: string;
  whisperModel?: string;
  language?: string;
  /** Skip whisper if raw transcript words already exist. */
  rawTranscriptWords?: TranscriptWord[];
  /** Skip transcript fix if corrected words already exist. */
  correctedTranscriptWords?: TranscriptWord[];
  forceWhisper?: boolean;
  forceTranscriptFix?: boolean;
  forceSemanticCuts?: boolean;
  forceEditor?: boolean;
  /** Caption style preset id from config/subtitle-styles.json (default hormozi_serifpop). */
  subtitleStyleId?: string;
  onProgress?: (stage: string, message: string) => void;
}

export interface RunEditorPipelineResult {
  workDir: string;
  rawTranscriptPath: string;
  correctedTranscriptPath: string;
  semanticCutsPath: string;
  resolvedCutsPath: string;
  edlPath: string;
  projectDir: string;
  rawWords: TranscriptWord[];
  correctedWords: TranscriptWord[];
  edl: Edl;
}

export async function runEditorPipeline(
  opts: RunEditorPipelineOptions,
): Promise<RunEditorPipelineResult> {
  const workDir = join(opts.outDir, defaultWorkSubdir);
  await mkdir(workDir, { recursive: true });
  await mkdir(opts.outDir, { recursive: true });

  const progress = (stage: string, message: string) => opts.onProgress?.(stage, message);
  const cacheDir = join(workDir, ".cache");

  // ── Stage 1: whisper.cpp ────────────────────────────────────────────────
  let rawWords = opts.rawTranscriptWords;
  let rawTranscriptPath = join(workDir, "transcript.raw.json");

  if (!rawWords || opts.forceWhisper) {
    progress("whisper", "Transcribing with whisper.cpp...");
    const whisper = await transcribeWithWhisper({
      videoPath: opts.videoPath,
      workDir,
      model: opts.whisperModel,
      language: opts.language,
      onProgress: (msg) => progress("whisper", msg),
    });
    rawWords = whisper.words;
    rawTranscriptPath = whisper.transcriptPath;
  }

  rawTranscriptPath = await writeTranscriptJson(workDir, "transcript.raw.json", rawWords);
  progress("whisper", `${rawWords.length} words transcribed`);

  // ── Stage 2: Gemini transcript cleanup (text only) ──────────────────────
  let correctedWords = opts.correctedTranscriptWords;
  if (!correctedWords || opts.forceTranscriptFix) {
    progress("transcript-fix", "Sending transcript to Gemini for wording cleanup...");
    correctedWords = await fixTranscript({
      words: rawWords,
      apiKey: opts.apiKey,
      model: opts.model,
      cacheDir,
      force: opts.forceTranscriptFix,
    });
  }

  const correctedTranscriptPath = await writeTranscriptJson(
    workDir,
    "transcript.corrected.json",
    correctedWords,
  );
  progress("transcript-fix", "Transcript wording corrected");

  // ── Stage 3: Stage A — semantic cuts (text only) ────────────────────────
  progress("semantic-cuts", "Proposing cuts / emphasis / pace by word ID...");
  const semanticDecision = await proposeSemanticCuts({
    words: correctedWords,
    userGuidance: opts.userGuidance ?? "",
    apiKey: opts.apiKey,
    model: opts.model,
    cacheDir,
    force: opts.forceSemanticCuts,
  });

  const semanticCutsPath = join(workDir, "semantic-cuts.json");
  await writeFile(semanticCutsPath, JSON.stringify(semanticDecision, null, 2), "utf-8");
  progress(
    "semantic-cuts",
    `${semanticDecision.remove.length} removals, ${semanticDecision.emphasize.length} emphasis, ${semanticDecision.pace.length} holds`,
  );

  // ── Stage 4: Stage B — deterministic cut resolver ───────────────────────
  const sourceDuration =
    correctedWords.length > 0 ? Math.max(...correctedWords.map((w) => w.end)) : 0;

  const resolved = resolveCuts({
    words: correctedWords,
    sourceDuration,
    decision: semanticDecision,
  });

  const resolvedCutsPath = join(workDir, "resolved-cuts.json");
  await writeFile(resolvedCutsPath, JSON.stringify(resolved, null, 2), "utf-8");
  progress(
    "cut-resolver",
    `${resolved.cuts.length} cuts, ${resolved.punch_ins.length} punch_ins, ${resolved.pace.length} pace ramps`,
  );

  // ── Stage 5: Gemini editor-in-chief (style + motion graphics) ───────────
  progress("editor", "Analyzing video for style + motion graphics...");
  const orchestratorEdl = await analyzeEdits({
    videoPath: opts.videoPath,
    transcriptWords: correctedWords,
    userGuidance: opts.userGuidance ?? "",
    apiKey: opts.apiKey,
    model: opts.model,
    cacheDir,
    force: opts.forceEditor,
  });

  const edl: Edl = {
    ...orchestratorEdl,
    cuts: resolved.cuts,
    punch_ins: resolved.punch_ins,
    pace: resolved.pace,
    sfx: [],
  };

  // Captions LAST — kept words on post-cut output timeline + transition blackout
  const captionStyle = defaultCaptionStyleFromTranscript(correctedWords);
  if (edl.style_decisions.caption_style === "none") {
    edl.style_decisions.caption_style = captionStyle.caption_style;
  }
  const stylesMenu = await loadSubtitleStylesMenu();
  const captionStyleId = resolveSubtitleStyleId(stylesMenu, opts.subtitleStyleId);
  edl.subtitle_style_id = captionStyleId;
  const captions = buildPostCutCaptionGraphics({
    words: correctedWords,
    cuts: resolved.cuts,
    sourceDuration,
    motionGraphicRequests: edl.motion_graphic_requests ?? [],
    captionStyleId,
  });
  for (const caption of captions) {
    caption.caption_style_id = captionStyleId;
  }
  mergeEdlWithTranscriptCaptions(edl, captions);

  const edlPath = join(workDir, "edl.json");
  await writeFile(edlPath, JSON.stringify(edl, null, 2), "utf-8");
  progress(
    "editor",
    `${edl.cuts.length} cuts, ${captions.length} caption lines (${captionStyleId})`,
  );

  // ── Build renderable composition ────────────────────────────────────────
  progress("build", "Mapping EDL to HyperFrames composition...");
  const projectDir = await buildProject({
    edl,
    videoPath: opts.videoPath,
    outDir: opts.outDir,
  });

  return {
    workDir,
    rawTranscriptPath,
    correctedTranscriptPath,
    semanticCutsPath,
    resolvedCutsPath,
    edlPath,
    projectDir,
    rawWords,
    correctedWords,
    edl,
  };
}

export const defaultEditorInstructionsPath = (): string =>
  fileURLToPath(new URL("../config/editor-system.md", import.meta.url));
