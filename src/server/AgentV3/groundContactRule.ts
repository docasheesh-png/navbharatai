/**
 * GROUND CONTACT IS MANDATORY (owner 2026-11-23). Every game that builds ground — a template, a
 * from-scratch build, or a follow-up edit — keeps characters, vehicles and objects ON that ground.
 * The kit does it in src/game/three/groundContact.ts. A game that draws ground and never calls the
 * kit is not finished: the note below is attached on every write until the call is there.
 */
import { GROUND_EPSILON } from '../lib/groundContact';

export { GROUND_EPSILON };

export const GROUND_CONTACT_RULE = '⛰️ GROUND CONTACT IS MANDATORY. Whenever this game creates ground, land, grass or terrain,'
  + ' nothing solid may sink into it or pass through it. The ground mesh is a collider (markWorldCollider(mesh, \'ground\')'
  + ' — createTerrain already does this). Place every character, vehicle and object with standOnGround(object) from'
  + ' src/game/three/surfaces.ts, which sits the model\'s LOWEST POINT on the surface (the bounding box, not the origin).'
  + ' driveVehicle and the character controller already do this. A custom mover calls standOnGround when it is created and'
  + ' clampOriginY from src/game/three/groundContact.ts every frame, and a vehicle keeps its wheel bottoms on the ground'
  + ' (the kit\'s suspension never finishes a frame below the surface). A bird, a plane or a projectile sets userData.ground'
  + ' = false. Take models, sounds and textures from the NavBharatAI library first. When the library has no match,'
  + ' call run_recipe({ name: "generate_stand_in" }): one model call designs a simple low-poly object and standOnGround places it.'
  + ' An uploaded .glb or .gltf is checked for type, size and triangles, then placed with standOnGround too.'
  + ' Do not set position.y to a constant on something that moves across the ground.';

const GROUND_FILE = /createTerrain\s*\(|markWorldCollider\s*\([^)]*['"]ground['"]/;
const USES_CONTACT = /standOnGround\s*\(|restOriginY\s*\(|clampOriginY\s*\(|groundScene\s*\(|driveVehicle\s*\(|settleOnGround\s*\(/;
/** The kit's own files implement the rule. A follow-up edit of one of them is not a missing call. */
const KIT_IMPL = /\/three\/(groundContact|surfaces|objects|world|physics|collision)\.ts$/;

/** The files of one build. A game with ground and no contact call is not acceptable. PURE. */
export function missingGroundContact(files: ReadonlyMap<string, string> | Readonly<Record<string, string>>): string {
  const entries = files instanceof Map ? [...files.entries()] : Object.entries(files);
  let makesGround = false;
  let usesContact = false;
  for (const [path, src] of entries) {
    const text = String(src || '');
    if (!text || text.length > 500_000) continue;
    if (KIT_IMPL.test(path)) {
      if (USES_CONTACT.test(text) || text.includes('export function restOriginY')) usesContact = true;
      continue;
    }
    if (GROUND_FILE.test(text)) makesGround = true;
    if (USES_CONTACT.test(text)) usesContact = true;
  }
  if (!makesGround || usesContact) return '';
  return '\n\n⛰️ GROUND CONTACT MISSING — this build is not acceptable yet. It creates ground and never places objects'
    + ' with standOnGround / restOriginY / clampOriginY / groundScene / driveVehicle (src/game/three/groundContact.ts).'
    + ' A character, vehicle or prop will sink into that ground. Add the call before finishing.';
}
