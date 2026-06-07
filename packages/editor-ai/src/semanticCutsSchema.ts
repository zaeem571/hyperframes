/** Gemini response schema for Stage A semantic cuts (word IDs only). */

export const SEMANTIC_CUTS_SCHEMA_VERSION = "2";

export const SEMANTIC_CUTS_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    remove: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          from_word: { type: "STRING", description: "Word id e.g. w0" },
          to_word: { type: "STRING", description: "Word id e.g. w3 inclusive" },
          reason: {
            type: "STRING",
            enum: ["filler", "false_start", "repeat", "dead_air", "tangent"],
          },
        },
        required: ["from_word", "to_word", "reason"],
        propertyOrdering: ["from_word", "to_word", "reason"],
      },
    },
    emphasize: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          from_word: { type: "STRING" },
          to_word: { type: "STRING" },
          kind: {
            type: "STRING",
            enum: ["hook", "key_number", "payoff", "key_claim"],
          },
        },
        required: ["from_word", "to_word", "kind"],
        propertyOrdering: ["from_word", "to_word", "kind"],
      },
    },
    pace: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          from_word: { type: "STRING" },
          to_word: { type: "STRING" },
          action: { type: "STRING", enum: ["hold"] },
        },
        required: ["from_word", "to_word", "action"],
        propertyOrdering: ["from_word", "to_word", "action"],
      },
    },
  },
  required: ["remove", "emphasize", "pace"],
  propertyOrdering: ["remove", "emphasize", "pace"],
} as const;
