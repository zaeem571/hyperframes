/**
 * Stage B: deterministic cut resolver — word-ID decisions → SOURCE-second cuts,
 * punch_ins, and pace[] per config/cutsdesign.md (9-step algorithm).
 */

import { computeKeptSegments } from "./timeline.js";
import type { TranscriptWord } from "./transcript.js";
import type {
  Cut,
  CutReason,
  PaceRamp,
  PunchIn,
  SeamQuality,
  SemanticCutsDecision,
  SemanticEmphasisKind,
  SemanticRemoveReason,
} from "./types.js";

const ROUND = (n: number): number => Math.round(n * 1000) / 1000;

const MIN_CUT_LEN = 0.3;
const PAUSE_FLOOR = 0.8;
const BREATH_PAD = 0.12;
const MIN_KEPT_BETWEEN = 1.0;
const CUTS_PER_MIN = 8;
const MERGE_GAP = 0.05;
const HOOK_PAYOFF_GUARD = 0.2;
const SEAM_TIGHT = 0.06;

const CONTINUATION_STARTERS = new Set(["or", "and", "but", "nor", "yet", "so"]);

const EMPHASIS_SCALE: Record<SemanticEmphasisKind, number> = {
  hook: 1.12,
  key_number: 1.18,
  payoff: 1.15,
  key_claim: 1.1,
};

const EMPHASIS_PRIORITY: Record<SemanticEmphasisKind, number> = {
  key_number: 4,
  payoff: 3,
  hook: 2,
  key_claim: 1,
};

const REMOVE_PRIORITY: Record<SemanticRemoveReason, number> = {
  filler: 5,
  false_start: 5,
  repeat: 4,
  dead_air: 2,
  tangent: 1,
};

export interface ResolveCutsOptions {
  words: TranscriptWord[];
  sourceDuration: number;
  decision: SemanticCutsDecision;
}

export interface ResolveCutsResult {
  cuts: Cut[];
  punch_ins: PunchIn[];
  pace: PaceRamp[];
}

interface ResolvedCutDraft {
  start: number;
  end: number;
  reason: SemanticRemoveReason;
  fromIdx: number;
  toIdx: number;
}

interface WordRemovalSpan {
  fromIdx: number;
  toIdx: number;
  reason: SemanticRemoveReason;
}

interface EmphasisDraft {
  start: number;
  end: number;
  kind: SemanticEmphasisKind;
  fromIdx: number;
  toIdx: number;
}

export function parseWordIndex(id: string): number {
  const m = /^w(\d+)$/.exec(id);
  if (!m) throw new Error(`Invalid word id: ${id}`);
  return Number.parseInt(m[1]!, 10);
}

/** STEP 1 — merge adjacent / near-adjacent word-ID removals before any length filtering. */
function mergeWordRemovalSpans(
  removes: SemanticCutsDecision["remove"],
  words: TranscriptWord[],
): WordRemovalSpan[] {
  const spans = (removes ?? [])
    .map((r) => ({
      fromIdx: parseWordIndex(r.from_word),
      toIdx: parseWordIndex(r.to_word),
      reason: r.reason,
    }))
    .filter((s) => s.fromIdx <= s.toIdx && s.fromIdx < words.length && s.toIdx < words.length)
    .sort((a, b) => a.fromIdx - b.fromIdx || a.toIdx - b.toIdx);

  const merged: WordRemovalSpan[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push({ ...span });
      continue;
    }

    const consecutiveOrOverlap = span.fromIdx <= last.toIdx + 1;
    const nearAdjacent =
      !consecutiveOrOverlap && words[span.fromIdx]!.start - words[last.toIdx]!.end < MIN_CUT_LEN;

    if (consecutiveOrOverlap || nearAdjacent) {
      last.toIdx = Math.max(last.toIdx, span.toIdx);
      if (REMOVE_PRIORITY[span.reason] > REMOVE_PRIORITY[last.reason]) {
        last.reason = span.reason;
      }
    } else {
      merged.push({ ...span });
    }
  }

  return merged;
}

function gapLength(words: TranscriptWord[], leftIdx: number): number {
  if (leftIdx < 0 || leftIdx >= words.length - 1) return 0;
  return words[leftIdx + 1]!.start - words[leftIdx]!.end;
}

/** STEPS 2–4 — resolve merged spans to times, breath padding, pause floor. */
function resolveRemovalDrafts(
  words: TranscriptWord[],
  sourceDuration: number,
  wordSpans: WordRemovalSpan[],
): ResolvedCutDraft[] {
  const drafts: ResolvedCutDraft[] = [];

  for (const span of wordSpans) {
    const { fromIdx, toIdx, reason } = span;

    const prevEnd = fromIdx === 0 ? 0 : words[fromIdx - 1]!.end;
    const nextStart = toIdx >= words.length - 1 ? sourceDuration : words[toIdx + 1]!.start;

    const rawStart = fromIdx === 0 ? 0 : prevEnd + (words[fromIdx]!.start - prevEnd) / 2;
    const rawEnd =
      toIdx >= words.length - 1
        ? sourceDuration
        : words[toIdx]!.end + (nextStart - words[toIdx]!.end) / 2;

    let start = fromIdx === 0 ? 0 : Math.max(rawStart, prevEnd + BREATH_PAD);
    let end = Math.min(rawEnd, nextStart - BREATH_PAD);

    start = ROUND(start);
    end = ROUND(end);

    if (end <= start) continue;
    if (violatesPauseFloor(words, fromIdx, toIdx, reason)) continue;

    drafts.push({ start, end, reason, fromIdx, toIdx });
  }

  return drafts;
}

function violatesPauseFloor(
  words: TranscriptWord[],
  fromIdx: number,
  toIdx: number,
  reason: SemanticRemoveReason,
): boolean {
  if (reason === "filler" || reason === "false_start" || reason === "repeat") {
    return false;
  }

  if (fromIdx > 0) {
    const g = gapLength(words, fromIdx - 1);
    if (g > 0 && g < PAUSE_FLOOR) return true;
  }
  if (toIdx < words.length - 1) {
    const g = gapLength(words, toIdx);
    if (g > 0 && g < PAUSE_FLOOR) return true;
  }
  return false;
}

function keptSpeechBetween(a: ResolvedCutDraft, b: ResolvedCutDraft): number {
  return b.start - a.end;
}

/** STEP 6 */
function applyMinKeptBetween(drafts: ResolvedCutDraft[]): ResolvedCutDraft[] {
  if (drafts.length < 2) return drafts;

  let current = [...drafts].sort((a, b) => a.start - b.start);
  let changed = true;

  while (changed) {
    changed = false;
    const next: ResolvedCutDraft[] = [];

    for (let i = 0; i < current.length; i++) {
      const cut = current[i]!;
      const prev = next[next.length - 1];
      if (prev && keptSpeechBetween(prev, cut) < MIN_KEPT_BETWEEN) {
        const keepPrev = REMOVE_PRIORITY[prev.reason] >= REMOVE_PRIORITY[cut.reason];
        if (keepPrev) {
          changed = true;
          continue;
        }
        next.pop();
        changed = true;
      }
      next.push(cut);
    }
    current = next;
  }

  return current;
}

/** STEP 7 — ties broken by longer cut first. */
function applyCutsPerMinuteCeiling(
  drafts: ResolvedCutDraft[],
  sourceDuration: number,
): ResolvedCutDraft[] {
  if (sourceDuration <= 0) return drafts;
  const maxCuts = Math.max(1, Math.ceil((sourceDuration / 60) * CUTS_PER_MIN));
  if (drafts.length <= maxCuts) return drafts;

  return [...drafts]
    .sort(
      (a, b) =>
        REMOVE_PRIORITY[b.reason] - REMOVE_PRIORITY[a.reason] ||
        b.end - b.start - (a.end - a.start) ||
        a.start - b.start,
    )
    .slice(0, maxCuts)
    .sort((a, b) => a.start - b.start);
}

function hookPayoffGuards(decision: SemanticCutsDecision): {
  hookStart?: number;
  payoffEnd?: number;
} {
  const guards: { hookStart?: number; payoffEnd?: number } = {};
  for (const e of decision.emphasize ?? []) {
    const from = parseWordIndex(e.from_word);
    const to = parseWordIndex(e.to_word);
    if (e.kind === "hook") guards.hookStart = from;
    if (e.kind === "payoff") guards.payoffEnd = to;
  }
  return guards;
}

/**
 * STEP 8 — pull boundaries outward to clear 0.20s guard around hook first word /
 * payoff last word; drop if invalid after pull.
 */
function applyHookPayoffGuard(
  drafts: ResolvedCutDraft[],
  words: TranscriptWord[],
  guards: ReturnType<typeof hookPayoffGuards>,
): ResolvedCutDraft[] {
  const kept: ResolvedCutDraft[] = [];

  for (const cut of drafts) {
    let { start, end } = cut;

    if (guards.hookStart !== undefined) {
      const hook = words[guards.hookStart]!;
      if (end > hook.start && end < hook.end + HOOK_PAYOFF_GUARD) {
        end = ROUND(hook.start - HOOK_PAYOFF_GUARD);
      }
      if (start < hook.end && start > hook.start - HOOK_PAYOFF_GUARD) {
        start = ROUND(hook.end + HOOK_PAYOFF_GUARD);
      }
    }

    if (guards.payoffEnd !== undefined) {
      const payoff = words[guards.payoffEnd]!;
      if (start < payoff.end && start > payoff.start - HOOK_PAYOFF_GUARD) {
        start = ROUND(payoff.end + HOOK_PAYOFF_GUARD);
      }
      if (end > payoff.start && end < payoff.end + HOOK_PAYOFF_GUARD) {
        end = ROUND(payoff.start - HOOK_PAYOFF_GUARD);
      }
    }

    if (end <= start || end - start < MIN_CUT_LEN) continue;
    kept.push({ ...cut, start, end });
  }

  return kept;
}

/** STEP 8b — drop cuts overlapping emphasize spans or post-payoff tail chops. */
function applyEmphasisAdjacencyDrop(
  drafts: ResolvedCutDraft[],
  decision: SemanticCutsDecision,
): ResolvedCutDraft[] {
  if ((decision.emphasize ?? []).length === 0) return drafts;

  return drafts.filter((d) => {
    for (const e of decision.emphasize ?? []) {
      const emp = {
        fromIdx: parseWordIndex(e.from_word),
        toIdx: parseWordIndex(e.to_word),
      };
      if (d.fromIdx <= emp.toIdx && d.toIdx >= emp.fromIdx) {
        return false;
      }
      if (e.kind === "payoff" && d.fromIdx === emp.toIdx + 1) {
        return false;
      }
    }
    return true;
  });
}

function payoffIndexSpan(
  decision: SemanticCutsDecision,
): { fromIdx: number; toIdx: number } | undefined {
  for (const e of decision.emphasize ?? []) {
    if (e.kind === "payoff") {
      return {
        fromIdx: parseWordIndex(e.from_word),
        toIdx: parseWordIndex(e.to_word),
      };
    }
  }
  return undefined;
}

/** STEP 8c — drop cuts that break sentence completion or payoff tails. */
function breaksSentenceIntegrity(
  draft: ResolvedCutDraft,
  words: TranscriptWord[],
  decision: SemanticCutsDecision,
): boolean {
  const { fromIdx, toIdx, reason } = draft;
  const firstRemoved = words[fromIdx]!.text.replace(/[^\w']/g, "").toLowerCase();

  if (fromIdx > 0 && CONTINUATION_STARTERS.has(firstRemoved)) {
    if (reason !== "filler" && reason !== "false_start" && reason !== "repeat") {
      return true;
    }
  }

  if (reason === "tangent" && fromIdx > 0 && gapLength(words, fromIdx - 1) < PAUSE_FLOOR) {
    return true;
  }

  const payoff = payoffIndexSpan(decision);
  if (payoff && fromIdx <= payoff.toIdx && toIdx >= payoff.fromIdx) {
    if (reason !== "filler" && reason !== "false_start") {
      return true;
    }
  }

  return false;
}

function applySentenceIntegrityDrop(
  drafts: ResolvedCutDraft[],
  words: TranscriptWord[],
  decision: SemanticCutsDecision,
): ResolvedCutDraft[] {
  return drafts.filter((d) => !breaksSentenceIntegrity(d, words, decision));
}

function seamQuality(seamGap: number): SeamQuality {
  if (seamGap < SEAM_TIGHT) return "cramped";
  if (seamGap < BREATH_PAD) return "tight";
  return "clean";
}

/** STEP 9 — round, sort, merge overlapping / < 0.05s apart. */
function finalizeCuts(drafts: ResolvedCutDraft[]): ResolvedCutDraft[] {
  if (drafts.length === 0) return [];

  const sorted = drafts
    .map((d) => ({
      ...d,
      start: ROUND(d.start),
      end: ROUND(d.end),
    }))
    .sort((a, b) => a.start - b.start);

  const merged: ResolvedCutDraft[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = merged[merged.length - 1]!;
    if (cur.start <= last.end + MERGE_GAP) {
      last.end = ROUND(Math.max(last.end, cur.end));
      last.fromIdx = Math.min(last.fromIdx, cur.fromIdx);
      last.toIdx = Math.max(last.toIdx, cur.toIdx);
      if (REMOVE_PRIORITY[cur.reason] > REMOVE_PRIORITY[last.reason]) {
        last.reason = cur.reason;
      }
    } else {
      merged.push({ ...cur });
    }
  }

  return merged;
}

function toCuts(
  drafts: ResolvedCutDraft[],
  words: TranscriptWord[],
  sourceDuration: number,
): Cut[] {
  return drafts.map((d) => {
    const nextStart = d.toIdx >= words.length - 1 ? sourceDuration : words[d.toIdx + 1]!.start;
    const seam_gap = ROUND(nextStart - d.end);
    return {
      start: d.start,
      end: d.end,
      reason: d.reason as CutReason,
      transition_id: "hard_cut",
      seam_gap,
      seam_quality: seamQuality(seam_gap),
    };
  });
}

function resolveEmphasisDrafts(
  words: TranscriptWord[],
  decision: SemanticCutsDecision,
): EmphasisDraft[] {
  const drafts: EmphasisDraft[] = [];

  for (const e of decision.emphasize ?? []) {
    const fromIdx = parseWordIndex(e.from_word);
    const toIdx = parseWordIndex(e.to_word);
    if (fromIdx > toIdx || fromIdx >= words.length || toIdx >= words.length) continue;

    let start = words[fromIdx]!.start;
    let end = words[toIdx]!.end;
    const spanLen = end - start;
    const minDur = 0.8;
    const maxDur = 3.0;

    if (spanLen > maxDur) {
      const center = (start + end) / 2;
      start = center - maxDur / 2;
      end = center + maxDur / 2;
    } else if (spanLen < minDur) {
      const center = (start + end) / 2;
      start = center - minDur / 2;
      end = center + minDur / 2;
    }

    drafts.push({
      start: ROUND(start),
      end: ROUND(end),
      kind: e.kind,
      fromIdx,
      toIdx,
    });
  }

  return drafts;
}

function clampEmphasisToKeptSegment(
  draft: EmphasisDraft,
  cuts: Cut[],
  words: TranscriptWord[],
): EmphasisDraft | null {
  const spanStart = words[draft.fromIdx]!.start;
  const spanEnd = words[draft.toIdx]!.end;

  for (const cut of cuts) {
    if (cut.start >= spanEnd || cut.end <= spanStart) continue;
    if (cut.start <= spanStart && cut.end >= spanEnd) return null;

    const leftLen = cut.start - spanStart;
    const rightLen = spanEnd - cut.end;
    if (leftLen >= rightLen) {
      return {
        ...draft,
        start: ROUND(spanStart),
        end: ROUND(Math.min(spanEnd, cut.start)),
        toIdx: draft.toIdx,
      };
    }
    return {
      ...draft,
      start: ROUND(Math.max(spanStart, cut.end)),
      end: ROUND(spanEnd),
      fromIdx: draft.fromIdx,
    };
  }
  return draft;
}

function applyPunchInRules(
  drafts: EmphasisDraft[],
  cuts: Cut[],
  words: TranscriptWord[],
): PunchIn[] {
  let working = drafts
    .map((d) => clampEmphasisToKeptSegment(d, cuts, words))
    .filter((d): d is EmphasisDraft => d !== null && d.end > d.start);

  working.sort(
    (a, b) => EMPHASIS_PRIORITY[b.kind] - EMPHASIS_PRIORITY[a.kind] || a.start - b.start,
  );

  if (working.length > 4) {
    working = working.slice(0, 4);
  }

  working.sort((a, b) => a.start - b.start);

  const kept: PunchIn[] = [];
  for (const d of working) {
    const candidate: PunchIn = {
      start: d.start,
      end: d.end,
      scale: EMPHASIS_SCALE[d.kind],
      focus_x: 0.5,
      focus_y: 0.4,
    };

    const overlapsCut = cuts.some((c) => candidate.start < c.end && candidate.end > c.start);
    if (overlapsCut) continue;

    const tooClose = kept.some((p) => {
      const gap = Math.min(
        Math.abs(p.start - candidate.end),
        Math.abs(candidate.start - p.end),
        Math.abs(p.start - candidate.start),
      );
      return gap < 2.0 && !(candidate.end <= p.start || candidate.start >= p.end);
    });
    if (tooClose) continue;

    const overlapIdx = kept.findIndex((p) => candidate.start < p.end && candidate.end > p.start);
    if (overlapIdx >= 0) {
      const existing = kept[overlapIdx]!;
      if ((candidate.scale ?? 1) > (existing.scale ?? 1)) {
        kept[overlapIdx] = candidate;
      }
      continue;
    }

    kept.push(candidate);
  }

  return kept.sort((a, b) => a.start - b.start);
}

function spansOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

function resolvePace(
  words: TranscriptWord[],
  decision: SemanticCutsDecision,
  cuts: Cut[],
  punch_ins: PunchIn[],
): PaceRamp[] {
  const holds = decision.pace ?? [];
  if (holds.length === 0) return [];

  const hold = holds[0]!;
  if (hold.action !== "hold") return [];

  const fromIdx = parseWordIndex(hold.from_word);
  const toIdx = parseWordIndex(hold.to_word);
  if (fromIdx > toIdx || fromIdx >= words.length) return [];

  const start = words[fromIdx]!.start;
  const end = words[toIdx]!.end;
  if (end - start < 0.6) return [];

  for (const cut of cuts) {
    if (spansOverlap(start, end, cut.start, cut.end)) return [];
  }
  for (const p of punch_ins) {
    if (spansOverlap(start, end, p.start, p.end)) return [];
  }

  return [{ start: ROUND(start), end: ROUND(end), rate: 0.85 }];
}

export function resolveCuts(opts: ResolveCutsOptions): ResolveCutsResult {
  const { words, sourceDuration, decision } = opts;
  if (words.length === 0) {
    return { cuts: [], punch_ins: [], pace: [] };
  }

  let drafts = resolveRemovalDrafts(
    words,
    sourceDuration,
    mergeWordRemovalSpans(decision.remove ?? [], words),
  );

  drafts = drafts.filter((d) => d.end - d.start >= MIN_CUT_LEN);
  drafts = applyMinKeptBetween(drafts);
  drafts = applyCutsPerMinuteCeiling(drafts, sourceDuration);
  drafts = applyHookPayoffGuard(drafts, words, hookPayoffGuards(decision));
  drafts = applyEmphasisAdjacencyDrop(drafts, decision);
  drafts = applySentenceIntegrityDrop(drafts, words, decision);
  drafts = finalizeCuts(drafts);

  for (const draft of drafts) {
    for (let wi = 0; wi < words.length; wi++) {
      if (wi >= draft.fromIdx && wi <= draft.toIdx) continue;
      const w = words[wi]!;
      if (draft.start > w.start + 1e-6 && draft.start < w.end - 1e-6) {
        throw new Error(`Cut start ${draft.start} lands inside kept word ${w.id}`);
      }
      if (draft.end > w.start + 1e-6 && draft.end < w.end - 1e-6) {
        throw new Error(`Cut end ${draft.end} lands inside kept word ${w.id}`);
      }
    }
  }

  const cuts = toCuts(drafts, words, sourceDuration);
  const emphasisDrafts = resolveEmphasisDrafts(words, decision);
  const punch_ins = applyPunchInRules(emphasisDrafts, cuts, words);
  const pace = resolvePace(words, decision, cuts, punch_ins);

  return { cuts, punch_ins, pace };
}

/** Exported for tests — re-base punch_ins onto output timeline after cuts. */
export function punchInsOnOutputTimeline(
  punch_ins: PunchIn[],
  cuts: Cut[],
  sourceDuration: number,
): PunchIn[] {
  const timeline = computeKeptSegments(cuts, sourceDuration);
  return punch_ins.map((p) => {
    const outStart = timeline.segments.reduce((acc, seg) => {
      if (p.start >= seg.srcStart && p.start <= seg.srcEnd) {
        return seg.outStart + (p.start - seg.srcStart);
      }
      return acc;
    }, 0);
    const outEnd = timeline.segments.reduce((acc, seg) => {
      if (p.end >= seg.srcStart && p.end <= seg.srcEnd) {
        return seg.outStart + (p.end - seg.srcStart);
      }
      return acc;
    }, outStart);
    return { ...p, start: outStart, end: outEnd };
  });
}
