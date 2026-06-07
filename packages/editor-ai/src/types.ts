/**
 * TypeScript mirror of the EDL JSON Schema (see schema.ts).
 *
 * Every time field below is in SOURCE seconds — i.e. measured against the raw input
 * video, before any cuts are removed. The mapper (mapper.ts) is responsible for
 * removing `cuts` and re-basing all other times onto the edited output timeline.
 */

export type Archetype =
  | "talking_head"
  | "tutorial"
  | "vlog"
  | "product_demo"
  | "interview"
  | "montage";

export type CaptionPlacement = "bottom_center" | "middle_center" | "top_center" | "lower_third";

export type CaptionStyle = "karaoke" | "block" | "word_pop" | "none";

export type TransitionStyle = "hard_cut" | "crossfade" | "dip_to_black";

export type Pace = "slow" | "medium" | "fast" | "snappy";

export interface StyleDecisions {
  archetype: Archetype;
  /** Hex color, e.g. "#FF3366". */
  accent_color: string;
  caption_placement: CaptionPlacement;
  caption_style: CaptionStyle;
  transition_style: TransitionStyle;
  pace: Pace;
  /** Optional CSS font-family for overlays. */
  font_family?: string;
}

export type CutReason =
  | "filler"
  | "false_start"
  | "repeat"
  | "dead_air"
  | "tangent"
  | "silence"
  | "filler_word"
  | "mistake"
  | "redundant";

export type SemanticRemoveReason = "filler" | "false_start" | "repeat" | "dead_air" | "tangent";

export type SemanticEmphasisKind = "hook" | "key_number" | "payoff" | "key_claim";

export interface SemanticRemoveSpan {
  from_word: string;
  to_word: string;
  reason: SemanticRemoveReason;
}

export interface SemanticEmphasizeSpan {
  from_word: string;
  to_word: string;
  kind: SemanticEmphasisKind;
}

export interface SemanticPaceSpan {
  from_word: string;
  to_word: string;
  action: "hold";
}

/** Stage A output — word IDs only, no timestamps. */
export interface SemanticCutsDecision {
  remove: SemanticRemoveSpan[];
  emphasize: SemanticEmphasizeSpan[];
  pace: SemanticPaceSpan[];
}

/** Speed ramp on a kept span (SOURCE seconds). Forward-compatible; mapper may wire later. */
export interface PaceRamp {
  start: number;
  end: number;
  rate: number;
}

export type SeamQuality = "clean" | "tight" | "cramped";

/** A span of dead air / filler to REMOVE from the source. SOURCE seconds. */
export interface Cut {
  start: number;
  end: number;
  reason?: CutReason;
  /** Catalog transition at the join after this cut. Defaults to hard_cut. */
  transition_id?: string;
  /** Air before next kept word at cut.end (SOURCE seconds). From Stage B Step 9. */
  seam_gap?: number;
  /** Join quality at cut.end. From Stage B Step 9. */
  seam_quality?: SeamQuality;
}

/** A scale-emphasis ("punch in") on the A-roll. SOURCE seconds. */
export interface PunchIn {
  start: number;
  end: number;
  /** e.g. 1.15 */
  scale: number;
  /** Horizontal focal point, 0..1. */
  focus_x?: number;
  /** Vertical focal point, 0..1. */
  focus_y?: number;
}

export type GraphicType = "caption" | "title" | "lower_third" | "callout" | "image";

export type GraphicPlacement =
  | "bottom_center"
  | "middle_center"
  | "top_center"
  | "lower_third"
  | "top_left"
  | "top_right";

/** Per-word karaoke timing (used when type=caption and caption_style=karaoke). */
export interface CaptionWord {
  word: string;
  start: number;
  end: number;
  /** One emphasis word per line — DM Serif Display italic + glow. */
  emphasis?: boolean;
}

export type CaptionZone = "zone_top" | "zone_midlow" | "zone_center";

export type CaptionStyleId =
  | "hormozi_serifpop"
  | "hormozi_classic"
  | "pill_box"
  | "beat_bounce"
  | "karaoke_sweep";

/** A timed text/overlay, including spoken-word captions. SOURCE seconds. */
export interface Graphic {
  start: number;
  end: number;
  type: GraphicType;
  text?: string;
  /** For type=image; must exist in the asset manifest. */
  asset_id?: string;
  placement?: GraphicPlacement;
  /** Karaoke word timings when type=caption. */
  words?: CaptionWord[];
  /** Subtitles guide placement zone (see config/subtitlesguide.md). */
  caption_zone?: CaptionZone;
  /** Subtitles guide style preset (see config/subtitlesguide.md). */
  caption_style_id?: CaptionStyleId;
  /** When "output", start/end/words are already on the post-cut timeline (no srcToOut in mapper). */
  timeline_base?: "source" | "output";
}

/** A sound effect to layer under the main track. SOURCE seconds. */
export interface Sfx {
  time: number;
  /** Must exist in the asset manifest. */
  asset_id: string;
  /** 0..1, default 1. */
  volume?: number;
}

export type MotionGraphicCoverage = "half" | "full";

/** Delegated to the motion-graphic sub-agent (Step 6). Not rendered until wired. */
export interface MotionGraphicRequest {
  start: number;
  end: number;
  /** Must exist in catalog.json motion_graphic_templates. */
  template_id: string;
  coverage: MotionGraphicCoverage;
  /** Scene brief for the sub-agent — meaning + verbatim text only; no visual treatment. */
  scene_context: string;
  /** Primary verbatim label/text to render (preferred over burying in scene_context). */
  headline?: string;
}

/** The full Edit Decision List emitted by the analyzer. */
export interface Edl {
  /** Model's best estimate of the raw video duration (seconds). ffprobe overrides this. */
  source_duration: number;
  style_decisions: StyleDecisions;
  cuts: Cut[];
  punch_ins: PunchIn[];
  /** Optional speed ramps from Stage B cut resolver (SOURCE seconds). */
  pace?: PaceRamp[];
  graphics: Graphic[];
  sfx: Sfx[];
  motion_graphic_requests?: MotionGraphicRequest[];
  /** Selected caption style for this run — must match every caption graphic. */
  subtitle_style_id?: CaptionStyleId;
}
