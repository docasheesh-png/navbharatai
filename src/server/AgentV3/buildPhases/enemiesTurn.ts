/**
 * 🦹 "ENEMY BANAO" IN AN OPEN WORLD THAT ALREADY EXISTS IS DONE BY THE PLATFORM (admin 2026-11-26: "kitna bhi prompt de! par
 * open world game me enemy ban hi nahi rahe hai … hero par attack karne ke liye enemy aye, fire kare, punch kare").
 *
 * 🔑 THE ROOT CAUSE. The game kit — Entities (people who chase and attack), combat, weapons, the police — is laid down by the
 * kit seed, and the seed runs ONLY on a brand-new build in an untouched workspace. A user who builds an open world and then
 * asks for enemies is on an EDIT turn: no seed runs, so the kit files the enemies need are not in the project, and the whole
 * thing is left to the model — which writes enemies on APIs that do not exist, forgets to list them, or places them nowhere
 * near the hero. However many times the user asks, the same thing happens, because the turn starts the same way.
 *
 * 🧬 THE FIX: on any turn whose words ask for enemies, in a game that is a NavBharatAI open world (it has the features list
 * and the open-world kit), the platform itself (1) lays down the systems kit when its Entities / Dispatch files are missing,
 * (2) writes src/game/features/streetDanger.ts — enemies near the hero from the first second, some punch, some FIRE, police
 * on a crime — and (3) lists it in src/game/features/index.ts. The builder is told it is done and which file to change. A game
 * that already has street danger, or a feature of its own that spawns hostile people, is not given a second set: the builder
 * is told to make THAT one work (and the playtest's MISSING_ENEMIES check reads the result). Never throws.
 */
import { asksForEnemies } from '../gameIntent';
import { parseFeatureList, FEATURES_INDEX } from '../growthGuard';
import { GAME_STREET_DANGER_FEATURE, GAME_STREET_DANGER_PATH } from '../../lib/GameOpenWorldGenerator';

export const OPEN_WORLD_KIT_FILE = 'src/game/play/openWorld.ts';
export const ENTITIES_FILE = 'src/game/systems/entities.ts';
export const DISPATCH_FILE = 'src/game/systems/dispatch.ts';
const DANGER_NAME = 'streetDanger';
const DANGER_IMPORT = "import streetDanger from './streetDanger';";

interface Issue { phase: 'build'; severity: 'info' | 'warning'; code: string; message: string; autoResolved: boolean }

/** A feature of the user's own that already spawns hostile people (so a second set is never added). PURE. */
export function ownEnemyFeature(files: Readonly<Record<string, string>>): string | null {
  for (const [p, c] of Object.entries(files)) {
    if (!/^src\/game\/features\/[^/]+\.tsx?$/.test(p) || p === FEATURES_INDEX || p === GAME_STREET_DANGER_PATH || typeof c !== 'string') continue;
    if (/new\s+Entities\s*\(|\.spawnAround\s*\(|hostile\s*:\s*true/.test(c)) return p;
  }
  return null;
}

/** The features list with street danger imported and listed — null when the list is not in the shape the platform wrote. PURE. */
export function withStreetDangerListed(index: string): string | null {
  const list = parseFeatureList(index);
  if (!list) return null;
  if (list.listed.includes(DANGER_NAME)) return index;
  let out = index;
  if (!out.includes(DANGER_IMPORT)) {
    const imports = [...out.matchAll(/^import[^\n]*;[ \t]*$/gm)];
    const last = imports[imports.length - 1];
    out = last ? out.slice(0, last.index! + last[0].length) + '\n' + DANGER_IMPORT + out.slice(last.index! + last[0].length) : DANGER_IMPORT + '\n' + out;
  }
  const open = /export\s+const\s+FEATURES\b[^=]*=\s*\[/.exec(out);
  if (!open) return null;
  const at = open.index + open[0].length;
  return out.slice(0, at) + '\n  streetDanger, // enemies (some punch, some fire), bystanders and the police — src/game/features/streetDanger.ts' + out.slice(at);
}

export async function enemiesAtTurnStart(io: {
  /** An import or a module turn, or a new build (the seed lays the danger itself): not this step's turn. */
  skip?: boolean;
  prompt: string;
  filesAtTurnStart: Readonly<Record<string, string>> | null;
  read: (path: string) => Promise<string>;
  write: (path: string, content: string) => Promise<void>;
  /** Runs one platform recipe (generate_game_systems) — true when it ran without an error. */
  runRecipe: (name: string) => Promise<boolean>;
  record: (issue: Issue) => void;
}): Promise<string> {
  try {
    const start = io.filesAtTurnStart;
    if (io.skip || !start || typeof start[FEATURES_INDEX] !== 'string' || typeof start[OPEN_WORLD_KIT_FILE] !== 'string') return '';
    if (!asksForEnemies(io.prompt)) return '';
    const has = async (p: string) => io.read(p).then((c) => typeof c === 'string', () => false);
    if (typeof start[GAME_STREET_DANGER_PATH] === 'string' || await has(GAME_STREET_DANGER_PATH)) {
      return 'ENEMIES: this game already has its enemies, bystanders and police in src/game/features/streetDanger.ts (listed in src/game/features/index.ts). '
        + 'For anything about enemies — how many, how strong, guns, punches, police — change THAT file (its STREET_DANGER numbers at the top). Never add a second set.';
    }
    const own = ownEnemyFeature(start);
    if (own) {
      return `ENEMIES: this game already has a feature of its own that spawns hostile people: ${own}. Make THAT one work — it must be listed in src/game/features/index.ts, `
        + 'spawn its enemies near the hero with Entities.spawnAround, and attack with damagePlayer — rather than adding a second set. The playtest checks that enemies are on screen.';
    }
    if (!(await has(ENTITIES_FILE)) || !(await has(DISPATCH_FILE))) {
      const ok = await io.runRecipe('generate_game_systems');
      if (!ok || !(await has(ENTITIES_FILE)) || !(await has(DISPATCH_FILE))) {
        io.record({ phase: 'build', severity: 'warning', code: 'ENEMIES_KIT_NOT_LAID', autoResolved: false,
          message: 'The request asked for enemies in the open world, but the game kit for them (src/game/systems/entities.ts and dispatch.ts) could not be laid down, so the platform added none; the builder was told.' });
        return 'ENEMIES: the request asks for enemies, but the game kit they run on could not be added to this project. Tell the user plainly that the enemies were not added this turn, and why.';
      }
    }
    const index = await io.read(FEATURES_INDEX).then((c) => (typeof c === 'string' ? c : null), () => null);
    const listed = index === null ? null : withStreetDangerListed(index);
    if (listed === null) {
      io.record({ phase: 'build', severity: 'warning', code: 'ENEMIES_NOT_LISTED', autoResolved: false,
        message: 'The request asked for enemies; the features list (src/game/features/index.ts) is not in the shape the platform wrote, so street danger was not added; the builder was told.' });
      return 'ENEMIES: the platform could not add its enemies because src/game/features/index.ts is not in its usual shape. Add one feature that spawns enemies near the hero (Entities.spawnAround) and list it there.';
    }
    await io.write(GAME_STREET_DANGER_PATH, GAME_STREET_DANGER_FEATURE);
    if (listed !== index) await io.write(FEATURES_INDEX, listed);
    io.record({ phase: 'build', severity: 'info', code: 'ENEMIES_ADDED', autoResolved: true,
      message: 'The request asked for enemies: the platform added src/game/features/streetDanger.ts (enemies near the hero from the first second — some punch, some fire — bystanders, and the police on a crime) and listed it — no model call made this change.' });
    return 'ENEMIES — ALREADY DONE BY THE PLATFORM: src/game/features/streetDanger.ts is written and listed in src/game/features/index.ts. Enemies appear near the hero from the first second; '
      + 'some punch, some carry guns and fire (a flash, a tracer, the shot\'s sound); they hurt the player\'s health; the hero\'s punch and the hero\'s own gun beat them; hurting a bystander brings the police. '
      + 'Do NOT write another enemy system. For changes the user asks for (more enemies, stronger, only guns, no police), edit THAT file — its STREET_DANGER numbers at the top.';
  } catch { return ''; }
}
