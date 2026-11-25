/**
 * NavBharatAI's OWN Indian garments (admin 2026-11-25: "haan, Indian kapde banana shuru karo"). Kurta-pajama, pagdi,
 * dhoti and saree are MADE here, from geometry, on the library's CC0 villager bodies (batch 7: Quaternius Universal Base
 * Characters + Universal Animation Library) — no downloaded garment, so nothing of anyone else's to licence.
 *
 * How a garment is made, and why it moves with the body:
 *   1. The body. The batch-7 villager carries only the HEAD faces of the base body (the rest was under the old outfit). The
 *      base pack's full-body mesh has the SAME 7281/7376 vertices in the same order, so its face list is written back onto
 *      the villager's mesh: the whole body returns with no new vertex, rig or clip.
 *   2. The fit. Each garment is a set of rings fitted to the body: at a height (or along an arm), the body's cross-section
 *      is measured in 24 directions, smoothed, and pushed out by the garment's ease. Rings become tubes (torso, sleeves,
 *      legs, skirts, a turban's wraps); a saree's pallu is a ribbon laid over the body's surface.
 *   3. The motion. Every garment vertex takes its skin weights from the 8 nearest body vertices (inverse-distance blend,
 *      top 4 joints), so the kurta bends with the arm and the saree swings with the hips in all 16 clips.
 *   4. Changeable by name. Each garment is its own node and material (Kurta, Pajama, Pagdi, Dhoti, Blouse, Saree, Border,
 *      Pallu), so a game's assetCustomizations.ts can recolour or hide any one of them.
 * The old fantasy outfit (Arms, Body, Legs, and its knee-high Feet boots) is detached; feet are bare.
 *
 * Usage: node --import tsx scripts/library/buildIndianGarments.mts "<Universal Base Characters 'Godot - UE' folder>"
 * Writes assets/game-models/<sha256>.glb per variant and src/server/AgentV3/gameAssets/reviewedLibraryBatch16.ts.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { readGlb, writeGlb, readAccessor, appendAccessor, pruneGlb, sha256, type Glb } from './glbEdit.mts';
import { validateGlb } from '../../src/server/AgentV3/gameAssets/assetPolicy';
import { REVIEWED_LIBRARY_BATCH_7 } from '../../src/server/AgentV3/gameAssets/reviewedLibraryBatch7';
import type { ReviewedAsset } from '../../src/server/AgentV3/gameAssets/providers';

const N = 24; // directions per ring
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ── the body ──────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Body { pos: Float32Array; nrm: Float32Array; joints: Float32Array; weights: Float32Array; count: number; headJoint: number; joint: (name: string) => number; jointPos: (name: string) => THREE.Vector3 }

function restoreFullBody(g: Glb, baseDir: string, baseName: string): Body {
  const base = JSON.parse(readFileSync(join(baseDir, `${baseName}.gltf`), 'utf8'));
  const baseBin = readFileSync(join(baseDir, base.buffers[0].uri));
  const baseGlb: Glb = { json: base, bin: baseBin };
  const bodyMesh = base.meshes.find((m: any) => readAccessor(baseGlb, m.primitives[0].attributes.POSITION).count > 5000);
  const headNode = g.json.nodes.find((n: any) => n.name === 'Head' && n.mesh !== undefined);
  const prim = g.json.meshes[headNode.mesh].primitives[0];
  const pos = readAccessor(g, prim.attributes.POSITION);
  const basePos = readAccessor(baseGlb, bodyMesh.primitives[0].attributes.POSITION);
  assert.equal(basePos.count, pos.count, 'the base body and the villager head must share their vertices');
  for (let i = 0; i < pos.data.length; i += 301) assert.ok(Math.abs(pos.data[i] - basePos.data[i]) < 1e-6, 'vertex order differs');
  const indices = readAccessor(baseGlb, bodyMesh.primitives[0].indices).data;
  prim.indices = appendAccessor(g, pos.count > 65535 ? Uint32Array.from(indices) : Uint16Array.from(indices), 'SCALAR', 34963);
  const skin = g.json.skins[headNode.skin];
  const ibm = readAccessor(g, skin.inverseBindMatrices).data;
  const jointIndex = (name: string) => skin.joints.findIndex((j: number) => g.json.nodes[j].name === name);
  return {
    pos: pos.data, nrm: readAccessor(g, prim.attributes.NORMAL).data, joints: readAccessor(g, prim.attributes.JOINTS_0).data,
    weights: readAccessor(g, prim.attributes.WEIGHTS_0).data, count: pos.count, headJoint: jointIndex('Head'), joint: jointIndex,
    jointPos: (name) => { const j = jointIndex(name); assert.ok(j >= 0, name); return V(0, 0, 0).setFromMatrixPosition(new THREE.Matrix4().fromArray(Array.from(ibm.slice(j * 16, j * 16 + 16))).invert()); },
  };
}

// ── fitting ───────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Ring { center: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3; radii: number[]; lift?: number[] }

/** The body's cross-section in N directions around an axis through `center`, smoothed, plus `ease`. */
function fitRing(body: Body, center: THREE.Vector3, axis: THREE.Vector3, u: THREE.Vector3, band: number, keep: (p: THREE.Vector3) => boolean, ease: number, lift?: (k: number) => number, smoothing = 2): Ring {
  const v = new THREE.Vector3().crossVectors(axis, u).normalize();
  const radii = new Array<number>(N).fill(0);
  const p = V(0, 0, 0), q = V(0, 0, 0);
  for (let i = 0; i < body.count; i++) {
    p.fromArray(body.pos, i * 3);
    if (!keep(p)) continue;
    q.subVectors(p, center);
    const along = q.dot(axis);
    const a = Math.atan2(q.dot(v), q.dot(u));
    const k = ((Math.round((a / (2 * Math.PI)) * N) % N) + N) % N;
    if (Math.abs(along - (lift?.(k) ?? 0)) > band) continue;
    q.addScaledVector(axis, -along);
    radii[k] = Math.max(radii[k], q.length());
  }
  // Fill directions no vertex fell into, then widen each to its neighbours and smooth, so a ring is never notched.
  for (let pass = 0; pass < N && radii.some(r => r === 0); pass++) for (let k = 0; k < N; k++) if (radii[k] === 0) radii[k] = Math.max(radii[(k + N - 1) % N], radii[(k + 1) % N]) * 0.98;
  let r = radii.map((_, k) => Math.max(radii[(k + N - 1) % N], radii[k], radii[(k + 1) % N]));
  for (let s = 0; s < smoothing; s++) r = r.map((_, k) => (r[(k + N - 1) % N] + 2 * r[k] + r[(k + 1) % N]) / 4);
  return { center: center.clone(), u: u.clone(), v, radii: r.map(x => x + ease), lift: lift ? Array.from({ length: N }, (_, k) => lift(k)) : undefined };
}

/** In a ring around +Y with u = +X, v = Y × X = −Z: direction k points FRONT (+Z) where sin(θ) = −1, i.e. k = 3N/4. */
const FRONT = (3 * N) / 4;
const frontness = (k: number) => -Math.sin((k / N) * 2 * Math.PI); // 1 at the front, −1 at the back
const pointOf = (ring: Ring, k: number, axis: THREE.Vector3) => {
  const t = (k / N) * 2 * Math.PI;
  return ring.center.clone().addScaledVector(ring.u, Math.cos(t) * ring.radii[k]).addScaledVector(ring.v, Math.sin(t) * ring.radii[k]).addScaledVector(axis, ring.lift?.[k] ?? 0);
};

interface Part { pos: number[]; idx: number[]; uv: number[] }
/** Rings → a closed tube (open at both ends). */
function tube(rings: Ring[], axis: THREE.Vector3): Part {
  const pos: number[] = [], idx: number[] = [], uv: number[] = [];
  rings.forEach((ring, j) => { for (let k = 0; k <= N; k++) { pos.push(...pointOf(ring, k % N, axis).toArray()); uv.push(k / N, j / Math.max(1, rings.length - 1)); } });
  for (let j = 0; j + 1 < rings.length; j++) for (let k = 0; k < N; k++) {
    const a = j * (N + 1) + k, b = a + 1, c = a + N + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  return { pos, idx, uv };
}
const merge = (...parts: Part[]): Part => {
  const out: Part = { pos: [], idx: [], uv: [] };
  for (const p of parts) { const base = out.pos.length / 3; out.pos.push(...p.pos); out.uv.push(...p.uv); out.idx.push(...p.idx.map(i => i + base)); }
  return out;
};
/** Never narrower than the ring above: a skirt or kurta hem hangs, it does not cling between the legs. */
function hang(rings: Ring[], flarePerRing: number): Ring[] {
  for (let j = 1; j < rings.length; j++) rings[j].radii = rings[j].radii.map((r, k) => Math.max(r, rings[j - 1].radii[k] + flarePerRing));
  return rings;
}
const range = (from: number, to: number, step: number) => { const out: number[] = []; const n = Math.round(Math.abs(to - from) / step); for (let i = 0; i <= n; i++) out.push(from + (to - from) * (i / n)); return out; };
const Y = V(0, 1, 0), X = V(1, 0, 0), Z = V(0, 0, 1);

/** Torso rings from y0 down to y1. */
function torso(body: Body, y0: number, y1: number, halfWidth: (y: number) => number, ease: number, smoothing = 2): Ring[] {
  let lastZ = 0;
  return range(y0, y1, 0.025).map(y => {
    let zMin = Infinity, zMax = -Infinity; const p = V(0, 0, 0);
    for (let i = 0; i < body.count; i++) { p.fromArray(body.pos, i * 3); if (Math.abs(p.y - y) < 0.02 && Math.abs(p.x) < halfWidth(y)) { zMin = Math.min(zMin, p.z); zMax = Math.max(zMax, p.z); } }
    lastZ = Number.isFinite(zMin) ? (zMin + zMax) / 2 : lastZ;
    return fitRing(body, V(0, y, lastZ), Y, X, 0.02, (q) => Math.abs(q.x) < halfWidth(y), ease, undefined, smoothing);
  });
}
/** Sleeve rings along one arm (T-pose), from the shoulder out to `reach` of the way to the wrist. */
function sleeve(body: Body, side: 1 | -1, x0: number, x1: number, armY: number, armZ: number, ease: number): Ring[] {
  const axis = V(side, 0, 0);
  return range(x0, x1, 0.03).map(x => fitRing(body, V(side * x, armY, armZ), axis, Y, 0.02, (p) => p.x * side > 0.08 && p.y > armY - 0.16, ease));
}
/** Leg rings for one leg from y0 down to y1. */
function leg(body: Body, side: 1 | -1, legX: number, y0: number, y1: number, ease: (y: number) => number): Ring[] {
  let lastZ = 0;
  return range(y0, y1, 0.04).map(y => {
    let zMin = Infinity, zMax = -Infinity; const p = V(0, 0, 0);
    for (let i = 0; i < body.count; i++) { p.fromArray(body.pos, i * 3); if (Math.abs(p.y - y) < 0.02 && p.x * side > -0.005 && Math.abs(p.x) < 0.3) { zMin = Math.min(zMin, p.z); zMax = Math.max(zMax, p.z); } }
    lastZ = Number.isFinite(zMin) ? (zMin + zMax) / 2 : lastZ;
    return fitRing(body, V(side * legX, y, lastZ), Y, X, 0.02, (q) => q.x * side > -0.005 && Math.abs(q.x) < 0.3, ease(y));
  });
}

/** A turban: tilted wraps from the forehead up, folds that run across them, and a closed crown. */
function pagdi(body: Body, foreheadY: number): Part {
  const p = V(0, 0, 0); let cx = 0, cz = 0, n = 0;
  for (let i = 0; i < body.count; i++) { p.fromArray(body.pos, i * 3); if (p.y > foreheadY && p.y < foreheadY + 0.08) { cx += p.x; cz += p.z; n++; } }
  const center = V(cx / n, 0, cz / n);
  const tilt = (k: number) => -0.05 * (1 - frontness(k)); // the front sits at the brow, the back drops to the nape
  const rings: Ring[] = [];
  const ys = range(foreheadY, foreheadY + 0.12, 0.012);
  ys.forEach((y, j) => {
    const r = fitRing(body, V(center.x, y, center.z), Y, X, 0.012, () => true, 0.022 + 0.014 * (j / ys.length), tilt);
    r.radii = r.radii.map((x, k) => x * (1 + 0.03 * Math.sin((2 * Math.PI * k) / N * 2 + j * 0.9))); // the wraps' folds
    if (j > 0) r.radii = r.radii.map((x, k) => Math.max(x, rings[j - 1].radii[k] * 0.97));
    rings.push(r);
  });
  const top = rings[rings.length - 1];
  for (const s of [0.86, 0.62, 0.3, 0.01]) rings.push({ ...top, center: top.center.clone().addScaledVector(Y, 0.016 * (1 - s) + 0.006), radii: top.radii.map(x => x * s) });
  return tube(rings, Y);
}

/** A strip laid over the body's surface along `path` (a saree's pallu), split into border | middle | border. */
function ribbon(body: Body, path: THREE.Vector3[], width: number, border: number, lift: number): { middle: Part; edges: Part } {
  const curve = new THREE.CatmullRomCurve3(path);
  const raw = curve.getSpacedPoints(48).map(pt => {
    let best = 0, bestD = Infinity; const p = V(0, 0, 0);
    for (let i = 0; i < body.count; i++) { p.fromArray(body.pos, i * 3); const d = p.distanceToSquared(pt); if (d < bestD) { bestD = d; best = i; } }
    const s = V(0, 0, 0).fromArray(body.pos, best * 3), nrm = V(0, 0, 0).fromArray(body.nrm, best * 3).normalize();
    // Where the path leaves the body (a hanging end), keep the path's own point; never inside the body.
    return { at: Math.sqrt(bestD) > 0.06 ? pt.clone() : s.addScaledVector(nrm, lift), nrm };
  });
  const smooth = raw.map((_, i) => { const a = raw[Math.max(0, i - 1)], b = raw[i], c = raw[Math.min(raw.length - 1, i + 1)]; return { at: a.at.clone().add(b.at).add(c.at).divideScalar(3), nrm: a.nrm.clone().add(b.nrm).add(c.nrm).normalize() }; });
  const cols = [-width / 2, -width / 2 + border, width / 2 - border, width / 2];
  const pos: number[] = [], uv: number[] = [];
  smooth.forEach((s, i) => {
    const tangent = smooth[Math.min(smooth.length - 1, i + 1)].at.clone().sub(smooth[Math.max(0, i - 1)].at).normalize();
    const side = new THREE.Vector3().crossVectors(tangent, s.nrm).normalize();
    cols.forEach((c, j) => { pos.push(...s.at.clone().addScaledVector(side, c).addScaledVector(s.nrm, 0.012 * (c / width) ** 2).toArray()); uv.push(j / 3, i / (smooth.length - 1)); });
  });
  const quads = (col: number) => { const idx: number[] = []; for (let i = 0; i + 1 < smooth.length; i++) { const a = i * 4 + col, b = a + 1, c = a + 4, d = c + 1; idx.push(a, c, b, b, c, d); } return idx; };
  return { middle: { pos, uv, idx: quads(1) }, edges: { pos, uv, idx: [...quads(0), ...quads(2)] } };
}

// ── weights, materials, nodes ─────────────────────────────────────────────────────────────────────────────────────────
/**
 * hem: a skirt, a kurta's skirt or a dhoti's wrap is weighted the way games weight a skirt without cloth simulation — to the
 * pelvis and to the thigh on its own side (a point at the front or back shares both thighs), blended into the body's own
 * weights near the waist. Taking the nearest body vertex dragged the hem with whichever leg was closest (the saree bulged
 * on every step); averaging both legs pulled the sides inside the thighs in the standing pose (the leg showed through).
 */
function transferWeights(body: Body, pos: number[], onlyHead = false, K = 8, hem = false): { joints: Uint8Array; weights: Float32Array } {
  const pelvis = body.joint('pelvis'), thighL = body.joint('thigh_l'), thighR = body.joint('thigh_r'), hipY = body.jointPos('thigh_l').y;
  const n = pos.length / 3; const joints = new Uint8Array(n * 4); const weights = new Float32Array(n * 4); const p = V(0, 0, 0), b = V(0, 0, 0);
  for (let v = 0; v < n; v++) {
    if (onlyHead) { joints[v * 4] = body.headJoint; weights[v * 4] = 1; continue; }
    const acc = new Map<number, number>();
    p.fromArray(pos, v * 3);
    const toHem = hem ? THREE.MathUtils.clamp((hipY + 0.04 - p.y) / 0.12, 0, 1) : 0; // 0 at the waist, 1 below the hips
    if (toHem > 0) {
      const left = THREE.MathUtils.smoothstep(p.x, -0.1, 0.1);
      acc.set(pelvis, 0.35 * toHem); acc.set(thighL, 0.65 * toHem * left); acc.set(thighR, 0.65 * toHem * (1 - left));
    }
    {
      const near: { i: number; d: number }[] = [];
      for (let i = 0; i < body.count; i++) {
        b.fromArray(body.pos, i * 3); const d = b.distanceToSquared(p);
        if (near.length < K || d < near[near.length - 1].d) { near.push({ i, d }); near.sort((x, y) => x.d - y.d); if (near.length > K) near.pop(); }
      }
      const total = near.reduce((s, { d }) => s + 1 / (d + 1e-5), 0);
      for (const { i, d } of near) { const w = (1 - toHem) / (d + 1e-5) / total; for (let c = 0; c < 4; c++) { const wt = body.weights[i * 4 + c]; if (wt > 0) acc.set(body.joints[i * 4 + c], (acc.get(body.joints[i * 4 + c]) ?? 0) + wt * w); } }
    }
    const top = [...acc].filter(([, w]) => w > 1e-6).sort((x, y) => y[1] - x[1]).slice(0, 4); const sum = top.reduce((s, [, w]) => s + w, 0);
    top.forEach(([j, w], c) => { joints[v * 4 + c] = j; weights[v * 4 + c] = w / sum; });
  }
  return { joints, weights };
}
const linear = (hex: string) => [1, 3, 5].map(i => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
function material(g: Glb, name: string, hex: string, roughness = 0.88): number {
  g.json.materials.push({ name, pbrMetallicRoughness: { baseColorFactor: [...linear(hex), 1], metallicFactor: 0, roughnessFactor: roughness }, doubleSided: true });
  return g.json.materials.length - 1;
}
function addGarment(g: Glb, body: Body, name: string, prims: Array<{ part: Part; material: number; k?: number; hem?: boolean }>, onlyHead = false): void {
  const head = g.json.nodes.findIndex((n: any) => n.name === 'Head' && n.mesh !== undefined);
  const parent = g.json.nodes.findIndex((n: any) => (n.children ?? []).includes(head));
  const primitives = prims.map(({ part, material: m, k, hem }) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(part.pos, 3)); geo.setIndex(part.idx); geo.computeVertexNormals();
    const { joints, weights } = transferWeights(body, part.pos, onlyHead, k, hem);
    return {
      attributes: {
        POSITION: appendAccessor(g, new Float32Array(part.pos), 'VEC3', 34962),
        NORMAL: appendAccessor(g, new Float32Array(geo.getAttribute('normal').array), 'VEC3', 34962),
        TEXCOORD_0: appendAccessor(g, new Float32Array(part.uv), 'VEC2', 34962),
        JOINTS_0: appendAccessor(g, joints, 'VEC4', 34962),
        WEIGHTS_0: appendAccessor(g, weights, 'VEC4', 34962),
      },
      indices: appendAccessor(g, part.pos.length / 3 > 65535 ? new Uint32Array(part.idx) : new Uint16Array(part.idx), 'SCALAR', 34963),
      material: m,
    };
  });
  g.json.meshes.push({ name, primitives });
  g.json.nodes.push({ name, mesh: g.json.meshes.length - 1, skin: g.json.nodes[head].skin });
  g.json.nodes[parent].children.push(g.json.nodes.length - 1);
}
/** The old fantasy outfit leaves the scene (its node stays, empty, so no index shifts); Feet stay as shoes. */
function detach(g: Glb, names: string[]): void {
  for (const n of g.json.nodes) if (names.includes(n.name) && n.mesh !== undefined) { delete n.mesh; delete n.skin; }
}
// ── the garments ──────────────────────────────────────────────────────────────────────────────────────────────────────
const baseDir = process.argv[2]; assert.ok(baseDir, 'Supply the Universal Base Characters "Godot - UE" folder');
const villager = (id: string) => REVIEWED_LIBRARY_BATCH_7.find(a => a.id === id)!;

interface Variant { id: string; from: string; base: string; subjects: string[]; describe: string; dress(g: Glb, b: Body): void }
const MAN_ARM = (b: Body) => ({ y: b.jointPos('upperarm_l').y, z: b.jointPos('upperarm_l').z, wrist: b.jointPos('hand_l').x - 0.04 });

function kurta(g: Glb, b: Body, hem: number, sleeveReach: number, colour: string): void {
  const a = MAN_ARM(b);
  // A band collar closes the shoulders: two narrow rings round the neck above the torso's widest ring.
  const collar = torso(b, 1.585, 1.56, () => 0.075, 0.012);
  const body = [...collar, ...torso(b, 1.53, 1.0, y => (y > 1.3 ? 0.2 : 0.3), 0.032, 6)];
  // The skirt starts ABOVE the torso's last ring and overlaps it: the two are weighted differently (body vs hem), so a
  // butt joint opened a gap at the waist in some poses and the body showed through.
  const skirt = hang(torso(b, 1.08, hem, () => 0.32, 0.046, 4), 0.0025);
  const reach = 0.17 + (a.wrist - 0.17) * sleeveReach;
  const m = material(g, 'Kurta', colour);
  addGarment(g, b, 'Kurta', [
    { part: merge(tube(body, Y), tube(sleeve(b, 1, 0.15, reach, a.y, a.z, 0.028), X), tube(sleeve(b, -1, 0.15, reach, a.y, a.z, 0.028), V(-1, 0, 0))), material: m, k: 16 },
    { part: tube(skirt, Y), material: m, k: 16, hem: true },
  ]);
}
function pajama(g: Glb, b: Body, colour: string, underKurtaTo = 0.56): void {
  const x = b.jointPos('thigh_l').x;
  const m = material(g, 'Pajama', colour);
  const ease = (y: number) => (y > underKurtaTo + 0.04 ? 0.016 : y < 0.3 ? 0.012 : 0.026); // slim under the kurta, so it never shows through
  addGarment(g, b, 'Pajama', [{ part: merge(tube(leg(b, 1, x, 1.02, 0.1, ease), Y), tube(leg(b, -1, x, 1.02, 0.1, ease), Y)), material: m }]);
}
function turban(g: Glb, b: Body, colour: string): void {
  const brow = b.jointPos('Head').y + 0.165;
  addGarment(g, b, 'Pagdi', [{ part: pagdi(b, brow), material: material(g, 'Pagdi', colour, 0.8) }], true);
  detach(g, ['Hair']);
}
function dhoti(g: Glb, b: Body, colour: string): void {
  const x = b.jointPos('thigh_l').x;
  const wrap = hang(torso(b, 1.04, 0.6, () => 0.32, 0.016, 4), 0.004); // starts under the kurta's ease, flares out below its hem
  const legs = (side: 1 | -1) => tube(leg(b, side, x, 0.66, 0.3, y => 0.03 + (y - 0.3) * 0.05), Y);
  const front = wrap.map(r => pointOf(r, FRONT, Y)); // the wrap's front line
  const pleat: Part = { pos: [], idx: [], uv: [] };
  range(0.98, 0.42, 0.04).forEach((y, i) => {
    const onWrap = front.find(p => Math.abs(p.y - y) < 0.021); const z = (onWrap?.z ?? front[front.length - 1].z) + 0.008;
    for (const dx of [-0.05, 0.05]) { pleat.pos.push(dx, y, z); pleat.uv.push(dx > 0 ? 1 : 0, i / 14); }
    if (i > 0) { const a = (i - 1) * 2; pleat.idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  });
  const dhotiM = material(g, 'Dhoti', colour);
  addGarment(g, b, 'Dhoti', [{ part: merge(tube(wrap, Y), pleat), material: dhotiM, k: 16, hem: true }, { part: merge(legs(1), legs(-1)), material: dhotiM, k: 16 }]);
}
function saree(g: Glb, b: Body, sareeColour: string, borderColour: string, blouseColour: string): void {
  const arm = { y: b.jointPos('upperarm_l').y, z: b.jointPos('upperarm_l').z };
  const blouse = torso(b, 1.48, 1.25, () => 0.17, 0.012);
  addGarment(g, b, 'Blouse', [{ part: merge(tube(blouse, Y), tube(sleeve(b, 1, 0.11, 0.27, arm.y, arm.z, 0.014), X), tube(sleeve(b, -1, 0.11, 0.27, arm.y, arm.z, 0.014), V(-1, 0, 0))), material: material(g, 'Blouse', blouseColour, 0.6) }]);
  const skirt = hang(torso(b, 1.07, 0.035, () => 0.32, 0.034, 4), 0.0018);
  // Fan pleats down the front, where a saree's pleats are tucked.
  for (const r of skirt) if (r.center.y < 0.92) r.radii = r.radii.map((x, k) => { const t = (k / N) * 2 * Math.PI; return frontness(k) > 0.55 ? x + 0.012 * Math.abs(Math.sin(t * 6)) * (0.92 - r.center.y) * 1.6 : x; });
  const sareeM = material(g, 'Saree', sareeColour, 0.55), borderM = material(g, 'Border', borderColour, 0.4);
  const hem = skirt.filter(r => r.center.y < 0.13).map(r => ({ ...r, radii: r.radii.map(x => x + 0.003) }));
  addGarment(g, b, 'Saree', [{ part: tube(skirt, Y), material: sareeM, k: 16, hem: true }, { part: tube(hem, Y), material: borderM, k: 16, hem: true }]);
  // The pallu: from the right hip, up across the chest, over the LEFT shoulder (+x is the character's left), down the back.
  const sh = b.jointPos('upperarm_l');
  const path = [V(-0.11, 1.05, 0.3), V(-0.03, 1.18, 0.3), V(0.05, 1.3, 0.3), V(0.11, 1.42, 0.3), V(sh.x - 0.02, sh.y + 0.12, sh.z), V(0.11, 1.42, -0.3), V(0.1, 1.2, -0.3), V(0.09, 0.95, -0.3), V(0.08, 0.72, -0.25)];
  const { middle, edges } = ribbon(b, path, 0.26, 0.035, 0.022);
  addGarment(g, b, 'Pallu', [{ part: middle, material: material(g, 'Pallu', sareeColour, 0.55) }, { part: edges, material: borderM }]);
}

const VARIANTS: Variant[] = [
  { id: 'q16-man-kurta-pajama', from: 'q7-villager-man', base: 'Superhero_Male_FullBody', subjects: ['man in kurta pajama', 'kurta pajama'], describe: 'cream knee-length kurta with full sleeves, white pajama',
    dress: (g, b) => { kurta(g, b, 0.56, 1, '#f2ead3'); pajama(g, b, '#fafafa'); } },
  { id: 'q16-man-pagdi', from: 'q7-villager-man', base: 'Superhero_Male_FullBody', subjects: ['man in pagdi', 'man in turban'], describe: 'white kurta-pajama and a saffron pagdi',
    dress: (g, b) => { kurta(g, b, 0.56, 1, '#fbfaf5'); pajama(g, b, '#fafafa'); turban(g, b, '#e0761f'); } },
  { id: 'q16-man-dhoti', from: 'q7-villager-man', base: 'Superhero_Male_FullBody', subjects: ['man in dhoti', 'dhoti kurta'], describe: 'hip-length khadi kurta with elbow sleeves, white dhoti, white pagdi',
    dress: (g, b) => { kurta(g, b, 0.86, 0.55, '#e9dcc0'); dhoti(g, b, '#f7f4ec'); turban(g, b, '#f4f1e8'); } },
  { id: 'q16-woman-saree', from: 'q7-villager-woman', base: 'Superhero_Female_FullBody', subjects: ['woman in saree', 'woman in sari'], describe: 'maroon saree with a gold border and pallu, green blouse',
    dress: (g, b) => { saree(g, b, '#8f1430', '#d4a72c', '#1d6b3c'); } },
];

const entries: ReviewedAsset[] = [];
for (const variant of VARIANTS) {
  const src = villager(variant.from);
  const g = readGlb(readFileSync(`assets/game-models/${src.sha256}.glb`));
  const body = restoreFullBody(g, baseDir, variant.base);
  detach(g, ['Arms', 'Body', 'Legs', 'Feet']); // the fantasy boots came to the knee and showed through; feet are bare
  variant.dress(g, body);
  pruneGlb(g); // the detached outfit and the old head-only face list leave the file, not only the scene
  const bytes = writeGlb(g);
  const stats = validateGlb(bytes);
  const sha = sha256(bytes);
  writeFileSync(`assets/game-models/${sha}.glb`, bytes);
  console.log(variant.id, bytes.length, 'bytes', stats.triangles, 'triangles', stats.animations.length, 'clips');
  entries.push({
    ...src, id: variant.id, sha256: sha, bytes: bytes.length, subjects: variant.subjects,
    license: { ...src.license, reviewedAt: '2026-11-25', attribution: `${variant.id}: garments (${variant.describe}) MADE by NavBharatAI from geometry in scripts/library/buildIndianGarments.mts — no downloaded garment; fitted to and skinned on ${src.id} (${src.license.attribution.slice(src.license.attribution.indexOf(':') + 2)}); the base body's full face list restored from Universal Base Characters (${variant.base}). CC0 1.0 Universal.` },
  });
}
const header = `import type { ReviewedAsset } from './providers';\n/** Library batch 16 (2026-11-25): NavBharatAI's own Indian garments — kurta-pajama, pagdi, dhoti, saree — made in scripts/library/buildIndianGarments.mts on the batch-7 CC0 villager bodies. Generated; do not hand-edit. */\nexport const REVIEWED_LIBRARY_BATCH_16: readonly ReviewedAsset[] = `;
writeFileSync('src/server/AgentV3/gameAssets/reviewedLibraryBatch16.ts', header + JSON.stringify(entries, null, 2) + ';\n');
