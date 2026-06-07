/**
 * OPTIONAL one-time preview — renders all 5 caption styles back-to-back in one MP4.
 * NOT part of the normal editor pipeline. Normal runs use run.ts (one style per video).
 *
 *   bun packages/editor-ai/render-subtitle-styles.ts [videos/my-clip.mp4]
 *
 * Requires pipeline-work/edl.json + transcript.corrected.json from a prior run.ts pass.
 * Outputs: videos/<name>-edited-subtitle-styles-preview.mp4
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildProject } from "./src/mapper.js";
import {
  buildCaptionGraphicsFromTranscript,
  mergeEdlWithTranscriptCaptions,
} from "./src/transcriptToGraphics.js";
import { allSubtitleStyleIds, loadSubtitleStylesMenu } from "./src/subtitleStyles.js";
import type { Edl } from "./src/types.js";
import type { TranscriptWord } from "./src/transcript.js";

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

function renderCmd(): string {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: "inherit", shell: false });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`));
    });
  });
}

async function renderProject(projectDir: string, outputPath: string): Promise<void> {
  await run(
    renderCmd(),
    [
      "tsx",
      "packages/cli/src/cli.ts",
      "render",
      projectDir,
      "--output",
      outputPath,
      "--quality",
      "draft",
    ],
    repoRoot,
  );
}

async function concatVideos(segments: string[], outputPath: string): Promise<void> {
  const listPath = join(dirname(outputPath), "subtitle-styles-concat.txt");
  const listBody = segments
    .map((p) => `file '${p.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`)
    .join("\n");
  await writeFile(listPath, listBody, "utf-8");
  await run(
    "ffmpeg",
    ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputPath],
    repoRoot,
  );
}

const videoArg = process.argv[2];
if (!videoArg) {
  console.error(`Usage: bun packages/editor-ai/render-subtitle-styles.ts <video>

Optional preview tool only — concatenates all 5 styles into one MP4 for eyeballing.
Normal editing: bun packages/editor-ai/run.ts <video>  (one style per run)`);
  process.exit(1);
}

const videoPath = resolveVideoPath(videoArg);
if (!existsSync(videoPath)) {
  console.error(`Video not found: ${videoPath}`);
  process.exit(1);
}

const outDir = defaultOutDir(videoPath);
const workDir = join(outDir, "pipeline-work");
const edlPath = join(workDir, "edl.json");
const transcriptPath = join(workDir, "transcript.corrected.json");

if (!existsSync(edlPath) || !existsSync(transcriptPath)) {
  console.error(
    `Missing pipeline artifacts. Run the editor pipeline first:\n  bun packages/editor-ai/run.ts "${videoArg}"`,
  );
  process.exit(1);
}

console.log("Optional style preview — rendering all 5 styles (not a normal pipeline run).\n");

const edl = JSON.parse(await readFile(edlPath, "utf-8")) as Edl;
const correctedWords = JSON.parse(await readFile(transcriptPath, "utf-8")) as TranscriptWord[];
const menu = await loadSubtitleStylesMenu();
const styleIds = allSubtitleStyleIds();
const previewBase = basename(outDir);
const previewDir = join(videosDir, `${previewBase}-subtitle-styles`);
await mkdir(previewDir, { recursive: true });

const segmentPaths: string[] = [];

for (const styleId of styleIds) {
  const styleMeta = menu.styles.find((s) => s.id === styleId);
  console.log(`\n=== Style: ${styleId} (${styleMeta?.name ?? styleId}) ===`);

  const styleEdl: Edl = JSON.parse(JSON.stringify(edl));
  styleEdl.subtitle_style_id = styleId;
  const captions = buildCaptionGraphicsFromTranscript({
    words: correctedWords,
    motionGraphicRequests: styleEdl.motion_graphic_requests ?? [],
    captionStyleId: styleId,
  });
  for (const caption of captions) {
    caption.caption_style_id = styleId;
  }
  mergeEdlWithTranscriptCaptions(styleEdl, captions);

  const projectDir = join(previewDir, styleId);
  const sourceVideo = existsSync(join(outDir, "raw.mp4")) ? join(outDir, "raw.mp4") : videoPath;
  await buildProject({
    edl: styleEdl,
    videoPath: sourceVideo,
    outDir: projectDir,
    normalize: false,
  });

  const segmentOut = join(previewDir, `${styleId}.mp4`);
  console.log(`Rendering ${styleId} (draft)...`);
  await renderProject(projectDir, segmentOut);
  segmentPaths.push(segmentOut);
}

const finalOut = join(videosDir, `${previewBase}-subtitle-styles-preview.mp4`);
console.log(`\nConcatenating ${segmentPaths.length} segments...`);
await concatVideos(segmentPaths, finalOut);

console.log(`\nDone: ${finalOut}`);
console.log("Styles appear in order:");
styleIds.forEach((id, i) => {
  const meta = menu.styles.find((s) => s.id === id);
  console.log(`  ${i + 1}. ${id} — ${meta?.name ?? id}`);
});
