/**
 * Minimal ffprobe wrapper — reads the source video's duration and dimensions.
 *
 * The cut-inversion math needs an accurate source duration (it bounds the final kept
 * segment), and the composition must match the source's width/height/aspect so the
 * footage isn't cropped or letterboxed. ffprobe is authoritative; the EDL's
 * model-estimated values are only fallbacks.
 *
 * Spawns `ffprobe` from PATH, matching how @hyperframes/engine invokes it, so we stay
 * dependency-free (no cross-package import).
 */

import { spawn } from "node:child_process";

export interface VideoInfo {
  duration: number | null;
  width: number | null;
  height: number | null;
}

function runFfprobe(args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const proc = spawn("ffprobe", args);
    let out = "";
    proc.stdout.on("data", (chunk) => {
      out += chunk.toString();
    });
    proc.on("error", () => resolve(null)); // ffprobe not on PATH
    proc.on("close", (code) => resolve(code === 0 ? out : null));
  });
}

/** Read duration + dimensions of the first video stream. Fields are null if unavailable. */
export async function probeVideoInfo(videoPath: string): Promise<VideoInfo> {
  const out = await runFfprobe([
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height:format=duration",
    "-of",
    "json",
    videoPath,
  ]);
  if (!out) return { duration: null, width: null, height: null };

  try {
    const parsed = JSON.parse(out) as {
      streams?: Array<{ width?: number; height?: number }>;
      format?: { duration?: string };
    };
    const stream = parsed.streams?.[0];
    const duration = Number.parseFloat(parsed.format?.duration ?? "");
    const toPos = (n: number | undefined): number | null =>
      typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
    return {
      duration: Number.isFinite(duration) && duration > 0 ? duration : null,
      width: toPos(stream?.width),
      height: toPos(stream?.height),
    };
  } catch {
    return { duration: null, width: null, height: null };
  }
}

/** Duration of `videoPath` in seconds via ffprobe, or null (caller should fall back). */
export async function probeDuration(videoPath: string): Promise<number | null> {
  return (await probeVideoInfo(videoPath)).duration;
}

/** ffprobe duration if available, otherwise the EDL's estimate. */
export async function resolveSourceDuration(videoPath: string, fallback: number): Promise<number> {
  const probed = await probeDuration(videoPath);
  return probed ?? fallback;
}
