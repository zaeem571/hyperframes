import { describe, expect, it } from "vitest";

import { computeKeptSegments, spanToOut, srcToOut } from "./timeline.js";
import type { Cut } from "./types.js";

describe("computeKeptSegments", () => {
  it("inverts the worked example (src=30, cuts at 2-5,12-14,20-21)", () => {
    const cuts: Cut[] = [
      { start: 2, end: 5 },
      { start: 12, end: 14 },
      { start: 20, end: 21 },
    ];
    const { segments, outputDuration } = computeKeptSegments(cuts, 30);

    expect(outputDuration).toBe(24);
    expect(segments).toEqual([
      { srcStart: 0, srcEnd: 2, len: 2, outStart: 0 },
      { srcStart: 5, srcEnd: 12, len: 7, outStart: 2 },
      { srcStart: 14, srcEnd: 20, len: 6, outStart: 9 },
      { srcStart: 21, srcEnd: 30, len: 9, outStart: 15 },
    ]);
  });

  it("returns one full segment when there are no cuts", () => {
    const { segments, outputDuration } = computeKeptSegments([], 10);
    expect(outputDuration).toBe(10);
    expect(segments).toEqual([{ srcStart: 0, srcEnd: 10, len: 10, outStart: 0 }]);
  });

  it("merges overlapping and unsorted cuts", () => {
    const cuts: Cut[] = [
      { start: 8, end: 10 },
      { start: 2, end: 6 },
      { start: 4, end: 9 }, // overlaps both -> merges into 2-10
    ];
    const { segments, outputDuration } = computeKeptSegments(cuts, 12);
    expect(segments).toEqual([
      { srcStart: 0, srcEnd: 2, len: 2, outStart: 0 },
      { srcStart: 10, srcEnd: 12, len: 2, outStart: 2 },
    ]);
    expect(outputDuration).toBe(4);
  });

  it("clamps out-of-range cuts and drops empty ones", () => {
    const cuts: Cut[] = [
      { start: -5, end: 3 }, // clamps to 0-3
      { start: 9, end: 99 }, // clamps to 9-10
      { start: 5, end: 5 }, // empty -> dropped
    ];
    const { segments, outputDuration } = computeKeptSegments(cuts, 10);
    expect(segments).toEqual([{ srcStart: 3, srcEnd: 9, len: 6, outStart: 0 }]);
    expect(outputDuration).toBe(6);
  });

  it("handles a cut at the very start and end", () => {
    const { segments } = computeKeptSegments(
      [
        { start: 0, end: 2 },
        { start: 8, end: 10 },
      ],
      10,
    );
    expect(segments).toEqual([{ srcStart: 2, srcEnd: 8, len: 6, outStart: 0 }]);
  });

  it("returns empty for non-positive source duration", () => {
    expect(computeKeptSegments([], 0)).toEqual({ segments: [], outputDuration: 0 });
  });
});

describe("srcToOut", () => {
  const tl = computeKeptSegments(
    [
      { start: 2, end: 5 },
      { start: 12, end: 14 },
    ],
    20,
  );
  // segments: [0-2 @0], [5-12 @2], [14-20 @9]; outputDuration 15

  it("maps a point inside a kept segment linearly", () => {
    expect(srcToOut(6, tl)).toBeCloseTo(3); // 2 + (6-5)
    expect(srcToOut(16, tl)).toBeCloseTo(11); // 9 + (16-14)
  });

  it("snaps a point inside a removed cut to the cut boundary", () => {
    expect(srcToOut(3, tl)).toBeCloseTo(2); // inside 2-5 -> end of prev kept seg
    expect(srcToOut(13, tl)).toBeCloseTo(9); // inside 12-14 -> 9
  });

  it("snaps a point past the end to outputDuration", () => {
    expect(srcToOut(50, tl)).toBeCloseTo(15);
  });
});

describe("spanToOut", () => {
  const tl = computeKeptSegments([{ start: 5, end: 10 }], 20);
  // segments: [0-5 @0], [10-20 @5]; outputDuration 15

  it("compresses a span that straddles a cut", () => {
    // 3..12 in source -> out 3..7 (the removed 5-10 middle vanishes)
    expect(spanToOut(3, 12, tl)).toEqual({ start: 3, duration: 4 });
  });

  it("returns null for a span fully inside a cut", () => {
    expect(spanToOut(6, 9, tl)).toBeNull();
  });

  it("maps a clean span inside one segment", () => {
    expect(spanToOut(11, 14, tl)).toEqual({ start: 6, duration: 3 });
  });
});
