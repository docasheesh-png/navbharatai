/**
 * ENTERABLE HOUSES (owner 2026-11-23). An action, shooter or open-world game — PUBG, Free Fire, BGMI,
 * GTA, in any language — does not leave the player outside a solid box. Every house opens, and the
 * map has a town of at least 100 of them.
 */
import { asksForEnterableHouses } from './gameIntent';

export const ENTERABLE_HOUSE_RULE = '🚪 ENTERABLE HOUSES. When the game is an action game, a shooter or an open world'
  + ' (a named battle-royale title or a city sandbox, in any language), call createActionTown() from src/game/three/buildings.ts.'
  + ' It places at least 100 houses in villages on roads. No identical model sits on an adjacent plot, and no identical'
  + ' model-plus-colour sits among the six nearest houses. Shells are instanced. The hollow interior, swinging door,'
  + ' furniture and floor collider are built only when the player is near, then removed again. The door opens with the'
  + ' interact key (E on a keyboard, Use on a phone) and its collider swings with it. Walls, floor and ceiling collide.'
  + ' The floor is ground, so the player stands on it indoors. The roof fades while the player is inside. Furniture uses'
  + ' the library subjects bed, sofa, chair, table, kitchen counter, fridge, lamp, cabinet and shelf. A solid library'
  + ' house is scenery: enterableShellFor(model) builds the walkable shell from its footprint. Do not leave a solid box'
  + ' as the only house.';

const ACTION_FILE = /createHouse\s*\(|createActionTown\s*\(/;
const ENTERS = /createActionTown\s*\(|createEnterableHouse\s*\(|enterable\s*:\s*true|enterableShellFor\s*\(/;
const KIT = /\/three\/(buildings|objects)\.ts$/;

/** A build that asks for an action world and still draws a solid house. PURE. */
export function missingEnterableHouses(prompt: string, files: ReadonlyMap<string, string> | Readonly<Record<string, string>>): string {
  if (!asksForEnterableHouses(prompt)) return '';
  const entries = files instanceof Map ? [...files.entries()] : Object.entries(files);
  let drawsHouse = false;
  let enters = false;
  for (const [path, src] of entries) {
    const text = String(src || '');
    if (!text || text.length > 500_000 || KIT.test(path)) continue;
    if (ENTERS.test(text)) enters = true;
    if (ACTION_FILE.test(text) || /createHouse\s*\(/.test(text)) drawsHouse = true;
  }
  if (enters || !drawsHouse) return '';
  return '\n\n🚪 ENTERABLE HOUSES MISSING — this build is not acceptable yet. An action, shooter or open-world game needs'
    + ' createActionTown() so every house opens and the map has at least 100 of them. A solid createHouse() is scenery, not a home.';
}
