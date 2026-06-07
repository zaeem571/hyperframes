/**
 * Build spoken-word caption graphics from a corrected whisper transcript.
 * Style-specific chunking per config/subtitlesguide.md.
 */

import { computeKeptSegments, srcToOut } from "./timeline.js";
import type { CaptionStyleId, Cut, Graphic, MotionGraphicRequest } from "./types.js";
import { round3, type TranscriptWord } from "./transcript.js";

/** No caption word may render within ±BLACKOUT of a cut join (output seconds). */
export const TRANSITION_BLACKOUT_SEC = 0.2;

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "so",
  "it",
  "its",
  "is",
  "are",
  "was",
  "were",
  "be",
  "to",
  "of",
  "in",
  "on",
  "at",
  "for",
  "with",
  "as",
  "by",
  "that",
  "this",
  "these",
  "those",
  "i",
  "you",
  "we",
  "they",
  "he",
  "she",
  "my",
  "your",
  "our",
  "their",
  "if",
  "not",
  "no",
  "yes",
  "um",
  "uh",
  "like",
  "just",
  "really",
  "very",
]);

export interface BuildCaptionGraphicsOptions {
  words: TranscriptWord[];
  pauseGapSeconds?: number;
  captionStyleId: CaptionStyleId;
  motionGraphicRequests?: MotionGraphicRequest[];
}

/** Pick exactly one emphasis word index per line (hormozi_serifpop, beat_bounce). */
export function pickEmphasisWordIndex(words: TranscriptWord[]): number {
  if (words.length === 0) return 0;
  if (words.length === 1) return 0;

  const candidates: Array<{ index: number; score: number }> = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const bare = w.text.replace(/[^\w']/g, "").toLowerCase();
    if (!bare || STOP_WORDS.has(bare)) continue;
    let score = bare.length;
    if (i === 0 || i === words.length - 1) score -= 2;
    candidates.push({ index: i, score });
  }

  if (candidates.length === 0) {
    const mid = Math.floor(words.length / 2);
    return Math.min(Math.max(mid, 0), words.length - 1);
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]!.index;
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

function isHiddenByFullGraphic(
  start: number,
  end: number,
  requests: MotionGraphicRequest[],
): boolean {
  return requests.some((r) => r.coverage === "full" && overlaps(start, end, r.start, r.end));
}

function splitIntoLines(
  words: TranscriptWord[],
  maxWordsPerLine: number,
  pauseGapSeconds: number,
): TranscriptWord[][] {
  const lines: TranscriptWord[][] = [];
  let current: TranscriptWord[] = [];

  for (const w of words) {
    if (!w.text.trim()) continue;
    const prev = current[current.length - 1];
    const gap = prev ? w.start - prev.end : 0;
    const lineFull = current.length >= maxWordsPerLine;
    const pauseBreak = prev && gap >= pauseGapSeconds;

    if (current.length > 0 && (lineFull || pauseBreak)) {
      lines.push(current);
      current = [];
    }
    current.push(w);
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

/** Resolve caption zone — style-aware defaults + coexistence overrides. */
export function resolveCaptionZone(
  styleId: CaptionStyleId,
  lineIndex: number,
  lineStart: number,
  lineEnd: number,
  requests: MotionGraphicRequest[],
): Graphic["caption_zone"] {
  for (const r of requests) {
    if (!overlaps(lineStart, lineEnd, r.start, r.end)) continue;
    if (r.coverage === "full") return undefined;
    return styleId === "beat_bounce" ? "zone_center" : "zone_top";
  }

  switch (styleId) {
    case "beat_bounce":
      return "zone_center";
    case "hormozi_classic":
    case "pill_box":
    case "karaoke_sweep":
      return "zone_midlow";
    default:
      return lineIndex % 2 === 0 ? "zone_top" : "zone_midlow";
  }
}

function wordsToGraphic(
  line: TranscriptWord[],
  captionStyleId: CaptionStyleId,
  zone: Graphic["caption_zone"],
  end: number,
  emphasisIndex?: number,
): Graphic {
  return {
    start: round3(line[0]!.start),
    end: round3(end),
    type: "caption",
    text: line.map((w) => w.text).join(" "),
    caption_zone: zone,
    caption_style_id: captionStyleId,
    words: line.map((w, wi) => ({
      word: w.text,
      start: round3(w.start),
      end: round3(w.end),
      emphasis: emphasisIndex === undefined ? undefined : wi === emphasisIndex,
    })),
  };
}

export function buildCaptionGraphicsFromTranscript(opts: BuildCaptionGraphicsOptions): Graphic[] {
  const { words, pauseGapSeconds = 0.6, captionStyleId, motionGraphicRequests = [] } = opts;
  if (words.length === 0) return [];

  switch (captionStyleId) {
    case "beat_bounce":
      return buildBeatBounceCaptions(words, captionStyleId, motionGraphicRequests);
    case "hormozi_classic":
      return buildChunkReplaceCaptions(
        words,
        captionStyleId,
        motionGraphicRequests,
        3,
        pauseGapSeconds,
      );
    case "karaoke_sweep":
      return buildPhraseCaptions(words, captionStyleId, motionGraphicRequests, 6, pauseGapSeconds);
    case "pill_box":
      return buildBuildUpCaptions(
        words,
        captionStyleId,
        motionGraphicRequests,
        4,
        pauseGapSeconds,
        false,
      );
    default:
      return buildBuildUpCaptions(
        words,
        captionStyleId,
        motionGraphicRequests,
        4,
        pauseGapSeconds,
        true,
      );
  }
}

function buildBeatBounceCaptions(
  words: TranscriptWord[],
  captionStyleId: CaptionStyleId,
  requests: MotionGraphicRequest[],
): Graphic[] {
  const filtered = words.filter((w) => w.text.trim());
  const graphics: Graphic[] = [];

  filtered.forEach((w, i) => {
    const nextStart = filtered[i + 1]?.start ?? w.end;
    const end = nextStart > w.start ? nextStart : w.end;
    if (isHiddenByFullGraphic(w.start, end, requests)) return;

    const zone = resolveCaptionZone(captionStyleId, i, w.start, end, requests);
    if (!zone) return;

    graphics.push(wordsToGraphic([w], captionStyleId, zone, end, pickEmphasisWordIndex([w])));
  });

  return graphics;
}

function buildChunkReplaceCaptions(
  words: TranscriptWord[],
  captionStyleId: CaptionStyleId,
  requests: MotionGraphicRequest[],
  maxWords: number,
  pauseGapSeconds: number,
): Graphic[] {
  const lines = splitIntoLines(words, maxWords, pauseGapSeconds);
  const graphics: Graphic[] = [];

  lines.forEach((line, lineIndex) => {
    const nextLineStart = lines[lineIndex + 1]?.[0]?.start;
    const end = nextLineStart ?? line[line.length - 1]!.end;
    if (isHiddenByFullGraphic(line[0]!.start, end, requests)) return;

    const zone = resolveCaptionZone(captionStyleId, lineIndex, line[0]!.start, end, requests);
    if (!zone) return;

    graphics.push(wordsToGraphic(line, captionStyleId, zone, end));
  });

  return graphics;
}

function buildPhraseCaptions(
  words: TranscriptWord[],
  captionStyleId: CaptionStyleId,
  requests: MotionGraphicRequest[],
  maxWords: number,
  pauseGapSeconds: number,
): Graphic[] {
  const lines = splitIntoLines(words, maxWords, pauseGapSeconds);
  const graphics: Graphic[] = [];

  lines.forEach((line, lineIndex) => {
    const start = line[0]!.start;
    const nextLineStart = lines[lineIndex + 1]?.[0]?.start;
    const end = nextLineStart ?? line[line.length - 1]!.end;
    if (isHiddenByFullGraphic(start, end, requests)) return;

    const zone = resolveCaptionZone(captionStyleId, lineIndex, start, end, requests);
    if (!zone) return;

    graphics.push(wordsToGraphic(line, captionStyleId, zone, end));
  });

  return graphics;
}

function buildBuildUpCaptions(
  words: TranscriptWord[],
  captionStyleId: CaptionStyleId,
  requests: MotionGraphicRequest[],
  maxWords: number,
  pauseGapSeconds: number,
  useEmphasis: boolean,
): Graphic[] {
  const lines = splitIntoLines(words, maxWords, pauseGapSeconds);
  const graphics: Graphic[] = [];

  lines.forEach((line, lineIndex) => {
    const start = line[0]!.start;
    const nextLineStart = lines[lineIndex + 1]?.[0]?.start;
    const end = nextLineStart ?? line[line.length - 1]!.end;
    if (isHiddenByFullGraphic(start, end, requests)) return;

    const zone = resolveCaptionZone(captionStyleId, lineIndex, start, end, requests);
    if (!zone) return;

    const emphasisIndex = useEmphasis ? pickEmphasisWordIndex(line) : undefined;
    graphics.push(wordsToGraphic(line, captionStyleId, zone, end, emphasisIndex));
  });

  return graphics;
}

/** Merge whisper captions with non-caption graphics from the editor EDL. */
export function mergeEdlWithTranscriptCaptions(
  edl: { graphics: Graphic[] },
  captionGraphics: Graphic[],
): void {
  const nonCaptions = (edl.graphics ?? []).filter((g) => g.type !== "caption");
  edl.graphics = [...nonCaptions, ...captionGraphics].sort((a, b) => a.start - b.start);
}

export function defaultCaptionStyleFromTranscript(words: TranscriptWord[]): {
  caption_style: "karaoke" | "block";
} {
  return { caption_style: words.length > 0 ? "karaoke" : "block" };
}

/** Words that survive Stage B cuts (no overlap with any cut span). */
export function filterKeptWords(words: TranscriptWord[], cuts: Cut[]): TranscriptWord[] {
  return words.filter((w) => !cuts.some((c) => w.start < c.end - 1e-6 && w.end > c.start + 1e-6));
}

export function mapWordsToOutputTimeline(
  words: TranscriptWord[],
  cuts: Cut[],
  sourceDuration: number,
): TranscriptWord[] {
  const timeline = computeKeptSegments(cuts, sourceDuration);
  return words.map((w) => ({
    ...w,
    start: round3(srcToOut(w.start, timeline)),
    end: round3(srcToOut(w.end, timeline)),
  }));
}

export function buildTransitionBlackoutWindows(
  cuts: Cut[],
  sourceDuration: number,
  blackoutSec = TRANSITION_BLACKOUT_SEC,
): Array<{ start: number; end: number }> {
  const timeline = computeKeptSegments(cuts, sourceDuration);
  return cuts.map((c) => {
    const join = srcToOut(c.end, timeline);
    return { start: round3(join - blackoutSec), end: round3(join + blackoutSec) };
  });
}

export function applyTransitionBlackoutToGraphics(
  graphics: Graphic[],
  blackoutWindows: Array<{ start: number; end: number }>,
): Graphic[] {
  return graphics.flatMap((g) => {
    if (!g.words?.length) return [g];
    const keptWords = g.words.filter(
      (w) => !blackoutWindows.some((win) => w.start >= win.start && w.start <= win.end),
    );
    if (keptWords.length === 0) return [];
    return [
      {
        ...g,
        words: keptWords,
        start: keptWords[0]!.start,
        end: keptWords[keptWords.length - 1]!.end,
        text: keptWords.map((w) => w.word).join(" "),
      },
    ];
  });
}

function remapMotionGraphicsToOutput(
  requests: MotionGraphicRequest[],
  cuts: Cut[],
  sourceDuration: number,
): MotionGraphicRequest[] {
  const timeline = computeKeptSegments(cuts, sourceDuration);
  return requests.map((r) => ({
    ...r,
    start: round3(srcToOut(r.start, timeline)),
    end: round3(srcToOut(r.end, timeline)),
  }));
}

export interface BuildPostCutCaptionGraphicsOptions {
  words: TranscriptWord[];
  cuts: Cut[];
  sourceDuration: number;
  captionStyleId: CaptionStyleId;
  motionGraphicRequests?: MotionGraphicRequest[];
  pauseGapSeconds?: number;
}

/** Captions from kept words on the post-cut OUTPUT timeline + transition blackout. */
export function buildPostCutCaptionGraphics(opts: BuildPostCutCaptionGraphicsOptions): Graphic[] {
  const kept = filterKeptWords(opts.words, opts.cuts);
  const outputWords = mapWordsToOutputTimeline(kept, opts.cuts, opts.sourceDuration);
  const mgOutput = remapMotionGraphicsToOutput(
    opts.motionGraphicRequests ?? [],
    opts.cuts,
    opts.sourceDuration,
  );

  const raw = buildCaptionGraphicsFromTranscript({
    words: outputWords,
    captionStyleId: opts.captionStyleId,
    motionGraphicRequests: mgOutput,
    pauseGapSeconds: opts.pauseGapSeconds,
  });

  const marked = raw.map((g) => ({ ...g, timeline_base: "output" as const }));
  const windows = buildTransitionBlackoutWindows(opts.cuts, opts.sourceDuration);
  return applyTransitionBlackoutToGraphics(marked, windows);
}
