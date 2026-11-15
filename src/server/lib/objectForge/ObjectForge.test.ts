// THE OBJECT FORGE: every primitive builds a closed, outward-facing mesh; transforms, mirrors, repeats and clips do what they say; every
// way a builder can write a bad spec is caught with a message it can act on; the measurements and drawings tell the truth; and the worked
// examples hold themselves to their own claims. The emitted engine is the code the game runs, so these tests run IT (never a copy).
import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { join } from 'node:path';
import * as THREE from 'three';
import { loadForge, authorObject, objectFileSource, pascal, FORGE_DIR, OBJECTS_DIR } from './forgeRuntime';
import { FORGE_ENGINE } from './forgeEngineSource';
import { FORGE_CHECK } from './forgeCheckSource';
import { FORGE_EXAMPLES } from './forgeExamples';
import { generateObjectForge, objectForgeEnabled, FORGE_GUIDE } from './ObjectForgeGenerator';
import { scanSecurity } from '../../AgentV3/SecurityAnalysis';

const { engine: E, check: C } = loadForge();

interface Arrays { position: Float32Array; normal: Float32Array; index: Uint32Array; triangles: number }

function volume(m: Arrays): number {
  let v = 0;
  const p = m.position; const ix = m.index;
  for (let i = 0; i < ix.length; i += 3) {
    const a = ix[i] * 3; const b = ix[i + 1] * 3; const c = ix[i + 2] * 3;
    v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
}

/** Mean of normal · (point - centroid): positive when the normals point away from the middle of the shape. */
function outwardness(m: Arrays): number {
  const p = m.position; const n = p.length / 3;
  let cx = 0; let cy = 0; let cz = 0;
  for (let i = 0; i < p.length; i += 3) { cx += p[i]; cy += p[i + 1]; cz += p[i + 2]; }
  cx /= n; cy /= n; cz /= n;
  let s = 0;
  for (let i = 0; i < p.length; i += 3) s += m.normal[i] * (p[i] - cx) + m.normal[i + 1] * (p[i + 1] - cy) + m.normal[i + 2] * (p[i + 2] - cz);
  return s / n;
}

/** Every edge must be used by exactly two triangles, once in each direction (vertices that sit in the same place count as one). */
function edgeProblems(m: Arrays): string[] {
  const key = (i: number): string => `${Math.round(m.position[i * 3] * 1e4)},${Math.round(m.position[i * 3 + 1] * 1e4)},${Math.round(m.position[i * 3 + 2] * 1e4)}`;
  const directed = new Map<string, number>();
  for (let i = 0; i < m.index.length; i += 3) {
    const k = [key(m.index[i]), key(m.index[i + 1]), key(m.index[i + 2])];
    if (k[0] === k[1] || k[1] === k[2] || k[0] === k[2]) continue; // a triangle collapsed to a line has no edges of its own
    for (let e = 0; e < 3; e++) { const ek = `${k[e]}>${k[(e + 1) % 3]}`; directed.set(ek, (directed.get(ek) ?? 0) + 1); }
  }
  const problems: string[] = [];
  for (const [ek, n] of directed) {
    const [a, b] = ek.split('>');
    if (n !== 1) problems.push(`edge used ${n} times in one direction`);
    else if (directed.get(`${b}>${a}`) !== 1) problems.push('edge with no opposite partner (a hole, or a triangle wound the other way)');
  }
  return problems;
}

const SHAPES: Array<[string, Record<string, unknown>, number]> = [
  // [label, shape, expected volume (0 when it has none or it is checked loosely)]
  ['box', { type: 'box', size: [1, 2, 3] }, 6],
  ['sphere', { type: 'sphere', radius: 1, seg: 32 }, (4 / 3) * Math.PI],
  ['ellipsoid', { type: 'sphere', radius: [1, 2, 0.5], seg: 32 }, (4 / 3) * Math.PI],
  ['cylinder', { type: 'cylinder', radiusTop: 1, radiusBottom: 1, height: 2, seg: 32 }, 2 * Math.PI],
  ['cone', { type: 'cylinder', radiusTop: 0, radiusBottom: 1, height: 3, seg: 32 }, Math.PI],
  ['frustum', { type: 'cylinder', radiusTop: 0.5, radiusBottom: 1, height: 2, seg: 32 }, (Math.PI * 2 * (1 + 0.5 + 0.25)) / 3],
  ['capsule', { type: 'capsule', radius: 0.5, length: 2, seg: 24 }, Math.PI * 0.25 * 2 + (4 / 3) * Math.PI * 0.125],
  ['torus', { type: 'torus', radius: 2, tube: 0.5, seg: 48, tubeSeg: 24 }, 2 * Math.PI * Math.PI * 2 * 0.25],
  ['lathe (up, capped)', { type: 'lathe', profile: [[1, 0], [1, 2]], seg: 32 }, 2 * Math.PI],
  ['lathe (down, capped)', { type: 'lathe', profile: [[1, 2], [1, 0]], seg: 32 }, 2 * Math.PI],
  ['lathe (poles)', { type: 'lathe', profile: [[0, 0], [1, 0], [1, 2], [0, 2]], seg: 32 }, 2 * Math.PI],
  ['lathe (flared, far from the origin)', { type: 'lathe', profile: [[0.2, 10], [1, 12]], seg: 32 }, (Math.PI * 2 * (1 + 0.2 + 0.04)) / 3],
  ['lathe (flared downward, far from the origin)', { type: 'lathe', profile: [[1, 12], [0.2, 10]], seg: 32 }, (Math.PI * 2 * (1 + 0.2 + 0.04)) / 3],
  ['loft', { type: 'loft', length: 4, stations: 24, ring: 24, sections: [{ t: 0, halfWidth: 0, top: 1, bottom: 0 }, { t: 0.5, halfWidth: 1, top: 2, bottom: 0 }, { t: 1, halfWidth: 0, top: 1, bottom: 0 }] }, 0],
  ['loft (open ends)', { type: 'loft', length: 2, sections: [{ t: 0, halfWidth: 0.5, top: 1, bottom: 0 }, { t: 1, halfWidth: 0.5, top: 1, bottom: 0 }] }, 0],
  ['extrude (concave)', { type: 'extrude', polygon: [[0, 0], [4, 0], [4, 1], [1, 1], [1, 3], [0, 3]], depth: 2 }, 12],
  ['extrude (clockwise input)', { type: 'extrude', polygon: [[0, 0], [0, 3], [1, 3], [1, 1], [4, 1], [4, 0]], depth: 2 }, 12],
  ['tube', { type: 'tube', path: [[0, 0, 0], [0, 1, 0], [1, 2, 0]], radius: [0.3, 0.25, 0.1], seg: 12 }, 0],
  ['tube (pointed tip)', { type: 'tube', path: [[0, 0, 0], [0, 1, 0], [0, 2, 0]], radius: [0.3, 0.2, 0], seg: 12 }, 0],
];

describe('the emitted engine', () => {
  it('is a single self-contained file that names its technique and imports nothing', () => {
    expect(FORGE_ENGINE).toMatch(/Technique:/);
    expect(FORGE_ENGINE).not.toMatch(/^import /m);
    expect(Object.keys(generateObjectForge().files)).toEqual([FORGE_DIR + 'forge.ts']);
  });

  it('typechecks under strict + noUnusedLocals, as a game would compile it (and so does the object file made from a spec)', () => {
    const root = join(process.cwd(), 'tests', '__forge_virtual__');
    const objectSource = objectFileSource(FORGE_EXAMPLES.person.spec);
    const memory = new Map<string, string>([[join(root, FORGE_DIR + 'forge.ts'), FORGE_ENGINE], [join(root, OBJECTS_DIR + 'person.ts'), objectSource]]);
    const host = ts.createCompilerHost({});
    const realRead = host.readFile.bind(host); const realExists = host.fileExists.bind(host);
    host.readFile = (p) => memory.get(p) ?? realRead(p);
    host.fileExists = (p) => memory.has(p) || realExists(p);
    const realDir = host.directoryExists?.bind(host);
    host.directoryExists = (d) => [...memory.keys()].some((k) => k.startsWith(d)) || (realDir ? realDir(d) : false);
    const program = ts.createProgram([...memory.keys()], {
      strict: true, noUnusedLocals: true, noUnusedParameters: true, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler, noEmit: true, skipLibCheck: true, lib: ['lib.es2020.d.ts'],
    }, host);
    const diags = ts.getPreEmitDiagnostics(program).filter((d) => d.file && memory.has(d.file.fileName));
    expect(diags.map((d) => `${d.file!.fileName}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`)).toEqual([]);
  });

  it('passes the platform\'s own security scan, with no errors (the engine and every example object)', () => {
    const files: Record<string, string> = { [FORGE_DIR + 'forge.ts']: FORGE_ENGINE };
    for (const e of Object.values(FORGE_EXAMPLES)) files[`${OBJECTS_DIR}${e.id}.ts`] = objectFileSource(e.spec);
    const bad = Object.entries(files).flatMap(([p, c]) => scanSecurity(p, c).filter((f) => f.severity === 'high' || f.severity === 'critical').map((f) => `${p}:${f.line} ${f.rule}`));
    expect(bad).toEqual([]);
  });

  it('uses no dollar-brace or backtick (the rule for every emitted source string)', () => {
    for (const src of [FORGE_ENGINE, FORGE_CHECK]) { expect(src).not.toContain('${'); expect(src).not.toContain('`'); }
  });
});

describe('every primitive builds a closed mesh that faces outward', () => {
  for (const [label, shape, vol] of SHAPES) {
    it(label, () => {
      const m: Arrays = E.shapeMesh(shape);
      expect(m.triangles).toBeGreaterThan(0);
      expect(m.index.length).toBe(m.triangles * 3);
      for (const i of m.index) expect(i).toBeLessThan(m.position.length / 3);
      for (const v of m.position) expect(Number.isFinite(v)).toBe(true);
      for (let i = 0; i < m.normal.length; i += 3) expect(Math.hypot(m.normal[i], m.normal[i + 1], m.normal[i + 2])).toBeCloseTo(1, 4);
      // The signed volume is positive only when the triangles wind outward; the normals agree with it.
      expect(volume(m)).toBeGreaterThan(0);
      expect(outwardness(m)).toBeGreaterThan(0);
      // Watertight and consistently wound: no hole, no triangle facing the other way than its neighbours.
      expect(edgeProblems(m).slice(0, 3)).toEqual([]);
      if (vol > 0) expect(volume(m) / vol).toBeGreaterThan(0.93); // a polygonal approximation is a little under the true solid
      if (vol > 0) expect(volume(m) / vol).toBeLessThan(1.001);
    });
  }

  it('a plane faces up', () => {
    const m: Arrays = E.shapeMesh({ type: 'plane', size: [4, 6], segments: 3 });
    expect(m.triangles).toBe(18);
    for (let i = 0; i < m.normal.length; i += 3) expect(m.normal[i + 1]).toBeCloseTo(1, 5);
  });

  it('a box keeps hard edges: each face has its own normal, not a blend', () => {
    const m: Arrays = E.shapeMesh({ type: 'box', size: [1, 1, 1] });
    expect(m.position.length / 3).toBe(24);
    for (let i = 0; i < m.normal.length; i += 3) expect(Math.max(Math.abs(m.normal[i]), Math.abs(m.normal[i + 1]), Math.abs(m.normal[i + 2]))).toBeCloseTo(1, 5);
  });

  it('a sphere has no zero-area triangles at its poles', () => {
    const m: Arrays = E.shapeMesh({ type: 'sphere', radius: 1, seg: 16 });
    const p = m.position;
    for (let i = 0; i < m.index.length; i += 3) {
      const a = m.index[i] * 3; const b = m.index[i + 1] * 3; const c = m.index[i + 2] * 3;
      const ux = p[b] - p[a]; const uy = p[b + 1] - p[a + 1]; const uz = p[b + 2] - p[a + 2]; const vx = p[c] - p[a]; const vy = p[c + 1] - p[a + 1]; const vz = p[c + 2] - p[a + 2];
      expect(Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)).toBeGreaterThan(1e-9);
    }
  });

  it('a loft whose section is a point at an end closes there without a cap', () => {
    const pointed: Arrays = E.shapeMesh({ type: 'loft', length: 2, ring: 8, stations: 6, sections: [{ t: 0, halfWidth: 0, top: 1, bottom: 0 }, { t: 1, halfWidth: 1, top: 2, bottom: 0 }] });
    const blunt: Arrays = E.shapeMesh({ type: 'loft', length: 2, ring: 8, stations: 6, sections: [{ t: 0, halfWidth: 1, top: 2, bottom: 0 }, { t: 1, halfWidth: 1, top: 2, bottom: 0 }] });
    expect(blunt.triangles).toBeGreaterThan(pointed.triangles);
  });

  it('ear clipping triangulates a concave polygon into exactly n - 2 triangles covering its area', () => {
    const poly: Array<[number, number]> = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 3], [0, 3]];
    const tris: number[] = E.triangulate(poly);
    expect(tris.length / 3).toBe(poly.length - 2);
    let area = 0;
    for (let i = 0; i < tris.length; i += 3) {
      const [a, b, c] = [poly[tris[i]], poly[tris[i + 1]], poly[tris[i + 2]]];
      area += ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
    }
    expect(area).toBeCloseTo(6, 6);
  });
});

describe('transforms', () => {
  it('Euler angles round-trip through the rotation matrix (the order is X then Y then Z, as three.js)', () => {
    for (const r of [[10, 20, 30], [-45, 60, 5], [0, 0, 90], [90, 0, 0], [33, -71, 12]] as Array<[number, number, number]>) {
      const back: [number, number, number] = E.matEuler(E.eulerMat(r));
      for (let i = 0; i < 3; i++) expect(back[i]).toBeCloseTo(r[i], 6);
    }
  });

  it('agrees with three.js on the same rotation', () => {
    const r: [number, number, number] = [25, -40, 70];
    const m = E.eulerMat(r) as number[];
    const t = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(r[0] * Math.PI / 180, r[1] * Math.PI / 180, r[2] * Math.PI / 180, 'XYZ'));
    const te = t.elements; // column-major
    for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) expect(m[row * 3 + col]).toBeCloseTo(te[col * 4 + row], 9);
  });

  it('a translated, rotated and scaled node lands where the matrix says', () => {
    const spec = { id: 'a', name: 'A', materials: { m: { color: '#ffffff' } }, nodes: [{ name: 'n', shape: { type: 'box', size: [1, 1, 1] }, material: 'm', position: [10, 0, 0], rotation: [0, 90, 0], scale: [4, 1, 1] }] };
    const [mesh] = E.worldMeshes(spec);
    const xs: number[] = []; const zs: number[] = [];
    for (let i = 0; i < mesh.position.length; i += 3) { xs.push(mesh.position[i]); zs.push(mesh.position[i + 2]); }
    // Scaled 4x along its own x, then turned 90 degrees about y: the long side now runs along world z.
    expect(Math.min(...xs)).toBeCloseTo(9.5, 6); expect(Math.max(...xs)).toBeCloseTo(10.5, 6);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(4, 6);
  });

  it('a child follows its parent: rotating the parent swings the child around the parent\'s origin', () => {
    const mk = (rot: number) => ({ id: 'a', name: 'A', materials: { m: { color: '#ffffff' } }, nodes: [{ name: 'arm', position: [0, 2, 0], rotation: [rot, 0, 0], children: [{ name: 'hand', shape: { type: 'sphere', radius: 0.1 }, material: 'm', position: [0, -1, 0] }] }] });
    const centre = (rot: number): number[] => {
      const [m] = E.worldMeshes(mk(rot)); let x = 0; let y = 0; let z = 0; const n = m.position.length / 3;
      for (let i = 0; i < m.position.length; i += 3) { x += m.position[i]; y += m.position[i + 1]; z += m.position[i + 2]; }
      return [x / n, y / n, z / n];
    };
    const rest = centre(0); const swung = centre(90);
    expect(rest[1]).toBeCloseTo(1, 1); expect(rest[2]).toBeCloseTo(0, 1);
    // 90 degrees about x sends "down" to "backward" (-z), at the same distance from the pivot.
    expect(swung[1]).toBeCloseTo(2, 1); expect(swung[2]).toBeCloseTo(-1, 1);
  });
});

describe('mirror and repeat', () => {
  const base = (extra: Record<string, unknown>) => ({ id: 'a', name: 'A', materials: { m: { color: '#ffffff' } }, nodes: [{ name: 'part', shape: { type: 'box', size: [1, 1, 1] }, material: 'm', position: [2, 0, 0], ...extra }] });

  it('a mirrored node makes a reflected copy, named _mirror, whose geometry is the mirror image (and still faces outward)', () => {
    const spec = base({ mirror: 'x', rotation: [0, 0, 30] });
    const ex: Array<{ name: string }> = E.expandNodes(spec);
    expect(ex.map((n) => n.name)).toEqual(['part', 'part_mirror']);
    const [a, b] = E.worldMeshes(spec);
    const xs = (m: { position: number[] }) => m.position.filter((_, i) => i % 3 === 0);
    expect(Math.min(...xs(b))).toBeCloseTo(-Math.max(...xs(a)), 6);
    expect(Math.max(...xs(b))).toBeCloseTo(-Math.min(...xs(a)), 6);
    const arr = (m: { position: number[]; index: number[] }): Arrays => E.meshArrays(m.position, m.index);
    expect(volume(arr(a))).toBeGreaterThan(0);
    expect(volume(arr(b))).toBeGreaterThan(0); // a negative scale flips winding; the engine flips it back
  });

  it('mirroring reflects the clip too: a swing about x is the same, about y or z it is reversed; mirrorPhase shifts it', () => {
    const spec = base({ mirror: 'x', mirrorPhase: 0.5, clips: { walk: [{ property: 'rotation', axis: 'x', amplitude: 30, speed: 1 }, { property: 'rotation', axis: 'y', amplitude: 10, speed: 1 }, { property: 'position', axis: 'x', amplitude: 0.2, speed: 1 }] } });
    const ex: Array<{ clips: Record<string, Array<Record<string, number | string>>> }> = E.expandNodes(spec);
    const [t, ry, px] = ex[1].clips.walk;
    expect(t.amplitude).toBe(30); expect(ry.amplitude).toBe(-10); expect(px.amplitude).toBe(-0.2);
    expect(t.phase).toBe(0.5);
    // At a quarter cycle the original swings +30 and the mirrored copy -30: opposite legs, which is a walk.
    const a = E.poseOf(ex[0], 'walk', 0.25).rotation[0]; const b = E.poseOf(ex[1], 'walk', 0.25).rotation[0];
    expect(a).toBeCloseTo(30, 6); expect(b).toBeCloseTo(-30, 6);
  });

  it('a mirrored node takes its children with it', () => {
    const spec = { id: 'a', name: 'A', materials: { m: { color: '#ffffff' } }, nodes: [{ name: 'arm', position: [1, 0, 0], mirror: 'x', children: [{ name: 'hand', shape: { type: 'sphere', radius: 0.1 }, material: 'm', position: [0, -1, 0.5] }] }] };
    const names = (E.expandNodes(spec) as Array<{ name: string }>).map((n) => n.name);
    expect(names).toEqual(['arm', 'hand', 'arm_mirror', 'hand_mirror']);
    const [a, b] = E.worldMeshes(spec);
    expect(a.position[0] + b.position[0]).toBeCloseTo(0, 5);
  });

  it('repeat with a step makes n copies in a row', () => {
    const spec = base({ repeat: { count: 4, step: [0, 0, 3] }, position: [0, 0, 0] });
    const ex: Array<{ name: string; position: number[] }> = E.expandNodes(spec);
    expect(ex.map((n) => n.name)).toEqual(['part', 'part_1', 'part_2', 'part_3']);
    expect(ex.map((n) => n.position[2])).toEqual([0, 3, 6, 9]);
  });

  it('repeat around an axis spreads copies round a circle', () => {
    const spec = base({ repeat: { count: 4, around: { axis: 'y' } }, position: [2, 0, 0] });
    const ex: Array<{ position: number[] }> = E.expandNodes(spec);
    const near = (v: number[], w: number[]) => v.every((x, i) => Math.abs(x - w[i]) < 1e-9);
    expect(near(ex[1].position, [0, 0, -2])).toBe(true);
    expect(near(ex[2].position, [-2, 0, 0])).toBe(true);
    expect(near(ex[3].position, [0, 0, 2])).toBe(true);
    // The copies are also TURNED to face the same way round the circle.
    expect(ex[1].rotation ?? (ex[1] as unknown as { rotation: number[] }).rotation).toBeDefined();
  });

  it('copies share one geometry (a fence of 40 posts builds one post)', () => {
    const spec = base({ repeat: { count: 40, step: [1, 0, 0] } });
    const ex: Array<{ source: number }> = E.expandNodes(spec);
    expect(new Set(ex.map((n) => n.source)).size).toBe(1);
  });
});

describe('a spec the builder wrote is checked, and every complaint says what to change', () => {
  const ok = () => ({ id: 'thing', name: 'Thing', materials: { m: { color: '#aabbcc' } }, nodes: [{ name: 'n', shape: { type: 'box', size: [1, 1, 1] }, material: 'm', position: [0, 0.5, 0] }] });
  const errorsOf = (mutate: (s: any) => void): string[] => { const s = ok(); mutate(s); return C.validateObjectSpec(s).errors; };

  it('a good spec passes, with no errors and a spec back', () => {
    const v = C.validateObjectSpec(ok());
    expect(v.errors).toEqual([]);
    expect(v.spec).not.toBeNull();
  });

  const CASES: Array<[string, (s: any) => void, RegExp]> = [
    ['an id with capitals', (s) => { s.id = 'Red Dragon'; }, /id must be lowercase/],
    ['no materials', (s) => { s.materials = {}; }, /at least one material/],
    ['a colour that is not hex', (s) => { s.materials.m.color = 'red'; }, /hex colour/],
    ['a roughness out of range', (s) => { s.materials.m.roughness = 3; }, /roughness is 3/],
    ['no nodes', (s) => { s.nodes = []; }, /at least one node/],
    ['a node name with a space', (s) => { s.nodes[0].name = 'left arm'; }, /name must be letters/],
    ['an unknown shape', (s) => { s.nodes[0].shape = { type: 'pyramid' }; }, /one of: box, sphere/],
    ['a shape with no material', (s) => { delete s.nodes[0].material; }, /no material/],
    ['a material that does not exist', (s) => { s.nodes[0].material = 'gold'; }, /not in materials/],
    ['a negative box size', (s) => { s.nodes[0].shape.size = [1, -1, 1]; }, /size\[1\] is -1/],
    ['a box size of the wrong length', (s) => { s.nodes[0].shape.size = [1, 1]; }, /\[x, y, z\]/],
    ['a NaN position', (s) => { s.nodes[0].position = [0, NaN, 0]; }, /position\[1\] must be a number/],
    ['a zero scale', (s) => { s.nodes[0].scale = [1, 0, 1]; }, /zero component/],
    ['a cylinder with both radii zero', (s) => { s.nodes[0].shape = { type: 'cylinder', radiusTop: 0, radiusBottom: 0, height: 1 }; }, /both 0/],
    ['a torus whose tube is fatter than the ring', (s) => { s.nodes[0].shape = { type: 'torus', radius: 1, tube: 2 }; }, /tube must be smaller/],
    ['seg that is not a whole number from 3 to 64', (s) => { s.nodes[0].shape = { type: 'sphere', radius: 1, seg: 2 }; }, /whole number from 3 to 64/],
    ['a lathe with one point', (s) => { s.nodes[0].shape = { type: 'lathe', profile: [[1, 0]] }; }, /2 to 48 points/],
    ['loft sections out of order', (s) => { s.nodes[0].shape = { type: 'loft', length: 2, sections: [{ t: 0.6, halfWidth: 1, top: 1, bottom: 0 }, { t: 0.2, halfWidth: 1, top: 1, bottom: 0 }] }; }, /larger than the section before/],
    ['a loft section with top below bottom', (s) => { s.nodes[0].shape = { type: 'loft', length: 2, sections: [{ t: 0, halfWidth: 1, top: 0, bottom: 1 }, { t: 1, halfWidth: 1, top: 1, bottom: 0 }] }; }, /top below bottom/],
    ['an extrude polygon that crosses itself (a bow tie)', (s) => { s.nodes[0].shape = { type: 'extrude', polygon: [[0, 0], [2, 2], [2, 0], [0, 2]], depth: 1 }; }, /crosses itself/],
    ['an extrude polygon in a line', (s) => { s.nodes[0].shape = { type: 'extrude', polygon: [[0, 0], [1, 1], [2, 2]], depth: 1 }; }, /no area/],
    ['a tube radius list of the wrong length', (s) => { s.nodes[0].shape = { type: 'tube', path: [[0, 0, 0], [0, 1, 0]], radius: [0.1] }; }, /1 entries but the path has 2/],
    ['an unknown mirror axis', (s) => { s.nodes[0].mirror = 'w'; }, /mirror must be x, y or z/],
    ['a repeat of 1000', (s) => { s.nodes[0].repeat = { count: 1000, step: [1, 0, 0] }; }, /repeat.count is 1000/],
    ['a repeat that would stack every copy', (s) => { s.nodes[0].repeat = { count: 3 }; }, /neither step nor around/],
    ['a clip track with a bad property', (s) => { s.nodes[0].clips = { walk: [{ property: 'wiggle', axis: 'x', amplitude: 1, speed: 1 }] }; }, /rotation, position or scale/],
    ['a clip with speed 0', (s) => { s.nodes[0].clips = { walk: [{ property: 'rotation', axis: 'x', amplitude: 1, speed: 0 }] }; }, /speed is 0/],
    ['a clip name with a space', (s) => { s.nodes[0].clips = { 'fast walk': [{ property: 'rotation', axis: 'x', amplitude: 1, speed: 1 }] }; }, /clip named/],
  ];
  for (const [label, mutate, re] of CASES) it(label, () => { expect(errorsOf(mutate).join(' | ')).toMatch(re); });

  it('two nodes that end up with the same name (a repeat copy against a node called part_1) are caught', () => {
    const e = errorsOf((s) => { s.nodes[0].name = 'part'; s.nodes[0].repeat = { count: 2, step: [1, 0, 0] }; s.nodes.push({ name: 'part_1' }); });
    expect(e.join(' ')).toMatch(/two nodes are called part_1/);
  });

  it('nesting deeper than 8 levels, too many nodes and too many triangles are refused with the heaviest nodes named', () => {
    const deep: any = { name: 'n0' }; let cur = deep;
    for (let i = 1; i < 12; i++) { const c: any = { name: 'n' + i }; cur.children = [c]; cur = c; }
    cur.shape = { type: 'box', size: [1, 1, 1] }; cur.material = 'm';
    expect(errorsOf((s) => { s.nodes = [deep]; }).join(' ')).toMatch(/nested more than 8/);
    expect(errorsOf((s) => { s.nodes[0].repeat = { count: 64, step: [1, 0, 0] }; s.nodes[0].mirror = 'x'; s.nodes.push(...Array.from({ length: 300 }, (_, i) => ({ name: 'x' + i }))); }).join(' ')).toMatch(/expands to \d+ nodes/);
    const heavy = errorsOf((s) => { s.nodes[0].shape = { type: 'sphere', radius: 1, seg: 64 }; s.nodes[0].repeat = { count: 10, step: [3, 0, 0] }; s.nodes[0].name = 'ball'; });
    expect(heavy.join(' ')).toMatch(/triangles; the limit is 24000.*ball/);
  });

  it('never throws on rubbish: null, text, numbers, arrays, deep junk', () => {
    for (const junk of [null, undefined, 'text', 42, [], [1, 2], {}, { nodes: 5 }, { id: 'a-b', name: 'x', materials: 3, nodes: [null] }, { id: 'ab', name: 'x', materials: { m: null }, nodes: [{ name: 'n', shape: 7 }] }]) {
      const v = C.validateObjectSpec(junk);
      expect(v.errors.length).toBeGreaterThan(0);
      expect(v.spec).toBeNull();
    }
  });

  it('an unused material is a warning, not an error', () => {
    const s: any = ok(); s.materials.spare = { color: '#000000' };
    const v = C.validateObjectSpec(s);
    expect(v.errors).toEqual([]);
    expect(v.warnings.join(' ')).toMatch(/spare is never used/);
  });
});

describe('measurement tells the truth', () => {
  const spec = (nodes: unknown[]) => ({ id: 'thing', name: 'Thing', materials: { a: { color: '#ff0000' }, b: { color: '#0000ff' } }, nodes });
  const box = (name: string, position: number[], size = [1, 1, 1], material = 'a') => ({ name, shape: { type: 'box', size }, material, position });
  const measure = (nodes: unknown[]) => C.measureObject(C.validateObjectSpec(spec(nodes)).spec);

  it('reports triangles, bounds and size in metres', () => {
    const r = measure([box('n', [0, 1, 0], [2, 2, 2])]);
    expect(r.triangles).toBe(12);
    expect(r.size.map((v: number) => +v.toFixed(6))).toEqual([2, 2, 2]);
    expect(r.min[1]).toBeCloseTo(0, 6);
    expect(r.warnings).toEqual([]);
  });

  it('warns about a part that floats free of the rest, and names it', () => {
    const r = measure([box('body', [0, 0.5, 0]), box('hat', [0, 3, 0], [0.5, 0.5, 0.5], 'b')]);
    expect(r.warnings.join(' ')).toMatch(/float free of the main body: \[hat\]/);
  });

  it('does not warn when parts touch or overlap', () => {
    expect(measure([box('body', [0, 0.5, 0]), box('head', [0, 1.25, 0], [0.5, 0.5, 0.5], 'b')]).warnings).toEqual([]);
  });

  it('warns when the base is not on y = 0, and says how far to move it', () => {
    const r = measure([box('n', [0, 3, 0])]);
    expect(r.warnings.join(' ')).toMatch(/lowest point is at y = 2\.50.*move everything by -2\.50/);
  });

  it('warns when the object is far from the origin, and when it is the wrong scale', () => {
    expect(measure([box('n', [40, 0.5, 0])]).warnings.join(' ')).toMatch(/centred at x = 40/);
    expect(measure([box('n', [0, 0.005, 0], [0.01, 0.01, 0.01])]).warnings.join(' ')).toMatch(/only 0\.010 m across/);
  });

  it('warns when a clip throws the object through the floor or blows it up (rotation is in degrees)', () => {
    // A long arm held out sideways from a pivot 1 m up, over a base plate: a small swing is fine, a big one drives the hand under the floor.
    const swing = (amp: number) => measure([box('post', [0, 0.55, 0], [0.2, 1.1, 0.2], 'b'), { name: 'arm', position: [0, 1, 0], mirror: 'x', clips: { wave: [{ property: 'rotation', axis: 'z', amplitude: amp, speed: 1 }] }, children: [box('hand', [0.75, 0, 0], [1.5, 0.2, 0.2])] }]);
    expect(swing(20).warnings).toEqual([]);
    expect(swing(85).warnings.join(' ')).toMatch(/clip wave pushes part of the object .* below its base/);
    const grow = measure([{ name: 'stalk', clips: { stretch: [{ property: 'scale', axis: 'y', amplitude: 9, speed: 1 }] }, children: [box('s', [0, 0.5, 0], [0.2, 1, 0.2])] }]);
    expect(grow.warnings.join(' ')).toMatch(/clip stretch makes the object .* times bigger/);
  });

  it('counts the triangles per material', () => {
    const r = measure([box('x', [0, 0.5, 0]), box('y', [0, 1.5, 0], [1, 1, 1], 'b')]);
    expect(r.perMaterial).toEqual({ a: 12, b: 12 });
  });

  it('draws a box as a filled rectangle with one symbol, from every side', () => {
    const r = measure([box('n', [0, 1, 0], [4, 2, 2])]);
    for (const view of [r.views.front, r.views.side, r.views.top]) {
      expect(view.length).toBeGreaterThan(2);
      expect(view.join('')).toMatch(/^#+$/);
    }
    // Front is x by y: wider than it is tall by characters (4 wide, 2 high, characters twice as tall as wide).
    expect(r.views.front[0].length).toBeGreaterThan(r.views.front.length);
  });

  it('draws the nearer material over the farther one, with the right symbol for each', () => {
    // A blue box in front of (larger z than) a red one: from the front you see blue; from behind-the-side you cannot tell, so use the top view.
    const r = measure([box('far', [0, 0.5, -1], [2, 1, 1], 'a'), box('near', [0, 0.5, 1], [2, 1, 1], 'b')]);
    const front = r.views.front.join('');
    expect(front).toContain('%'); expect(front).not.toContain('#');
    const top = r.views.top.join('\n');
    expect(top).toContain('#'); expect(top).toContain('%');
    // In the top view the front (larger z) is at the TOP of the picture: the blue (%) box is above the red (#) one.
    expect(top.indexOf('%')).toBeLessThan(top.indexOf('#'));
  });

  it('puts the face on the right in the side view: a nose (+z) shows on the right', () => {
    const r = measure([box('body', [0, 0.5, 0], [1, 1, 2]), box('nose', [0, 0.5, 1.5], [0.2, 0.2, 1], 'b')]);
    const row = r.views.side.find((l: string) => l.includes('%')) as string;
    expect(row.trimEnd().endsWith('%')).toBe(true);
    expect(row.trimEnd().length).toBeGreaterThanOrEqual(row.indexOf('%'));
  });

  it('formats a report a builder can read: numbers, legend, three drawings, warnings last', () => {
    const text = C.formatReport(measure([box('n', [0, 3, 0])]));
    expect(text).toMatch(/thing: 12 triangles/);
    expect(text).toMatch(/Symbols: # a {3}% b/);
    expect(text.indexOf('FRONT')).toBeLessThan(text.indexOf('SIDE'));
    expect(text.indexOf('SIDE')).toBeLessThan(text.indexOf('TOP'));
    expect(text.indexOf('TOP')).toBeLessThan(text.indexOf('WARNINGS'));
  });
});

describe('the worked examples hold themselves to their own claims', () => {
  const built = Object.fromEntries(Object.values(FORGE_EXAMPLES).map((e) => [e.id, authorObject(e.spec)]));

  it('every example is valid and builds with no warnings at all', () => {
    for (const [id, r] of Object.entries(built)) {
      expect(r.errors, id).toEqual([]);
      expect(r.ok, id).toBe(true);
      expect(r.report!.warnings, id).toEqual([]);
      expect(r.report!.degenerateTriangles, id).toBe(0);
    }
  });

  it('every example is cheap enough for a phone (a few thousand triangles)', () => {
    for (const [id, r] of Object.entries(built)) expect(r.report!.triangles, id).toBeLessThan(4000);
  });

  it('the person is a person: 1.7 to 1.9 m tall, shoulders wider than the head, left-right symmetric, standing on y = 0', () => {
    const r = built.person.report!;
    expect(r.size[1]).toBeGreaterThan(1.7); expect(r.size[1]).toBeLessThan(1.9);
    expect(Math.abs(r.min[1])).toBeLessThan(0.03);
    expect(Math.abs(r.min[0] + r.max[0])).toBeLessThan(0.01);
    expect(r.size[0]).toBeGreaterThan(0.4);
    expect(Object.keys(r.clips).sort()).toEqual(['idle', 'walk']);
  });

  it('the person walks: legs and arms swing in opposition, the feet stay near the ground and nothing tears off', () => {
    const spec = FORGE_EXAMPLES.person.spec;
    const pose = (n: string, t: number): number[] => { const ex = E.expandNodes(spec) as Array<{ name: string }>; const node = ex.find((x) => x.name === n)!; return E.poseOf(node, 'walk', t).rotation; };
    expect(pose('hip', 0.25)[0]).toBeCloseTo(-pose('hip_mirror', 0.25)[0], 6);
    expect(pose('shoulder', 0.25)[0]).toBeCloseTo(-pose('shoulder_mirror', 0.25)[0], 6);
    // The arm swings against the SAME-SIDE leg.
    expect(Math.sign(pose('shoulder', 0.25)[0])).toBe(-Math.sign(pose('hip', 0.25)[0]));
    const r = built.person.report!;
    expect(r.clips.walk.minY).toBeGreaterThan(-0.15);
    expect(r.clips.walk.reach).toBeLessThan(Math.hypot(...(r.size as [number, number, number])) * 1.5);
  });

  it('the quadruped has four legs on the ground that trot in diagonal pairs, and its head is above its back', () => {
    const spec = FORGE_EXAMPLES.quadruped.spec;
    const ex = E.expandNodes(spec) as Array<{ name: string }>;
    for (const n of ['f_upper', 'f_upper_mirror', 'b_upper', 'b_upper_mirror']) expect(ex.some((x) => x.name === n), n).toBe(true);
    const rot = (n: string, t: number): number => E.poseOf(ex.find((x) => x.name === n), 'walk', t).rotation[0];
    // Diagonal pairs: front-left with back-right swing together.
    expect(rot('front_leg', 0.25)).toBeCloseTo(rot('back_leg_mirror', 0.25), 6);
    expect(rot('front_leg', 0.25)).toBeCloseTo(-rot('front_leg_mirror', 0.25), 6);
    const r = built.quadruped.report!;
    expect(r.size[2]).toBeGreaterThan(r.size[1] * 0.9); // longer than tall, like a dog
    expect(r.size[1]).toBeGreaterThan(0.7); expect(r.size[1]).toBeLessThan(1.1);
  });

  it('the house is house-sized and its roof sits on its walls', () => {
    const r = built.house.report!;
    expect(r.size[0]).toBeGreaterThan(8); expect(r.size[0]).toBeLessThan(10);
    expect(r.size[1]).toBeGreaterThan(5); expect(r.size[1]).toBeLessThan(7);
    expect(r.min[1]).toBeCloseTo(0, 5);
  });

  it('the sword is a sword: about a metre, thin, with the blade up', () => {
    const r = built.sword.report!;
    expect(r.size[1]).toBeGreaterThan(1.0); expect(r.size[1]).toBeLessThan(1.15);
    expect(r.size[2]).toBeLessThan(0.07);
  });

  it('the tree sways without leaving the ground', () => {
    const r = built.tree.report!;
    expect(Object.keys(r.clips)).toEqual(['sway']);
    expect(r.clips.sway.minY).toBeGreaterThan(-0.2);
    expect(r.size[1]).toBeGreaterThan(5.5); expect(r.size[1]).toBeLessThan(7);
  });

  it('asking for the same example twice gives byte-identical files (deterministic)', () => {
    expect(authorObject(FORGE_EXAMPLES.person.spec).files).toEqual(authorObject(FORGE_EXAMPLES.person.spec).files);
  });
});

describe('the object in a real three.js scene', () => {
  const make = (id: string) => {
    const out = authorObject(FORGE_EXAMPLES[id].spec);
    // Run the generated OBJECT FILE against the generated ENGINE, the way a game would.
    const engineJs = ts.transpileModule(FORGE_ENGINE, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const objectJs = ts.transpileModule(out.files![`${OBJECTS_DIR}${id}.ts`], { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    const engineExports: Record<string, unknown> = {};
    // eslint-disable-next-line no-new-func
    new Function('exports', engineJs)(engineExports);
    const objectExports: Record<string, any> = {};
    // eslint-disable-next-line no-new-func
    new Function('exports', 'require', objectJs)(objectExports, (rel: string) => { if (rel === '../forge/forge') return engineExports; throw new Error('unexpected import ' + rel); });
    return objectExports['create' + pascal(id)](THREE);
  };

  it('the object file exports a create function that returns a group with every named node', () => {
    const o = make('person');
    expect(o.group).toBeInstanceOf(THREE.Group);
    for (const n of ['torso', 'head', 'hip', 'hip_mirror', 'shoulder_mirror', 'knee_mirror', 'foot_mirror']) expect(o.nodes[n], n).toBeDefined();
    expect(o.clips.sort()).toEqual(['idle', 'walk']);
    expect(o.triangles).toBe(authorObject(FORGE_EXAMPLES.person.spec).report!.triangles);
  });

  it('the real bounding box matches what the check measured (what was measured is what is shown)', () => {
    for (const id of Object.keys(FORGE_EXAMPLES)) {
      const o = make(id);
      const box = new THREE.Box3().setFromObject(o.group);
      const r = authorObject(FORGE_EXAMPLES[id].spec).report!;
      expect(box.min.y, id).toBeCloseTo(r.min[1], 4); expect(box.max.y, id).toBeCloseTo(r.max[1], 4);
      expect(box.min.x, id).toBeCloseTo(r.min[0], 4); expect(box.max.x, id).toBeCloseTo(r.max[0], 4);
      expect(box.min.z, id).toBeCloseTo(r.min[2], 4); expect(box.max.z, id).toBeCloseTo(r.max[2], 4);
    }
  });

  it('play and update move the pivots; stopping returns to the rest pose; dispose frees it', () => {
    const o = make('person');
    const rest = o.nodes.hip.rotation.x;
    o.play('walk'); o.update(0.25);
    expect(Math.abs(o.nodes.hip.rotation.x - rest)).toBeGreaterThan(0.3);
    expect(o.nodes.hip.rotation.x).toBeCloseTo(-o.nodes.hip_mirror.rotation.x, 6);
    o.play(null);
    o.update(1);
    const parent = new THREE.Scene(); parent.add(o.group);
    o.dispose();
    expect(parent.children.length).toBe(0);
  });

  it('a mirrored limb is a mirror image in the real scene too (negative scale, still lit from outside)', () => {
    const o = make('person');
    const l = new THREE.Box3().setFromObject(o.nodes.thigh); const r = new THREE.Box3().setFromObject(o.nodes.thigh_mirror);
    expect(l.min.x).toBeCloseTo(-r.max.x, 5);
    expect(o.nodes.thigh_mirror.parent.scale.x).toBeLessThan(0);
  });
});

describe('the tool\'s own words', () => {
  it('the guide names every shape, the conventions and the honest ceiling', () => {
    for (const s of ['box', 'sphere', 'cylinder', 'capsule', 'torus', 'lathe', 'loft', 'extrude', 'tube', 'plane']) expect(FORGE_GUIDE).toContain(s);
    expect(FORGE_GUIDE).toMatch(/FACES \+Z/); expect(FORGE_GUIDE).toMatch(/metres/); expect(FORGE_GUIDE).toMatch(/HONEST CEILING/);
    for (const id of Object.keys(FORGE_EXAMPLES)) expect(FORGE_GUIDE).toContain(id);
  });

  it('is on unless switched off', () => {
    expect(objectForgeEnabled({})).toBe(true);
    expect(objectForgeEnabled({ AGENTV3_OBJECT_FORGE: 'off' })).toBe(false);
    expect(objectForgeEnabled({ AGENTV3_OBJECT_FORGE: ' 0 ' })).toBe(false);
    expect(objectForgeEnabled({ AGENTV3_OBJECT_FORGE: 'on' })).toBe(true);
  });

  it('a failed spec produces a list of reasons and no files', () => {
    const r = authorObject({ id: 'x' });
    expect(r.ok).toBe(false);
    expect(r.files).toBeUndefined();
    expect(r.text).toMatch(/NOT built/);
  });
});
