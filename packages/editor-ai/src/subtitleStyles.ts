/**
 * Load and validate config/subtitle-styles.json (user-facing style picker menu).
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { CaptionStyleId } from "./types.js";

export interface SubtitleStyleEntry {
  id: string;
  name: string;
  description: string;
  vibe?: string;
  preview?: string;
}

export interface SubtitleStylesMenu {
  default: string;
  spec_doc?: string;
  note?: string;
  styles: SubtitleStyleEntry[];
}

const ALL_STYLE_IDS: CaptionStyleId[] = [
  "hormozi_serifpop",
  "hormozi_classic",
  "pill_box",
  "beat_bounce",
  "karaoke_sweep",
];

export const DEFAULT_SUBTITLE_STYLE: CaptionStyleId = "hormozi_serifpop";

const defaultMenuPath = (): string =>
  fileURLToPath(new URL("../config/subtitle-styles.json", import.meta.url));

export async function loadSubtitleStylesMenu(
  path: string = defaultMenuPath(),
): Promise<SubtitleStylesMenu> {
  const raw = JSON.parse(await readFile(path, "utf-8")) as SubtitleStylesMenu;
  if (!Array.isArray(raw.styles) || raw.styles.length === 0) {
    throw new Error(`Invalid subtitle styles menu at ${path}`);
  }
  return raw;
}

export function subtitleStyleIds(menu: SubtitleStylesMenu): Set<string> {
  return new Set(menu.styles.map((s) => s.id));
}

export function resolveSubtitleStyleId(
  menu: SubtitleStylesMenu,
  id: string | undefined,
): CaptionStyleId {
  const resolved = id?.trim() || menu.default || DEFAULT_SUBTITLE_STYLE;
  if (!subtitleStyleIds(menu).has(resolved)) {
    throw new UnknownSubtitleStyleError(resolved, menu);
  }
  return resolved as CaptionStyleId;
}

export class UnknownSubtitleStyleError extends Error {
  constructor(
    public readonly id: string,
    public readonly menu: SubtitleStylesMenu,
  ) {
    super(`Unknown subtitle style "${id}".`);
    this.name = "UnknownSubtitleStyleError";
  }
}

export function formatSubtitleStyleMenu(menu: SubtitleStylesMenu): string {
  const lines = [
    "Subtitle styles (--subtitle-style <id>):",
    "",
    ...menu.styles.map((s) => {
      const def = s.id === (menu.default || DEFAULT_SUBTITLE_STYLE) ? " [default]" : "";
      return `  ${s.id}${def}\n    ${s.name} — ${s.description}`;
    }),
    "",
    `Default: ${menu.default || DEFAULT_SUBTITLE_STYLE}`,
    `Spec: config/${menu.spec_doc ?? "subtitlesguide.md"}`,
  ];
  return lines.join("\n");
}

/** Compact lines for the interactive picker (id, name, one-line description). */
export function formatSubtitleStylePickerLines(menu: SubtitleStylesMenu): string[] {
  return menu.styles.map((s, i) => {
    const def = s.id === (menu.default || DEFAULT_SUBTITLE_STYLE) ? " [default]" : "";
    return `  ${i + 1}. ${s.id}${def} — ${s.name}: ${s.description}`;
  });
}

export function printSubtitleStylePicker(menu: SubtitleStylesMenu): void {
  console.log("\nCaption styles — pick one (required before transcription):\n");
  for (const line of formatSubtitleStylePickerLines(menu)) {
    console.log(line);
  }
  console.log("");
}

export function isInteractiveTTY(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

export function parseSubtitleStylePickerAnswer(
  menu: SubtitleStylesMenu,
  answer: string,
): CaptionStyleId | null {
  const trimmed = answer.trim();
  if (!trimmed) return null;

  const asNumber = Number.parseInt(trimmed, 10);
  if (!Number.isNaN(asNumber) && asNumber >= 1 && asNumber <= menu.styles.length) {
    return menu.styles[asNumber - 1]!.id as CaptionStyleId;
  }

  if (subtitleStyleIds(menu).has(trimmed)) {
    return trimmed as CaptionStyleId;
  }

  return null;
}

async function promptSubtitleStyleId(menu: SubtitleStylesMenu): Promise<CaptionStyleId> {
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (true) {
      const answer = await rl.question("Subtitle style id (or number): ");
      const picked = parseSubtitleStylePickerAnswer(menu, answer);
      if (picked) return picked;
      console.error(`Invalid choice "${answer.trim()}". Pick one of:\n`);
      for (const line of formatSubtitleStylePickerLines(menu)) {
        console.log(line);
      }
      console.log("");
    }
  } finally {
    rl.close();
  }
}

export type SubtitleStyleSelectionSource = "cli" | "prompt" | "default-non-interactive";

export interface SubtitleStyleSelection {
  styleId: CaptionStyleId;
  source: SubtitleStyleSelectionSource;
}

/**
 * Resolve caption style before pipeline work begins.
 * Interactive TTY: prompt when no valid --subtitle-style. CI/non-TTY: default without blocking.
 */
export async function resolveSubtitleStyleForRun(opts: {
  menu: SubtitleStylesMenu;
  /** Value after --subtitle-style, if any. */
  cliStyleId?: string;
  /** --subtitle-style was passed with no following value. */
  cliStyleFlagWithoutValue?: boolean;
}): Promise<SubtitleStyleSelection> {
  const { menu, cliStyleId, cliStyleFlagWithoutValue } = opts;
  const defaultId = resolveSubtitleStyleId(menu, undefined);

  if (cliStyleId && !cliStyleFlagWithoutValue) {
    try {
      return { styleId: resolveSubtitleStyleId(menu, cliStyleId), source: "cli" };
    } catch (err) {
      if (!(err instanceof UnknownSubtitleStyleError)) throw err;
      if (!isInteractiveTTY()) {
        return { styleId: defaultId, source: "default-non-interactive" };
      }
      console.error(`${err.message}\n`);
      printSubtitleStylePicker(menu);
      return { styleId: await promptSubtitleStyleId(menu), source: "prompt" };
    }
  }

  if (!isInteractiveTTY()) {
    return { styleId: defaultId, source: "default-non-interactive" };
  }

  if (cliStyleFlagWithoutValue) {
    console.error("--subtitle-style requires an id.\n");
  }
  printSubtitleStylePicker(menu);
  return { styleId: await promptSubtitleStyleId(menu), source: "prompt" };
}

export function allSubtitleStyleIds(): readonly CaptionStyleId[] {
  return ALL_STYLE_IDS;
}
