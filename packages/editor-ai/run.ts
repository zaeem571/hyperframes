/**
 * Editor pipeline runner: whisper.cpp → Gemini transcript fix → Gemini editor-in-chief.
 *
 *   bun packages/editor-ai/run.ts [videos/my-clip.mp4] [--guidance "brief"]
 *
 * Every run uses ONE caption style, chosen at the start (interactive picker or --subtitle-style).
 * Drop source videos in <repo>/videos/. Edited projects go to videos/<name>-edited/.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runEditorPipeline } from "./src/pipeline.js";
import {
  formatSubtitleStyleMenu,
  loadSubtitleStylesMenu,
  resolveSubtitleStyleForRun,
  type SubtitleStyleSelection,
} from "./src/subtitleStyles.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const videosDir = join(repoRoot, "videos");

function resolveVideoPath(input: string): string {
  if (!input) return "";

  const direct = resolve(input);
  if (existsSync(direct)) return direct;

  const inVideos = join(videosDir, input);
  if (existsSync(inVideos)) return inVideos;

  return direct;
}

function defaultOutDir(videoPath: string): string {
  const base = basename(videoPath, extname(videoPath));
  return join(videosDir, `${base}-edited`);
}

function defaultRenderPath(outDir: string): string {
  const base = basename(outDir);
  return join(videosDir, `${base}.mp4`);
}

function formatStyleLogLine(selection: SubtitleStyleSelection): string {
  if (selection.source === "default-non-interactive") {
    return `${selection.styleId} (default, non-interactive)`;
  }
  return selection.styleId;
}

async function printUsage(menuText: string): Promise<never> {
  console.error(`Usage: bun packages/editor-ai/run.ts <video> [outDir] [options]

Video:
  Put source files in: ${videosDir}
  Pass a filename (e.g. my-clip.mp4) or a full path.

Output (optional):
  Default: videos/<name>-edited/
  Final render: videos/<name>-edited.mp4

Options:
  --guidance "text"       Creative brief for the editor-in-chief pass
  --guidance-file path    Read creative brief from a markdown/text file
  --force-editor          Bypass cached editor-in-chief EDL (fresh Gemini call)
  --force-semantic-cuts   Bypass cached Stage A semantic cuts (fresh Gemini call)
  --subtitle-style <id>   Skip the interactive style picker and use this preset

${menuText}

Normal run (one style per video):
  1. Pick caption style     Interactive menu at start (or --subtitle-style)
  2. whisper.cpp              Word-level transcription
  3. Gemini (text)            Transcript cleanup
  4. Gemini (video)           Editor-in-chief EDL
  5. Build composition        Captions in the chosen style only

Optional — compare all 5 styles in one file (NOT part of normal runs):
  bun packages/editor-ai/render-subtitle-styles.ts <video>`);
  process.exit(1);
}

function parseArgs(argv: string[]): {
  videoPath: string;
  outDir: string;
  userGuidance: string;
  guidanceFile?: string;
  forceEditor: boolean;
  forceSemanticCuts: boolean;
  subtitleStyleId?: string;
  subtitleStyleFlagWithoutValue: boolean;
  showHelp: boolean;
} {
  const positional: string[] = [];
  let userGuidance = "";
  let guidanceFile: string | undefined;
  let forceEditor = false;
  let forceSemanticCuts = false;
  let subtitleStyleId: string | undefined;
  let subtitleStyleFlagWithoutValue = false;
  let showHelp = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      showHelp = true;
      continue;
    }
    if (arg === "--guidance" && argv[i + 1]) {
      userGuidance = argv[++i]!;
      continue;
    }
    if (arg === "--guidance-file" && argv[i + 1]) {
      guidanceFile = argv[++i];
      continue;
    }
    if (arg === "--force-editor") {
      forceEditor = true;
      continue;
    }
    if (arg === "--force-semantic-cuts") {
      forceSemanticCuts = true;
      continue;
    }
    if (arg === "--subtitle-style") {
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        subtitleStyleId = argv[++i];
      } else {
        subtitleStyleFlagWithoutValue = true;
      }
      continue;
    }
    if (arg.startsWith("-")) {
      console.error(`Unknown flag: ${arg}`);
      process.exit(1);
    }
    positional.push(arg);
  }

  if (!positional[0]) {
    return {
      videoPath: "",
      outDir: "",
      userGuidance,
      guidanceFile,
      forceEditor,
      forceSemanticCuts,
      subtitleStyleId,
      subtitleStyleFlagWithoutValue,
      showHelp: true,
    };
  }

  const videoPath = resolveVideoPath(positional[0]!);
  const outDir = resolve(positional[1] ?? defaultOutDir(videoPath));

  return {
    videoPath,
    outDir,
    userGuidance,
    guidanceFile,
    forceEditor,
    forceSemanticCuts,
    subtitleStyleId,
    subtitleStyleFlagWithoutValue,
    showHelp,
  };
}

const stylesMenu = await loadSubtitleStylesMenu();
const menuText = formatSubtitleStyleMenu(stylesMenu);
const args = parseArgs(process.argv.slice(2));

if (args.showHelp || !args.videoPath) {
  await printUsage(menuText);
}

if (!existsSync(args.videoPath)) {
  console.error(`Video not found: ${args.videoPath}`);
  console.error(`Drop source files in ${videosDir} and pass the filename.`);
  process.exit(1);
}

// Step 0: caption style — before whisper, Gemini, or composition build.
const subtitleStyle = await resolveSubtitleStyleForRun({
  menu: stylesMenu,
  cliStyleId: args.subtitleStyleId,
  cliStyleFlagWithoutValue: args.subtitleStyleFlagWithoutValue,
});

if (args.guidanceFile) {
  const fromFile = await readFile(resolve(args.guidanceFile), "utf-8");
  args.userGuidance = args.userGuidance ? `${args.userGuidance}\n\n${fromFile}` : fromFile;
}

console.log(`\n=== HyperFrames Editor Pipeline ===`);
console.log(`Video:          ${args.videoPath}`);
console.log(`Output:         ${args.outDir}`);
console.log(`Subtitle style: ${formatStyleLogLine(subtitleStyle)}`);
if (args.userGuidance) {
  console.log(
    `Guidance:       ${args.userGuidance.slice(0, 120)}${args.userGuidance.length > 120 ? "…" : ""}`,
  );
}

const result = await runEditorPipeline({
  videoPath: args.videoPath,
  outDir: args.outDir,
  userGuidance: args.userGuidance,
  forceEditor: args.forceEditor,
  forceSemanticCuts: args.forceSemanticCuts,
  subtitleStyleId: subtitleStyle.styleId,
  onProgress: (stage, message) => console.log(`[${stage}] ${message}`),
});

const renderOut = defaultRenderPath(args.outDir);

console.log(`\n=== Done ===`);
console.log(`Raw transcript:       ${result.rawTranscriptPath}`);
console.log(`Corrected transcript: ${result.correctedTranscriptPath}`);
console.log(`Semantic cuts:        ${result.semanticCutsPath}`);
console.log(`Resolved cuts:        ${result.resolvedCutsPath}`);
console.log(`EDL:                  ${result.edlPath}`);
console.log(`Composition:          ${result.projectDir}`);
console.log(
  `\nRender:\n  npx tsx packages/cli/src/cli.ts render "${result.projectDir}" --output "${renderOut}"`,
);
