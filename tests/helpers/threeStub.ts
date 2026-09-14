// A minimal three.js stand-in, so a GENERATED object builder can be RUN rather than string-matched.
//
// WHY THIS EXISTS. `three` is not a dependency of this repo — the generated game code installs it in
// the user's sandbox — so the generators' tests could only ever assert that a string contained
// "createMotorcycle". That is exactly the test that would have passed while shipping a bike whose
// wheelbase was 1.62 m instead of 1.35 (a real bug in the first draft of this builder: the fork rake
// throws the front wheel forward, and the steering head was not set back to pay for it).
//
// So the generated module is transpiled and executed against these stubs, and the assertions are
// about REAL NUMBERS in the resulting scene graph: where the wheels are, whether they touch the
// ground, how many parts the object has. Stubs record their constructor arguments; nothing renders.

export interface StubGeometry { kind: string; args: number[] }
export interface StubMaterial { kind: string; params: Record<string, unknown>; dispose(): void }

export class Vec3 {
  constructor(public x = 0, public y = 0, public z = 0) {}
  set(x: number, y: number, z: number): this { this.x = x; this.y = y; this.z = z; return this; }
  copy(v: { x: number; y: number; z: number }): this { return this.set(v.x, v.y, v.z); }
}

export class Obj3D {
  children: Obj3D[] = [];
  position = new Vec3();
  rotation = new Vec3();
  scale = new Vec3(1, 1, 1);
  name = '';
  castShadow = false;
  receiveShadow = false;
  geometry?: StubGeometry;
  material?: StubMaterial;
  add(...kids: Obj3D[]): this { for (const k of kids) this.children.push(k); return this; }
  getObjectByName(n: string): Obj3D | undefined {
    if (this.name === n) return this;
    for (const c of this.children) { const f = c.getObjectByName(n); if (f) return f; }
    return undefined;
  }
}

/** Every descendant, depth-first. */
export function walk(root: Obj3D): Obj3D[] {
  const out: Obj3D[] = [];
  const visit = (o: Obj3D): void => { out.push(o); for (const c of o.children) visit(c); };
  visit(root);
  return out;
}

/**
 * World position of a node, at REST. Additive over the parent chain — correct here because nothing
 * in these builders is rotated at construction time except individual leaf meshes, whose own
 * rotation does not move their origin.
 */
export function worldPos(root: Obj3D, target: Obj3D): Vec3 | null {
  const found = (o: Obj3D, acc: Vec3): Vec3 | null => {
    const here = new Vec3(acc.x + o.position.x, acc.y + o.position.y, acc.z + o.position.z);
    if (o === target) return here;
    for (const c of o.children) { const r = found(c, here); if (r) return r; }
    return null;
  };
  return found(root, new Vec3());
}

const geo = (kind: string) => class { kind = kind; args: number[]; constructor(...a: number[]) { this.args = a; } };
const mat = (kind: string) => class {
  kind = kind; params: Record<string, unknown>;
  constructor(p: Record<string, unknown> = {}) { this.params = p; }
  dispose(): void { /* nothing to free in a stub */ }
};

export const THREE_STUB = {
  Group: class extends Obj3D {},
  Object3D: Obj3D,
  Mesh: class extends Obj3D {
    constructor(g?: StubGeometry, m?: StubMaterial) { super(); this.geometry = g; this.material = m; }
  },
  Vector3: Vec3,
  BoxGeometry: geo('box'),
  CylinderGeometry: geo('cylinder'),
  SphereGeometry: geo('sphere'),
  TorusGeometry: geo('torus'),
  PlaneGeometry: geo('plane'),
  MeshStandardMaterial: mat('standard'),
  MeshPhysicalMaterial: mat('physical'),
  MeshBasicMaterial: mat('basic'),
  DoubleSide: 2,
};

/** What the generated objects.ts imports from './surfaces'. */
export const SURFACES_STUB = {
  surfaceMaterial: (kind: string, opts: Record<string, unknown> = {}) => ({ kind: 'surface:' + kind, params: opts, dispose() {} }),
  enableAO: <T,>(g: T): T => g,
};
