/**
 * EDL -> Hyperframes composition.
 *
 * `buildHtml` is pure (string in, string out) and is the unit-testable core.
 * `buildProject` adds the I/O: ffprobe the real duration, copy the raw video and any
 * referenced assets into an output directory, and write index.html.
 *
 * The emitted directory drops directly into `hyperframes render <dir>` — no engine
 * changes. The single invariant the whole file is built around: every EDL time is in
 * SOURCE seconds and must pass through the timeline remap (srcToOut / spanToOut) before
 * becoming a data-start or GSAP position. `data-media-start` is the lone exception.
 */

import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadAssetManifest, type AssetManifest } from "./assets.js";
import { probeVideoInfo } from "./ffprobe.js";
import { normalizeForSeeking } from "./normalize.js";
import * as h from "./html.js";
import { computeKeptSegments, spanToOut, srcToOut, type KeptTimeline } from "./timeline.js";
import type { Edl, Graphic, GraphicPlacement, StyleDecisions } from "./types.js";

const OUTPUT_VIDEO_NAME = "raw.mp4";
const defaultManifestPath = (): string =>
  fileURLToPath(new URL("../config/asset-manifest.json", import.meta.url));

const num = (n: number): string => String(Math.round(n * 1000) / 1000);

// ---------------------------------------------------------------------------
// buildHtml (pure)
// ---------------------------------------------------------------------------

export interface BuildHtmlArgs {
  edl: Edl;
  manifest: AssetManifest;
  /** Authoritative source duration (from ffprobe; falls back to edl.source_duration). */
  sourceDuration: number;
  /** Composition width — match the source so footage isn't cropped. Defaults to 1920. */
  width?: number;
  /** Composition height — match the source so footage isn't cropped. Defaults to 1080. */
  height?: number;
  /** <video>/<audio> src for the raw footage. Defaults to "raw.mp4". */
  videoSrc?: string;
}

export function buildHtml(args: BuildHtmlArgs): string {
  const {
    edl,
    manifest,
    sourceDuration,
    width = 1920,
    height = 1080,
    videoSrc = OUTPUT_VIDEO_NAME,
  } = args;
  const timeline = computeKeptSegments(edl.cuts ?? [], sourceDuration);
  // Scale text/overlay sizing to resolution (1.0 at 1080p short-side).
  const scale = Math.min(width, height) / 1080;

  const stageInner = buildStage(timeline, videoSrc, sourceDuration);
  const voice = buildVoiceTracks(timeline, videoSrc);
  const sfx = buildSfx(edl, manifest, timeline);
  const { overlays, karaokeScript } = buildOverlays(edl, manifest, timeline, scale);
  const punchScript = buildPunchIns(edl, timeline);

  return h.document({
    width,
    height,
    outputDuration: timeline.outputDuration,
    stageInner,
    overlays,
    audios: [voice, sfx].filter(Boolean).join("\n"),
    timelineScript: [punchScript, karaokeScript].filter(Boolean).join("\n"),
  });
}

/** One <video> per kept segment, stacked in #aroll-stage (runtime shows the active one). */
function buildStage(timeline: KeptTimeline, videoSrc: string, sourceDuration: number): string {
  return timeline.segments
    .map((seg, i) =>
      h.videoEl({
        id: `clip${i}`,
        src: videoSrc,
        start: seg.outStart,
        mediaStart: seg.srcStart,
        duration: seg.len,
        sourceDuration,
      }),
    )
    .join("\n");
}

/** Matching <audio> per kept segment so the original voice survives the cuts. */
function buildVoiceTracks(timeline: KeptTimeline, videoSrc: string): string {
  return timeline.segments
    .map((seg, i) =>
      h.audioEl({
        id: `clip${i}-audio`,
        src: videoSrc,
        start: seg.outStart,
        duration: seg.len,
        mediaStart: seg.srcStart,
        volume: 1,
      }),
    )
    .join("\n");
}

/** Layered SFX, time-remapped, src + duration resolved from the manifest. */
function buildSfx(edl: Edl, manifest: AssetManifest, timeline: KeptTimeline): string {
  return (edl.sfx ?? [])
    .map((s, i) => {
      const entry = manifest[s.asset_id];
      if (!entry) return ""; // validated upstream; guard anyway
      const start = srcToOut(s.time, timeline);
      if (start >= timeline.outputDuration) return ""; // would land past the edited end
      return h.audioEl({
        id: `sfx${i}`,
        src: entry.path,
        start,
        duration: Math.max(entry.duration, 0.1),
        volume: s.volume ?? 1,
      });
    })
    .filter(Boolean)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Overlays (graphics + captions)
// ---------------------------------------------------------------------------

const FONT_SIZE: Record<Graphic["type"], number> = {
  caption: 72,
  title: 96,
  lower_third: 56,
  callout: 48,
  image: 0,
};

function buildOverlays(
  edl: Edl,
  manifest: AssetManifest,
  timeline: KeptTimeline,
  scale: number,
): { overlays: string; karaokeScript: string } {
  const style = edl.style_decisions;
  const blocks: string[] = [];
  const scripts: string[] = [];

  (edl.graphics ?? []).forEach((g, gi) => {
    const span = spanToOut(g.start, g.end, timeline);
    if (!span) return; // fully inside a removed cut

    const placement: GraphicPlacement = g.placement ?? style.caption_placement;
    const css = overlayStyle(g, style, placement, scale);
    const id = `gfx${gi}`;

    if (g.type === "image" && g.asset_id) {
      const path = manifest[g.asset_id]?.path;
      if (!path) return;
      const inner = `<img src="${h.escapeHtml(path)}" alt="" style="max-width:60%;max-height:60%" />`;
      blocks.push(
        h.overlayEl({
          id,
          start: span.start,
          duration: span.duration,
          trackIndex: 10 + gi,
          style: css,
          innerHtml: inner,
        }),
      );
      return;
    }

    if (g.type === "caption" && style.caption_style === "karaoke" && g.words?.length) {
      const { html, gsap } = buildKaraoke(id, g, style, timeline);
      blocks.push(
        h.overlayEl({
          id,
          start: span.start,
          duration: span.duration,
          trackIndex: 10 + gi,
          style: css,
          innerHtml: html,
        }),
      );
      if (gsap) scripts.push(gsap);
      return;
    }

    blocks.push(
      h.overlayEl({
        id,
        start: span.start,
        duration: span.duration,
        trackIndex: 10 + gi,
        style: css,
        innerHtml: h.escapeHtml(g.text ?? ""),
      }),
    );
  });

  return { overlays: blocks.join("\n"), karaokeScript: scripts.join("\n") };
}

function overlayStyle(
  g: Graphic,
  style: StyleDecisions,
  placement: GraphicPlacement,
  scale: number,
): string {
  const font = style.font_family ? `font-family:${style.font_family};` : "";
  if (g.type === "image")
    return `${h.placementCss(placement)}display:flex;justify-content:center;align-items:center;`;

  const size = Math.round((FONT_SIZE[g.type] || 56) * scale);
  const pad = Math.round(60 * scale);
  // Captions: white text + accent highlight (applied per-word for karaoke).
  // Other overlays: accent-colored text.
  const color = g.type === "caption" ? "#fff" : style.accent_color;
  return (
    `${h.placementCss(placement)}${font}` +
    `font-size:${size}px;font-weight:800;color:${color};` +
    `text-shadow:0 2px 12px rgba(0,0,0,.55);line-height:1.2;padding:0 ${pad}px;`
  );
}

/** Per-word spans + GSAP color/opacity tweens at each word's remapped start time. */
function buildKaraoke(
  id: string,
  g: Graphic,
  style: StyleDecisions,
  timeline: KeptTimeline,
): { html: string; gsap: string } {
  const spans: string[] = [];
  const tweens: string[] = [];
  (g.words ?? []).forEach((w, wi) => {
    const wid = `${id}-w${wi}`;
    spans.push(`<span id="${wid}" style="opacity:.45">${h.escapeHtml(w.word)}</span>`);
    const at = srcToOut(w.start, timeline);
    // Animates color + opacity (NOT volume) so the producer's audio-automation probe stays off.
    tweens.push(
      `      tl.to("#${wid}", { color: "${style.accent_color}", opacity: 1, duration: 0.08 }, ${num(at)});`,
    );
  });
  return { html: spans.join(" "), gsap: tweens.join("\n") };
}

// ---------------------------------------------------------------------------
// Punch-ins
// ---------------------------------------------------------------------------

/** Scale #aroll-stage (the wrapper, so cuts don't fragment the target) per punch_in. */
function buildPunchIns(edl: Edl, timeline: KeptTimeline): string {
  const lines: string[] = [];
  (edl.punch_ins ?? []).forEach((p) => {
    const span = spanToOut(p.start, p.end, timeline);
    if (!span) return;
    const ramp = Math.min(0.3, span.duration / 2);
    const ox = `${Math.round((p.focus_x ?? 0.5) * 100)}% ${Math.round((p.focus_y ?? 0.5) * 100)}%`;
    lines.push(
      `      tl.to("#aroll-stage", { scale: ${num(p.scale)}, transformOrigin: "${ox}", duration: ${num(ramp)}, ease: "power2.out" }, ${num(span.start)});`,
    );
    lines.push(
      `      tl.to("#aroll-stage", { scale: 1, duration: ${num(ramp)}, ease: "power2.inOut" }, ${num(span.start + span.duration - ramp)});`,
    );
  });
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// buildProject (I/O)
// ---------------------------------------------------------------------------

export interface BuildProjectArgs {
  edl: Edl;
  /** Path to the raw .mp4. */
  videoPath: string;
  /** Output project directory (created if needed). */
  outDir: string;
  /** Asset manifest path. Defaults to <package>/config/asset-manifest.json. */
  manifestPath?: string;
  /** Base dir the manifest's relative paths resolve against. Defaults to manifest's dir. */
  assetsBaseDir?: string;
  /** Render fps (also the keyframe rate for normalization). Defaults to 30. */
  fps?: number;
  /**
   * Re-encode the source with dense keyframes so cut in-points seek exactly (no frame
   * freezing). Defaults to true. Set false to skip if your source is already all-keyframe.
   */
  normalize?: boolean;
}

/** Write a renderable composition project from an EDL; returns the output directory. */
export async function buildProject(args: BuildProjectArgs): Promise<string> {
  const { edl, videoPath, outDir, fps = 30, normalize = true } = args;
  const manifestPath = args.manifestPath ?? defaultManifestPath();
  const assetsBaseDir = args.assetsBaseDir ?? dirname(manifestPath);

  const manifest = await loadAssetManifest(manifestPath);

  // Probe the real duration + dimensions so timing is accurate and the canvas matches
  // the source aspect ratio (no cropping a portrait clip into a landscape frame).
  const info = await probeVideoInfo(videoPath);
  const sourceDuration = info.duration ?? edl.source_duration;
  const width = info.width ?? 1920;
  const height = info.height ?? 1080;

  const html = buildHtml({ edl, manifest, sourceDuration, width, height });

  await mkdir(outDir, { recursive: true });

  // Normalize for frame-accurate seeking; fall back to a plain copy if ffmpeg is absent.
  const dest = join(outDir, OUTPUT_VIDEO_NAME);
  const normalized = normalize ? await normalizeForSeeking(videoPath, dest, { fps }) : false;
  if (!normalized) {
    if (normalize) {
      console.warn(
        "Could not normalize source (ffmpeg missing or failed) — copying as-is. " +
          "Cuts may freeze on frames if the source has sparse keyframes.",
      );
    }
    await copyFile(videoPath, dest);
  }

  await copyReferencedAssets(edl, manifest, assetsBaseDir, outDir);
  await writeFile(join(outDir, "index.html"), html, "utf-8");

  return outDir;
}

/** Copy SFX/image asset files referenced by the EDL. Missing sources are skipped (silent placeholders). */
async function copyReferencedAssets(
  edl: Edl,
  manifest: AssetManifest,
  assetsBaseDir: string,
  outDir: string,
): Promise<void> {
  const ids = new Set<string>();
  for (const s of edl.sfx ?? []) ids.add(s.asset_id);
  for (const g of edl.graphics ?? []) if (g.type === "image" && g.asset_id) ids.add(g.asset_id);

  for (const id of ids) {
    const entry = manifest[id];
    if (!entry) continue;
    const src = join(assetsBaseDir, entry.path);
    if (!existsSync(src)) continue; // silent placeholder
    const dest = join(outDir, entry.path);
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(src, dest);
  }
}
