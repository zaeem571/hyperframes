/**
 * Structured output schema for the transcript cleanup pass (text-only, no editing).
 */

export const TRANSCRIPT_FIX_SCHEMA_VERSION = "1";

export const TRANSCRIPT_FIX_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    words: {
      type: "ARRAY",
      description:
        "Corrected word-level transcript. Same length and timestamps as input; only text may change.",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING", description: "Stable word id from input, unchanged." },
          text: { type: "STRING", description: "Corrected spoken word or punctuation." },
          start: {
            type: "NUMBER",
            description: "Start time in SOURCE seconds — must match input.",
          },
          end: { type: "NUMBER", description: "End time in SOURCE seconds — must match input." },
        },
        required: ["id", "text", "start", "end"],
        propertyOrdering: ["id", "text", "start", "end"],
      },
    },
  },
  required: ["words"],
  propertyOrdering: ["words"],
} as const;
