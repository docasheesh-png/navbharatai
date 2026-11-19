/**
 * 🔴 ONE INSTRUCTION PER OBJECT, NOT TWO THAT DISAGREE (autopsy 61279465, 2026-11-04 — the 3D train simulator).
 *
 * L3 prepared a reviewed CC0 locomotive (Kenney `train-diesel-a`) and wrote it into the game as
 * `loadRequestedAsset('train', …)`. In the SAME build, the hero-object contract and the `object_spec` tool told
 * the builder *"TRAIN / LOCOMOTIVE — There is no library builder for this one, so HAND-MODEL it"*. The builder
 * followed the spec, never opened assetModels.ts, and shipped a train made of boxes to a user who had written
 * "not primitive placeholders". Six models were downloaded, saved and published; none was in the scene.
 *
 * 🧬 THE CLASS: two subsystems describing the same object, each unaware the other existed. So the spec now
 * READS what L3 prepared — the subjects in the game's own `assetModels.ts` — and, where a model is ready, it
 * says so first and demotes the hand-modelling spec to the fallback. PURE; never throws.
 */
import { gameAssetRequirements } from './assetPlan';
import { REVIEWED_GAME_ASSETS } from './providers';

export const ASSET_MODELS_PATH = 'src/game/three/assetModels.ts';

/** The local-model manifest a generated assetModels.ts carries ({} for anything else) — subject → entry. */
export function localModelEntries(assetModelsSource: string | null | undefined): Record<string, Record<string, unknown>> {
  const m = /const assets: Record<string, LocalGameAsset> = (\{.*\});\n/.exec(String(assetModelsSource ?? ''));
  if (!m) return {};
  try {
    const parsed = JSON.parse(m[1]) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>)
      .filter(([k, v]) => /^[a-z][a-z0-9 _-]{0,40}$/i.test(k) && !!v && typeof v === 'object' && !Array.isArray(v)) as Array<[string, Record<string, unknown>]>);
  } catch { return {}; }
}

/** The subjects a generated assetModels.ts has a local model for ([] for anything else). */
export function localModelSubjects(assetModelsSource: string | null | undefined): string[] {
  return Object.keys(localModelEntries(assetModelsSource));
}

/** Which ready local model (if any) an object name is asking for — through the catalogue's own aliases. */
export function readyModelFor(objectName: string, ready: readonly string[]): string | null {
  if (!ready.length) return null;
  const name = String(objectName ?? '').trim();
  if (!name) return null;
  if (ready.includes(name.toLowerCase())) return name.toLowerCase();
  try {
    for (const r of gameAssetRequirements(name, REVIEWED_GAME_ASSETS)) if (ready.includes(r.subject)) return r.subject;
  } catch { /* no match */ }
  return null;
}

/** The line that leads an object's spec when a local model is ready for it. */
export function localModelLead(subject: string): string {
  return `  ✅ A REVIEWED LOCAL 3D MODEL IS READY FOR THIS ("${subject}") — use it, do NOT hand-model it: `
    + `const handle = await loadRequestedAsset('${subject}', fallback) from src/game/three/assetModels.ts; add handle.root to the scene. `
    + 'The spec below is ONLY for that procedural fallback (and the real sizes to place the model at). '
    + `To CHANGE it — colour, size, turn, position, hidden parts, animation, the code-built object instead, or a 100% replacement with the user's own .glb — add a "${subject}" entry to src/game/three/assetCustomizations.ts (examples at the top of that file); never edit the library model or its loader.`;
}

/** The handoff sentence that overrides every hand-modelling instruction for the subjects L3 prepared. */
export function localModelsOverride(ready: readonly string[]): string {
  if (!ready.length) return '';
  return `THIS OVERRIDES every "HAND-MODEL it" instruction anywhere in this prompt (the HERO OBJECTS block included) and from the object_spec tool for: ${ready.join(', ')}. `
    + 'Those subjects already have reviewed 3D models in this project; building them from primitives instead is the defect, not the fallback.';
}
