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
}
export type GroundFindingKind = 'flat-road' | 'pinned-vehicle-y' | 'own-train';
export interface GroundFinding { kind: GroundFindingKind; path: string; line: string }

const CODE_FILE = /\.(t|j)sx?$/i;
const MAX_FILE = 400_000;
const empty = (): GroundShapeHalves => ({ hillyTerrain: false, kitGround: { road: false, rail: false, height: false }, flatRoad: [], pinnedVehicleY: [], movedVehicles: [], ownTrain: [] });

const ROAD_WORD = /(road|track|asphalt|lane|highway|street|rail)/i;
const VEHICLE = /\b((?:player)?(?:car|vehicle|kart|bike|truck|bus|racer|auto)\w{0,24})\.position\.y\s*=\s*(-?\d+(?:\.\d+)?|ROAD_SURFACE_Y)\s*;/gi;
const MOVED = /\b((?:player)?(?:car|vehicle|kart|bike|truck|bus|racer|auto)\w{0,24})\.position\.(?:x|z)\s*[+-]=/gi;
const TRAIN_MOVE = /\b(train\w{0,24})\.position\.(?:x|z)\s*[+-]?=\s*[^;\n]{0,80}/gi;

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
  return h;
}

/** Join the halves across the build. Nothing is said for a flat world. PURE. */
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

const WHAT: Readonly<Record<GroundFindingKind, string>> = {
  'flat-road': 'a flat road/track plane at one height over HILLY terrain — the grass rises over it and the car looks sunk. Use createRoad() (createRoad({ path, closed }) for a curve or circuit) or createTrackStream(plan) — they drape on the hills and cut the ground to the road',
  'pinned-vehicle-y': 'a driven vehicle pinned to a constant y on HILLY terrain — it drives into the first hill. Move it with driveVehicle(...) (it follows the ground, pitch and roll) or set y = groundHeightAt(x, z)',
  'own-train': 'a hand-moved train with no kit ground — it floats or sinks off the land. Lay the line with createRailTrack() and put the train at y = groundHeightAt(x, z) (that is the rail top)',
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
