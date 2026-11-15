// OBJECT FORGE — the emitted source of src/game/forge/forge.ts: build ANY object from a declarative spec.
//
// 100% ours. The point: NavBharatAI is not limited to the objects somebody pre-built. The builder describes an object — a dragon, a
// teapot, a lighthouse, a person — as a small JSON tree (primitives, transforms, materials, symmetry, pivots, animation clips), and
// this engine turns it into real triangles. The spec is DATA, so it can be validated, measured and drawn BEFORE it reaches the game
// (forgeCheck.ts); and the same engine runs in the game, so what was measured is what is shown.
//
// Techniques (public ideas, own code): primitive meshes with computed smooth or flat normals (UV sphere, tapered cylinder, lathe,
// capsule, torus, superellipse loft, ear-clipped extrusion, parallel-transport tube); affine transform trees (rotation matrices from
// Euler angles, reflection by a negative scale); mirror and repeat expansion; sinusoidal animation tracks on named pivots.
//
// Conventions: metres, +Y up, the object FACES +Z, its feet (or base) sit on y = 0, centred on x = 0 and z = 0.
//
// PURE source string; the generator writes it. Rule for editing: no backticks and no dollar-brace inside the string below.
export const FORGE_ENGINE = `// Object Forge — builds any object from a declarative spec: primitives, transform tree, mirror/repeat, materials, animation clips.
// Technique: procedural primitive meshes with computed normals, affine transform trees, reflection by negative scale, sinusoidal tracks. Own implementation.
// Conventions: metres, +Y up, the object faces +Z, its base sits on y = 0.

export type Vec3 = [number, number, number];
export type Axis = 'x' | 'y' | 'z';

// three.js is passed in by the caller (import * as THREE from 'three'); it is typed loosely here on purpose.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ThreeLike = any;

export interface ForgeMaterial {
  /** '#rrggbb' */
  color: string;
  roughness?: number;
  metalness?: number;
  emissive?: string;
  opacity?: number;
}

export interface ForgeSection {
  /** Position along the length, 0 (back) to 1 (front); sections must be in increasing order. */
  t: number;
  halfWidth: number;
  top: number;
  bottom: number;
  /** Squareness of the section: 2 is an ellipse, higher is boxier. Default 2. */
  power?: number;
}

export type ForgeShape =
  | { type: 'box'; size: Vec3 }
  | { type: 'sphere'; radius: number | Vec3; seg?: number }
  | { type: 'cylinder'; radiusTop: number; radiusBottom: number; height: number; seg?: number; capTop?: boolean; capBottom?: boolean }
  | { type: 'capsule'; radius: number; length: number; seg?: number }
  | { type: 'torus'; radius: number; tube: number; seg?: number; tubeSeg?: number }
  | { type: 'lathe'; profile: Array<[number, number]>; seg?: number; capEnds?: boolean }
  | { type: 'loft'; length: number; sections: ForgeSection[]; stations?: number; ring?: number }
  | { type: 'extrude'; polygon: Array<[number, number]>; depth: number }
  | { type: 'tube'; path: Vec3[]; radius: number | number[]; seg?: number }
  | { type: 'plane'; size: [number, number]; segments?: number };

export interface ForgeTrack {
  property: 'rotation' | 'position' | 'scale';
  axis: Axis;
  /** Degrees for rotation, metres for position, a fraction for scale. Not used by a spin. */
  amplitude?: number;
  /** Cycles per second (a spin may be negative: the other way round). */
  speed: number;
  /** A rotation that turns for ever at speed turns per second (a wheel, a propeller, a fan) instead of swinging to and fro. */
  spin?: boolean;
  /** In cycles (0.5 is half a cycle). */
  phase?: number;
  offset?: number;
}

export interface ForgeRepeat {
  count: number;
  step?: Vec3;
  around?: { axis: Axis; degrees?: number };
}

export interface ForgeNode {
  name: string;
  shape?: ForgeShape;
  material?: string;
  position?: Vec3;
  /** Degrees, applied in X, Y, Z order. */
  rotation?: Vec3;
  scale?: Vec3;
  /** Adds a reflected copy of this node and everything under it. */
  mirror?: Axis;
  /** How far (in cycles) the mirrored copy is shifted in its clips: 0.5 makes the left leg swing opposite to the right. */
  mirrorPhase?: number;
  repeat?: ForgeRepeat;
  /** Named animation clips: each is a list of tracks. */
  clips?: Record<string, ForgeTrack[]>;
  children?: ForgeNode[];
}

export interface ObjectSpec {
  id: string;
  name: string;
  materials: Record<string, ForgeMaterial>;
  nodes: ForgeNode[];
}

export interface MeshArrays {
  position: Float32Array;
  normal: Float32Array;
  index: Uint32Array;
  triangles: number;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Mesh builder

class Part {
  pos: number[] = [];
  idx: number[] = [];
  vert(x: number, y: number, z: number): number {
    this.pos.push(x, y, z);
    return this.pos.length / 3 - 1;
  }
  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }
  /** A flat polygon fan with its own vertices (a hard edge), wound so its normal faces along outward. */
  fan(points: Vec3[], centre: Vec3, outward: Vec3): void {
    const c = this.vert(centre[0], centre[1], centre[2]);
    const ids = points.map((q) => this.vert(q[0], q[1], q[2]));
    for (let k = 0; k < ids.length; k++) {
      const a = ids[k]; const b = ids[(k + 1) % ids.length];
      this.triOut(c, a, b, outward);
    }
  }
  /** A triangle wound so its normal faces along outward (used where the outward direction is known). */
  triOut(a: number, b: number, c: number, outward: Vec3): void {
    const p = this.pos;
    const ux = p[b * 3] - p[a * 3]; const uy = p[b * 3 + 1] - p[a * 3 + 1]; const uz = p[b * 3 + 2] - p[a * 3 + 2];
    const vx = p[c * 3] - p[a * 3]; const vy = p[c * 3 + 1] - p[a * 3 + 1]; const vz = p[c * 3 + 2] - p[a * 3 + 2];
    const d = (uy * vz - uz * vy) * outward[0] + (uz * vx - ux * vz) * outward[1] + (ux * vy - uy * vx) * outward[2];
    if (d >= 0) this.tri(a, b, c); else this.tri(a, c, b);
  }
  /** Signed volume of the closed surface: positive when the triangles wind outward. */
  volume(): number {
    let v = 0;
    const p = this.pos;
    for (let i = 0; i < this.idx.length; i += 3) {
      const a = this.idx[i] * 3; const b = this.idx[i + 1] * 3; const c = this.idx[i + 2] * 3;
      v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
    }
    return v / 6;
  }
  flip(): void {
    for (let i = 0; i < this.idx.length; i += 3) { const t = this.idx[i + 1]; this.idx[i + 1] = this.idx[i + 2]; this.idx[i + 2] = t; }
  }
  /** Smooth normals: each vertex gets the sum of the area-weighted normals of the triangles that share it. */
  finish(): MeshArrays {
    return meshArrays(this.pos, this.idx);
  }
}

export function meshArrays(pos: number[], idx: number[]): MeshArrays {
  const n = new Float32Array(pos.length);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3; const b = idx[i + 1] * 3; const c = idx[i + 2] * 3;
    const ux = pos[b] - pos[a]; const uy = pos[b + 1] - pos[a + 1]; const uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a]; const vy = pos[c + 1] - pos[a + 1]; const vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy; const ny = uz * vx - ux * vz; const nz = ux * vy - uy * vx;
    for (const o of [a, b, c]) { n[o] += nx; n[o + 1] += ny; n[o + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]);
    // A vertex no triangle uses has no normal: point it up rather than leave a zero vector in the array.
    if (l < 1e-12) { n[i + 1] = 1; continue; }
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return { position: Float32Array.from(pos), normal: n, index: Uint32Array.from(idx), triangles: idx.length / 3 };
}

/** Smooth curve through (t, v) control points (cubic Hermite with finite-difference slopes). */
function curve(ts: number[], vs: number[], t: number): number {
  const n = ts.length;
  if (n === 1 || t <= ts[0]) return vs[0];
  if (t >= ts[n - 1]) return vs[n - 1];
  let i = 0;
  while (i < n - 2 && t > ts[i + 1]) i++;
  const h = ts[i + 1] - ts[i];
  const s = (t - ts[i]) / h;
  const m0 = i === 0 ? (vs[1] - vs[0]) / h : (vs[i + 1] - vs[i - 1]) / (ts[i + 1] - ts[i - 1]);
  const m1 = i + 1 === n - 1 ? (vs[n - 1] - vs[n - 2]) / h : (vs[i + 2] - vs[i]) / (ts[i + 2] - ts[i]);
  const s2 = s * s; const s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * vs[i] + (s3 - 2 * s2 + s) * h * m0 + (-2 * s3 + 3 * s2) * vs[i + 1] + (s3 - s2) * h * m1;
}

const spow = (v: number, e: number): number => Math.sign(v) * Math.pow(Math.abs(v), e);
const TINY = 1e-6;
const clampSeg = (v: number | undefined, def: number): number => Math.max(3, Math.min(64, Math.round(v ?? def)));

/** Join consecutive rows of vertices into triangles. A row of one vertex is a pole (a fan); wrapRows closes the last row to the first. */
function joinRows(p: Part, rows: number[][], wrapRows: boolean): void {
  const last = wrapRows ? rows.length : rows.length - 1;
  for (let i = 0; i < last; i++) {
    const a = rows[i]; const b = rows[(i + 1) % rows.length];
    if (a.length === 1 && b.length === 1) continue;
    if (a.length === 1) { for (let k = 0; k < b.length; k++) p.tri(a[0], b[k], b[(k + 1) % b.length]); continue; }
    if (b.length === 1) { for (let k = 0; k < a.length; k++) p.tri(a[k], b[0], a[(k + 1) % a.length]); continue; }
    const n = a.length;
    for (let k = 0; k < n; k++) {
      const q = (k + 1) % n;
      p.tri(a[k], b[k], a[q]); p.tri(a[q], b[k], b[q]);
    }
  }
}

function ringPoints(cx: number, cy: number, cz: number, rx: number, rz: number, seg: number): Vec3[] {
  const out: Vec3[] = [];
  for (let k = 0; k < seg; k++) { const a = (k / seg) * Math.PI * 2; out.push([cx + Math.cos(a) * rx, cy, cz + Math.sin(a) * rz]); }
  return out;
}

function ringRow(p: Part, pts: Vec3[]): number[] {
  return pts.map((q) => p.vert(q[0], q[1], q[2]));
}

/** Make the surface face outward: closed shapes by their signed volume, open ones by the test the caller supplies. */
function orient(p: Part, closed: boolean, openFacesOutward?: () => number): void {
  const s = closed ? p.volume() : openFacesOutward ? openFacesOutward() : 1;
  if (s < 0) p.flip();
}

function buildBox(p: Part, s: Vec3): void {
  const hx = s[0] / 2; const hy = s[1] / 2; const hz = s[2] / 2;
  const faces: Array<[Vec3, Vec3, Vec3, Vec3, Vec3]> = [
    [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz], [1, 0, 0]],
    [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-1, 0, 0]],
    [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [0, 1, 0]],
    [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz], [0, -1, 0]],
    [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz], [0, 0, 1]],
    [[-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], [hx, -hy, -hz], [0, 0, -1]],
  ];
  for (const [a, b, c, d, out] of faces) {
    const ia = p.vert(a[0], a[1], a[2]); const ib = p.vert(b[0], b[1], b[2]); const ic = p.vert(c[0], c[1], c[2]); const id = p.vert(d[0], d[1], d[2]);
    p.triOut(ia, ib, ic, out); p.triOut(ia, ic, id, out);
  }
}

function buildSphere(p: Part, radius: number | Vec3, segIn?: number): void {
  const r: Vec3 = typeof radius === 'number' ? [radius, radius, radius] : radius;
  const seg = clampSeg(segIn, 16);
  const rings = Math.max(2, Math.floor(seg / 2));
  const rows: number[][] = [];
  for (let i = 0; i <= rings; i++) {
    const phi = (Math.PI * i) / rings;
    const y = Math.cos(phi) * r[1]; const rad = Math.sin(phi);
    if (i === 0 || i === rings) { rows.push([p.vert(0, y, 0)]); continue; }
    rows.push(ringRow(p, ringPoints(0, y, 0, r[0] * rad, r[2] * rad, seg)));
  }
  joinRows(p, rows, false);
  orient(p, true);
}

/** Flip the winding of the triangles from index from up to to (positions in the index array, multiples of 3). */
function flipRange(p: Part, from: number, to: number): void {
  for (let i = from; i < to; i += 3) { const t = p.idx[i + 1]; p.idx[i + 1] = p.idx[i + 2]; p.idx[i + 2] = t; }
}

function buildLathe(p: Part, profile: Array<[number, number]>, segIn: number | undefined, capEnds: boolean): void {
  const seg = clampSeg(segIn, 16);
  const pts = profile.filter((q, i) => i === 0 || Math.hypot(q[0] - profile[i - 1][0], q[1] - profile[i - 1][1]) > TINY);
  const rows: number[][] = [];
  for (const [r, y] of pts) rows.push(r <= TINY ? [p.vert(0, y, 0)] : ringRow(p, ringPoints(0, y, 0, r, r, seg)));
  joinRows(p, rows, false);
  const first = pts[0]; const last = pts[pts.length - 1];
  // The wall winds outward when the profile climbs; one that descends is flipped (a profile that ends level with where it began is
  // a closed loop, and the signed volume decides).
  const rise = last[1] - first[1];
  if (Math.abs(rise) > TINY) { if (rise < 0) flipRange(p, 0, p.idx.length); } else orient(p, true);
  if (capEnds) {
    const up = rise >= 0;
    if (first[0] > TINY) p.fan(ringPoints(0, first[1], 0, first[0], first[0], seg), [0, first[1], 0], [0, up ? -1 : 1, 0]);
    if (last[0] > TINY) p.fan(ringPoints(0, last[1], 0, last[0], last[0], seg), [0, last[1], 0], [0, up ? 1 : -1, 0]);
  }
}

function buildCylinder(p: Part, rt: number, rb: number, h: number, segIn: number | undefined, capTop: boolean, capBottom: boolean): void {
  const seg = clampSeg(segIn, 16);
  const top = rt <= TINY ? [p.vert(0, h / 2, 0)] : ringRow(p, ringPoints(0, h / 2, 0, rt, rt, seg));
  const bottom = rb <= TINY ? [p.vert(0, -h / 2, 0)] : ringRow(p, ringPoints(0, -h / 2, 0, rb, rb, seg));
  // Rows run bottom to top, which is the winding that faces outward.
  joinRows(p, [bottom, top], false);
  if (rt > TINY && capTop) p.fan(ringPoints(0, h / 2, 0, rt, rt, seg), [0, h / 2, 0], [0, 1, 0]);
  if (rb > TINY && capBottom) p.fan(ringPoints(0, -h / 2, 0, rb, rb, seg), [0, -h / 2, 0], [0, -1, 0]);
}

function buildTorus(p: Part, radius: number, tube: number, segIn?: number, tubeSegIn?: number): void {
  const seg = clampSeg(segIn, 24); const tseg = clampSeg(tubeSegIn, 10);
  const rows: number[][] = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const row: number[] = [];
    for (let j = 0; j < tseg; j++) {
      const b = (j / tseg) * Math.PI * 2;
      const rr = radius + tube * Math.cos(b);
      row.push(p.vert(Math.cos(a) * rr, tube * Math.sin(b), Math.sin(a) * rr));
    }
    rows.push(row);
  }
  joinRows(p, rows, true);
  orient(p, true);
}

function buildLoft(p: Part, length: number, sections: ForgeSection[], stationsIn?: number, ringIn?: number): void {
  const stations = Math.max(2, Math.min(64, Math.round(stationsIn ?? 14)));
  const ring = clampSeg(ringIn, 14);
  const ts = sections.map((s) => s.t);
  const hw = sections.map((s) => s.halfWidth);
  const tp = sections.map((s) => s.top);
  const bt = sections.map((s) => s.bottom);
  const pw = sections.map((s) => s.power ?? 2);
  const rows: number[][] = [];
  const capInfo: Array<{ y: number; z: number; w: number; hh: number; pwr: number } | null> = [];
  for (let s = 0; s < stations; s++) {
    const t = s / (stations - 1);
    const z = (t - 0.5) * length;
    const w = Math.max(0, curve(ts, hw, t)); const yTop = curve(ts, tp, t); const yBot = curve(ts, bt, t);
    const pwr = Math.max(1, curve(ts, pw, t));
    const mid = (yTop + yBot) / 2; const hh = Math.max(0, (yTop - yBot) / 2);
    if (w < TINY || hh < TINY) { rows.push([p.vert(0, mid, z)]); capInfo.push(null); continue; }
    const row: number[] = [];
    for (let k = 0; k < ring; k++) {
      const a = (k / ring) * Math.PI * 2;
      row.push(p.vert(w * spow(Math.cos(a), 2 / pwr), mid + hh * spow(Math.sin(a), 2 / pwr), z));
    }
    rows.push(row); capInfo.push({ y: mid, z, w, hh, pwr });
  }
  joinRows(p, rows, false);
  // Rows run along +z with the ring turning counter-clockwise about +z, which winds the wall inward: flip it (the caps below are explicit).
  flipRange(p, 0, p.idx.length);
  const ends: Array<[number, number]> = [[0, -1], [stations - 1, 1]];
  for (const [si, dir] of ends) {
    const info = capInfo[si];
    if (!info) continue;
    const pts: Vec3[] = [];
    for (let k = 0; k < ring; k++) { const a = (k / ring) * Math.PI * 2; pts.push([info.w * spow(Math.cos(a), 2 / info.pwr), info.y + info.hh * spow(Math.sin(a), 2 / info.pwr), info.z]); }
    p.fan(pts, [0, info.y, info.z], [0, 0, dir]);
  }
}

function signedArea(poly: Array<[number, number]>): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) { const q = poly[(i + 1) % poly.length]; a += poly[i][0] * q[1] - q[0] * poly[i][1]; }
  return a / 2;
}

/** Ear-clipping triangulation of a simple polygon given counter-clockwise; returns index triples. */
export function triangulate(poly: Array<[number, number]>): number[] {
  const n = poly.length;
  const idx: number[] = [];
  for (let i = 0; i < n; i++) idx.push(i);
  const out: number[] = [];
  const cross = (a: number, b: number, c: number): number => (poly[b][0] - poly[a][0]) * (poly[c][1] - poly[a][1]) - (poly[b][1] - poly[a][1]) * (poly[c][0] - poly[a][0]);
  const inside = (pt: number, a: number, b: number, c: number): boolean => cross(a, b, pt) >= -1e-12 && cross(b, c, pt) >= -1e-12 && cross(c, a, pt) >= -1e-12;
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const a = idx[(i + idx.length - 1) % idx.length]; const b = idx[i]; const c = idx[(i + 1) % idx.length];
      if (cross(a, b, c) <= 1e-12) continue;
      let ear = true;
      for (const q of idx) { if (q === a || q === b || q === c) continue; if (inside(q, a, b, c)) { ear = false; break; } }
      if (!ear) continue;
      out.push(a, b, c); idx.splice(i, 1); clipped = true; break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  return out;
}

function buildExtrude(p: Part, polyIn: Array<[number, number]>, depth: number): void {
  const poly = signedArea(polyIn) < 0 ? polyIn.slice().reverse() : polyIn;
  const hz = depth / 2;
  const tris = triangulate(poly);
  for (const [z, out] of [[hz, 1], [-hz, -1]] as Array<[number, number]>) {
    const ids = poly.map((q) => p.vert(q[0], q[1], z));
    for (let i = 0; i < tris.length; i += 3) p.triOut(ids[tris[i]], ids[tris[i + 1]], ids[tris[i + 2]], [0, 0, out]);
  }
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]; const b = poly[(i + 1) % poly.length];
    const out: Vec3 = [b[1] - a[1], -(b[0] - a[0]), 0];
    const v0 = p.vert(a[0], a[1], -hz); const v1 = p.vert(b[0], b[1], -hz); const v2 = p.vert(b[0], b[1], hz); const v3 = p.vert(a[0], a[1], hz);
    p.triOut(v0, v1, v2, out); p.triOut(v0, v2, v3, out);
  }
}

function buildTube(p: Part, path: Vec3[], radius: number | number[], segIn?: number): void {
  const seg = clampSeg(segIn, 8);
  const n = path.length;
  const rad = (i: number): number => (typeof radius === 'number' ? radius : radius[i]);
  const tangent = (i: number): Vec3 => {
    const a = path[Math.max(0, i - 1)]; const b = path[Math.min(n - 1, i + 1)];
    const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const l = Math.hypot(d[0], d[1], d[2]) || 1;
    return [d[0] / l, d[1] / l, d[2] / l];
  };
  let t0 = tangent(0);
  // First normal: any direction not parallel to the tangent.
  let nrm: Vec3 = Math.abs(t0[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const dot0 = nrm[0] * t0[0] + nrm[1] * t0[1] + nrm[2] * t0[2];
  nrm = [nrm[0] - t0[0] * dot0, nrm[1] - t0[1] * dot0, nrm[2] - t0[2] * dot0];
  let nl = Math.hypot(nrm[0], nrm[1], nrm[2]) || 1; nrm = [nrm[0] / nl, nrm[1] / nl, nrm[2] / nl];
  const rows: number[][] = [];
  const frames: Array<{ c: Vec3; nrm: Vec3; bin: Vec3; r: number }> = [];
  for (let i = 0; i < n; i++) {
    const t = tangent(i);
    const d = nrm[0] * t[0] + nrm[1] * t[1] + nrm[2] * t[2];
    nrm = [nrm[0] - t[0] * d, nrm[1] - t[1] * d, nrm[2] - t[2] * d];
    nl = Math.hypot(nrm[0], nrm[1], nrm[2]) || 1; nrm = [nrm[0] / nl, nrm[1] / nl, nrm[2] / nl];
    const bin: Vec3 = [t[1] * nrm[2] - t[2] * nrm[1], t[2] * nrm[0] - t[0] * nrm[2], t[0] * nrm[1] - t[1] * nrm[0]];
    frames.push({ c: path[i], nrm, bin, r: rad(i) });
    t0 = t;
    if (rad(i) <= TINY) { rows.push([p.vert(path[i][0], path[i][1], path[i][2])]); continue; }
    const row: number[] = [];
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2; const c = Math.cos(a) * rad(i); const s = Math.sin(a) * rad(i);
      row.push(p.vert(path[i][0] + nrm[0] * c + bin[0] * s, path[i][1] + nrm[1] * c + bin[1] * s, path[i][2] + nrm[2] * c + bin[2] * s));
    }
    rows.push(row);
  }
  joinRows(p, rows, false);
  // Same configuration as the loft: rows along the tangent, ring counter-clockwise about it, so the wall is flipped.
  flipRange(p, 0, p.idx.length);
  for (const [i, dirSign] of [[0, -1], [n - 1, 1]] as Array<[number, number]>) {
    const f = frames[i];
    if (f.r <= TINY) continue;
    const t = tangent(i);
    const pts: Vec3[] = [];
    for (let k = 0; k < seg; k++) { const a = (k / seg) * Math.PI * 2; const c = Math.cos(a) * f.r; const s = Math.sin(a) * f.r; pts.push([f.c[0] + f.nrm[0] * c + f.bin[0] * s, f.c[1] + f.nrm[1] * c + f.bin[1] * s, f.c[2] + f.nrm[2] * c + f.bin[2] * s]); }
    p.fan(pts, f.c, [t[0] * dirSign, t[1] * dirSign, t[2] * dirSign]);
  }
}

function buildPlane(p: Part, size: [number, number], segIn?: number): void {
  const n = Math.max(1, Math.min(64, Math.round(segIn ?? 1)));
  const rows: number[][] = [];
  for (let i = 0; i <= n; i++) {
    const row: number[] = [];
    for (let j = 0; j <= n; j++) row.push(p.vert((j / n - 0.5) * size[0], 0, (i / n - 0.5) * size[1]));
    rows.push(row);
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const a = rows[i][j]; const b = rows[i][j + 1]; const c = rows[i + 1][j]; const d = rows[i + 1][j + 1];
    p.triOut(a, c, b, [0, 1, 0]); p.triOut(b, c, d, [0, 1, 0]);
  }
}

/** The mesh of one primitive, in its own space, with normals. */
export function shapeMesh(shape: ForgeShape): MeshArrays {
  const p = new Part();
  switch (shape.type) {
    case 'box': buildBox(p, shape.size); break;
    case 'sphere': buildSphere(p, shape.radius, shape.seg); break;
    case 'cylinder': buildCylinder(p, shape.radiusTop, shape.radiusBottom, shape.height, shape.seg, shape.capTop !== false, shape.capBottom !== false); break;
    case 'capsule': {
      const r = shape.radius; const h = shape.length / 2;
      const hemi = Math.max(2, Math.floor(clampSeg(shape.seg, 12) / 3));
      const profile: Array<[number, number]> = [];
      for (let i = 0; i <= hemi; i++) { const a = (Math.PI / 2) * (i / hemi); profile.push([r * Math.sin(a), -h - r * Math.cos(a)]); }
      for (let i = 0; i <= hemi; i++) { const a = Math.PI / 2 + (Math.PI / 2) * (i / hemi); profile.push([r * Math.sin(a), h - r * Math.cos(a)]); }
      buildLathe(p, profile, shape.seg, false);
      break;
    }
    case 'torus': buildTorus(p, shape.radius, shape.tube, shape.seg, shape.tubeSeg); break;
    case 'lathe': buildLathe(p, shape.profile, shape.seg, shape.capEnds !== false); break;
    case 'loft': buildLoft(p, shape.length, shape.sections, shape.stations, shape.ring); break;
    case 'extrude': buildExtrude(p, shape.polygon, shape.depth); break;
    case 'tube': buildTube(p, shape.path, shape.radius, shape.seg); break;
    case 'plane': buildPlane(p, shape.size, shape.segments); break;
  }
  return p.finish();
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Transforms

export type Mat3 = [number, number, number, number, number, number, number, number, number];
const DEG = Math.PI / 180;

/** Rotation matrix from Euler angles in degrees, X then Y then Z (the three.js default order: R = Rx * Ry * Rz). */
export function eulerMat(rot: Vec3): Mat3 {
  const [a, b, c] = [rot[0] * DEG, rot[1] * DEG, rot[2] * DEG];
  const ca = Math.cos(a); const sa = Math.sin(a); const cb = Math.cos(b); const sb = Math.sin(b); const cc = Math.cos(c); const sc = Math.sin(c);
  return [
    cb * cc, -cb * sc, sb,
    ca * sc + sa * sb * cc, ca * cc - sa * sb * sc, -sa * cb,
    sa * sc - ca * sb * cc, sa * cc + ca * sb * sc, ca * cb,
  ];
}

/** Euler angles in degrees from a pure rotation matrix (the inverse of eulerMat). */
export function matEuler(m: Mat3): Vec3 {
  const y = Math.asin(Math.max(-1, Math.min(1, m[2])));
  let x: number; let z: number;
  if (Math.abs(m[2]) < 0.9999999) { x = Math.atan2(-m[5], m[8]); z = Math.atan2(-m[1], m[0]); }
  else { x = Math.atan2(m[7], m[4]); z = 0; }
  return [x / DEG, y / DEG, z / DEG];
}

export function mulMat(a: Mat3, b: Mat3): Mat3 {
  const o = new Array<number>(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o as Mat3;
}

export function mulVec(m: Mat3, v: Vec3): Vec3 {
  return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
}

export function det3(m: Mat3): number {
  return m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

const AXES: Axis[] = ['x', 'y', 'z'];
const axisIndex = (a: Axis): number => AXES.indexOf(a);

// ---------------------------------------------------------------------------------------------------------------------------------
// Expansion: mirror and repeat become real nodes, so every consumer sees one flat list

export interface ExpandedNode {
  name: string;
  parent: number;
  shape?: ForgeShape;
  material?: string;
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
  clips: Record<string, ForgeTrack[]>;
  /** The node this one is a copy of (for sharing geometry), or its own index. */
  source: number;
}

const unit = (v: Vec3 | undefined, d: number): Vec3 => (v ? [v[0], v[1], v[2]] : [d, d, d]);

function reflectClips(clips: Record<string, ForgeTrack[]>, axis: Axis, phase: number): Record<string, ForgeTrack[]> {
  const out: Record<string, ForgeTrack[]> = {};
  for (const [name, tracks] of Object.entries(clips)) {
    out[name] = tracks.map((t) => {
      let sign = 1;
      if (t.property === 'rotation') sign = t.axis === axis ? 1 : -1;
      else if (t.property === 'position') sign = t.axis === axis ? -1 : 1;
      // A spin is reflected by turning the other way when the axis is one the mirror reverses; a swing, by negating its amplitude.
      if (t.spin) return { ...t, speed: t.speed * sign, offset: (t.offset ?? 0) * sign, phase: (t.phase ?? 0) * sign + phase };
      return { ...t, amplitude: (t.amplitude ?? 0) * sign, offset: (t.offset ?? 0) * sign, phase: (t.phase ?? 0) + phase };
    });
  }
  return out;
}

export const MAX_EXPANDED_NODES = 400;

export function expandNodes(spec: ObjectSpec): ExpandedNode[] {
  const out: ExpandedNode[] = [];
  // One mesh per DISTINCT shape: every node whose shape is the same as an earlier node's (a copy, a mirror, the same wheel under the second
  // carriage of a train) builds from that earlier node's geometry, so a longer train costs no more shapes.
  const firstWithShape = new Map<string, number>();
  const emit = (node: ForgeNode, parent: number, suffix: string, copyOf: number | null, pos: Vec3, rot: Vec3, scl: Vec3, clips: Record<string, ForgeTrack[]>): number => {
    if (out.length >= MAX_EXPANDED_NODES) throw new Error('the object expands to ' + (MAX_EXPANDED_NODES + 1) + ' nodes or more; the limit is ' + MAX_EXPANDED_NODES);
    const index = out.length;
    let source = copyOf ?? index;
    if (node.shape) {
      const key = JSON.stringify(node.shape);
      const hit = firstWithShape.get(key);
      if (hit === undefined) firstWithShape.set(key, index); else source = hit;
    }
    out.push({ name: node.name + suffix, parent, shape: node.shape, material: node.material, position: pos, rotation: rot, scale: scl, clips, source });
    return index;
  };
  const visit = (node: ForgeNode, parent: number, suffix: string, contextDepth = 0): void => {
    const basePos = unit(node.position, 0);
    const baseRot = unit(node.rotation, 0);
    const baseScl = unit(node.scale, 1);
    const clips = node.clips ?? {};
    // The copies this node stands for: the node itself, one per repeat step, and a reflection of each when it is mirrored.
    const repeats = node.repeat ? Math.max(1, Math.round(node.repeat.count)) : 1;
    let firstCopy = -1;
    for (let i = 0; i < repeats; i++) {
      let pos = basePos; let rot = baseRot;
      const copySuffix = i === 0 ? suffix : suffix + '_' + i;
      if (node.repeat && i > 0) {
        if (node.repeat.step) pos = [basePos[0] + node.repeat.step[0] * i, basePos[1] + node.repeat.step[1] * i, basePos[2] + node.repeat.step[2] * i];
        if (node.repeat.around) {
          const deg = (node.repeat.around.degrees ?? 360) / repeats * i;
          const rv: Vec3 = [0, 0, 0]; rv[axisIndex(node.repeat.around.axis)] = deg;
          const rm = eulerMat(rv);
          pos = mulVec(rm, basePos);
          rot = matEuler(mulMat(rm, eulerMat(baseRot)));
        }
      }
      const idx = emit(node, parent, copySuffix, firstCopy < 0 ? null : firstCopy, pos, rot, baseScl, clips);
      if (firstCopy < 0) firstCopy = idx;
      const first = firstCopy;
      // What the children inherit: a repeated parent's copy number carries a "p" (for parent), so the second copy of a child under the first
      // copy of its parent (window_1) can never be the same name as the first copy of that child under the second copy of the parent (window_1p).
      // A mirror adds nothing here, so a mirrored limb's parts stay hand_mirror, knee_mirror.
      // Include branching-ancestor depth even when earlier ancestors use their zero copy.
      // Otherwise A0/B1/C and A1/B0/C both become C_1p.
      const childContext = suffix + (i > 0 ? '_' + i + 'p' + (contextDepth || '') : '');
      const childContextDepth = contextDepth + (repeats > 1 || node.mirror ? 1 : 0);
      for (const child of node.children ?? []) visit(child, idx, childContext, childContextDepth);
      if (node.mirror) {
        const ax = axisIndex(node.mirror);
        const mpos: Vec3 = [pos[0], pos[1], pos[2]]; mpos[ax] = -mpos[ax];
        const mrot: Vec3 = [rot[0], rot[1], rot[2]];
        for (let k = 0; k < 3; k++) if (k !== ax) mrot[k] = -mrot[k];
        const mscl: Vec3 = [baseScl[0], baseScl[1], baseScl[2]]; mscl[ax] = -mscl[ax];
        const mirrorTag = '_mirror' + (contextDepth || '');
        const msuffix = copySuffix + mirrorTag;
        emit(node, parent, msuffix, first, mpos, mrot, mscl, reflectClips(clips, node.mirror, node.mirrorPhase ?? 0));
        const mIdx = out.length - 1;
        for (const child of node.children ?? []) visit(child, mIdx, childContext + mirrorTag, childContextDepth);
      }
    }
  };
  for (const n of spec.nodes) visit(n, -1, '');
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Animation

export function trackValue(t: ForgeTrack, time: number): number {
  if (t.spin) return (t.offset ?? 0) + ((t.phase ?? 0) + time * t.speed) * 360;
  return (t.offset ?? 0) + (t.amplitude ?? 0) * Math.sin((time * t.speed + (t.phase ?? 0)) * Math.PI * 2);
}

/** The local transform of a node at a time within a clip (no clip, or a clip the node lacks, gives its base pose). */
export function poseOf(node: ExpandedNode, clip: string | null, time: number): { position: Vec3; rotation: Vec3; scale: Vec3 } {
  const position: Vec3 = [node.position[0], node.position[1], node.position[2]];
  const rotation: Vec3 = [node.rotation[0], node.rotation[1], node.rotation[2]];
  const scale: Vec3 = [node.scale[0], node.scale[1], node.scale[2]];
  const tracks = clip ? node.clips[clip] : undefined;
  if (tracks) {
    for (const t of tracks) {
      const v = trackValue(t, time); const i = axisIndex(t.axis);
      if (t.property === 'rotation') rotation[i] += v; else if (t.property === 'position') position[i] += v; else scale[i] += v;
    }
  }
  return { position, rotation, scale };
}

export interface WorldMesh {
  name: string;
  material: string;
  position: number[];
  index: number[];
}

/** Every mesh of the object in the object's own space (the node tree applied), at a pose. This is what the checks measure. */
export function worldMeshes(spec: ObjectSpec, clip: string | null = null, time = 0): WorldMesh[] {
  const nodes = expandNodes(spec);
  const mats: Mat3[] = []; const offs: Vec3[] = [];
  const cache = new Map<number, MeshArrays>();
  const out: WorldMesh[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const pose = poseOf(n, clip, time);
    const r = eulerMat(pose.rotation);
    const local: Mat3 = [r[0] * pose.scale[0], r[1] * pose.scale[1], r[2] * pose.scale[2], r[3] * pose.scale[0], r[4] * pose.scale[1], r[5] * pose.scale[2], r[6] * pose.scale[0], r[7] * pose.scale[1], r[8] * pose.scale[2]];
    const pm = n.parent >= 0 ? mats[n.parent] : null;
    const po = n.parent >= 0 ? offs[n.parent] : null;
    mats.push(pm ? mulMat(pm, local) : local);
    const o = po && pm ? mulVec(pm, pose.position) : pose.position;
    offs.push(po ? [o[0] + po[0], o[1] + po[1], o[2] + po[2]] : [o[0], o[1], o[2]]);
    if (!n.shape) continue;
    let mesh = cache.get(n.source);
    if (!mesh) { mesh = shapeMesh(nodes[n.source].shape as ForgeShape); cache.set(n.source, mesh); }
    const m = mats[i]; const off = offs[i];
    const flip = det3(m) < 0;
    const position: number[] = [];
    for (let k = 0; k < mesh.position.length; k += 3) {
      const v = mulVec(m, [mesh.position[k], mesh.position[k + 1], mesh.position[k + 2]]);
      position.push(v[0] + off[0], v[1] + off[1], v[2] + off[2]);
    }
    const index: number[] = [];
    for (let k = 0; k < mesh.index.length; k += 3) {
      if (flip) index.push(mesh.index[k], mesh.index[k + 2], mesh.index[k + 1]); else index.push(mesh.index[k], mesh.index[k + 1], mesh.index[k + 2]);
    }
    out.push({ name: n.name, material: n.material ?? '', position, index });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The object in a game

export interface ForgeObject {
  group: ThreeLike;
  /** Every node by name, so a game can attach a weapon to the right hand or turn a head toward a target. */
  nodes: Record<string, ThreeLike>;
  triangles: number;
  clips: string[];
  play(clip: string | null, speed?: number): void;
  update(dt: number): void;
  dispose(): void;
}

export function createObject(THREE: ThreeLike, spec: ObjectSpec): ForgeObject {
  const expanded = expandNodes(spec);
  const group = new THREE.Group();
  group.name = spec.id;
  const materials: Record<string, ThreeLike> = {};
  for (const [key, m] of Object.entries(spec.materials)) {
    materials[key] = new THREE.MeshStandardMaterial({
      color: m.color, roughness: m.roughness ?? 0.7, metalness: m.metalness ?? 0,
      emissive: m.emissive ?? '#000000', transparent: (m.opacity ?? 1) < 1, opacity: m.opacity ?? 1,
    });
  }
  const geometries = new Map<number, ThreeLike>();
  const objects: ThreeLike[] = [];
  const nodes: Record<string, ThreeLike> = {};
  let triangles = 0;
  const clipNames = new Set<string>();
  for (let i = 0; i < expanded.length; i++) {
    const n = expanded[i];
    let obj: ThreeLike;
    if (n.shape) {
      let g = geometries.get(n.source);
      if (!g) {
        const a = shapeMesh(expanded[n.source].shape as ForgeShape);
        g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
        g.setIndex(new THREE.BufferAttribute(a.index, 1));
        g.userData.triangles = a.triangles;
        geometries.set(n.source, g);
      }
      triangles += g.userData.triangles as number;
      obj = new THREE.Mesh(g, materials[n.material ?? ''] ?? new THREE.MeshStandardMaterial({ color: '#cccccc' }));
      obj.castShadow = true; obj.receiveShadow = true;
    } else obj = new THREE.Group();
    obj.name = n.name;
    obj.position.set(n.position[0], n.position[1], n.position[2]);
    obj.rotation.set(n.rotation[0] * DEG, n.rotation[1] * DEG, n.rotation[2] * DEG);
    obj.scale.set(n.scale[0], n.scale[1], n.scale[2]);
    (n.parent >= 0 ? objects[n.parent] : group).add(obj);
    objects.push(obj); nodes[n.name] = obj;
    for (const c of Object.keys(n.clips)) clipNames.add(c);
  }
  let clip: string | null = null; let time = 0; let rate = 1;
  const apply = (): void => {
    for (let i = 0; i < expanded.length; i++) {
      const n = expanded[i];
      if (Object.keys(n.clips).length === 0) continue;
      const pose = poseOf(n, clip, time);
      objects[i].position.set(pose.position[0], pose.position[1], pose.position[2]);
      objects[i].rotation.set(pose.rotation[0] * DEG, pose.rotation[1] * DEG, pose.rotation[2] * DEG);
      objects[i].scale.set(pose.scale[0], pose.scale[1], pose.scale[2]);
    }
  };
  return {
    group, nodes, triangles, clips: [...clipNames],
    play(name: string | null, speed = 1): void { clip = name; rate = speed; time = 0; apply(); },
    update(dt: number): void { if (!clip) return; time += dt * rate; apply(); },
    dispose(): void {
      for (const g of geometries.values()) g.dispose();
      for (const m of Object.values(materials)) m.dispose();
      group.removeFromParent();
    },
  };
}
`;

