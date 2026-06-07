/**
 * Word-level transcript shape shared with @hyperframes/cli whisper normalize.
 * Times are in SOURCE seconds.
 */

export interface TranscriptWord {
  id?: string;
  text: string;
  start: number;
  end: number;
}

export function assignWordIds(words: TranscriptWord[]): TranscriptWord[] {
  return words.map((w, i) => ({
    ...w,
    id: w.id ?? `w${i}`,
    text: w.text.trim(),
    start: round3(w.start),
    end: round3(w.end),
  }));
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Ensure corrected output preserves whisper timing (editor pass depends on this). */
export function assertTimingsPreserved(
  original: TranscriptWord[],
  corrected: TranscriptWord[],
): void {
  if (original.length !== corrected.length) {
    throw new Error(
      `Transcript fix changed word count (${original.length} -> ${corrected.length}). ` +
        "Only text may change; timestamps and word count must stay the same.",
    );
  }
  for (let i = 0; i < original.length; i++) {
    const a = original[i];
    const b = corrected[i];
    if (!a || !b) continue;
    if (a.start !== b.start || a.end !== b.end) {
      throw new Error(
        `Transcript fix changed timing at index ${i} (${a.id ?? `w${i}`}): ` +
          `[${a.start},${a.end}] -> [${b.start},${b.end}].`,
      );
    }
    if (a.id && b.id && a.id !== b.id) {
      throw new Error(`Transcript fix changed word id at index ${i}: ${a.id} -> ${b.id}.`);
    }
  }
}
