/**
 * The Gemini `responseSchema` that forces a deterministic EDL.
 *
 * Expressed as a plain object using the JSON-Schema-like shape `@google/genai`
 * accepts (uppercase `type` strings + `propertyOrdering`). Keeping it framework-free
 * means this file has zero imports and can be inspected/tested in isolation.
 *
 * `propertyOrdering` is honored by Gemini structured output and nudges the model
 * toward stable key order, which improves run-to-run determinism.
 *
 * Bump SCHEMA_VERSION whenever the shape changes — it is folded into the analyzer
 * cache key so edits here correctly invalidate previously cached EDLs.
 */

export const SCHEMA_VERSION = "1";

export const EDL_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    source_duration: {
      type: "NUMBER",
      description: "Total duration of the raw video in seconds (best estimate from the footage).",
    },
    style_decisions: {
      type: "OBJECT",
      description: "Global stylistic choices derived from the Style Decision Graph.",
      properties: {
        archetype: {
          type: "STRING",
          enum: ["talking_head", "tutorial", "vlog", "product_demo", "interview", "montage"],
        },
        accent_color: { type: "STRING", description: "Hex color, e.g. #FF3366." },
        caption_placement: {
          type: "STRING",
          enum: ["bottom_center", "middle_center", "top_center", "lower_third"],
        },
        caption_style: {
          type: "STRING",
          enum: ["karaoke", "block", "word_pop", "none"],
        },
        transition_style: {
          type: "STRING",
          enum: ["hard_cut", "crossfade", "dip_to_black"],
        },
        pace: { type: "STRING", enum: ["slow", "medium", "fast", "snappy"] },
        font_family: { type: "STRING", description: "Optional CSS font-family for overlays." },
      },
      required: [
        "archetype",
        "accent_color",
        "caption_placement",
        "caption_style",
        "transition_style",
        "pace",
      ],
      propertyOrdering: [
        "archetype",
        "accent_color",
        "caption_placement",
        "caption_style",
        "transition_style",
        "pace",
        "font_family",
      ],
    },
    cuts: {
      type: "ARRAY",
      description:
        "Dead-air / filler spans to REMOVE, in SOURCE seconds. Non-overlapping, ascending.",
      items: {
        type: "OBJECT",
        properties: {
          start: { type: "NUMBER" },
          end: { type: "NUMBER" },
          reason: {
            type: "STRING",
            enum: ["silence", "filler_word", "mistake", "dead_air", "redundant"],
          },
        },
        required: ["start", "end"],
        propertyOrdering: ["start", "end", "reason"],
      },
    },
    punch_ins: {
      type: "ARRAY",
      description: "Scale-emphasis moments on the A-roll. Times in SOURCE seconds.",
      items: {
        type: "OBJECT",
        properties: {
          start: { type: "NUMBER" },
          end: { type: "NUMBER" },
          scale: { type: "NUMBER", description: "Zoom factor, e.g. 1.15." },
          focus_x: { type: "NUMBER", description: "Horizontal focal point, 0..1." },
          focus_y: { type: "NUMBER", description: "Vertical focal point, 0..1." },
        },
        required: ["start", "end", "scale"],
        propertyOrdering: ["start", "end", "scale", "focus_x", "focus_y"],
      },
    },
    graphics: {
      type: "ARRAY",
      description: "Timed text/overlays INCLUDING spoken-word captions. Times in SOURCE seconds.",
      items: {
        type: "OBJECT",
        properties: {
          start: { type: "NUMBER" },
          end: { type: "NUMBER" },
          type: {
            type: "STRING",
            enum: ["caption", "title", "lower_third", "callout", "image"],
          },
          text: { type: "STRING" },
          asset_id: {
            type: "STRING",
            description: "For type=image; must exist in the asset manifest.",
          },
          placement: {
            type: "STRING",
            enum: [
              "bottom_center",
              "middle_center",
              "top_center",
              "lower_third",
              "top_left",
              "top_right",
            ],
          },
          words: {
            type: "ARRAY",
            description: "Karaoke word timings (SOURCE seconds) when type=caption.",
            items: {
              type: "OBJECT",
              properties: {
                word: { type: "STRING" },
                start: { type: "NUMBER" },
                end: { type: "NUMBER" },
              },
              required: ["word", "start", "end"],
              propertyOrdering: ["word", "start", "end"],
            },
          },
        },
        required: ["start", "end", "type"],
        propertyOrdering: ["start", "end", "type", "text", "asset_id", "placement", "words"],
      },
    },
    sfx: {
      type: "ARRAY",
      description: "Sound effects to layer under the main track. Times in SOURCE seconds.",
      items: {
        type: "OBJECT",
        properties: {
          time: { type: "NUMBER" },
          asset_id: { type: "STRING", description: "Must exist in the asset manifest." },
          volume: { type: "NUMBER", description: "0..1, default 1." },
        },
        required: ["time", "asset_id"],
        propertyOrdering: ["time", "asset_id", "volume"],
      },
    },
  },
  required: ["source_duration", "style_decisions", "cuts", "punch_ins", "graphics", "sfx"],
  propertyOrdering: ["source_duration", "style_decisions", "cuts", "punch_ins", "graphics", "sfx"],
} as const;
