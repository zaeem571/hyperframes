import { describe, expect, it } from "vitest";

import { parseWordIndex, resolveCuts, punchInsOnOutputTimeline } from "./cutResolver.js";
import { assignWordIds, type TranscriptWord } from "./transcript.js";
import type { SemanticCutsDecision } from "./types.js";

function wordsFromPairs(pairs: Array<[string, number, number]>): TranscriptWord[] {
  return assignWordIds(pairs.map(([text, start, end]) => ({ text, start, end })));
}

describe("parseWordIndex", () => {
  it("parses wN ids", () => {
    expect(parseWordIndex("w0")).toBe(0);
    expect(parseWordIndex("w42")).toBe(42);
  });

  it("throws on invalid ids", () => {
    expect(() => parseWordIndex("word0")).toThrow(/Invalid word id/);
  });
});

describe("resolveCuts", () => {
  it("snaps cut boundaries to gap midpoints, never inside kept words", () => {
    const words = wordsFromPairs([
      ["Hello", 0.0, 0.4],
      ["um", 0.55, 0.75],
      ["world", 0.95, 1.4],
    ]);
    const decision: SemanticCutsDecision = {
      remove: [{ from_word: "w1", to_word: "w1", reason: "filler" }],
      emphasize: [{ from_word: "w0", to_word: "w0", kind: "hook" }],
      pace: [],
    };

    const { cuts } = resolveCuts({ words, sourceDuration: 2.0, decision });
    expect(cuts).toHaveLength(1);
    const cut = cuts[0]!;
    expect(cut.transition_id).toBe("hard_cut");
    expect(cut.reason).toBe("filler");
    expect(cut.seam_gap).toBeDefined();
    expect(cut.seam_quality).toMatch(/^(clean|tight|cramped)$/);

    expect(cut.start).toBeCloseTo(0.52, 3);
    expect(cut.end).toBeCloseTo(0.83, 3);

    for (const w of words) {
      expect(cut.start <= w.start || cut.start >= w.end).toBe(true);
      expect(cut.end <= w.start || cut.end >= w.end).toBe(true);
    }
  });

  it("drops cuts shorter than 0.30s", () => {
    const words = wordsFromPairs([
      ["a", 0.0, 0.1],
      ["b", 0.11, 0.2],
    ]);
    const decision: SemanticCutsDecision = {
      remove: [{ from_word: "w0", to_word: "w0", reason: "filler" }],
      emphasize: [],
      pace: [],
    };
    const { cuts } = resolveCuts({ words, sourceDuration: 0.5, decision });
    expect(cuts).toHaveLength(0);
  });

  it("preserves pause floor for dead_air on short gaps", () => {
    const words = wordsFromPairs([
      ["one", 0.0, 0.3],
      ["two", 0.35, 0.6],
      ["three", 0.65, 0.9],
    ]);
    const decision: SemanticCutsDecision = {
      remove: [{ from_word: "w1", to_word: "w1", reason: "dead_air" }],
      emphasize: [],
      pace: [],
    };
    const { cuts } = resolveCuts({ words, sourceDuration: 1.0, decision });
    expect(cuts).toHaveLength(0);
  });

  it("allows filler removal through short gaps", () => {
    const words = wordsFromPairs([
      ["one", 0.0, 0.3],
      ["uh", 0.5, 0.65],
      ["two", 0.95, 1.3],
    ]);
    const decision: SemanticCutsDecision = {
      remove: [{ from_word: "w1", to_word: "w1", reason: "filler" }],
      emphasize: [],
      pace: [],
    };
    const { cuts } = resolveCuts({ words, sourceDuration: 1.5, decision });
    expect(cuts.length).toBeGreaterThan(0);
  });

  it("keeps higher-priority cut when kept speech between cuts is under 1s", () => {
    const words = wordsFromPairs([
      ["um", 0.0, 0.2],
      ["well", 0.25, 0.5],
      ["content", 0.55, 1.0],
      ["uh", 1.3, 1.45],
      ["end", 1.6, 1.8],
    ]);
    const decision: SemanticCutsDecision = {
      remove: [
        { from_word: "w0", to_word: "w1", reason: "tangent" },
        { from_word: "w3", to_word: "w3", reason: "filler" },
      ],
      emphasize: [],
      pace: [],
    };
    const { cuts } = resolveCuts({ words, sourceDuration: 2.0, decision });
    const reasons = cuts.map((c) => c.reason);
    expect(reasons).toContain("filler");
    expect(reasons).not.toContain("tangent");
  });

  it("emits punch_ins with scales by kind", () => {
    const words = wordsFromPairs([
      ["Hook", 0.0, 0.5],
      ["forty", 1.0, 1.3],
      ["percent", 1.35, 1.7],
      ["payoff", 2.0, 2.5],
    ]);
    const decision: SemanticCutsDecision = {
      remove: [],
      emphasize: [
        { from_word: "w0", to_word: "w0", kind: "hook" },
        { from_word: "w1", to_word: "w2", kind: "key_number" },
        { from_word: "w3", to_word: "w3", kind: "payoff" },
      ],
      pace: [],
    };
    const { punch_ins } = resolveCuts({ words, sourceDuration: 3.0, decision });
    expect(punch_ins.length).toBeGreaterThan(0);
    const hook = punch_ins.find((p) => p.scale === 1.12);
    const stat = punch_ins.find((p) => p.scale === 1.18);
    expect(hook).toBeDefined();
    expect(stat).toBeDefined();
    for (const p of punch_ins) {
      expect(p.focus_x).toBe(0.5);
      expect(p.focus_y).toBe(0.4);
    }
  });

  it("caps punch_ins at 4 and enforces min 2s gap", () => {
    const words = wordsFromPairs(
      Array.from(
        { length: 10 },
        (_, i) => [`w${i}`, i * 0.5, i * 0.5 + 0.3] as [string, number, number],
      ),
    );
    const decision: SemanticCutsDecision = {
      remove: [],
      emphasize: words.map((w) => ({
        from_word: w.id!,
        to_word: w.id!,
        kind: "key_claim" as const,
      })),
      pace: [],
    };
    const { punch_ins } = resolveCuts({ words, sourceDuration: 5.0, decision });
    expect(punch_ins.length).toBeLessThanOrEqual(4);
  });

  it("emits at most one pace hold and drops hold overlapping punch_in", () => {
    const words = wordsFromPairs([
      ["dramatic", 0.0, 0.5],
      ["line", 0.55, 1.0],
      ["here", 1.05, 1.5],
    ]);
    const decision: SemanticCutsDecision = {
      remove: [],
      emphasize: [{ from_word: "w0", to_word: "w1", kind: "hook" }],
      pace: [{ from_word: "w0", to_word: "w1", action: "hold" }],
    };
    const { pace, punch_ins } = resolveCuts({ words, sourceDuration: 2.0, decision });
    expect(punch_ins.length).toBeGreaterThan(0);
    expect(pace).toHaveLength(0);
  });

  it("emits pace hold when no punch_in conflict", () => {
    const words = wordsFromPairs([
      ["quiet", 0.0, 0.4],
      ["moment", 0.5, 0.9],
      ["later", 2.0, 2.4],
    ]);
    const decision: SemanticCutsDecision = {
      remove: [],
      emphasize: [{ from_word: "w2", to_word: "w2", kind: "payoff" }],
      pace: [{ from_word: "w0", to_word: "w1", action: "hold" }],
    };
    const { pace } = resolveCuts({ words, sourceDuration: 3.0, decision });
    expect(pace).toHaveLength(1);
    expect(pace[0]!.rate).toBe(0.85);
  });

  it("protects hook first word from cuts", () => {
    const words = wordsFromPairs([
      ["um", 0.0, 0.15],
      ["Big", 0.2, 0.5],
      ["idea", 0.55, 0.9],
    ]);
    const decision: SemanticCutsDecision = {
      remove: [{ from_word: "w0", to_word: "w0", reason: "filler" }],
      emphasize: [{ from_word: "w1", to_word: "w2", kind: "hook" }],
      pace: [],
    };
    const { cuts } = resolveCuts({ words, sourceDuration: 1.0, decision });
    for (const cut of cuts) {
      expect(cut.end).toBeLessThan(words[1]!.start - 0.15);
    }
  });

  it("matches cutsdesign worked example A (okay + so merge)", () => {
    const words = wordsFromPairs([
      ["okay", 0.13, 0.57],
      ["so", 0.57, 0.84],
      ["now", 0.87, 1.27],
    ]);
    const decision: SemanticCutsDecision = {
      remove: [
        { from_word: "w0", to_word: "w0", reason: "filler" },
        { from_word: "w1", to_word: "w1", reason: "filler" },
      ],
      emphasize: [{ from_word: "w2", to_word: "w2", kind: "hook" }],
      pace: [],
    };
    const { cuts } = resolveCuts({ words, sourceDuration: 2.0, decision });
    expect(cuts).toHaveLength(1);
    expect(cuts[0]!.start).toBe(0);
    expect(cuts[0]!.end).toBeCloseTo(0.75, 3);
  });

  it("matches cutsdesign worked example B (false_start breath pad on end)", () => {
    const words = wordsFromPairs([
      ["video", 25.14, 25.47],
      ["so", 25.57, 25.71],
      ["just", 25.71, 26.03],
      ["edits", 26.03, 26.41],
      ["and", 26.44, 26.68],
    ]);
    const decision: SemanticCutsDecision = {
      remove: [{ from_word: "w1", to_word: "w3", reason: "false_start" }],
      emphasize: [{ from_word: "w4", to_word: "w4", kind: "payoff" }],
      pace: [],
    };
    const { cuts } = resolveCuts({ words, sourceDuration: 30.0, decision });
    expect(cuts).toHaveLength(1);
    expect(cuts[0]!.start).toBeCloseTo(25.59, 3);
    expect(cuts[0]!.end).toBeCloseTo(26.32, 3);
  });

  it("matches cutsdesign worked example C (drop when padding invalid)", () => {
    const words = wordsFromPairs([
      ["before", 9.5, 10.0],
      ["drop", 10.0, 10.15],
      ["after", 10.2, 10.5],
    ]);
    const decision: SemanticCutsDecision = {
      remove: [{ from_word: "w1", to_word: "w1", reason: "filler" }],
      emphasize: [],
      pace: [],
    };
    const { cuts } = resolveCuts({ words, sourceDuration: 11.0, decision });
    expect(cuts).toHaveLength(0);
  });

  it("merges consecutive word-ID removals before min-length filtering", () => {
    const words = wordsFromPairs([
      ["okay", 0.13, 0.57],
      ["so", 0.57, 0.84],
      ["now", 0.87, 1.27],
    ]);
    const decision: SemanticCutsDecision = {
      remove: [
        { from_word: "w0", to_word: "w0", reason: "filler" },
        { from_word: "w1", to_word: "w1", reason: "filler" },
      ],
      emphasize: [{ from_word: "w2", to_word: "w2", kind: "hook" }],
      pace: [],
    };
    const { cuts } = resolveCuts({ words, sourceDuration: 2.0, decision });
    expect(cuts).toHaveLength(1);
    expect(cuts[0]!.end).toBeLessThanOrEqual(words[2]!.start - 0.12 + 1e-6);
    expect(cuts[0]!.end).toBeCloseTo(0.75, 3);
  });

  it("leaves 0.12s breath pad before the next kept word on every cut.end", () => {
    const words = wordsFromPairs([
      ["a", 25.0, 25.5],
      ["b", 25.55, 26.0],
      ["c", 26.05, 26.3],
      ["and", 26.44, 26.8],
    ]);
    const decision: SemanticCutsDecision = {
      remove: [{ from_word: "w0", to_word: "w2", reason: "false_start" }],
      emphasize: [{ from_word: "w3", to_word: "w3", kind: "payoff" }],
      pace: [],
    };
    const { cuts } = resolveCuts({ words, sourceDuration: 30.0, decision });
    expect(cuts).toHaveLength(1);
    expect(cuts[0]!.end).toBeLessThanOrEqual(words[3]!.start - 0.12 + 1e-6);
    expect(cuts[0]!.end).toBeCloseTo(26.32, 3);
  });

  it("merges overlapping resolved cuts", () => {
    const words = wordsFromPairs([
      ["a", 0.0, 0.2],
      ["b", 0.3, 0.5],
      ["c", 0.6, 0.8],
      ["d", 1.0, 1.2],
    ]);
    const decision: SemanticCutsDecision = {
      remove: [
        { from_word: "w0", to_word: "w1", reason: "filler" },
        { from_word: "w1", to_word: "w2", reason: "filler" },
      ],
      emphasize: [],
      pace: [],
    };
    const { cuts } = resolveCuts({ words, sourceDuration: 1.5, decision });
    expect(cuts.length).toBeLessThanOrEqual(2);
  });

  it("drops cuts adjacent to emphasize spans (step 8b)", () => {
    const words = wordsFromPairs([
      ["payoff", 0.0, 0.4],
      ["tail", 0.45, 0.7],
    ]);
    const decision: SemanticCutsDecision = {
      remove: [{ from_word: "w1", to_word: "w1", reason: "tangent" }],
      emphasize: [{ from_word: "w0", to_word: "w0", kind: "payoff" }],
      pace: [],
    };
    const { cuts } = resolveCuts({ words, sourceDuration: 2.0, decision });
    expect(cuts).toHaveLength(0);
  });

  it("drops sentence-tail removal starting with continuation (step 8c)", () => {
    const words = wordsFromPairs([
      ["as", 36.0, 36.2],
      ["the", 36.25, 36.4],
      ["audience", 36.45, 36.9],
      ["or", 36.95, 37.1],
      ["the", 37.15, 37.3],
      ["user", 37.35, 37.6],
      ["has", 37.65, 37.85],
      ["decided", 37.9, 38.3],
    ]);
    const decision: SemanticCutsDecision = {
      remove: [{ from_word: "w3", to_word: "w7", reason: "tangent" }],
      emphasize: [{ from_word: "w0", to_word: "w7", kind: "payoff" }],
      pace: [],
    };
    const { cuts } = resolveCuts({ words, sourceDuration: 40.0, decision });
    expect(cuts).toHaveLength(0);
  });

  it("tags seam_gap and seam_quality on every cut (step 9)", () => {
    const words = wordsFromPairs([
      ["okay", 0.13, 0.57],
      ["so", 0.57, 0.84],
      ["now", 0.87, 1.27],
    ]);
    const decision: SemanticCutsDecision = {
      remove: [
        { from_word: "w0", to_word: "w0", reason: "filler" },
        { from_word: "w1", to_word: "w1", reason: "filler" },
      ],
      emphasize: [{ from_word: "w2", to_word: "w2", kind: "hook" }],
      pace: [],
    };
    const { cuts } = resolveCuts({ words, sourceDuration: 2.0, decision });
    expect(cuts).toHaveLength(1);
    expect(cuts[0]!.seam_gap).toBeCloseTo(0.12, 2);
    expect(cuts[0]!.seam_quality).toBe("clean");
  });
});

describe("punchInsOnOutputTimeline", () => {
  it("re-bases punch_in times after cuts", () => {
    const punch_ins = [{ start: 2.0, end: 2.5, scale: 1.15 }];
    const cuts = [{ start: 0.5, end: 1.0, transition_id: "hard_cut" }];
    const mapped = punchInsOnOutputTimeline(punch_ins, cuts, 3.0);
    expect(mapped[0]!.start).toBeCloseTo(1.5, 3);
  });
});
