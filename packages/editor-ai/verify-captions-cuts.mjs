/**
 * Verify closing sentence survives cuts and no caption word starts in transition blackout.
 * Usage: node packages/editor-ai/verify-captions-cuts.mjs [pipeline-work-dir]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildTransitionBlackoutWindows, filterKeptWords } from "./src/transcriptToGraphics.js";

const work =
  process.argv[2] ??
  resolve("../../videos/WhatsApp Video 2026-06-07 at 10.25.53 PM-edited/pipeline-work");

const words = JSON.parse(readFileSync(resolve(work, "transcript.corrected.json"), "utf8"));
const resolved = JSON.parse(readFileSync(resolve(work, "resolved-cuts.json"), "utf8"));
const edl = JSON.parse(readFileSync(resolve(work, "edl.json"), "utf8"));
const semantic = JSON.parse(readFileSync(resolve(work, "semantic-cuts.json"), "utf8"));

const sourceDuration = Math.max(...words.map((w) => w.end));
const cuts = resolved.cuts ?? [];
const kept = filterKeptWords(words, cuts);

const tail = ["or", "the", "user", "has", "decided"];
const tailWords = kept.filter((w) => tail.includes(w.text.toLowerCase().replace(/[^\w']/g, "")));
const tailTexts = tailWords.map((w) => w.text.toLowerCase());

console.log("=== Closing sentence tail (kept words) ===");
console.log(tailWords.map((w) => `${w.id}:${w.text}`).join(" | ") || "(none)");
console.log(
  "PASS tail intact:",
  tail.every((t) => tailTexts.some((x) => x.includes(t))),
);

console.log("\n=== Stage A removals touching tail ===");
for (const r of semantic.remove ?? []) {
  const hitsTail = ["w75", "w76", "w77", "w78", "w79"].some(
    (id) => id >= r.from_word && id <= r.to_word,
  );
  if (hitsTail) console.log(" ", r);
}
if (!(semantic.remove ?? []).some((r) => r.from_word <= "w79" && r.to_word >= "w75")) {
  console.log("  (no Stage A removal spans w75–w79)");
}

console.log("\n=== Resolved cuts (seam fields) ===");
for (const c of cuts) {
  console.log(
    `  ${c.start}–${c.end} ${c.reason} seam_gap=${c.seam_gap} seam_quality=${c.seam_quality}`,
  );
}

const captions = (edl.graphics ?? []).filter((g) => g.type === "caption");
const windows = buildTransitionBlackoutWindows(cuts, sourceDuration);
let violations = 0;
for (const g of captions) {
  for (const w of g.words ?? []) {
    for (const win of windows) {
      if (w.start >= win.start && w.start <= win.end) {
        console.log(
          `VIOLATION: "${w.word}" at out ${w.start} in blackout [${win.start}, ${win.end}]`,
        );
        violations++;
      }
    }
  }
}

console.log("\n=== Caption / cut check ===");
console.log(
  `Caption lines: ${captions.length}, timeline_base=output: ${captions.every((g) => g.timeline_base === "output")}`,
);
console.log(`Blackout violations: ${violations}`);
console.log(violations === 0 ? "PASS no caption on cut joins" : "FAIL");
