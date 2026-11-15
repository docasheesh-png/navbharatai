// OBJECT FORGE — the CHECK half (forgeCheck.ts): validate a spec the builder wrote, measure what it would build, and DRAW it as text.
//
// A model that writes a 3D object blind cannot see it. This module is its eyes: before the object reaches the game, the spec is checked
// against real limits (triangle budget, sane sizes, a polygon that does not cross itself), and the object it builds is measured from
// the SAME engine the game runs — bounds in metres, parts that float free of the rest, an animation that throws a limb through the
// floor — and drawn from three sides as a text silhouette with one symbol per material, so the builder can see a head where the
// torso should be and fix it. It runs on the server (the tool) and in tests; it is not shipped into a game.
//
// PURE source string, loaded by forgeRuntime.ts next to the engine. Rule for editing: no backticks and no dollar-brace inside the string.
export const FORGE_CHECK = `// Object Forge — validation, measurement and a text drawing of an object spec.
import { expandNodes, shapeMesh, worldMeshes, type ForgeNode, type ObjectSpec, type WorldMesh } from './forge';

export const FORGE_LIMITS = { maxNodes: 400, maxTriangles: 24000, maxDepth: 8, maxDimension: 2000, maxMaterials: 32, maxClips: 12, maxTracks: 12 };

const SHAPES = ['box', 'sphere', 'cylinder', 'capsule', 'torus', 'lathe', 'loft', 'extrude', 'tube', 'plane'];
const NAME = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const HEX = /^#[0-9a-fA-F]{6}$/;
const AXES = ['x', 'y', 'z'];

export interface Validation {
  errors: string[];
  warnings: string[];
  spec: ObjectSpec | null;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function checkNumber(v: unknown, path: string, errors: string[], lo: number, hi: number, optional = false): void {
  if (v === undefined && optional) return;
  if (!finite(v)) { errors.push(path + ' must be a number'); return; }
  if (v < lo || v > hi) errors.push(path + ' is ' + v + ' but must be between ' + lo + ' and ' + hi);
}

function checkVec(v: unknown, path: string, errors: string[], lo: number, hi: number, optional = false): void {
  if (v === undefined && optional) return;
  if (!Array.isArray(v) || v.length !== 3) { errors.push(path + ' must be [x, y, z], three numbers'); return; }
  for (let i = 0; i < 3; i++) checkNumber(v[i], path + '[' + i + ']', errors, lo, hi);
}

function checkSeg(v: unknown, path: string, errors: string[]): void {
  if (v === undefined) return;
  if (!finite(v) || !Number.isInteger(v) || v < 3 || v > 64) errors.push(path + ' must be a whole number from 3 to 64');
}

function segmentsCross(a: number[], b: number[], c: number[], d: number[]): boolean {
  const o = (p: number[], q: number[], r: number[]): number => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(a, b, c); const d2 = o(a, b, d); const d3 = o(c, d, a); const d4 = o(c, d, b);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function checkShape(shape: unknown, path: string, errors: string[]): void {
  if (!isRec(shape)) { errors.push(path + ' must be an object like { "type": "box", "size": [1, 1, 1] }'); return; }
  const t = shape.type;
  if (typeof t !== 'string' || !SHAPES.includes(t)) { errors.push(path + '.type is ' + JSON.stringify(t) + ' but must be one of: ' + SHAPES.join(', ')); return; }
  const D = FORGE_LIMITS.maxDimension;
  switch (t) {
    case 'box': checkVec(shape.size, path + '.size', errors, 0.001, D); break;
    case 'sphere':
      if (Array.isArray(shape.radius)) checkVec(shape.radius, path + '.radius', errors, 0.001, D); else checkNumber(shape.radius, path + '.radius', errors, 0.001, D);
      checkSeg(shape.seg, path + '.seg', errors); break;
    case 'cylinder':
      checkNumber(shape.radiusTop, path + '.radiusTop', errors, 0, D); checkNumber(shape.radiusBottom, path + '.radiusBottom', errors, 0, D);
      checkNumber(shape.height, path + '.height', errors, 0.001, D); checkSeg(shape.seg, path + '.seg', errors);
      if (finite(shape.radiusTop) && finite(shape.radiusBottom) && shape.radiusTop === 0 && shape.radiusBottom === 0) errors.push(path + ' has radiusTop and radiusBottom both 0, so it is nothing');
      break;
    case 'capsule': checkNumber(shape.radius, path + '.radius', errors, 0.001, D); checkNumber(shape.length, path + '.length', errors, 0, D); checkSeg(shape.seg, path + '.seg', errors); break;
    case 'torus':
      checkNumber(shape.radius, path + '.radius', errors, 0.001, D); checkNumber(shape.tube, path + '.tube', errors, 0.001, D);
      checkSeg(shape.seg, path + '.seg', errors); checkSeg(shape.tubeSeg, path + '.tubeSeg', errors);
      if (finite(shape.radius) && finite(shape.tube) && shape.tube >= shape.radius) errors.push(path + '.tube must be smaller than .radius (a tube as fat as the ring crosses itself)');
      break;
    case 'lathe': {
      const pr = shape.profile;
      if (!Array.isArray(pr) || pr.length < 2 || pr.length > 48) { errors.push(path + '.profile must be a list of 2 to 48 points [radius, y]'); break; }
      pr.forEach((q, i) => {
        if (!Array.isArray(q) || q.length !== 2) { errors.push(path + '.profile[' + i + '] must be [radius, y]'); return; }
        checkNumber(q[0], path + '.profile[' + i + '][0] (radius)', errors, 0, D); checkNumber(q[1], path + '.profile[' + i + '][1] (y)', errors, -D, D);
      });
      checkSeg(shape.seg, path + '.seg', errors); break;
    }
    case 'loft': {
      checkNumber(shape.length, path + '.length', errors, 0.001, D);
      const sec = shape.sections;
      if (!Array.isArray(sec) || sec.length < 2 || sec.length > 16) { errors.push(path + '.sections must be a list of 2 to 16 cross-sections'); break; }
      let prev = -1;
      sec.forEach((s, i) => {
        const sp = path + '.sections[' + i + ']';
        if (!isRec(s)) { errors.push(sp + ' must be { t, halfWidth, top, bottom }'); return; }
        checkNumber(s.t, sp + '.t', errors, 0, 1); checkNumber(s.halfWidth, sp + '.halfWidth', errors, 0, D);
        checkNumber(s.top, sp + '.top', errors, -D, D); checkNumber(s.bottom, sp + '.bottom', errors, -D, D); checkNumber(s.power, sp + '.power', errors, 1, 10, true);
        if (finite(s.t)) { if (s.t <= prev) errors.push(sp + '.t must be larger than the section before it'); prev = s.t; }
        if (finite(s.top) && finite(s.bottom) && s.top < s.bottom) errors.push(sp + ' has top below bottom');
      });
      checkNumber(shape.stations, path + '.stations', errors, 2, 64, true); checkSeg(shape.ring, path + '.ring', errors); break;
    }
    case 'extrude': {
      const poly = shape.polygon;
      checkNumber(shape.depth, path + '.depth', errors, 0.001, D);
      if (!Array.isArray(poly) || poly.length < 3 || poly.length > 64) { errors.push(path + '.polygon must be a list of 3 to 64 points [x, y]'); break; }
      let ok = true;
      poly.forEach((q, i) => {
        if (!Array.isArray(q) || q.length !== 2 || !finite(q[0]) || !finite(q[1])) { errors.push(path + '.polygon[' + i + '] must be [x, y]'); ok = false; }
      });
      if (!ok) break;
      const pts = poly as number[][];
      let area = 0;
      for (let i = 0; i < pts.length; i++) { const q = pts[(i + 1) % pts.length]; area += pts[i][0] * q[1] - q[0] * pts[i][1]; }
      if (Math.abs(area) < 1e-9) errors.push(path + '.polygon has no area (its points are in a line)');
      for (let i = 0; i < pts.length; i++) for (let j = i + 2; j < pts.length; j++) {
        if (i === 0 && j === pts.length - 1) continue;
        if (segmentsCross(pts[i], pts[(i + 1) % pts.length], pts[j], pts[(j + 1) % pts.length])) { errors.push(path + '.polygon crosses itself between edges ' + i + ' and ' + j + ' (list the points in order around the outline)'); i = pts.length; break; }
      }
      break;
    }
    case 'tube': {
      const pa = shape.path;
      if (!Array.isArray(pa) || pa.length < 2 || pa.length > 64) { errors.push(path + '.path must be a list of 2 to 64 points [x, y, z]'); break; }
      pa.forEach((q, i) => checkVec(q, path + '.path[' + i + ']', errors, -D, D));
      if (Array.isArray(shape.radius)) {
        if (shape.radius.length !== pa.length) errors.push(path + '.radius has ' + shape.radius.length + ' entries but the path has ' + pa.length + ' points');
        shape.radius.forEach((r, i) => checkNumber(r, path + '.radius[' + i + ']', errors, 0, D));
      } else checkNumber(shape.radius, path + '.radius', errors, 0.001, D);
      checkSeg(shape.seg, path + '.seg', errors); break;
    }
    case 'plane':
      if (!Array.isArray(shape.size) || shape.size.length !== 2) errors.push(path + '.size must be [width, depth]');
      else { checkNumber(shape.size[0], path + '.size[0]', errors, 0.001, D); checkNumber(shape.size[1], path + '.size[1]', errors, 0.001, D); }
      checkNumber(shape.segments, path + '.segments', errors, 1, 64, true); break;
  }
}

const BEHAVIOURS = ['static', 'rails', 'wander', 'drive', 'orbit'];

/** A behaviour is DATA the kit's fixed movements read: every number is bounded, every clip it names must exist on the object. */
function checkBehaviour(b: unknown, clips: Set<string>, errors: string[]): void {
  if (b === undefined) return;
  if (!isRec(b) || typeof b.type !== 'string' || !BEHAVIOURS.includes(b.type)) { errors.push('behaviour.type must be one of: ' + BEHAVIOURS.join(', ')); return; }
  const clip = (v: unknown, name: string): void => {
    if (v === undefined) return;
    if (typeof v !== 'string' || !clips.has(v)) errors.push('behaviour.' + name + ' is ' + JSON.stringify(v) + ' but the object has no clip called that (its clips: ' + ([...clips].join(', ') || 'none') + ')');
  };
  const num = (v: unknown, name: string, lo: number, hi: number, optional = true): void => checkNumber(v, 'behaviour.' + name, errors, lo, hi, optional);
  switch (b.type) {
    case 'rails': {
      const pa = b.path;
      if (!Array.isArray(pa) || pa.length < 2 || pa.length > 200) { errors.push('behaviour.path must be a list of 2 to 200 points [x, z] in metres'); break; }
      pa.forEach((q, i) => {
        if (!Array.isArray(q) || q.length !== 2) { errors.push('behaviour.path[' + i + '] must be [x, z]'); return; }
        checkNumber(q[0], 'behaviour.path[' + i + '][0]', errors, -100000, 100000); checkNumber(q[1], 'behaviour.path[' + i + '][1]', errors, -100000, 100000);
      });
      num(b.speed, 'speed', 0.01, 300, false);
      if (b.loop !== undefined && typeof b.loop !== 'boolean') errors.push('behaviour.loop must be true or false');
      num(b.wheelRadius, 'wheelRadius', 0.05, 20); clip(b.clip, 'clip'); break;
    }
    case 'wander': {
      num(b.radius, 'radius', 1, 10000, false); num(b.speed, 'speed', 0.05, 60, false); num(b.turnRate, 'turnRate', 0.1, 20); num(b.seed, 'seed', -2147483648, 2147483647);
      if (b.pause !== undefined) {
        if (!Array.isArray(b.pause) || b.pause.length !== 2) errors.push('behaviour.pause must be [shortest, longest] in seconds');
        else { checkNumber(b.pause[0], 'behaviour.pause[0]', errors, 0, 600); checkNumber(b.pause[1], 'behaviour.pause[1]', errors, 0, 600); if (finite(b.pause[0]) && finite(b.pause[1]) && b.pause[0] > b.pause[1]) errors.push('behaviour.pause is [' + b.pause[0] + ', ' + b.pause[1] + '] but the shortest pause is longer than the longest'); }
      }
      clip(b.clip, 'clip'); clip(b.idleClip, 'idleClip'); break;
    }
    case 'drive':
      num(b.maxSpeed, 'maxSpeed', 0.5, 400, false); num(b.accel, 'accel', 0.1, 400); num(b.brake, 'brake', 0.1, 800); num(b.turnRate, 'turnRate', 0.1, 10); num(b.wheelRadius, 'wheelRadius', 0.05, 20); clip(b.clip, 'clip'); break;
    case 'orbit':
      num(b.radius, 'radius', 2, 100000, false); num(b.altitude, 'altitude', 0, 10000, false); num(b.speed, 'speed', 0.5, 400, false); num(b.bank, 'bank', 0, 60); clip(b.clip, 'clip'); break;
  }
}

function checkTracks(clips: unknown, path: string, errors: string[]): void {
  if (clips === undefined) return;
  if (!isRec(clips)) { errors.push(path + ' must be an object of named clips'); return; }
  for (const [name, tracks] of Object.entries(clips)) {
    if (!NAME.test(name)) errors.push(path + ' has a clip named ' + JSON.stringify(name) + ': use letters, digits and _ (for example walk)');
    if (!Array.isArray(tracks) || tracks.length === 0 || tracks.length > FORGE_LIMITS.maxTracks) { errors.push(path + '.' + name + ' must be a list of 1 to ' + FORGE_LIMITS.maxTracks + ' tracks'); continue; }
    tracks.forEach((t, i) => {
      const tp = path + '.' + name + '[' + i + ']';
      if (!isRec(t)) { errors.push(tp + ' must be { property, axis, amplitude, speed }'); return; }
      if (t.property !== 'rotation' && t.property !== 'position' && t.property !== 'scale') errors.push(tp + '.property must be rotation, position or scale');
      if (typeof t.axis !== 'string' || !AXES.includes(t.axis)) errors.push(tp + '.axis must be x, y or z');
      const amax = t.property === 'rotation' ? 360 : 1000;
      if (t.spin !== undefined && typeof t.spin !== 'boolean') errors.push(tp + '.spin must be true or false');
      if (t.spin === true) {
        if (t.property !== 'rotation') errors.push(tp + ' is a spin, which only a rotation can be (a wheel turns; a position swings)');
        if (!finite(t.speed) || Math.abs(t.speed) < 0.01 || Math.abs(t.speed) > 10) errors.push(tp + '.speed is ' + String(t.speed) + ' but a spin turns between 0.01 and 10 times a second (negative is the other way)');
      } else {
        checkNumber(t.amplitude, tp + '.amplitude', errors, -amax, amax); checkNumber(t.speed, tp + '.speed', errors, 0.01, 10);
      }
      checkNumber(t.phase, tp + '.phase', errors, -100, 100, true); checkNumber(t.offset, tp + '.offset', errors, -amax, amax, true);
    });
  }
}

function checkNode(node: unknown, path: string, depth: number, errors: string[], materials: Rec): void {
  if (!isRec(node)) { errors.push(path + ' must be an object'); return; }
  if (typeof node.name !== 'string' || !NAME.test(node.name)) errors.push(path + '.name must be letters, digits and _ starting with a letter (for example left_arm), got ' + JSON.stringify(node.name));
  if (depth > FORGE_LIMITS.maxDepth) { errors.push(path + ' is nested more than ' + FORGE_LIMITS.maxDepth + ' levels deep'); return; }
  if (node.shape !== undefined) {
    checkShape(node.shape, path + '.shape', errors);
    if (typeof node.material !== 'string') errors.push(path + ' draws a shape but has no material (name one from the materials list)');
    else if (!(node.material in materials)) errors.push(path + '.material is ' + JSON.stringify(node.material) + ', which is not in materials (' + Object.keys(materials).join(', ') + ')');
  }
  checkVec(node.position, path + '.position', errors, -FORGE_LIMITS.maxDimension, FORGE_LIMITS.maxDimension, true);
  checkVec(node.rotation, path + '.rotation', errors, -3600, 3600, true);
  if (node.scale !== undefined) {
    checkVec(node.scale, path + '.scale', errors, -1000, 1000);
    if (Array.isArray(node.scale) && node.scale.some((v) => finite(v) && Math.abs(v) < 0.0001)) errors.push(path + '.scale has a zero component, which flattens the node to nothing');
  }
  if (node.mirror !== undefined && (typeof node.mirror !== 'string' || !AXES.includes(node.mirror))) errors.push(path + '.mirror must be x, y or z');
  checkNumber(node.mirrorPhase, path + '.mirrorPhase', errors, -100, 100, true);
  if (node.repeat !== undefined) {
    const r = node.repeat;
    if (!isRec(r)) errors.push(path + '.repeat must be { count, step } or { count, around }');
    else {
      checkNumber(r.count, path + '.repeat.count', errors, 1, 64);
      if (finite(r.count) && !Number.isInteger(r.count)) errors.push(path + '.repeat.count must be a whole number');
      checkVec(r.step, path + '.repeat.step', errors, -FORGE_LIMITS.maxDimension, FORGE_LIMITS.maxDimension, true);
      if (r.around !== undefined) {
        if (!isRec(r.around) || typeof r.around.axis !== 'string' || !AXES.includes(r.around.axis)) errors.push(path + '.repeat.around must be { axis: x|y|z, degrees? }');
        else checkNumber(r.around.degrees, path + '.repeat.around.degrees', errors, -360, 360, true);
      }
      if (r.step === undefined && r.around === undefined && finite(r.count) && r.count > 1) errors.push(path + '.repeat has a count but neither step nor around, so every copy would sit in the same place');
    }
  }
  checkTracks(node.clips, path + '.clips', errors);
  if (node.children !== undefined) {
    if (!Array.isArray(node.children)) errors.push(path + '.children must be a list of nodes');
    else node.children.forEach((c, i) => checkNode(c, path + '.children[' + i + ']', depth + 1, errors, materials));
  }
}

/** Check a spec of unknown shape (the builder wrote it, so nothing is trusted). */
export function validateObjectSpec(input: unknown): Validation {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isRec(input)) return { errors: ['the spec must be an object { id, name, materials, nodes }'], warnings, spec: null };
  if (typeof input.id !== 'string' || !/^[a-z][a-z0-9-]{1,39}$/.test(input.id)) errors.push('id must be lowercase letters, digits and - (2 to 40 characters, starting with a letter), for example "red-dragon"; got ' + JSON.stringify(input.id));
  if (typeof input.name !== 'string' || input.name.length === 0 || input.name.length > 80) errors.push('name must be a short text');
  const mats = input.materials;
  if (!isRec(mats) || Object.keys(mats).length === 0) errors.push('materials must be an object with at least one material, like { "skin": { "color": "#d9a066" } }');
  else {
    const keys = Object.keys(mats);
    if (keys.length > FORGE_LIMITS.maxMaterials) errors.push('materials has ' + keys.length + ' entries; the limit is ' + FORGE_LIMITS.maxMaterials);
    for (const k of keys) {
      const m = mats[k];
      if (!NAME.test(k)) errors.push('materials key ' + JSON.stringify(k) + ' must be letters, digits and _');
      if (!isRec(m)) { errors.push('materials.' + k + ' must be an object with a color'); continue; }
      if (typeof m.color !== 'string' || !HEX.test(m.color)) errors.push('materials.' + k + '.color must be a hex colour like #a1b2c3, got ' + JSON.stringify(m.color));
      if (m.emissive !== undefined && (typeof m.emissive !== 'string' || !HEX.test(m.emissive))) errors.push('materials.' + k + '.emissive must be a hex colour like #a1b2c3');
      checkNumber(m.roughness, 'materials.' + k + '.roughness', errors, 0, 1, true); checkNumber(m.metalness, 'materials.' + k + '.metalness', errors, 0, 1, true); checkNumber(m.opacity, 'materials.' + k + '.opacity', errors, 0, 1, true);
    }
  }
  if (!Array.isArray(input.nodes) || input.nodes.length === 0) errors.push('nodes must be a list with at least one node');
  else input.nodes.forEach((n, i) => checkNode(n, 'nodes[' + i + ']', 0, errors, isRec(mats) ? mats : {}));
  if (errors.length > 0) return { errors, warnings, spec: null };

  const spec = input as unknown as ObjectSpec;
  const expanded = expandNodes(spec);
  if (expanded.length > FORGE_LIMITS.maxNodes) errors.push('the object expands to ' + expanded.length + ' nodes (mirrors and repeats count); the limit is ' + FORGE_LIMITS.maxNodes);
  const seen = new Set<string>();
  for (const n of expanded) { if (seen.has(n.name)) errors.push('two nodes are called ' + n.name + ' (a mirror adds _mirror to the name and a repeat adds _1, _2: pick names that do not collide)'); seen.add(n.name); }
  const clipNames = new Set<string>();
  for (const n of expanded) for (const c of Object.keys(n.clips)) clipNames.add(c);
  if (clipNames.size > FORGE_LIMITS.maxClips) errors.push('the object has ' + clipNames.size + ' clips; the limit is ' + FORGE_LIMITS.maxClips);
  checkBehaviour(input.behaviour, clipNames, errors);
  if (errors.length > 0) return { errors, warnings, spec: null };

  let triangles = 0;
  const cache = new Map<number, number>();
  const cost: Array<[string, number]> = [];
  for (const n of expanded) {
    if (!n.shape) continue;
    let t = cache.get(n.source);
    if (t === undefined) { t = shapeMesh(expanded[n.source].shape as NonNullable<ForgeNode['shape']>).triangles; cache.set(n.source, t); }
    triangles += t; cost.push([n.name, t]);
  }
  if (triangles > FORGE_LIMITS.maxTriangles) {
    cost.sort((a, b) => b[1] - a[1]);
    errors.push('the object is ' + triangles + ' triangles; the limit is ' + FORGE_LIMITS.maxTriangles + '. The heaviest nodes: ' + cost.slice(0, 5).map((c) => c[0] + ' (' + c[1] + ')').join(', ') + '. Lower seg, ring, stations or tubeSeg on those');
    return { errors, warnings, spec: null };
  }
  if (cost.length === 0) errors.push('no node has a shape, so there is nothing to draw');
  const used = new Set(expanded.map((n) => n.material).filter((m): m is string => !!m));
  for (const k of Object.keys(spec.materials)) if (!used.has(k)) warnings.push('material ' + k + ' is never used');
  return { errors, warnings, spec: errors.length === 0 ? spec : null };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Measurement

export interface ObjectReport {
  id: string;
  nodes: number;
  meshes: number;
  triangles: number;
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
  perMaterial: Record<string, number>;
  degenerateTriangles: number;
  clips: Record<string, { minY: number; maxY: number; reach: number }>;
  warnings: string[];
  views: { front: string[]; side: string[]; top: string[] };
  legend: string;
}

interface Box { min: number[]; max: number[] }

function meshBox(m: WorldMesh): Box {
  const min = [Infinity, Infinity, Infinity]; const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.position.length; i += 3) for (let k = 0; k < 3; k++) { const v = m.position[i + k]; if (v < min[k]) min[k] = v; if (v > max[k]) max[k] = v; }
  return { min, max };
}

function overlap(a: Box, b: Box, eps: number): boolean {
  for (let k = 0; k < 3; k++) if (a.min[k] - eps > b.max[k] || b.min[k] - eps > a.max[k]) return false;
  return true;
}

const SYMBOLS = '#%@+=*oxs&$';

/** Draw the object from one side as text: one symbol per material, nearer surfaces over farther ones. */
function silhouette(meshes: WorldMesh[], materialIndex: Map<string, number>, h: number, v: number, depth: number, hSign: number, depthSign: number, minB: number[], maxB: number[]): string[] {
  const W = 64; const H = 28;
  const spanH = Math.max(1e-6, maxB[h] - minB[h]); const spanV = Math.max(1e-6, maxB[v] - minB[v]);
  const cw = Math.max(spanH / W, spanV / (2 * H));
  const cols = Math.max(1, Math.min(W, Math.ceil(spanH / cw))); const rows = Math.max(1, Math.min(H, Math.ceil(spanV / (2 * cw))));
  const grid: string[] = new Array<string>(cols * rows).fill(' ');
  const z: number[] = new Array<number>(cols * rows).fill(-Infinity);
  const toH = (x: number): number => (hSign > 0 ? x - minB[h] : maxB[h] - x) / cw;
  const toV = (y: number): number => (y - minB[v]) / (2 * cw);
  for (const m of meshes) {
    const sym = SYMBOLS[(materialIndex.get(m.material) ?? 0) % SYMBOLS.length];
    const P = m.position;
    for (let i = 0; i < m.index.length; i += 3) {
      const a = m.index[i] * 3; const b = m.index[i + 1] * 3; const c = m.index[i + 2] * 3;
      const ax = toH(P[a + h]); const ay = toV(P[a + v]); const bx = toH(P[b + h]); const by = toV(P[b + v]); const cx = toH(P[c + h]); const cy = toV(P[c + v]);
      const az = P[a + depth] * depthSign; const bz = P[b + depth] * depthSign; const cz = P[c + depth] * depthSign;
      const den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(den) < 1e-12) continue;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))); const x1 = Math.min(cols - 1, Math.floor(Math.max(ax, bx, cx)));
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy))); const y1 = Math.min(rows - 1, Math.floor(Math.max(ay, by, cy)));
      for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
        const px = gx + 0.5; const py = gy + 0.5;
        const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den; const l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den; const l3 = 1 - l1 - l2;
        if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
        const d = l1 * az + l2 * bz + l3 * cz;
        const cell = gy * cols + gx;
        if (d > z[cell]) { z[cell] = d; grid[cell] = sym; }
      }
    }
  }
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    const gy = rows - 1 - r;
    lines.push(grid.slice(gy * cols, gy * cols + cols).join('').replace(/ +$/, ''));
  }
  return lines;
}

function bounds(meshes: WorldMesh[]): Box {
  const min = [Infinity, Infinity, Infinity]; const max = [-Infinity, -Infinity, -Infinity];
  for (const m of meshes) { const b = meshBox(m); for (let k = 0; k < 3; k++) { if (b.min[k] < min[k]) min[k] = b.min[k]; if (b.max[k] > max[k]) max[k] = b.max[k]; } }
  return { min, max };
}

/** Measure a VALID spec (validateObjectSpec first): triangles, bounds, floating parts, animation reach, and three text views. */
export function measureObject(spec: ObjectSpec): ObjectReport {
  const warnings: string[] = [];
  const expanded = expandNodes(spec);
  const meshes = worldMeshes(spec);
  const box = bounds(meshes);
  const size: [number, number, number] = [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];
  const perMaterial: Record<string, number> = {};
  let triangles = 0; let degenerate = 0;
  for (const m of meshes) {
    const tris = m.index.length / 3;
    triangles += tris; perMaterial[m.material] = (perMaterial[m.material] ?? 0) + tris;
    const P = m.position;
    for (let i = 0; i < m.index.length; i += 3) {
      const a = m.index[i] * 3; const b = m.index[i + 1] * 3; const c = m.index[i + 2] * 3;
      const ux = P[b] - P[a]; const uy = P[b + 1] - P[a + 1]; const uz = P[b + 2] - P[a + 2]; const vx = P[c] - P[a]; const vy = P[c + 1] - P[a + 1]; const vz = P[c + 2] - P[a + 2];
      const area2 = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
      if (!(area2 > 1e-10)) degenerate++;
    }
  }
  const largest = Math.max(size[0], size[1], size[2]);
  if (largest < 0.02) warnings.push('the whole object is only ' + largest.toFixed(3) + ' m across: sizes are in METRES (a person is about 1.75)');
  if (largest > 1000) warnings.push('the object is ' + largest.toFixed(0) + ' m across: sizes are in METRES (a person is about 1.75)');
  if (Math.abs(box.min[1]) > 0.05) warnings.push('its lowest point is at y = ' + box.min[1].toFixed(2) + ': the object should STAND on y = 0 (move everything by ' + (-box.min[1]).toFixed(2) + ' in y), unless it is meant to fly');
  const cx = (box.min[0] + box.max[0]) / 2; const cz = (box.min[2] + box.max[2]) / 2;
  if (Math.abs(cx) > Math.max(0.25, size[0] * 0.25) || Math.abs(cz) > Math.max(0.25, size[2] * 0.25)) warnings.push('the object is centred at x = ' + cx.toFixed(2) + ', z = ' + cz.toFixed(2) + ': keep it centred on the origin so it can be placed and turned');
  if (degenerate > 0) warnings.push(degenerate + ' triangles have no area (two points on top of each other)');

  // Parts that float free of the rest: connected components of the part boxes, grown by 2 cm.
  const boxes = meshes.map(meshBox);
  const comp: number[] = boxes.map((_, i) => i);
  const find = (i: number): number => { while (comp[i] !== i) { comp[i] = comp[comp[i]]; i = comp[i]; } return i; };
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (overlap(boxes[i], boxes[j], 0.02)) comp[find(i)] = find(j);
  const groups = new Map<number, string[]>();
  meshes.forEach((m, i) => { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), m.name]); });
  if (groups.size > 1) {
    const sorted = [...groups.values()].sort((a, b) => b.length - a.length);
    warnings.push(sorted.length - 1 + ' group(s) of parts float free of the main body: ' + sorted.slice(1).map((g) => '[' + g.slice(0, 4).join(', ') + (g.length > 4 ? ', ...' : '') + ']').join(' ') + '. Move them so they touch (a position is the CENTRE of a shape, and the node tree is relative to the parent)');
  }

  // Animation: sample each clip across a few seconds and see how far the object reaches and whether it sinks through the floor.
  const clips: ObjectReport['clips'] = {};
  const clipNames = new Set<string>();
  for (const n of expanded) for (const c of Object.keys(n.clips)) clipNames.add(c);
  const rest = Math.hypot(size[0], size[1], size[2]);
  for (const clip of clipNames) {
    let minY = Infinity; let maxY = -Infinity; let reach = 0;
    for (let s = 0; s < 16; s++) {
      const b = bounds(worldMeshes(spec, clip, (s / 16) * 2));
      minY = Math.min(minY, b.min[1]); maxY = Math.max(maxY, b.max[1]);
      reach = Math.max(reach, Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]));
    }
    clips[clip] = { minY, maxY, reach };
    if (minY < box.min[1] - 0.25) warnings.push('clip ' + clip + ' pushes part of the object ' + (box.min[1] - minY).toFixed(2) + ' m below its base: lower an amplitude');
    if (reach > rest * 1.6) warnings.push('clip ' + clip + ' makes the object ' + (reach / rest).toFixed(1) + ' times bigger than at rest: an amplitude is too large (rotation is in DEGREES)');
  }

  const materialIndex = new Map<string, number>();
  Object.keys(spec.materials).forEach((k, i) => materialIndex.set(k, i));
  const views = {
    front: silhouette(meshes, materialIndex, 0, 1, 2, 1, 1, box.min, box.max),
    side: silhouette(meshes, materialIndex, 2, 1, 0, 1, -1, box.min, box.max),
    top: silhouette(meshes, materialIndex, 0, 2, 1, 1, 1, box.min, box.max),
  };
  const legend = Object.keys(spec.materials).map((k, i) => SYMBOLS[i % SYMBOLS.length] + ' ' + k).join('   ');
  return {
    id: spec.id, nodes: expanded.length, meshes: meshes.length, triangles,
    min: [box.min[0], box.min[1], box.min[2]], max: [box.max[0], box.max[1], box.max[2]], size, perMaterial, degenerateTriangles: degenerate,
    clips, warnings, views, legend,
  };
}

/** The report as text for the builder: numbers first, then the three drawings. */
export function formatReport(r: ObjectReport): string {
  const NL = String.fromCharCode(10);
  const f = (v: number): string => v.toFixed(2);
  const lines: string[] = [];
  lines.push(r.id + ': ' + r.triangles + ' triangles, ' + r.meshes + ' meshes in ' + r.nodes + ' nodes. Size ' + f(r.size[0]) + ' wide (x) by ' + f(r.size[1]) + ' high (y) by ' + f(r.size[2]) + ' deep (z) metres; base at y = ' + f(r.min[1]) + '.');
  const clipNames = Object.keys(r.clips);
  if (clipNames.length > 0) lines.push('Clips: ' + clipNames.join(', '));
  lines.push('Materials (triangles): ' + Object.entries(r.perMaterial).map(([k, v]) => k + ' ' + v).join(', '));
  lines.push('Symbols: ' + r.legend);
  lines.push('FRONT (looking at its face, +x to the right):'); lines.push(...r.views.front);
  lines.push('SIDE (its face is on the right):'); lines.push(...r.views.side);
  lines.push('TOP (its face is at the top, +x to the right):'); lines.push(...r.views.top);
  if (r.warnings.length > 0) { lines.push('WARNINGS (fix these, then call again):'); for (const w of r.warnings) lines.push('- ' + w); }
  return lines.join(NL);
}
`;
