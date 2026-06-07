/**
 * Run whisper.cpp transcription via the HyperFrames CLI (local, no API key).
 */

import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { assignWordIds, type TranscriptWord } from "./transcript.js";

const cliEntry = (): string => fileURLToPath(new URL("../../cli/dist/cli.js", import.meta.url));

export interface TranscribeWithWhisperOptions {
  videoPath: string;
  workDir: string;
  model?: string;
  language?: string;
  onProgress?: (msg: string) => void;
}

export interface TranscribeWithWhisperResult {
  words: TranscriptWord[];
  transcriptPath: string;
}

interface TranscribeJsonResult {
  ok?: boolean;
  error?: string;
  transcriptPath?: string;
  wordCount?: number;
}

export async function transcribeWithWhisper(
  opts: TranscribeWithWhisperOptions,
): Promise<TranscribeWithWhisperResult> {
  await mkdir(opts.workDir, { recursive: true });

  opts.onProgress?.("Running whisper.cpp via hyperframes transcribe...");

  const args = [
    cliEntry(),
    "transcribe",
    resolve(opts.videoPath),
    "--dir",
    resolve(opts.workDir),
    "--json",
  ];
  if (opts.model) args.push("--model", opts.model);
  if (opts.language) args.push("--language", opts.language);

  let stdout: string;
  try {
    stdout = execFileSync(process.execPath, args, {
      encoding: "utf-8",
      env: {
        ...process.env,
        HYPERFRAMES_NO_TELEMETRY: "1",
        HYPERFRAMES_NO_UPDATE_CHECK: "1",
      },
      maxBuffer: 16 * 1024 * 1024,
      timeout: 600_000,
    });
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string };
    throw new Error(
      `whisper transcription failed: ${(e.stderr ?? e.message ?? String(err)).trim()}`,
    );
  }

  const lastLine = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!lastLine) throw new Error("hyperframes transcribe produced no JSON output.");

  const meta = JSON.parse(lastLine) as TranscribeJsonResult;
  if (!meta.ok || !meta.transcriptPath) {
    throw new Error(meta.error ?? "hyperframes transcribe failed.");
  }

  const raw = JSON.parse(await readFile(meta.transcriptPath, "utf-8")) as TranscriptWord[];
  const words = assignWordIds(Array.isArray(raw) ? raw : []);

  return {
    words,
    transcriptPath: meta.transcriptPath,
  };
}

export async function writeTranscriptJson(
  dir: string,
  filename: string,
  words: TranscriptWord[],
): Promise<string> {
  const path = join(dir, filename);
  await writeFile(path, JSON.stringify(words, null, 2), "utf-8");
  return path;
}
