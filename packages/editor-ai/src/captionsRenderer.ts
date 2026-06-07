/**
 * Caption HTML + GSAP per subtitle style (subtitlesguide.md).
 * Each caption_style_id maps to exactly one renderer branch.
 */

import * as h from "./html.js";
import { srcToOut, type KeptTimeline } from "./timeline.js";
import type { CaptionStyleId, Graphic, StyleDecisions } from "./types.js";

const num = (n: number): string => String(Math.round(n * 1000) / 1000);
const ACTIVE_YELLOW = "#F7C204";
const DEFAULT_ACCENT = "#F7C204";

function outTime(t: number, g: Graphic, timeline: KeptTimeline): number {
  return g.timeline_base === "output" ? t : srcToOut(t, timeline);
}

export interface StackedCaptionResult {
  html: string;
  gsap: string;
}

export class CaptionStyleMismatchError extends Error {
  constructor(
    public readonly expected: CaptionStyleId,
    public readonly actual: string | undefined,
    public readonly overlayId: string,
  ) {
    super(
      `Caption style mismatch on ${overlayId}: expected "${expected}" but got "${actual ?? "(missing)"}".`,
    );
    this.name = "CaptionStyleMismatchError";
  }
}

function requireStyleId(overlayId: string, g: Graphic, edlStyleId: CaptionStyleId): CaptionStyleId {
  const styleId = g.caption_style_id;
  if (!styleId) {
    throw new CaptionStyleMismatchError(edlStyleId, undefined, overlayId);
  }
  if (styleId !== edlStyleId) {
    throw new CaptionStyleMismatchError(edlStyleId, styleId, overlayId);
  }
  return styleId;
}

export function buildStackedCaption(
  id: string,
  g: Graphic,
  style: StyleDecisions,
  timeline: KeptTimeline,
  width: number,
  _height: number,
  edlStyleId: CaptionStyleId,
): StackedCaptionResult {
  const styleId = requireStyleId(id, g, edlStyleId);

  switch (styleId) {
    case "hormozi_classic":
      return buildHormoziClassicCaption(id, g, timeline, width);
    case "pill_box":
      return buildPillBoxCaption(id, g, style, timeline, width);
    case "beat_bounce":
      return buildBeatBounceCaption(id, g, style, timeline, width);
    case "karaoke_sweep":
      return buildKaraokeSweepCaption(id, g, style, timeline, width);
    case "hormozi_serifpop":
      return buildHormoziSerifpopCaption(id, g, timeline, width);
    default: {
      const _exhaustive: never = styleId;
      throw new Error(`Unknown caption style: ${_exhaustive}`);
    }
  }
}

function chunkOutTween(id: string, g: Graphic, timeline: KeptTimeline, duration = 0.09): string[] {
  const at = outTime(g.end, g, timeline);
  return [
    `      tl.to("#${id}", { opacity: 0, duration: ${duration}, ease: "power1.in" }, ${num(at - duration)});`,
    `      tl.set("#${id}", { opacity: 1 }, 0);`,
  ];
}

function buildHormoziSerifpopCaption(
  id: string,
  g: Graphic,
  timeline: KeptTimeline,
  width: number,
): StackedCaptionResult {
  const sx = width / 1080;
  const normalSize = Math.round(76 * sx);
  const emphSize = Math.round(92 * sx);
  const spans: string[] = [];
  const tweens: string[] = [];

  (g.words ?? []).forEach((w, wi) => {
    const wid = `${id}-w${wi}`;
    const emphasis = w.emphasis === true;
    const font = emphasis
      ? `'DM Serif Display', Georgia, serif`
      : `'Montserrat', system-ui, sans-serif`;
    const size = emphasis ? emphSize : normalSize;
    const color = emphasis ? "#FFB627" : "#FFFFFF";
    const scale = emphasis ? 0.8 : 0.92;

    spans.push(
      `<span id="${wid}" style="display:inline-block;opacity:0;transform:translateY(14px) scale(${scale});` +
        `font-family:${font};font-size:${size}px;font-weight:${emphasis ? 400 : 800};` +
        `font-style:${emphasis ? "italic" : "normal"};color:${color};` +
        `text-shadow:${emphasis ? "0 0 0 rgba(0,0,0,0)" : "0 3px 10px rgba(0,0,0,0.55)"};` +
        `margin-right:0.25em;">${h.escapeHtml(w.word)}</span>`,
    );

    const at = outTime(w.start, g, timeline);
    tweens.push(
      `      tl.to("#${wid}", { opacity: 1, y: 0, scale: 1, duration: ${emphasis ? 0.16 : 0.14}, ease: "${emphasis ? "back.out(2.6)" : "back.out(2)"}" }, ${num(at)});`,
    );
    if (emphasis) {
      tweens.push(
        `      tl.to("#${wid}", { textShadow: "0 0 18px rgba(255,182,39,0.85), 0 0 36px rgba(255,150,0,0.55)", duration: 0.16 }, ${num(at)});`,
      );
    }
  });

  const blockEnd = outTime(g.end, g, timeline);
  tweens.push(
    `      tl.to("#${id}", { opacity: 0, duration: 0.12, ease: "power1.in" }, ${num(blockEnd - 0.12)});`,
    `      tl.set("#${id}", { opacity: 1 }, 0);`,
  );

  return { html: spans.join(""), gsap: tweens.join("\n") };
}

function buildHormoziClassicCaption(
  id: string,
  g: Graphic,
  timeline: KeptTimeline,
  width: number,
): StackedCaptionResult {
  const sx = width / 1080;
  const fontSize = Math.round(84 * sx);
  const stroke = Math.max(4, Math.round(8 * sx));
  const spans: string[] = [];
  const tweens: string[] = [];
  const words = g.words ?? [];
  const chunkStart = outTime(g.start, g, timeline);

  words.forEach((w, wi) => {
    const wid = `${id}-w${wi}`;
    spans.push(
      `<span id="${wid}" style="display:inline-block;color:#FFFFFF;` +
        `font-family:'Montserrat',system-ui,sans-serif;font-size:${fontSize}px;font-weight:900;` +
        `text-transform:uppercase;letter-spacing:0.5px;margin-right:0.35em;` +
        `-webkit-text-stroke:${stroke}px #000000;paint-order:stroke fill;` +
        `text-shadow:0 4px 0 rgba(0,0,0,0.55);line-height:1.04;">${h.escapeHtml(w.word.toUpperCase())}</span>`,
    );

    const at = outTime(w.start, g, timeline);
    tweens.push(`      tl.set("#${wid}", { color: "${ACTIVE_YELLOW}" }, ${num(at)});`);
    const next = words[wi + 1];
    if (next) {
      const nextAt = outTime(next.start, g, timeline);
      tweens.push(`      tl.set("#${wid}", { color: "#FFFFFF" }, ${num(nextAt)});`);
    }
  });

  tweens.push(
    `      tl.fromTo("#${id}", { opacity: 0, y: 40, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: 0.15, ease: "back.out(2.2)" }, ${num(chunkStart)});`,
    ...chunkOutTween(id, g, timeline, 0.09),
  );

  return { html: spans.join(""), gsap: tweens.join("\n") };
}

function buildPillBoxCaption(
  id: string,
  g: Graphic,
  style: StyleDecisions,
  timeline: KeptTimeline,
  width: number,
): StackedCaptionResult {
  const sx = width / 1080;
  const fontSize = Math.round(64 * sx);
  const padY = Math.max(4, Math.round(8 * sx));
  const padX = Math.max(10, Math.round(18 * sx));
  const radius = Math.max(8, Math.round(14 * sx));
  const accent = style.accent_color || DEFAULT_ACCENT;
  const spans: string[] = [];
  const tweens: string[] = [];
  const words = g.words ?? [];

  words.forEach((w, wi) => {
    const pillId = `${id}-pill${wi}`;
    const textId = `${id}-w${wi}`;
    spans.push(
      `<span id="${pillId}" style="display:inline-block;opacity:0;transform:scale(0.7);` +
        `background:rgba(0,0,0,0.82);border-radius:${radius}px;padding:${padY}px ${padX}px;` +
        `margin:4px 5px;box-shadow:0 4px 12px rgba(0,0,0,0.35);line-height:1.35;">` +
        `<span id="${textId}" style="color:#FFFFFF;font-family:'Montserrat',system-ui,sans-serif;` +
        `font-size:${fontSize}px;font-weight:800;">${h.escapeHtml(w.word)}</span></span>`,
    );

    const at = outTime(w.start, g, timeline);
    tweens.push(
      `      tl.to("#${pillId}", { opacity: 1, scale: 1, duration: 0.14, ease: "back.out(2.4)" }, ${num(at)});`,
      `      tl.set("#${pillId}", { backgroundColor: "${accent}" }, ${num(at)});`,
      `      tl.set("#${textId}", { color: "#000000" }, ${num(at)});`,
    );

    const next = words[wi + 1];
    if (next) {
      const nextAt = outTime(next.start, g, timeline);
      tweens.push(
        `      tl.set("#${pillId}", { backgroundColor: "rgba(0,0,0,0.82)" }, ${num(nextAt)});`,
        `      tl.set("#${textId}", { color: "#FFFFFF" }, ${num(nextAt)});`,
      );
    }
  });

  const blockEnd = outTime(g.end, g, timeline);
  tweens.push(
    `      tl.to("#${id}", { opacity: 0, duration: 0.11, ease: "power1.in" }, ${num(blockEnd - 0.11)});`,
    `      tl.set("#${id}", { opacity: 1 }, 0);`,
  );

  return { html: spans.join(""), gsap: tweens.join("\n") };
}

function buildBeatBounceCaption(
  id: string,
  g: Graphic,
  style: StyleDecisions,
  timeline: KeptTimeline,
  width: number,
): StackedCaptionResult {
  const sx = width / 1080;
  const fontSize = Math.round(150 * sx);
  const stroke = Math.max(2, Math.round(4 * sx));
  const w = g.words?.[0];
  if (!w) return { html: "", gsap: "" };

  const accent = style.accent_color || DEFAULT_ACCENT;
  const color = w.emphasis ? accent : "#FFFFFF";
  const wid = `${id}-w0`;
  const at = outTime(w.start, g, timeline);
  const outAt = outTime(g.end, g, timeline) - 0.07;

  const html =
    `<span id="${wid}" style="display:inline-block;opacity:0;transform:scale(0.4) scaleY(1.25);` +
    `font-family:'Bebas Neue',Impact,sans-serif;font-size:${fontSize}px;font-weight:400;` +
    `text-transform:uppercase;letter-spacing:2px;color:${color};line-height:1;` +
    `-webkit-text-stroke:${stroke}px #000000;paint-order:stroke fill;` +
    `text-shadow:0 6px 14px rgba(0,0,0,0.5);">${h.escapeHtml(w.word.toUpperCase())}</span>`;

  const gsap = [
    `      tl.to("#${wid}", { opacity: 1, scale: 1.12, scaleY: 0.95, duration: 0.13, ease: "back.out(3)" }, ${num(at)});`,
    `      tl.to("#${wid}", { scale: 1, scaleY: 1, duration: 0.09, ease: "back.out(3)" }, ${num(at + 0.13)});`,
    `      tl.to("#${wid}", { scale: 0.85, opacity: 0, duration: 0.07, ease: "power2.in" }, ${num(Math.max(at + 0.05, outAt))});`,
    `      tl.set("#${id}", { opacity: 1 }, 0);`,
  ].join("\n");

  return { html, gsap };
}

function buildKaraokeSweepCaption(
  id: string,
  g: Graphic,
  style: StyleDecisions,
  timeline: KeptTimeline,
  width: number,
): StackedCaptionResult {
  const sx = width / 1080;
  const fontSize = Math.round(68 * sx);
  const accent = style.accent_color || DEFAULT_ACCENT;
  const spans: string[] = [];
  const tweens: string[] = [];
  const words = g.words ?? [];
  const phraseStart = outTime(g.start, g, timeline);

  words.forEach((w, wi) => {
    const wrapId = `${id}-wrap${wi}`;
    const fillId = `${id}-fill${wi}`;
    const baseId = `${id}-base${wi}`;
    spans.push(
      `<span id="${wrapId}" style="display:inline-block;position:relative;margin:0 0.2em;vertical-align:baseline;">` +
        `<span id="${baseId}" style="color:rgba(255,255,255,0.45);font-family:'Inter',system-ui,sans-serif;` +
        `font-size:${fontSize}px;font-weight:800;line-height:1.25;` +
        `text-shadow:0 2px 10px rgba(0,0,0,0.6);">${h.escapeHtml(w.word)}</span>` +
        `<span id="${fillId}" style="position:absolute;left:0;top:0;overflow:hidden;width:0%;` +
        `white-space:nowrap;color:${accent};font-family:'Inter',system-ui,sans-serif;` +
        `font-size:${fontSize}px;font-weight:800;line-height:1.25;` +
        `text-shadow:0 2px 10px rgba(0,0,0,0.6);">${h.escapeHtml(w.word)}</span></span>`,
    );

    const wordStart = outTime(w.start, g, timeline);
    const wordDur = Math.max(0.05, w.end - w.start);
    tweens.push(
      `      tl.to("#${fillId}", { width: "100%", duration: ${num(wordDur)}, ease: "none" }, ${num(wordStart)});`,
      `      tl.set("#${fillId}", { color: "#FFFFFF" }, ${num(wordStart + wordDur)});`,
    );
  });

  tweens.push(
    `      tl.to("#${id}", { opacity: 1, duration: 0.14 }, ${num(phraseStart)});`,
    `      tl.set("#${id}", { opacity: 0 }, 0);`,
    ...chunkOutTween(id, g, timeline, 0.12),
  );

  return { html: spans.join(""), gsap: tweens.join("\n") };
}

/** Resolve the authoritative style id from an EDL before rendering. */
export function resolveEdlSubtitleStyleId(edl: {
  subtitle_style_id?: CaptionStyleId;
  graphics?: Graphic[];
}): CaptionStyleId {
  const captions = (edl.graphics ?? []).filter((g) => g.type === "caption");
  const declared = edl.subtitle_style_id ?? captions[0]?.caption_style_id ?? "hormozi_serifpop";

  for (const g of captions) {
    if (g.caption_style_id && g.caption_style_id !== declared) {
      throw new CaptionStyleMismatchError(declared, g.caption_style_id, "edl");
    }
  }

  return declared;
}

/** Google Font families required for a single caption style. */
export function fontsForCaptionStyle(styleId: CaptionStyleId): string {
  switch (styleId) {
    case "hormozi_serifpop":
      return "family=DM+Serif+Display:ital@0;1&family=Montserrat:wght@800";
    case "hormozi_classic":
      return "family=Montserrat:wght@900";
    case "pill_box":
      return "family=Montserrat:wght@800";
    case "beat_bounce":
      return "family=Bebas+Neue";
    case "karaoke_sweep":
      return "family=Inter:wght@800";
    default: {
      const _exhaustive: never = styleId;
      return _exhaustive;
    }
  }
}
