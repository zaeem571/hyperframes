# @hyperframes/editor-ai

Automated AI video-editing layer in front of the Hyperframes producer.

Feed a raw `.mp4` → Gemini analyzes it against a Style Decision Graph → a deterministic
**Edit Decision List (EDL)** is emitted (forced via JSON Schema) → the EDL is mapped to a
Hyperframes composition (`index.html` + assets) that drops straight into
`hyperframes render`. No LangChain, no engine changes.

## Flow

```ts
import { analyze, buildProject } from "@hyperframes/editor-ai";

// 1. Analyze (cached by sha256 of mp4 + prompt + schema + model — re-runs are free).
const edl = await analyze({ videoPath: "assets/raw.mp4" }); // needs GEMINI_API_KEY

// 2. Map the EDL to a renderable composition directory.
const dir = await buildProject({ edl, videoPath: "assets/raw.mp4", outDir: "out/project" });

// 3. Render with the existing pipeline:
//    npx tsx packages/cli/src/cli.ts render out/project --output out/final.mp4
```

## How it works

- **`analyzer.ts`** — SHA-256 cache check; on miss, uploads via the Gemini File API,
  waits until `ACTIVE`, injects `config/instructions.md` + `config/asset-manifest.json`,
  and calls `gemini-2.5-flash` (temperature 0.2) with a strict `responseSchema`.
- **`timeline.ts`** (pure) — `cuts` are dead-air spans to _remove_; the kept segments are
  their inverse. `srcToOut` / `spanToOut` re-base every other EDL time (in **source**
  seconds) onto the edited **output** timeline.
- **`mapper.ts`** — kept segments → stacked `<video>`/`<audio>` clips
  (`data-media-start` = source offset, `data-start` = output position); `punch_ins` →
  GSAP scale on the `#aroll-stage` wrapper; `graphics`/captions → timed overlays (karaoke
  = per-word spans + color tweens); `sfx` → layered `<audio>`. The root carries
  `data-duration` and registers `window.__timelines["main"]`, so the producer skips the
  browser duration probe.

> **Invariant:** every EDL time except `data-media-start` is in _source_ seconds and must
> pass through `srcToOut`/`spanToOut` before becoming a `data-start`/GSAP position.

## Config

- `config/instructions.md` — the Style Decision Graph (the LLM prompt).
- `config/asset-manifest.json` — `asset_id → { path, type, duration }`. Referenced SFX /
  images are copied into the output project; missing sources are skipped (silent
  placeholders).
