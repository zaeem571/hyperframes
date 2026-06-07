/**
 * @hyperframes/editor-ai
 *
 * Automated AI video-editing layer: analyze raw footage with Gemini, emit a
 * deterministic Edit Decision List (EDL), and map it onto a Hyperframes composition
 * that drops directly into the producer render pipeline.
 */

export { analyze, analyzeEdits } from "./analyzer.js";
export type { AnalyzeOptions, AnalyzeEditsOptions } from "./analyzer.js";

export { buildHtml, buildProject } from "./mapper.js";
export type { BuildHtmlArgs, BuildProjectArgs } from "./mapper.js";

export { computeKeptSegments, srcToOut, spanToOut } from "./timeline.js";
export type { KeptSegment, KeptTimeline } from "./timeline.js";

export { probeDuration, probeVideoInfo, resolveSourceDuration } from "./ffprobe.js";
export type { VideoInfo } from "./ffprobe.js";

export { normalizeForSeeking } from "./normalize.js";
export type { NormalizeOptions } from "./normalize.js";

export { loadAssetManifest, assetIds } from "./assets.js";
export type { AssetEntry, AssetManifest, AssetType } from "./assets.js";

export { EDL_RESPONSE_SCHEMA, SCHEMA_VERSION } from "./schema.js";
export {
  TRANSCRIPT_FIX_RESPONSE_SCHEMA,
  TRANSCRIPT_FIX_SCHEMA_VERSION,
} from "./transcriptFixSchema.js";

export { fixTranscript } from "./transcriptFix.js";
export type { FixTranscriptOptions } from "./transcriptFix.js";

export { proposeSemanticCuts } from "./semanticCuts.js";
export type { ProposeSemanticCutsOptions } from "./semanticCuts.js";
export {
  SEMANTIC_CUTS_RESPONSE_SCHEMA,
  SEMANTIC_CUTS_SCHEMA_VERSION,
} from "./semanticCutsSchema.js";

export { resolveCuts, parseWordIndex } from "./cutResolver.js";
export type { ResolveCutsOptions, ResolveCutsResult } from "./cutResolver.js";

export { assignWordIds, assertTimingsPreserved, round3 } from "./transcript.js";
export type { TranscriptWord } from "./transcript.js";

export {
  buildCaptionGraphicsFromTranscript,
  buildPostCutCaptionGraphics,
  mergeEdlWithTranscriptCaptions,
  defaultCaptionStyleFromTranscript,
  filterKeptWords,
  applyTransitionBlackoutToGraphics,
  buildTransitionBlackoutWindows,
  TRANSITION_BLACKOUT_SEC,
} from "./transcriptToGraphics.js";
export type {
  BuildCaptionGraphicsOptions,
  BuildPostCutCaptionGraphicsOptions,
} from "./transcriptToGraphics.js";

export { transcribeWithWhisper, writeTranscriptJson } from "./whisperTranscribe.js";
export type {
  TranscribeWithWhisperOptions,
  TranscribeWithWhisperResult,
} from "./whisperTranscribe.js";

export { runEditorPipeline } from "./pipeline.js";
export type { RunEditorPipelineOptions, RunEditorPipelineResult } from "./pipeline.js";

export type * from "./types.js";
