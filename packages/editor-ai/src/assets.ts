/**
 * Asset manifest loading + validation.
 *
 * The manifest maps an `asset_id` (referenced by the EDL's `sfx` and image
 * `graphics`) to a local relative path, a type, and a duration. The analyzer uses
 * it to reject hallucinated asset ids; the mapper uses it to resolve `src` and to
 * set `<audio data-duration>` for sound effects.
 */

import { readFile } from "node:fs/promises";

export type AssetType = "sfx" | "image" | "marker";

export interface AssetEntry {
  /** Relative path, e.g. "assets/sfx/whoosh.mp3". */
  path: string;
  type: AssetType;
  /** Duration in seconds. Required for sfx (sets <audio data-duration>); 0 for images. */
  duration: number;
}

export type AssetManifest = Record<string, AssetEntry>;

/** Load and validate the asset manifest JSON at `manifestPath`. */
export async function loadAssetManifest(manifestPath: string): Promise<AssetManifest> {
  const raw = await readFile(manifestPath, "utf-8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Asset manifest at ${manifestPath} is not valid JSON: ${(err as Error).message}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `Asset manifest at ${manifestPath} must be a JSON object of asset_id -> entry.`,
    );
  }

  const manifest = parsed as Record<string, unknown>;
  for (const [id, entry] of Object.entries(manifest)) {
    if (!entry || typeof entry !== "object") {
      throw new Error(`Asset "${id}" must be an object with { path, type, duration }.`);
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.path !== "string" || e.path.length === 0) {
      throw new Error(`Asset "${id}" is missing a string "path".`);
    }
    if (e.type !== "sfx" && e.type !== "image" && e.type !== "marker") {
      throw new Error(`Asset "${id}" has invalid "type" (expected sfx | image | marker).`);
    }
    if (typeof e.duration !== "number" || !Number.isFinite(e.duration)) {
      throw new Error(`Asset "${id}" is missing a finite numeric "duration".`);
    }
  }

  return manifest as AssetManifest;
}

/** Return the set of valid asset ids for membership checks. */
export function assetIds(manifest: AssetManifest): Set<string> {
  return new Set(Object.keys(manifest));
}
