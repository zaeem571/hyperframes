import { compileTimingAttrs } from "@hyperframes/core/compiler";
import { describe, expect, it } from "vitest";

import type { AssetManifest } from "./assets.js";
import { buildHtml } from "./mapper.js";
import type { Edl } from "./types.js";

const manifest: AssetManifest = {
  sfx_whoosh: { path: "assets/sfx/whoosh.mp3", type: "sfx", duration: 0.6 },
};

// source duration 30, one cut 2-5 -> segments [0-2 @0], [5-30 @2]; outputDuration 27.
const edl: Edl = {
  source_duration: 30,
  style_decisions: {
    archetype: "talking_head",
    accent_color: "#FF3366",
    caption_placement: "bottom_center",
    caption_style: "karaoke",
    transition_style: "hard_cut",
    pace: "fast",
  },
  cuts: [{ start: 2, end: 5 }],
  punch_ins: [{ start: 10, end: 14, scale: 1.2, focus_x: 0.5, focus_y: 0.4 }],
  graphics: [
    { start: 0, end: 2, type: "title", text: "Hello <World>" },
    {
      start: 6,
      end: 9,
      type: "caption",
      text: "the quick",
      words: [
        { word: "the", start: 6, end: 6.5 },
        { word: "quick", start: 6.5, end: 7 },
      ],
    },
  ],
  sfx: [{ time: 10, asset_id: "sfx_whoosh", volume: 0.8 }],
};

describe("buildHtml", () => {
  const html = buildHtml({ edl, manifest, sourceDuration: 30 });

  it("emits the root composition with the edited output duration", () => {
    expect(html).toContain('data-composition-id="main"');
    expect(html).toContain('data-duration="27"');
    expect(html).toContain('window.__timelines["main"]');
  });

  it("maps kept segments to video clips with correct source/output timing", () => {
    // first kept segment: source 0-2 -> output 0
    expect(html).toMatch(
      /<video id="clip0"[^>]*data-start="0"[^>]*data-media-start="0"[^>]*data-duration="2"/,
    );
    // second kept segment: source 5-30 -> output starts at 2, media-start 5
    expect(html).toMatch(
      /<video id="clip1"[^>]*data-start="2"[^>]*data-media-start="5"[^>]*data-duration="25"/,
    );
  });

  it("emits matching voice audio tracks per segment", () => {
    expect(html).toMatch(
      /<audio id="clip1-audio"[^>]*data-start="2"[^>]*data-media-start="5"[^>]*data-volume="1"/,
    );
  });

  it("remaps sfx time through the cut and resolves manifest path + duration", () => {
    // source time 10 -> output 7 (2 + (10-5))
    expect(html).toMatch(
      /<audio id="sfx0" src="assets\/sfx\/whoosh\.mp3"[^>]*data-start="7"[^>]*data-duration="0.6"[^>]*data-volume="0.8"/,
    );
  });

  it("targets #aroll-stage for punch-ins, in output coordinates", () => {
    expect(html).toContain('tl.to("#aroll-stage", { scale: 1.2, transformOrigin: "50% 40%"');
    expect(html).toContain(", 7);"); // remapped punch-in start
  });

  it("renders karaoke captions as per-word spans with accent color tweens", () => {
    expect(html).toContain('id="gfx1-w0"');
    expect(html).toContain('id="gfx1-w1"');
    // word "the" starts at source 6 -> output 3
    expect(html).toContain(
      'tl.to("#gfx1-w0", { color: "#FF3366", opacity: 1, duration: 0.08 }, 3);',
    );
  });

  it("escapes text content in overlays", () => {
    expect(html).toContain("Hello &lt;World&gt;");
    expect(html).not.toContain("Hello <World>");
  });
});

describe("producer contract (core compileTimingAttrs)", () => {
  const html = buildHtml({ edl, manifest, sourceDuration: 30 });
  const { unresolved, html: compiled } = compileTimingAttrs(html);

  it("leaves no unresolved timed elements (no browser probe needed)", () => {
    expect(unresolved).toEqual([]);
  });

  it("lets the static pass derive data-end from data-duration", () => {
    // clip0: start 0 + duration 2 -> end 2
    expect(compiled).toContain('data-end="2"');
  });
});
