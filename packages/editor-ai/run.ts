/**
 * One-shot runner: raw .mp4 -> EDL -> renderable composition project.
 *
 *   bun packages/editor-ai/run.ts <video.mp4> [outDir]
 *
 * Requires GEMINI_API_KEY (bun auto-loads it from the repo .env).
 * After it finishes, render the printed project with the existing CLI.
 */

import { resolve } from "node:path";

import { analyze } from "./src/analyzer.js";
import { buildProject } from "./src/mapper.js";

const videoPath = resolve(process.argv[2] ?? "");
const outDir = resolve(process.argv[3] ?? "out/editor-ai-project");

if (!process.argv[2]) {
  console.error("Usage: bun packages/editor-ai/run.ts <video.mp4> [outDir]");
  process.exit(1);
}

console.log(`Analyzing ${videoPath} ...`);
const edl = await analyze({ videoPath });
console.log(
  `EDL: ${edl.cuts.length} cuts, ${edl.punch_ins.length} punch-ins, ` +
    `${edl.graphics.length} graphics, ${edl.sfx.length} sfx. ` +
    `archetype=${edl.style_decisions.archetype} accent=${edl.style_decisions.accent_color}`,
);

const dir = await buildProject({ edl, videoPath, outDir });
console.log(`\nComposition written to: ${dir}`);
console.log(
  `\nRender it with:\n  npx tsx packages/cli/src/cli.ts render "${dir}" --output out/final.mp4`,
);
