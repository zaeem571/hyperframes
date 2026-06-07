import { describe, expect, it } from "vitest";

import {
  DEFAULT_SUBTITLE_STYLE,
  formatSubtitleStylePickerLines,
  parseSubtitleStylePickerAnswer,
  resolveSubtitleStyleForRun,
  type SubtitleStylesMenu,
} from "./subtitleStyles.js";

const menu: SubtitleStylesMenu = {
  default: "hormozi_serifpop",
  styles: [
    {
      id: "hormozi_serifpop",
      name: "Serif Pop (Amber)",
      description: "Bold white sans with one glowing amber italic-serif word per line.",
    },
    {
      id: "hormozi_classic",
      name: "Hormozi Classic",
      description: "Ultra-heavy Montserrat caps.",
    },
  ],
};

describe("parseSubtitleStylePickerAnswer", () => {
  it("accepts style id", () => {
    expect(parseSubtitleStylePickerAnswer(menu, "hormozi_classic")).toBe("hormozi_classic");
  });

  it("accepts 1-based menu number", () => {
    expect(parseSubtitleStylePickerAnswer(menu, "2")).toBe("hormozi_classic");
  });

  it("rejects empty and unknown values", () => {
    expect(parseSubtitleStylePickerAnswer(menu, "")).toBeNull();
    expect(parseSubtitleStylePickerAnswer(menu, "bogus")).toBeNull();
  });
});

describe("formatSubtitleStylePickerLines", () => {
  it("includes id, name, and description", () => {
    const lines = formatSubtitleStylePickerLines(menu);
    expect(lines[0]).toContain("hormozi_serifpop");
    expect(lines[0]).toContain("Serif Pop (Amber)");
    expect(lines[1]).toContain("hormozi_classic");
  });
});

describe("resolveSubtitleStyleForRun", () => {
  it("uses valid cli id without prompting", async () => {
    const result = await resolveSubtitleStyleForRun({
      menu,
      cliStyleId: "hormozi_classic",
    });
    expect(result).toEqual({ styleId: "hormozi_classic", source: "cli" });
  });

  it("falls back to default when non-interactive and no flag", async () => {
    const stdin = process.stdin.isTTY;
    const stdout = process.stdout.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });

    const result = await resolveSubtitleStyleForRun({ menu });
    expect(result.styleId).toBe(DEFAULT_SUBTITLE_STYLE);
    expect(result.source).toBe("default-non-interactive");

    Object.defineProperty(process.stdin, "isTTY", { value: stdin, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: stdout, configurable: true });
  });
});
