import { describe, expect, it } from "vitest";

import { assertTimingsPreserved, assignWordIds } from "./transcript.js";
import {
  buildPostCutCaptionGraphics,
  buildCaptionGraphicsFromTranscript,
  buildTransitionBlackoutWindows,
  pickEmphasisWordIndex,
  resolveCaptionZone,
  TRANSITION_BLACKOUT_SEC,
} from "./transcriptToGraphics.js";

describe("assertTimingsPreserved", () => {
  const base = assignWordIds([
    { text: "hello", start: 0, end: 0.4 },
    { text: "wrld", start: 0.4, end: 0.8 },
  ]);

  it("accepts text-only corrections", () => {
    const fixed = [
      { id: "w0", text: "hello", start: 0, end: 0.4 },
      { id: "w1", text: "world", start: 0.4, end: 0.8 },
    ];
    expect(() => assertTimingsPreserved(base, fixed)).not.toThrow();
  });

  it("rejects timing changes", () => {
    const bad = [
      { id: "w0", text: "hello", start: 0.1, end: 0.4 },
      { id: "w1", text: "world", start: 0.4, end: 0.8 },
    ];
    expect(() => assertTimingsPreserved(base, bad)).toThrow(/timing/i);
  });

  it("rejects word count changes", () => {
    expect(() => assertTimingsPreserved(base, [base[0]!])).toThrow(/word count/i);
  });
});

describe("buildCaptionGraphicsFromTranscript", () => {
  it("groups words into caption lines with karaoke timings", () => {
    const words = assignWordIds([
      { text: "one", start: 0, end: 0.2 },
      { text: "two", start: 0.2, end: 0.4 },
      { text: "three", start: 1.2, end: 1.4 },
    ]);

    const graphics = buildCaptionGraphicsFromTranscript({
      words,
      captionStyleId: "hormozi_serifpop",
      pauseGapSeconds: 0.5,
    });

    expect(graphics).toHaveLength(2);
    expect(graphics[0]?.type).toBe("caption");
    expect(graphics[0]?.words).toHaveLength(2);
    expect(graphics[0]?.caption_style_id).toBe("hormozi_serifpop");
    expect(graphics[1]?.words?.[0]?.word).toBe("three");
  });

  it("beat_bounce emits one graphic per word", () => {
    const words = assignWordIds([
      { text: "one", start: 0, end: 0.2 },
      { text: "two", start: 0.2, end: 0.4 },
    ]);
    const graphics = buildCaptionGraphicsFromTranscript({
      words,
      captionStyleId: "beat_bounce",
    });
    expect(graphics).toHaveLength(2);
    expect(graphics.every((g) => g.words?.length === 1)).toBe(true);
    expect(graphics.every((g) => g.caption_zone === "zone_center")).toBe(true);
  });

  it("marks one emphasis word per line (longest content word, not first/last)", () => {
    const words = assignWordIds([
      { text: "the", start: 0, end: 0.2 },
      { text: "quick", start: 0.2, end: 0.5 },
      { text: "brown", start: 0.5, end: 0.8 },
    ]);
    expect(pickEmphasisWordIndex(words)).toBe(1);
  });

  it("uses ZONE_TOP when half-screen graphic is active (coexistence)", () => {
    expect(
      resolveCaptionZone("hormozi_serifpop", 1, 5, 8, [
        {
          start: 4,
          end: 10,
          template_id: "concept-diagram-half",
          coverage: "half",
          scene_context: "test",
        },
      ]),
    ).toBe("zone_top");
  });
});

describe("buildPostCutCaptionGraphics", () => {
  it("excludes words inside cuts and uses output timeline", () => {
    const words = assignWordIds([
      { text: "keep", start: 0, end: 0.4 },
      { text: "cut", start: 0.5, end: 0.7 },
      { text: "after", start: 1.5, end: 1.8 },
    ]);
    const cuts = [{ start: 0.45, end: 0.85, transition_id: "hard_cut" as const }];
    const graphics = buildPostCutCaptionGraphics({
      words,
      cuts,
      sourceDuration: 2.0,
      captionStyleId: "hormozi_serifpop",
    });

    expect(graphics.every((g) => g.timeline_base === "output")).toBe(true);
    const allWords = graphics.flatMap((g) => g.words ?? []).map((w) => w.word);
    expect(allWords).not.toContain("cut");
    expect(allWords).toContain("keep");
    expect(allWords).toContain("after");
  });

  it("blackouts caption words overlapping cut joins", () => {
    const words = assignWordIds([
      { text: "before", start: 0, end: 0.4 },
      { text: "join", start: 0.5, end: 0.7 },
      { text: "after", start: 1.0, end: 1.3 },
    ]);
    const cuts = [{ start: 0.45, end: 0.85, transition_id: "hard_cut" as const }];
    const windows = buildTransitionBlackoutWindows(cuts, 2.0);
    const join = 0.45;
    expect(windows[0]!.start).toBeCloseTo(join - TRANSITION_BLACKOUT_SEC, 2);

    const graphics = buildPostCutCaptionGraphics({
      words,
      cuts,
      sourceDuration: 2.0,
      captionStyleId: "beat_bounce",
    });
    for (const w of graphics.flatMap((g) => g.words ?? [])) {
      for (const win of windows) {
        expect(w.start >= win.start && w.start <= win.end).toBe(false);
      }
    }
  });
});
