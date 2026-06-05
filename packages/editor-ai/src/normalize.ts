/**
 * Source video normalization.
 *
 * Cut-based editing seeks the source to many in-points. If the source has sparse
 * keyframes (e.g. one every ~10s), those seeks land on the nearest prior keyframe and
 * the picture FREEZES on a stale frame at every cut — which ruins the edit.
 *
 * The fix is a one-time re-encode with a keyframe on every frame boundary (GOP = fps),
 * so every cut in-point is exact. We spawn `ffmpeg` from PATH (same convention as the
 * rest of the repo). If ffmpeg is missing or fails, the caller falls back to a plain copy.
 */

import { spawn } from "node:child_process";

export interface NormalizeOptions {
  /** Output frame rate / keyframe interval. Match the render fps (default 30). */
  fps?: number;
}

/**
 * Re-encode `src` to `dest` with a keyframe on every frame (frame-accurate seeking).
 * Resolves true on success, false if ffmpeg is unavailable or the encode failed.
 */
export function normalizeForSeeking(
  src: string,
  dest: string,
  opts: NormalizeOptions = {},
): Promise<boolean> {
  const fps = opts.fps ?? 30;
  return new Promise((resolve) => {
    const proc = spawn("ffmpeg", [
      "-y",
      "-i",
      src,
      "-c:v",
      "libx264",
      "-r",
      String(fps),
      "-g",
      "1", // keyframe on EVERY frame -> every cut in-point seeks exactly (no freezing)
      "-keyint_min",
      "1",
      "-sc_threshold",
      "0",
      "-pix_fmt",
      "yuv420p",
      "-preset",
      "veryfast",
      "-movflags",
      "+faststart",
      "-c:a",
      "aac",
      dest,
    ]);

    proc.on("error", () => resolve(false)); // ffmpeg not on PATH
    proc.on("close", (code) => resolve(code === 0));
  });
}
