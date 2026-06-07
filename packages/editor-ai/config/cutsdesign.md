<role>
Authoritative rules for CUTS, ZOOMS (punch-ins), and PACING in the reel pipeline. Two consumers:
  - STAGE A (Semantic Editor, transcript-only LLM): uses this as GUIDANCE to propose what to
    remove / emphasize / hold, expressed by WORD ID only (never timestamps).
  - STAGE B (Cut Resolver, deterministic code): uses this as HARD ENFORCEMENT. It snaps word-ID
    decisions to real inter-word time gaps and rejects/repairs anything that violates these rules.
Every numeric value below is binding on Stage B. Stage A should not propose anything Stage B
would reject.
</role>

<inputs>
Word list: each word has id (w0, w1, ...), text, start, end (SOURCE seconds, whisper timings).
A "gap" between word wN and wN+1 = [ words[wN].end , words[wN+1].start ]. Gap length = that span.
All cut boundaries land INSIDE gaps, never inside a word — this is non-negotiable and is what
makes mid-word cuts structurally impossible.
</inputs>

<house_style>
Tight but natural. Remove filler, false starts, and dead air; keep the natural rhythm of speech.
Target 3-8 cuts per minute for talking-head. Never cut just to cut. A clean edit with fewer,
well-placed cuts beats a choppy one.
</house_style>

# ============================== CUTS ==============================

<what_stage_a_may_remove>
Stage A proposes removals as word-ID spans { from_word, to_word, reason }. Valid reasons:
filler - "um", "uh", "like" (filler use), "you know", "so so", "I mean" (filler use)
false_start - a restarted/abandoned phrase the speaker immediately redoes
repeat - a sentence/phrase repeated because the speaker flubbed it (keep the better take)
dead_air - leading/trailing non-speech, or a long mid-clip silence
tangent - a clearly off-topic aside that does not serve the clip's point
Stage A must NOT propose removing:

- Any single content word mid-sentence (nouns/verbs/adjectives that carry meaning).
- Words whose removal breaks grammatical/semantic continuity of the kept sentence.
- A natural pause alone (that is Stage B's job via gap rules, not a word removal).
  </what_stage_a_may_remove>

<stage_b_algorithm>
Stage B is a deterministic function. Execute these steps IN THIS EXACT ORDER. The order is part
of the specification — do not reorder, do not merge steps, do not apply a later step before an
earlier one. Each step lists its inputs and outputs.

INPUT: removals[] (word-ID spans from Stage A), words[] (id/text/start/end), sourceDuration.

STEP 1 — MERGE ADJACENT REMOVALS (before anything else).
Sort removals by from_word index. Walk the list; merge two removals A then B into one if:
B.from_word index <= A.to_word index + 1 (consecutive or overlapping word ranges)
OR the gap between words[A.to].end and words[B.from].start is < 0.30s (near-adjacent).
Merged span = { from_word: A.from_word, to_word: max(A.to, B.to),
reason: higher-priority of the two }.
Priority for reason: filler = false_start > repeat > dead_air > tangent.
Repeat until no more merges. THIS STEP MUST RUN FIRST — never length-filter before merging,
or adjacent single-word removals get dropped individually (bug: "okay so" loses only "okay").

STEP 2 — RESOLVE EACH MERGED SPAN TO RAW TIMES.
prevEnd = (from_word is w0) ? 0 : words[from-1].end
nextStart = (to_word is last) ? sourceDuration : words[to+1].start
raw.start = (from_word is w0) ? 0 : prevEnd + (words[from].start - prevEnd) / 2
raw.end = (to_word is last) ? sourceDuration : words[to].end + (nextStart - words[to].end) / 2

STEP 3 — APPLY BREATH PADDING (clamp BOTH ends; this is mandatory, not optional).
Let PAD = 0.12.
cut.start = max(raw.start, prevEnd + PAD) // but never less than 0 (and if from is w0, keep 0)
cut.end = min(raw.end, nextStart - PAD) // pull END back so it never eats the next word's onset
If after padding cut.end <= cut.start (the gap was too small to hold padding), this removal is
INVALID — drop it (the words sit too tight to cut cleanly). Do NOT emit a zero/negative cut.
Rationale: cut.end must always sit >= PAD before the next kept word's start. The "starts
mid-breath" bug is caused by skipping this clamp on cut.end.

STEP 4 — PRESERVE PAUSE FLOOR.
If the removal's own words are filler/false_start/repeat, keep the cut. Otherwise (dead_air,
tangent) if the removed span is ENTIRELY a natural pause shorter than 0.80s, drop the cut
(don't delete real speech gaps just for pace).

STEP 5 — DROP SUB-MINIMUM CUTS.
Drop any remaining cut with (cut.end - cut.start) < 0.30s.

STEP 6 — ENFORCE MIN KEPT SPEECH BETWEEN CUTS.
Sort cuts ascending. For any two consecutive cuts leaving < 1.00s of kept speech between them
(cutB.start - cutA.end < 1.00), keep the higher-priority cut (by reason priority above), drop
the other. Repeat until no violations.

STEP 7 — ENFORCE CUTS-PER-MINUTE CEILING.
If count > 8 \* (sourceDuration / 60), keep the highest-priority cuts up to the ceiling; drop
the rest. Ties broken by longer cut first.

STEP 8 — PROTECT HOOK/PAYOFF GUARD.
If any cut boundary falls within 0.20s of the first content word of a `hook` emphasis span or
the last content word of a `payoff` span, pull the boundary outward to clear the 0.20s guard;
if that makes the cut invalid, drop it.

STEP 8b — EMPHASIS-ADJACENCY DROP.
Drop any cut whose removed word span overlaps (same word indices as) ANY emphasize[] span
from Stage A, or starts immediately after emphasize.to_word (post-payoff tail chop).
Pre-hook opening trims (from w0 through the word before hook) are allowed.

STEP 8c — SENTENCE-INTEGRITY DROP.
Drop any cut that would break a kept sentence by removing its completion: - First removed word is a continuation starter (or, and, but, nor, yet, so) while a content
word before fromIdx is kept — the tail is load-bearing ("…as the audience | or the user has decided"). - reason = tangent AND there is no pause >= 0.80s immediately before from_word (not a real aside). - Any removal inside the payoff emphasize span's last sentence except pure filler/false_start at the very end.
When in doubt, DROP — meaning protection beats aggressive trimming.

STEP 9 — FINALIZE + SEAM TAGGING.
Round start/end to 3 decimals. Sort ascending. Merge any cuts now overlapping or < 0.05s apart.
For each emitted cut, tag the join seam (at cut.end, before the next kept word):
seam_gap = next_kept_word.start - cut.end (SOURCE seconds; should be >= 0.12 after Step 3)
seam_quality ∈ clean | tight | cramped
clean — seam_gap >= 0.12 (full breath pad honored)
tight — 0.06 <= seam_gap < 0.12
cramped — seam_gap < 0.06 (bad seam; prefer dropping in future passes)
Emit cuts[] = { start, end, reason, transition_id:"hard_cut", seam_gap, seam_quality }.
</stage_b_algorithm>

<worked_examples>
These use the real WhatsApp-clip transcript. Verify your implementation reproduces them exactly.

EXAMPLE A — adjacent single-word removals MUST merge (Step 1).
Stage A removals: { w0,w0,filler } ("okay" 0.13-0.57), { w1,w1,filler } ("so" 0.57-0.84).
w2 "now" starts 0.87.
Step 1: w1.from index (1) <= w0.to index (0) + 1 -> MERGE into { w0, w1, filler }.
Step 2: from is w0 -> raw.start = 0. to is w1, nextStart = w2.start = 0.87,
raw.end = w1.end + (0.87 - 0.84)/2 = 0.84 + 0.015 = 0.855.
Step 3: cut.start = 0 (from is w0). cut.end = min(0.855, 0.87 - 0.12) = min(0.855, 0.75) = 0.75.
Result: cut { start: 0, end: 0.75 }. BOTH "okay" and "so" removed; 0.12s air before "now".
WRONG (current bug): only w0 cut -> end 0.57 -> "so" stays in the video. That is a FAILURE.

EXAMPLE B — breath padding on cut.end prevents mid-breath clip (Step 3).
Stage A removal: { w51,w53,false_start } ("so just edits", w53 ends 26.41). w54 "and" starts 26.44.
Last kept before: w50 "video" ends 25.47.
Step 2: raw.start = 25.47 + (w51.start 25.57 - 25.47)/2 = 25.47 + 0.05 = 25.52.
raw.end = 26.41 + (26.44 - 26.41)/2 = 26.41 + 0.015 = 26.425.
Step 3: cut.start = max(25.52, 25.47 + 0.12) = max(25.52, 25.59) = 25.59.
cut.end = min(26.425, 26.44 - 0.12) = min(26.425, 26.32) = 26.32.
Result: cut { start: 25.59, end: 26.32 }. Now 0.12s air before "and" — no mid-breath slam.
WRONG (current bug): end 26.425, only 0.015s before "and" -> audio resumes mid-breath. FAILURE.

EXAMPLE C — a cut too tight to pad must be DROPPED (Step 3 invalid case).
Hypothetical: remove a word whose previous-kept ends at 10.00 and next-kept starts at 10.20
(0.20s total gap). PAD 0.12 each side needs 0.24s; only 0.20s exists.
Step 3: cut.start = 10.12, cut.end = 10.08 -> end <= start -> INVALID -> DROP. Emit nothing here.
</worked_examples>

# ============================== ZOOMS / PUNCH-INS ==============================

<what_stage_a_may_emphasize>
Stage A proposes emphasis as { word | from_word..to_word, kind }. Valid kinds:
hook - the opening line that earns the watch (usually one per clip)
key_number - a spoken statistic / figure / quantity
payoff - the conclusion / punchline / key takeaway (usually one per clip)
key_claim - a single strong claim worth visual weight (use sparingly)
Emphasis is SPARING: only the hook, key numbers, and the payoff by default. A 30-45s clip should
have ~2-4 emphasis marks total, not one per sentence.
</what_stage_a_may_emphasize>

<stage_b_zoom_resolution>
Each emphasis mark becomes ONE punch_in over the marked word span:
start = words[from].start ; end = words[to].end (clamped to the OUTPUT timeline after cuts).
scale by kind: hook 1.12 | key_number 1.18 | payoff 1.15 | key_claim 1.10
focus_x 0.5 ; focus_y 0.40 (face) unless framing dictates otherwise.
duration: clamp to 0.8s min, 3.0s max. If the marked span is longer, center the punch_in on it.
</stage_b_zoom_resolution>

<stage_b_zoom_hard_rules>

1. MIN GAP BETWEEN ZOOMS: no two punch_ins within 2.0s of output time — drop the lower-priority
   one (key_number > payoff > hook > key_claim for retention value).
2. CEILING: max 4 punch_ins per clip; if more, keep highest priority.
3. NEVER zoom across a cut boundary — a punch_in must lie entirely within one kept segment;
   if a mark spans a cut, clamp it to the larger side.
4. NO STACKING: punch_ins never overlap; if two would, merge to the higher scale.
5. Do NOT zoom on ordinary speech — emphasis-marked spans only. No emphasis mark = no zoom.
   </stage_b_zoom_hard_rules>

# ============================== PACING / SLOW-DOWN ==============================

<what_stage_a_may_hold>
Stage A proposes pacing as { from_word..to_word, action } where action:
hold - let a dramatic key line breathe (slight slow-down for weight)
Use ONLY on a genuinely dramatic/important line — at most 1 per clip, often zero. Never on filler,
never on the hook's first words (the hook should feel snappy, not slow).
</what_stage_a_may_hold>

<stage_b_pace_resolution>
A hold becomes a speed ramp on that kept span:
playback rate 0.85x over the marked span (subtle — not slow-motion).
ramp in/out 150ms at each edge to avoid an audible/visual snap.
pitch-correct audio if the engine supports it; if not, the span plays at 0.85x with pitch shift
accepted (flag to user).
Hard rules: max 1 hold per clip; min held-span length 0.6s; a hold must lie within one kept
segment (never across a cut); never combine a hold with a punch_in on the same span (pick the
punch_in — motion reads stronger than slow-down for short-form).
</stage_b_pace_resolution>

# ============================== CAPTION ORDERING (downstream) ==============================

<caption_ordering_contract>
Captions are built LAST — after Stage B cuts are resolved and the kept timeline is known.
Pipeline order: … → Stage B → editor-in-chief → CAPTIONS → mapper.

1. KEPT WORDS ONLY: include only transcript words that do NOT overlap any resolved cut
   (word.start >= cut.end OR word.end <= cut.start for all cuts — no overlap).
2. OUTPUT TIMELINE: map each kept word through srcToOut() onto the post-cut output timeline.
   Caption graphic start/end and word timings are OUTPUT seconds (mapper uses them directly
   via timeline_base:"output" — no second srcToOut pass).
3. TRANSITION-WINDOW BLACKOUT: for each cut join at output time J = srcToOut(cut.end):
   no caption word may render during [J - BLACKOUT, J + BLACKOUT] where BLACKOUT = 0.20s.
   Drop or trim any caption word whose output span overlaps a blackout window.
   Rationale: captions must not appear on top of a cut/transition seam — they would flash
   mid-join and read as word-chopping even when the audio edit is clean.
4. Build caption graphics from the trimmed kept-word list, then merge into EDL graphics[].
   </caption_ordering_contract>

# ============================== TRANSITIONS / SFX (STUB) ==============================

<transitions_sfx_stub>
NOT ACTIVE YET — finalized in the transitions step. Placeholder contract so Stage B output is
forward-compatible:

- Every emitted cut carries transition_id; default "hard_cut" (no visible transition) for now.
- A later step will let Stage B assign a visible shader transition to ~1 in 3 cuts and sync an
  sfx from the catalog to transitions / zoom hits, using the verified catalog.json ids.
- Do not invent transition or sfx ids here; leave hard_cut until that step wires the catalog.
  </transitions_sfx_stub>

<output_contract>
Stage B emits the existing pipeline shapes (no downstream change):
cuts[]: { start, end, reason, transition_id:"hard_cut", seam_gap, seam_quality }
(SOURCE seconds, snapped; seam fields describe the join after cut.end)
punch_ins[]: { start, end, scale, focus_x, focus_y } (SOURCE seconds)
pace[] (new, optional): { start, end, rate } (SOURCE seconds)
All cut/punch_in/pace times SOURCE seconds; timeline.ts re-bases them onto the output.
Caption graphics use OUTPUT seconds per <caption_ordering_contract>.
</output_contract>
