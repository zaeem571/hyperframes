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

export type CutReason = "silence" | "filler_word" | "mistake" | "dead_air" | "redundant";

/** A span of dead air / filler to REMOVE from the source. SOURCE seconds. */
export interface Cut {
  start: number;
  end: number;
  reason?: CutReason;
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
}

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
}

/** A sound effect to layer under the main track. SOURCE seconds. */
export interface Sfx {
  time: number;
  /** Must exist in the asset manifest. */
  asset_id: string;
  /** 0..1, default 1. */
  volume?: number;
}

/** The full Edit Decision List emitted by the analyzer. */
export interface Edl {
  /** Model's best estimate of the raw video duration (seconds). ffprobe overrides this. */
  source_duration: number;
  style_decisions: StyleDecisions;
  cuts: Cut[];
  punch_ins: PunchIn[];
  graphics: Graphic[];
  sfx: Sfx[];
}
