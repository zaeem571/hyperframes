/**
 * The core timing math — pure, no I/O, fully unit-testable.
 *
 * `cuts` in the EDL are spans of dead air to REMOVE. Everything else in the EDL
 * (punch_ins, graphics, sfx, karaoke word timings) is expressed in SOURCE seconds.
 * After the cuts are removed the timeline is compressed, so every source time must be
 * re-based onto the OUTPUT timeline before it can become a `data-start` / GSAP position.
 *
 * `data-media-start` is the ONLY value that stays in source coordinates — it is the
 * offset INTO the original file where a kept segment begins playing.
 */

import type { Cut } from "./types.js";

/** One surviving span of the source after cuts are removed. */
export interface KeptSegment {
  /** Where this segment starts in the SOURCE file (-> data-media-start). */
  srcStart: number;
  /** Where this segment ends in the SOURCE file. */
  srcEnd: number;
  /** Length of the segment in seconds (-> data-duration). */
  len: number;
  /** Where this segment starts on the OUTPUT timeline (-> data-start). */
  outStart: number;
}

export interface KeptTimeline {
  segments: KeptSegment[];
  /** Total duration of the edited output (sum of kept segment lengths). */
  outputDuration: number;
}

const EPS = 1e-6;

/**
 * Invert `cuts` over [0, sourceDuration] to get the kept segments.
 * Cuts are clamped, emptied/inverted ones dropped, then sorted and merged before
 * inversion, so overlapping or unsorted model output is handled safely.
 */
export function computeKeptSegments(cuts: Cut[], sourceDuration: number): KeptTimeline {
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) {
    return { segments: [], outputDuration: 0 };
  }

  // 1. Sanitize: clamp to bounds, drop empty/inverted spans.
  const norm = cuts
    .map((c) => ({
      start: Math.min(Math.max(c.start, 0), sourceDuration),
      end: Math.min(Math.max(c.end, 0), sourceDuration),
    }))
    .filter((c) => c.end - c.start > EPS)
    .sort((a, b) => a.start - b.start);

  // 2. Merge overlapping / adjacent cuts.
  const merged: Array<{ start: number; end: number }> = [];
  for (const c of norm) {
    const last = merged[merged.length - 1];
    if (last && c.start <= last.end + EPS) {
      last.end = Math.max(last.end, c.end);
    } else {
      merged.push({ ...c });
    }
  }

  // 3. Invert over [0, sourceDuration], accumulating output positions.
  const segments: KeptSegment[] = [];
  let cursor = 0;
  let outStart = 0;
  const pushKept = (srcStart: number, srcEnd: number): void => {
    const len = srcEnd - srcStart;
    if (len <= EPS) return;
    segments.push({ srcStart, srcEnd, len, outStart });
    outStart += len;
  };

  for (const c of merged) {
    pushKept(cursor, c.start);
    cursor = c.end;
  }
  pushKept(cursor, sourceDuration);

  return { segments, outputDuration: outStart };
}

/**
 * Map a SOURCE time onto the OUTPUT timeline.
 *
 * If the time lands inside a kept segment it maps linearly. If it lands inside a
 * removed cut (or before the first segment), it snaps to the end of the preceding kept
 * segment (or 0). Times past the last segment snap to outputDuration.
 */
export function srcToOut(t: number, timeline: KeptTimeline): number {
  const { segments, outputDuration } = timeline;
  if (segments.length === 0) return 0;

  for (const seg of segments) {
    if (t < seg.srcStart) {
      // Falls before this segment (inside a cut or before the start) -> snap back.
      return seg.outStart;
    }
    if (t <= seg.srcEnd + EPS) {
      return seg.outStart + (t - seg.srcStart);
    }
  }
  // Past the end of the last kept segment.
  return outputDuration;
}

/**
 * Remap a SOURCE span [start,end] onto the OUTPUT timeline. The removed middle of a
 * straddling span collapses. Returns null if nothing survives (span fully inside a cut).
 */
export function spanToOut(
  start: number,
  end: number,
  timeline: KeptTimeline,
): { start: number; duration: number } | null {
  const outStart = srcToOut(start, timeline);
  const outEnd = srcToOut(end, timeline);
  const duration = outEnd - outStart;
  if (duration <= EPS) return null;
  return { start: outStart, duration };
}
