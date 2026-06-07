/**
 * Tiny, dependency-free HTML string builders.
 *
 * Deliberately no DOM library — the mapper emits a static composition string, and the
 * producer's compiler parses it. Keeping these as pure string helpers makes the output
 * deterministic and trivially snapshot-testable.
 */

import type { CaptionStyleId, GraphicPlacement } from "./types.js";

/** Escape text for safe insertion into element bodies and double-quoted attributes. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const num = (n: number): string => String(Math.round(n * 1000) / 1000);

/** A kept A-roll video segment (visual only; audio comes from the matching <audio>). */
export function videoEl(opts: {
  id: string;
  src: string;
  start: number;
  mediaStart: number;
  duration: number;
  sourceDuration: number;
}): string {
  return (
    `      <video id="${opts.id}" class="clip" src="${escapeHtml(opts.src)}" muted playsinline` +
    ` data-start="${num(opts.start)}" data-media-start="${num(opts.mediaStart)}"` +
    ` data-duration="${num(opts.duration)}" data-source-duration="${num(opts.sourceDuration)}"` +
    ` style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video>`
  );
}

/** An audio track (original voice segment or a layered SFX). */
export function audioEl(opts: {
  id: string;
  src: string;
  start: number;
  duration: number;
  mediaStart?: number;
  volume?: number;
}): string {
  const mediaStart =
    opts.mediaStart === undefined ? "" : ` data-media-start="${num(opts.mediaStart)}"`;
  const volume = opts.volume === undefined ? "" : ` data-volume="${num(opts.volume)}"`;
  return (
    `      <audio id="${opts.id}" src="${escapeHtml(opts.src)}"` +
    ` data-start="${num(opts.start)}" data-duration="${num(opts.duration)}"${mediaStart}${volume}></audio>`
  );
}

/**
 * CSS positioning for an overlay placement. Offsets are expressed as percentages of the
 * frame so placement is correct for any aspect ratio (portrait, landscape, square).
 */
export function placementCss(placement: GraphicPlacement): string {
  switch (placement) {
    case "middle_center":
      return "left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;";
    case "top_center":
      return "left:0;right:0;top:7%;text-align:center;";
    case "lower_third":
      return "left:0;right:0;bottom:15%;text-align:center;";
    case "top_left":
      return "left:5%;top:5%;text-align:left;";
    case "top_right":
      return "right:5%;top:5%;text-align:right;";
    case "bottom_center":
    default:
      return "left:0;right:0;bottom:9%;text-align:center;";
  }
}

/**
 * A generic timed overlay block (text already escaped / pre-rendered as innerHtml).
 * `class="clip"` is required for the runtime to gate visibility to [start, start+duration];
 * `data-track-index` (not the deprecated `data-layer`) controls the layer/z-order.
 */
export function overlayEl(opts: {
  id: string;
  start: number;
  duration: number;
  trackIndex: number;
  style: string;
  innerHtml: string;
}): string {
  return (
    `      <div id="${opts.id}" class="overlay clip" data-start="${num(opts.start)}"` +
    ` data-duration="${num(opts.duration)}" data-track-index="${opts.trackIndex}"` +
    ` style="position:absolute;z-index:${opts.trackIndex};${opts.style}">${opts.innerHtml}</div>`
  );
}

/** Assemble the full composition document at the given (source-matched) dimensions. */
export function document(opts: {
  width: number;
  height: number;
  outputDuration: number;
  stageInner: string;
  overlays: string;
  audios: string;
  timelineScript: string;
  /** Google Fonts query string for the selected caption style only. */
  captionFontQuery?: string;
  /** Selected subtitle style id (written to root for verification). */
  subtitleStyleId?: CaptionStyleId;
}): string {
  const { width, height } = opts;
  const fontLinks = opts.captionFontQuery
    ? `    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?${opts.captionFontQuery}&display=swap" rel="stylesheet" />
`
    : "";
  const styleAttr = opts.subtitleStyleId
    ? `\n      data-subtitle-style="${escapeHtml(opts.subtitleStyleId)}"`
    : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
${fontLinks}    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: ${width}px; height: ${height}px; overflow: hidden; background: #000; }
      .overlay { color: #fff; font-family: Inter, system-ui, sans-serif; }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="${num(opts.outputDuration)}"
      data-width="${width}"
      data-height="${height}"${styleAttr}
    >
      <div id="aroll-stage" style="position:absolute;inset:0">
${opts.stageInner}
      </div>
${opts.audios}
${opts.overlays}
    </div>

    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
${opts.timelineScript}
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;
}
