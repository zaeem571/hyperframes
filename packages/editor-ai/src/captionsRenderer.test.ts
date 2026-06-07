import { describe, expect, it } from "vitest";

import { buildHtml } from "./mapper.js";
import { buildStackedCaption, fontsForCaptionStyle } from "./captionsRenderer.js";
import { computeKeptSegments } from "./timeline.js";
import type { AssetManifest } from "./assets.js";
import type { Edl, Graphic } from "./types.js";

const manifest: AssetManifest = {};

const baseStyle = {
  archetype: "talking_head" as const,
  accent_color: "#F7C204",
  caption_placement: "bottom_center" as const,
  caption_style: "karaoke" as const,
  transition_style: "hard_cut" as const,
  pace: "fast" as const,
};

function captionGraphic(styleId: Graphic["caption_style_id"], words: Graphic["words"]): Graphic {
  return {
    start: 0,
    end: 3,
    type: "caption",
    text: words?.map((w) => w.word).join(" ") ?? "",
    caption_zone: styleId === "beat_bounce" ? "zone_center" : "zone_midlow",
    caption_style_id: styleId,
    words,
  };
}

describe("buildStackedCaption styles", () => {
  const timeline = computeKeptSegments([], 10);

  it("renders hormozi_classic with Montserrat 900 stroke and active color swaps", () => {
    const { html, gsap } = buildStackedCaption(
      "cap0",
      captionGraphic("hormozi_classic", [
        { word: "this", start: 0, end: 0.5 },
        { word: "works", start: 0.5, end: 1 },
      ]),
      baseStyle,
      timeline,
      1080,
      1920,
      "hormozi_classic",
    );
    expect(html).toContain("font-weight:900");
    expect(html).toContain("-webkit-text-stroke");
    expect(gsap).toContain('color: "#F7C204"');
    expect(gsap).toContain('fromTo("#cap0"');
  });

  it("renders pill_box with per-word pill plates", () => {
    const { html, gsap } = buildStackedCaption(
      "cap0",
      captionGraphic("pill_box", [
        { word: "hello", start: 0, end: 0.4 },
        { word: "world", start: 0.4, end: 0.8 },
      ]),
      baseStyle,
      timeline,
      1080,
      1920,
      "pill_box",
    );
    expect(html).toContain('id="cap0-pill0"');
    expect(html).toContain("border-radius");
    expect(gsap).toContain("backgroundColor");
  });

  it("renders beat_bounce with Bebas Neue bounce", () => {
    const { html, gsap } = buildStackedCaption(
      "cap0",
      captionGraphic("beat_bounce", [{ word: "go", start: 0, end: 0.5, emphasis: true }]),
      baseStyle,
      timeline,
      1080,
      1920,
      "beat_bounce",
    );
    expect(html).toContain("Bebas Neue");
    expect(gsap).toContain("scaleY");
  });

  it("renders karaoke_sweep with L→R fill layer", () => {
    const { html, gsap } = buildStackedCaption(
      "cap0",
      captionGraphic("karaoke_sweep", [
        { word: "learn", start: 0, end: 0.5 },
        { word: "fast", start: 0.5, end: 1 },
      ]),
      baseStyle,
      timeline,
      1080,
      1920,
      "karaoke_sweep",
    );
    expect(html).toContain('id="cap0-fill0"');
    expect(html).toContain("Inter");
    expect(gsap).toContain('width: "100%"');
  });

  it("throws when graphic style id does not match selected style", () => {
    expect(() =>
      buildStackedCaption(
        "cap0",
        captionGraphic("pill_box", [{ word: "x", start: 0, end: 0.5 }]),
        baseStyle,
        timeline,
        1080,
        1920,
        "hormozi_classic",
      ),
    ).toThrow(/mismatch/i);
  });
});

describe("fontsForCaptionStyle", () => {
  it("loads only Bebas for beat_bounce", () => {
    expect(fontsForCaptionStyle("beat_bounce")).toBe("family=Bebas+Neue");
    expect(fontsForCaptionStyle("karaoke_sweep")).toContain("Inter");
    expect(fontsForCaptionStyle("hormozi_serifpop")).toContain("DM+Serif");
  });
});

describe("buildHtml caption style wiring", () => {
  it("writes data-subtitle-style and style-specific fonts", () => {
    const edl: Edl = {
      source_duration: 10,
      subtitle_style_id: "beat_bounce",
      style_decisions: baseStyle,
      cuts: [],
      graphics: [captionGraphic("beat_bounce", [{ word: "go", start: 0, end: 0.5 }])],
    };
    const html = buildHtml({ edl, manifest, sourceDuration: 10, width: 1080, height: 1920 });
    expect(html).toContain('data-subtitle-style="beat_bounce"');
    expect(html).toContain("Bebas+Neue");
    expect(html).not.toContain("DM+Serif");
  });
});
