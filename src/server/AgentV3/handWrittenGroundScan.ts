// AgentV3 — A HAND-WRITTEN ROAD, RAIL OR DRIVEN Y THAT IGNORES THE HILLS IS READ BY ITS SHAPE (admin
// 2026-11-02, build be6aae96: "car aage chal kar zameen me dhasne lagti hai … sabhi racing game me").
//
// The kit now keeps every vehicle, road and rail ON the terrain (createTerrain + createRoad +
// createRailTrack + driveVehicle + groundHeightAt, one shared ground registry). A build that hand-writes
// its own flat road plane, pins a driven vehicle's y to a constant, or moves its own train without the
// kit's ground is back in the old bug — and only on HILLY terrain (a flat:true world is fine). This scan
// reads those shapes per written file, joins them across the build, and returns a note the builder reads
// with the file still open (the repair turn). It NEVER fails a build: a note, once per build. PURE.
import { RECIPE_LIBRARY_PATH } from './typeMembers';

export interface GroundShapeHalves {
  /** createTerrain(...) without flat: true, or terrain vertices displaced by noise. */
  hillyTerrain: boolean;
  /** Uses the kit's ground (groundHeightAt / createRailTrack / createRoad / driveVehicle). */
  kitGround: { road: boolean; rail: boolean; height: boolean };
  flatRoad: Array<{ line: string }>;
  pinnedVehicleY: Array<{ obj: string; line: string }>;
  movedVehicles: string[];
  ownTrain: Array<{ line: string }>;
  /** A FEATURE file of a kit game that lays a big flat plane of its own as land (failedbr #2495). */
  flatLand: Array<{ line: string }>;
}
export type GroundFindingKind = 'flat-road' | 'pinned-vehicle-y' | 'own-train' | 'own-land';
export interface GroundFinding { kind: GroundFindingKind; path: string; line: string }

const CODE_FILE = /\.(t|j)sx?$/i;
const MAX_FILE = 400_000;
const empty = (): GroundShapeHalves => ({ hillyTerrain: false, kitGround: { road: false, rail: false, height: false }, flatRoad: [], pinnedVehicleY: [], movedVehicles: [], ownTrain: [], flatLand: [] });

const ROAD_WORD = /(road|track|asphalt|lane|highway|street|rail)/i;
const VEHICLE = /\b((?:player)?(?:car|vehicle|kart|bike|truck|bus|racer|auto)\w{0,24})\.position\.y\s*=\s*(-?\d+(?:\.\d+)?|ROAD_SURFACE_Y)\s*;/gi;
const MOVED = /\b((?:player)?(?:car|vehicle|kart|bike|truck|bus|racer|auto)\w{0,24})\.position\.(?:x|z)\s*[+-]=/gi;
const TRAIN_MOVE = /\b(train\w{0,24})\.position\.(?:x|z)\s*[+-]?=\s*[^;\n]{0,80}/gi;
// 🌱 A FEATURE THAT LAYS ITS OWN LAND (failedbr #2495/#2501 autopsy: a 2 km PlaneGeometry at y = -0.1 in an open world's
// feature — the map's hills cut through it). Only a feature file (src/game/features/…), only a plane or disc laid FLAT in
// that file, and only MAP-SCALE: at least LAND_METRES across in BOTH directions. A pitch (105 x 68), a court, a pool, a
// parking lot, a road or race-track strip (8 x 800), a sign, a decal, a screen, a marker or a HUD quad is never flagged
// (re-review 2026-11-23: 100 m caught a football pitch).
const FEATURE_FILE = /(^|\/)src\/game\/features\/[^/]+\.(t|j)sx?$/i;
export const LAND_METRES = 300;
const LAID_FLAT = /(?:rotation\.x\s*=\s*-\s*Math\.PI\s*\/\s*2|rotateX\(\s*-\s*Math\.PI\s*\/\s*2\s*\)|rotation\.set\(\s*-\s*Math\.PI\s*\/\s*2\s*,)/;
const PLANE_ARGS = /new\s+(?:THREE\.)?(PlaneGeometry|CircleGeometry)\s*\(\s*([A-Za-z_$][\w$]*|\d+(?:\.\d+)?)(?:\s*,\s*([A-Za-z_$][\w$]*|\d+(?:\.\d+)?))?/g;
/** A number literal, or a `const|let|var NAME = <number>` in the same file; else NaN (unknown is never flagged). PURE. */
function metres(token: string | undefined, src: string): number {
  if (!token) return Number.NaN;
  if (/^\d/.test(token)) return Number(token);
  const m = src.match(new RegExp('\\b(?:const|let|var)\\s+' + token.replace(/\$/g, '\\$') + '\\s*(?::\\s*number\\s*)?=\\s*(\\d+(?:\\.\\d+)?)\\s*[;,\\n]'));
  return m ? Number(m[1]) : Number.NaN;
}

/** The halves one file contributes. PURE. */
export function groundShapeHalves(path: string, content: string): GroundShapeHalves {
  const h = empty();
  const p = String(path || '');
  const src = String(content || '');
  if (!src || src.length > MAX_FILE || !CODE_FILE.test(p) || /(^|\/)node_modules\//.test(p) || RECIPE_LIBRARY_PATH.test(p)) return h;
  for (const m of src.matchAll(/createTerrain\s*\(([^)]{0,200})\)/g)) if (!/flat\s*:\s*true/.test(m[1])) h.hillyTerrain = true;
  if (/\b(?:pos|position|positions)\w{0,10}\.setY\([^)]{0,80}(noise|perlin|simplex|sin\()/i.test(src)) h.hillyTerrain = true;
  h.kitGround = { road: /\bcreateRoad\s*\(|\bcreateTrackStream\s*\(/.test(src), rail: /\bcreateRailTrack\s*\(/.test(src), height: /\bgroundHeightAt\s*\(|userData\.heightAt|\bdriveVehicle\s*\(/.test(src) };
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (ln.length > 600) continue;
    // A road-named mesh made of a flat PlaneGeometry: `const road = new THREE.Mesh(new THREE.PlaneGeometry(…`.
    if (/new\s+(?:THREE\.)?PlaneGeometry\s*\(/.test(ln) && ROAD_WORD.test(ln.split('PlaneGeometry')[0])) h.flatRoad.push({ line: ln.trim().slice(0, 160) });
  }
  for (const m of src.matchAll(VEHICLE)) h.pinnedVehicleY.push({ obj: m[1], line: m[0].trim().slice(0, 160) });
  for (const m of src.matchAll(MOVED)) h.movedVehicles.push(m[1]);
  for (const m of src.matchAll(TRAIN_MOVE)) h.ownTrain.push({ line: m[0].trim().slice(0, 160) });
  if (FEATURE_FILE.test(p) && LAID_FLAT.test(src)) {
    for (const m of src.matchAll(PLANE_ARGS)) {
      // PlaneGeometry(width, height = 1); CircleGeometry(radius). The narrower side decides: a strip is not land.
      const a = metres(m[2], src), b = m[1] === 'PlaneGeometry' ? (m[3] === undefined ? 1 : metres(m[3], src)) : a;
      const across = m[1] === 'CircleGeometry' ? a * 2 : Math.min(a, b);
      if (Number.isFinite(across) && across >= LAND_METRES) h.flatLand.push({ line: m[0].trim().slice(0, 160) });
    }
  }
  return h;
}

/** Join the halves across the build. Nothing is said for a flat world. Roads, pinned vehicles and trains only — a
 *  feature's own land is ownLandFindings, with its own once-per-build note, so it never pre-empts this one. PURE. */
export function groundShapeFindings(index: ReadonlyMap<string, GroundShapeHalves>): GroundFinding[] {
  const all = [...index.entries()];
  const hilly = all.some(([, h]) => h.hillyTerrain);
  if (!hilly) return [];
  const usesRail = all.some(([, h]) => h.kitGround.rail);
  const usesHeight = all.some(([, h]) => h.kitGround.height);
  const moved = new Set(all.flatMap(([, h]) => h.movedVehicles));
  const out: GroundFinding[] = [];
  for (const [path, h] of all) {
    for (const r of h.flatRoad) out.push({ kind: 'flat-road', path, line: r.line });
    for (const v of h.pinnedVehicleY) if (moved.has(v.obj)) out.push({ kind: 'pinned-vehicle-y', path, line: v.line });
    if (!usesRail && !usesHeight) for (const t of h.ownTrain) out.push({ kind: 'own-train', path, line: t.line });
  }
  return out;
}

/**
 * A feature's own map-scale land — only in an OPEN WORLD (the project has src/game/world.ts: the kit draws the map, so a
 * feature's plane can only fight it). A features-only game (no world.ts) is never told. PURE.
 */
export function ownLandFindings(index: ReadonlyMap<string, GroundShapeHalves>, hasWorldFile: boolean): GroundFinding[] {
  if (!hasWorldFile) return [];
  return [...index.entries()].flatMap(([path, h]) => (h.flatLand || []).map((r) => ({ kind: 'own-land' as const, path, line: r.line })));
}

const WHAT: Readonly<Record<GroundFindingKind, string>> = {
  'flat-road': 'a flat road/track plane at one height over HILLY terrain — the grass rises over it and the car looks sunk. Use createRoad() (createRoad({ path, closed }) for a curve or circuit) or createTrackStream(plan) — they drape on the hills and cut the ground to the road',
  'pinned-vehicle-y': 'a driven vehicle pinned to a constant y on HILLY terrain — it drives into the first hill. Move it with driveVehicle(...) (it follows the ground, pitch and roll) or set y = groundHeightAt(x, z)',
  'own-train': 'a hand-moved train with no kit ground — it floats or sinks off the land. Lay the line with createRailTrack() and put the train at y = groundHeightAt(x, z) (that is the rail top)',
  'own-land': 'a feature lays a map-scale flat plane of its own as land — it sits at one height while the map\'s hills, sea and levelled places sit at theirs, so they cut through it. Stand things on the land with world.place(object, x, z), and make a different land a LAND region in src/game/world.ts. A sized ground object (a pitch, a court, a pool, a parking lot) is fine at its real size, placed with world.place',
};

/** The note the builder reads with the file still open — once per build. Never a build failure. PURE. */
export function handWrittenGroundNote(findings: readonly GroundFinding[]): string {
  if (!findings || findings.length === 0) return '';
  const lines = findings.slice(0, 4).map((f) => `- ${f.path}: \`${f.line}\` — ${WHAT[f.kind]}.`);
  return '\n\n⛰️ HAND-WRITTEN GROUND — this will sink into the hills (admin 2026-11-02, build be6aae96: '
    + '"car zameen me dhas jaati hai"):\n'
    + `${lines.join('\n')}\n`
    + 'The game kit keeps everything ON the land by construction: createTerrain, createRoad / createRailTrack / '
    + 'createTrackStream, driveVehicle and groundHeightAt(x, z) share one ground. Use them, or fix the lines above now, '
    + 'while the file is open.';
}

/** The own-land note — its own heading and its own once-per-build flag in the dispatcher. Never a build failure. PURE. */
export function ownLandNote(findings: readonly GroundFinding[]): string {
  const own = (findings || []).filter((f) => f.kind === 'own-land');
  if (own.length === 0) return '';
  const lines = own.slice(0, 4).map((f) => `- ${f.path}: \`${f.line}\` — ${WHAT[f.kind]}.`);
  return '\n\n🌱 A FEATURE LAYS ITS OWN LAND — the map will not join it (failedbr #2495):\n'
    + `${lines.join('\n')}\n`
    + 'This is a note, not an error: fix the lines above now, while the file is open, unless the user asked for exactly this.';
}
