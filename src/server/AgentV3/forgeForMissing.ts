// 🧩 WHAT THE LIBRARY DOES NOT HAVE IS MADE WITH THE FORGE — SAID PER OBJECT, CHECKED AFTER (admin 2026-11-20: "han" to
// "jab yuzer koi aisi cheez maange jo library me nahi hai, to platform use Object Forge se khud bana de", and "user ko
// bataya jaye user ki language me ki user apna module khud bhi upload kar sake").
//
// 🔑 THE CLASS: the Forge existed, but using it was a single generic line in a long system prompt, so a weak builder
// hand-wrote a camel from boxes — the same class the Athree map had before it was seeded (failedbr #2478). The platform
// cannot write the Forge spec itself yet: a model call outside the builder's own turn is held until it has admitted
// billing and cancellation (ToolDispatcher, `describe`), which is the admin's money decision, not this module's.
// So the platform does the part it can do deterministically:
//   1. reads which objects the user NAMED that neither the reviewed library nor the kit's own factories provide;
//   2. hands the builder, for EACH, the Forge instruction with the worked example and checklist for its kind;
//   3. after the build, warns (never blocks) for any of them that has no Forge object — so the report says so.
// The builder also tells the user, in the user's own language, that they can attach their own 3D model instead.
//
// PURE — no I/O.

import { subjectWordsIn, exampleIdForKind, subjectChecklist, type SubjectKind } from '../lib/objectForge/forgeSubjects';
import { OBJECTS_DIR } from '../lib/objectForge/forgePaths';
import { gameAssetRequirements } from './gameAssets/assetPlan';
import type { ReviewedAsset } from './gameAssets/providers';

/** Words that name a CATEGORY, not an object to model. */
const GENERIC = new Set(['animal', 'vehicle', 'character', 'player', 'npc', 'plant', 'building', 'bird', 'forest', 'grass', 'rail', 'railway', 'engine', 'nav', 'cycle']);
/**
 * Objects the 3D kit already builds with its own factories (createHouse, the vehicles, createAircraft, the humanoid,
 * trees and plants), so the Forge is not needed for them.
 */
const KIT_BUILDS = new Set(['car', 'gaadi', 'gadi', 'house', 'ghar', 'tree', 'ped', 'plane', 'aeroplane', 'airplane', 'jet', 'bike', 'motorbike',
  'motorcycle', 'person', 'human', 'man', 'woman', 'boy', 'girl', 'insaan', 'aadmi', 'ladki', 'ladka', 'soldier', 'warrior', 'villager', 'child']);
/** At most this many objects are assigned to the Forge per build (each is a builder step). */
export const FORGE_MISSING_MAX = 4;

export interface MissingObject { word: string; kind: SubjectKind }

/** The objects the request names that neither the library nor the kit provides, in the order named. PURE. */
export function missingObjectSubjects(request: string, catalogue: readonly ReviewedAsset[]): MissingObject[] {
  const out: MissingObject[] = [];
  for (const { word, kind } of subjectWordsIn(String(request ?? ''))) {
    if (GENERIC.has(word) || KIT_BUILDS.has(word)) continue;
    let served = false;
    try { served = gameAssetRequirements(word, catalogue).length > 0; } catch { served = false; }
    if (served) continue;
    out.push({ word, kind });
    if (out.length >= FORGE_MISSING_MAX) break;
  }
  return out;
}

/**
 * The whole assignment for one build turn: [] unless the 3D kit was seeded and the Forge is on. ONE call, so the chat
 * handler gains a single branch (Q-979 headroom). PURE.
 */
export function forgeAssignment(request: string, catalogue: readonly ReviewedAsset[], opts: { kit3D: boolean; forgeOn: boolean }): MissingObject[] {
  return opts.kit3D && opts.forgeOn ? missingObjectSubjects(request, catalogue) : [];
}

/** The builder's per-object instruction, plus what to tell the user. '' when nothing is missing. PURE. */
export function forgeMissingHandoff(missing: readonly MissingObject[]): string {
  if (missing.length === 0) return '';
  const lines = missing.map(({ word, kind }) => `• "${word}" (${kind}): run_recipe({ name: "author_object", input: { example: "${exampleIdForKind(kind)}" } }) to see the closest worked spec, `
    + `then author_object({ spec }) with its id "${word.replace(/[^a-z0-9]+/g, '-')}". ${subjectChecklist(kind).replace(/\n/g, ' ')}`);
  return [
    '🧩 NOT IN THE LIBRARY, SO MAKE THEM WITH THE OBJECT FORGE: NavBharatAI\'s reviewed model library and the kit\'s own factories do not have',
    `these objects the user named: ${missing.map((m) => m.word).join(', ')}. Build EACH with the Object Forge — never as hand-placed boxes:`,
    ...lines,
    'Then, in your final message and in the USER\'S OWN LANGUAGE, name the objects NavBharatAI made itself and say they can replace any of them',
    'with their own 3D model: attach a .glb, .gltf, .obj (or .fbx, or a zip of them) in the chat with the paperclip, and ask "where can I get free 3D models" any time.',
  ].join('\n');
}

/**
 * After the build: the missing objects with no Forge object for them (no file in src/game/objects/ whose name or content
 * names the word). Advisory — the builder may have had a good reason. PURE.
 */
export function forgeNotUsedFor(missing: readonly MissingObject[], objectFiles: ReadonlyMap<string, string>): string[] {
  const files = [...objectFiles].filter(([p]) => p.startsWith(OBJECTS_DIR));
  return missing.filter(({ word }) => {
    const w = word.toLowerCase();
    return !files.some(([p, c]) => p.toLowerCase().includes(w) || String(c).toLowerCase().includes(`"${w}`) || String(c).toLowerCase().includes(`'${w}`));
  }).map((m) => m.word);
}

/** The readiness warning for objects the Forge was asked to make and did not. PURE. */
export function forgeNotUsedWarning(words: readonly string[]): string {
  return `Object Forge not used for ${words.join(', ')}: the library has no model for ${words.length === 1 ? 'it' : 'them'} and the builder was asked `
    + 'to make each with author_object, but no Forge object was saved — it may have been drawn by hand from boxes. Build it with author_object.';
}
