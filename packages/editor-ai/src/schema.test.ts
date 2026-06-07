import { describe, expect, it } from "vitest";

import {
  EDL_RESPONSE_SCHEMA,
  EDITOR_EDL_RESPONSE_SCHEMA,
  EDITOR_ORCHESTRATOR_RESPONSE_SCHEMA,
  EDITOR_SCHEMA_VERSION,
  SCHEMA_VERSION,
} from "./schema.js";

describe("EDL_RESPONSE_SCHEMA", () => {
  it("requires the EDL top-level fields", () => {
    expect(EDL_RESPONSE_SCHEMA.required).toEqual([
      "source_duration",
      "style_decisions",
      "cuts",
      "punch_ins",
      "graphics",
      "sfx",
    ]);
  });

  it("folds captions into graphics (type enum includes 'caption')", () => {
    const typeEnum = EDL_RESPONSE_SCHEMA.properties.graphics.items.properties.type.enum;
    expect(typeEnum).toContain("caption");
    // and there is no separate top-level captions array
    expect(EDL_RESPONSE_SCHEMA.properties).not.toHaveProperty("captions");
  });

  it("supports per-word karaoke timings on graphics", () => {
    const words = EDL_RESPONSE_SCHEMA.properties.graphics.items.properties.words;
    expect(words.type).toBe("ARRAY");
    expect(words.items.required).toEqual(["word", "start", "end"]);
  });

  it("exposes a string SCHEMA_VERSION (folded into the cache key)", () => {
    expect(typeof SCHEMA_VERSION).toBe("string");
  });

  it("editor schema requires motion_graphic_requests and per-cut transition_id", () => {
    expect(EDITOR_EDL_RESPONSE_SCHEMA.required).toContain("motion_graphic_requests");
    const cutProps = EDL_RESPONSE_SCHEMA.properties.cuts.items.properties;
    expect(cutProps.transition_id.enum).toContain("hard_cut");
    expect(cutProps.transition_id.enum).toContain("flash-through-white");
    expect(typeof EDITOR_SCHEMA_VERSION).toBe("string");
  });

  it("orchestrator schema omits cuts punch_ins and sfx", () => {
    expect(EDITOR_ORCHESTRATOR_RESPONSE_SCHEMA.required).toEqual([
      "source_duration",
      "style_decisions",
      "graphics",
      "motion_graphic_requests",
    ]);
    expect(EDITOR_ORCHESTRATOR_RESPONSE_SCHEMA.properties).not.toHaveProperty("cuts");
    expect(EDITOR_ORCHESTRATOR_RESPONSE_SCHEMA.properties).not.toHaveProperty("punch_ins");
    expect(EDITOR_ORCHESTRATOR_RESPONSE_SCHEMA.properties).not.toHaveProperty("sfx");
  });
});
