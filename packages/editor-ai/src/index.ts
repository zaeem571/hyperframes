/**
 * @hyperframes/editor-ai
 *
 * Automated AI video-editing layer: analyze raw footage with Gemini, emit a
 * deterministic Edit Decision List (EDL), and map it onto a Hyperframes composition
 * that drops directly into the producer render pipeline.
 */

export { analyze } from "./analyzer.js";
export type { AnalyzeOptions } from "./analyzer.js";

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

export type * from "./types.js";
