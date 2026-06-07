/**
 * Load and validate config/catalog.json for the agentic editor orchestrator.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export interface CatalogTransition {
  id: string;
  shader: string | null;
  title?: string;
  when_to_use?: string;
  default_duration_sec?: number;
  energy?: string;
}

export interface CatalogSfx {
  id: string;
  asset_id: string;
  character?: string;
  when_to_use?: string;
  duration_sec?: number;
}

export interface CatalogMotionGraphicTemplate {
  id: string;
  coverage: "half" | "full";
  title?: string;
  description?: string;
  status?: string;
}

export interface EditorCatalog {
  transitions: CatalogTransition[];
  sfx: CatalogSfx[];
  motion_graphic_templates: CatalogMotionGraphicTemplate[];
}

const defaultCatalogPath = (): string =>
  fileURLToPath(new URL("../config/catalog.json", import.meta.url));

export async function loadCatalog(path: string = defaultCatalogPath()): Promise<EditorCatalog> {
  const raw = JSON.parse(await readFile(path, "utf-8")) as EditorCatalog;
  if (!Array.isArray(raw.transitions) || !Array.isArray(raw.sfx)) {
    throw new Error(`Invalid catalog at ${path}: missing transitions or sfx arrays.`);
  }
  return {
    transitions: raw.transitions,
    sfx: raw.sfx,
    motion_graphic_templates: raw.motion_graphic_templates ?? [],
  };
}

export function transitionIds(catalog: EditorCatalog): Set<string> {
  return new Set(catalog.transitions.map((t) => t.id));
}

export function sfxAssetIds(catalog: EditorCatalog): Set<string> {
  return new Set(catalog.sfx.map((s) => s.asset_id));
}

export function motionGraphicTemplateIds(catalog: EditorCatalog): Set<string> {
  return new Set(catalog.motion_graphic_templates.map((t) => t.id));
}

/** Slim catalog for LLM context — ids + when_to_use only. */
export function catalogForPrompt(catalog: EditorCatalog): Record<string, unknown> {
  return {
    transitions: catalog.transitions.map((t) => ({
      id: t.id,
      title: t.title,
      when_to_use: t.when_to_use,
      energy: t.energy,
    })),
    sfx: catalog.sfx.map((s) => ({
      id: s.id,
      asset_id: s.asset_id,
      character: s.character,
      when_to_use: s.when_to_use,
    })),
    motion_graphic_templates: catalog.motion_graphic_templates.map((t) => ({
      id: t.id,
      coverage: t.coverage,
      title: t.title,
      description: t.description,
    })),
  };
}

export const defaultEditorSystemPath = (): string =>
  fileURLToPath(new URL("../config/editor-system.md", import.meta.url));

export const defaultEditorUserTemplatePath = (): string =>
  fileURLToPath(new URL("../config/editor-user-template.md", import.meta.url));

export const defaultSubtitlesGuidePath = (): string =>
  fileURLToPath(new URL("../config/subtitlesguide.md", import.meta.url));

export function fillEditorUserTemplate(
  template: string,
  slots: { userGuidance: string; transcriptJson: string; catalogJson: string },
): string {
  const guidance = slots.userGuidance.trim() || "(none — use your best editorial judgment)";
  return template
    .replace(/\{\{USER_GUIDANCE\}\}/g, guidance)
    .replace(/\{\{TRANSCRIPT_JSON\}\}/g, slots.transcriptJson)
    .replace(/\{\{CATALOG_JSON\}\}/g, slots.catalogJson);
}
