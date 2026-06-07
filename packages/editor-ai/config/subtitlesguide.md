<role>
Authoritative subtitle style library and rendering contract for the reel pipeline. Captions are
built deterministically in code from the corrected transcript (text + per-word timings). This
file dictates the EXACT font, color, glow, position, and word-reveal animation. Follow every
value literally. Never improvise. Never fall back to HyperFrames defaults.
</role>

<canvas_and_units>
Canvas: 1080 x 1920 (9:16). px values are in this space. Origin top-left.
SAFE ZONES — never place text inside:
Top 0-150px (notch). Bottom 0-260px (platform UI).
Captions render on track-index 30+ (above speaker video and above motion graphics) — see
<face_avoidance> and <coexistence> for the exceptions.
</canvas_and_units>

<architecture>
Each style in <style_library> is SELF-CONTAINED and authoritative for its own font(s), layout,
emphasis mechanism, position behavior, words-on-screen, and animation. The sections below
(<emphasis_word_selection>, <positions>, <face_avoidance>, <animation_principles>) are SHARED
DEFAULTS. When a style explicitly specifies a value (e.g. a fixed position, a different word
count, its own motion), the STYLE WINS over the shared default. Do not force one style's pattern
onto another — that is the mistake that makes five styles look like one.
</architecture>

<emphasis_word_selection>
Styles that emphasize ONE word per line (hormozi_serifpop, beat_bounce key-word tint) pick it so:

1. If USER GUIDANCE or the editor EDL flags a keyword for that line, use it.
2. Else the longest content word (noun/verb/adjective), ignoring stop-words
   (the, a, is, to, of, and, so, it, this, that...).
3. Avoid the first/last word if possible — emphasis reads best mid-line.
   Styles that highlight the ACTIVE (currently-spoken) word instead (hormozi_classic, pill_box,
   karaoke_sweep) do not use this selection — they track speech word-by-word.
   </emphasis_word_selection>

<positions>
Two named zones (used by styles that alternate or pin to one):
  ZONE_TOP    -> x=90 left, vertical block center y=470 (upper free zone).
  ZONE_MIDLOW -> x=90 left (or centered if the style says so), block center y=1300 (~68% down).
  CENTER      -> horizontal+vertical center, y=960 (only beat_bounce uses this).
Each style declares whether it alternates TOP/MIDLOW or stays fixed. Honor the style's choice.
</positions>

<face_avoidance>
Text stays IN FRONT (no speaker cutout/matting). Face band ~ x360-720, y500-1150 (centered 9:16
talking head). Rule for any style whose block would land in that band:

- Prefer the style's alternate/secondary position to clear the band.
- If fixed, nudge vertically to the nearest band edge (up to y=430 top / y=1320 low) until clear.
- beat_bounce is the ONLY style permitted to sit centered in the band (one big opaque word,
  brief) unless USER GUIDANCE forbids it, in which case it falls back to ZONE_MIDLOW.
  </face_avoidance>

<animation_principles>
Shared, non-negotiable for every style:

- Seekable/deterministic ONLY: a paused GSAP timeline keyed to word start/end times. Never
  wall-clock, Date.now, or real-time rAF — HyperFrames renders by seeking.
- Word/chunk timing is driven by the transcript's per-word start/end.
- Each style's specific motion (pop, bounce, sweep, build-up, replace) is defined IN that style
  and overrides any generic motion. Do not add motion a style did not specify.
  </animation_principles>

<style_library>

<style id="hormozi_serifpop">
Use: DEFAULT. The reference look (images 3-5). Bold white sans + one glowing amber italic-serif word.
NORMAL: Montserrat 800, #FFFFFF, font-size 76px, line-height 1.06, letter-spacing 0px,
  text-shadow 0 3px 10px rgba(0,0,0,0.55) for legibility on any footage.
EMPHASIS: DM Serif Display Italic, font-size 92px (larger than normal), fill #FFB627,
  glow: text-shadow 0 0 18px rgba(255,182,39,0.85), 0 0 36px rgba(255,150,0,0.55);
  no stroke. Sits inline in the build-up.
Alignment: left. Zones: alternate TOP / MIDLOW per <positions>.
</style>

<style id="hormozi_classic">
Use: business / motivation / opinion. The benchmark Hormozi look. The single boldest style here.
DISTINCT BY: ultra-heavy all-caps weight + fixed mid-low + active-word color highlight + thick
  black stroke. NO serif, NO zone alternation, NO size change between words.

NORMAL + ACTIVE words (all same font; emphasis is COLOR, not font):
  font: Montserrat, weight 900 (Black). text-transform: uppercase. font-size 84px.
  line-height 1.04. letter-spacing 0.5px. word-spacing 6px. text-align: center.
  stroke (load-bearing — do not omit or gray): -webkit-text-stroke 8px #000000;
    paint-order: stroke fill. drop shadow: text-shadow 0 4px 0 rgba(0,0,0,0.55).
  base fill (not-yet-spoken + already-spoken words): #FFFFFF.
  ACTIVE word (currently being spoken): fill #F7C204 (Hormozi yellow). The fill swaps to yellow
    for the duration that word is the active one, then RETURNS to white when the next word
    becomes active. Only ONE yellow word at a time — the karaoke-on-speech highlight.

POSITION: FIXED at ZONE_MIDLOW (y=1300), centered. Never alternates to TOP. Never moves.
  Exception: face-avoidance / coexistence may shift it, per those sections.

WORDS ON SCREEN: show the current short phrase (1-3 words); this style REPLACES per chunk rather
  than building a tall stack — keep it to one or two centered lines, classic Hormozi.

ANIMATION (seek-driven GSAP, keyed to word start):
  chunk IN: the whole 1-3 word chunk pops together — opacity 0->1 (70ms); translateY 40px->0
    (bottom-to-top pop, 150ms, ease back.out(2.2)); scale 0.9->1.0 (150ms).
  active-word highlight: instant fill swap white->#F7C204 at that word's start (0ms, no tween),
    swap back to #FFFFFF at next word's start.
  chunk OUT: opacity 1->0 over 90ms when the next chunk begins.
</style>

<style id="pill_box">
Use: any content; cleanest readability on busy/bright backgrounds. CapCut-style.
DISTINCT BY: every word sits in its own solid rounded PILL (background plate), no text stroke,
  active pill is a different color. Layout is a row/wrap of pills, not free text.

WORDS: Montserrat 800, text-transform: none. font-size 64px. line-height 1.35 (room for pills).
  letter-spacing 0px. text-align: center. word wrap allowed, 1-4 words visible.
EACH WORD PILL:
  display inline-block; padding 8px 18px; border-radius 14px; margin 4px 5px;
  base pill background: rgba(0,0,0,0.82); base text fill #FFFFFF.
  NO -webkit-text-stroke (the pill plate provides contrast — that is the point of this style).
  subtle pill shadow: box-shadow 0 4px 12px rgba(0,0,0,0.35).
ACTIVE word pill (currently spoken): background = composition accent_color (default #F7C204);
  text fill #000000. Reverts to black-pill/white-text when the next word is active.

POSITION: FIXED at ZONE_MIDLOW (y=1300), centered. Does not alternate.

ANIMATION (seek-driven GSAP, keyed to word start):
  per word IN: pill scale 0.7->1.0 (140ms, back.out(2.4)); opacity 0->1 (90ms). Words build up
    in a row and STAY (build-up, not replace) until the phrase clears.
  active swap: pill background + text color swap instantly at word start (0ms), revert at next
    word start.
  block clear: whole pill row opacity 1->0 over 110ms at sentence end / next sentence first word.
</style>

<style id="beat_bounce">
Use: high-energy, fast-talking, hype. Every word is a single punchy event.
DISTINCT BY: tall CONDENSED font, ONE word on screen at a time (replace, not stack), springy
  squash-stretch bounce, dead-center placement.

WORD (one at a time): font: Bebas Neue, weight 400 (tall condensed display).
  text-transform: uppercase. font-size 150px (huge — it owns the frame center). line-height 1.0.
  letter-spacing 2px. text-align: center. fill #FFFFFF.
  stroke: -webkit-text-stroke 4px #000000; paint-order: stroke fill.
  drop shadow: text-shadow 0 6px 14px rgba(0,0,0,0.5).
  key-word tint: if the word is the line's emphasis word (per <emphasis_word_selection>), fill
    = composition accent_color (default #F7C204) instead of white. Otherwise white.

POSITION: FIXED dead center, vertical center y=960 (this style is allowed in the face band
  BECAUSE only one big word flashes briefly and is centered/opaque — it reads as design, not
  obstruction). If USER GUIDANCE forbids center-over-face, fall back to ZONE_MIDLOW.

WORDS ON SCREEN: exactly ONE word, replaced by the next as spoken. No build-up, no phrases.

ANIMATION (seek-driven GSAP, keyed to word start) — the bounce is the signature:
  IN: scale 0.4->1.12 over 130ms (ease back.out(3)), then settle 1.12->1.0 over 90ms;
    simultaneously scaleY squash: 1.25->0.95->1.0 (squash-stretch) across the same 220ms;
    opacity 0->1 over 60ms.
  OUT (as next word arrives): scale 1.0->0.85, opacity 1->0 over 70ms (power2.in).
  Words do not overlap — current word exits as the next enters, on the next word's start time.
</style>

<style id="karaoke_sweep">
Use: educational / tutorial / steady talking-head. Calm, readable, classic karaoke.
DISTINCT BY: the FULL phrase is visible at once (not revealed word-by-word); a color FILL
  SWEEPS left-to-right across each word in time with speech. Consistent word widths, stable.

PHRASE: Inter, weight 800. text-transform: none. font-size 68px. line-height 1.25.
  letter-spacing 0px. text-align: center. up to 4-6 words / two lines visible together.
  base (unspoken) fill: rgba(255,255,255,0.45) (dimmed white — clearly "not yet read").
  spoken fill: #FFFFFF, with the active word's fill = composition accent_color (default #F7C204).
  legibility: text-shadow 0 2px 10px rgba(0,0,0,0.6). No stroke.

POSITION: FIXED at ZONE_MIDLOW (y=1300), centered. Does not alternate.

WORDS ON SCREEN: the whole phrase appears together (gentle fade), then the sweep tracks speech.

ANIMATION (seek-driven GSAP, keyed to word timings) — the sweep is the signature:
  phrase IN: whole phrase opacity 0->1 over 140ms at the phrase's first word start.
  sweep: as each word is spoken, that word's fill animates dimmed->#FFFFFF over that word's
    duration via a left-to-right clip/gradient mask (background-clip: text with a moving
    linear-gradient stop, OR per-letter fill keyed across the word's start->end). The CURRENTLY
    spoken word holds accent_color during its window, then resolves to solid #FFFFFF after.
  phrase OUT: opacity 1->0 over 120ms at sentence end / next sentence first word.
</style>

</style_library>

<fonts>
Open-source Google Fonts; load explicitly into the composition (no system fonts). Only load the
fonts the chosen style needs:
  Montserrat (800, 900)   - hormozi_serifpop, hormozi_classic, pill_box
  DM Serif Display (400 italic) - hormozi_serifpop (the glowing serif word)
  Bebas Neue (400)        - beat_bounce
  Inter (800)             - karaoke_sweep
Google Sans is not used (not freely distributable); Montserrat is the house sans.
</fonts>

<hard_rules>

- Text inside a safe zone (top 0-150, bottom 0-260) -> failure. Clamp to nearest legal y.
- A style rendered with the wrong font, weight, or emphasis mechanism than its spec -> failure.
  (e.g. hormozi_classic in anything lighter than Montserrat 900, or with no/gray stroke; the
  heavy weight + black stroke are load-bearing. beat_bounce in a non-condensed font. pill_box
  without pill backgrounds.)
- Applying one style's pattern to another (forcing build-up onto beat_bounce, alternating zones
  onto a fixed style, etc.) -> failure. The selected style's own spec is authoritative.
- Non-deterministic animation -> failure (seek-driven GSAP only).
- A caption block centered over the face band by a style not permitted there -> failure
  (only beat_bounce may, per <face_avoidance>).
- Caption overlapping a half-screen graphic in the same half -> failure (see <coexistence>).
- Rendering a different style than the one selected by the user / --subtitle-style / default ->
  failure. The chosen style id must be the one rendered.
  </hard_rules>

<coexistence>
When a half-screen motion graphic occupies a half of the frame, captions use the OPPOSITE zone:
  graphic in bottom half -> captions use ZONE_TOP for its duration.
  graphic in top half    -> captions use ZONE_MIDLOW for its duration.
When a full-coverage graphic is active, captions HIDE for its duration.
</coexistence>
