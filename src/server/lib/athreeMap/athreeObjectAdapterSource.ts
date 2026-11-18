/** Candidate appended inside objects.ts, where cache ownership is known. */
export const OBJECT_DISPOSAL = `
/** Release only this factory-created visual's unique geometry/materials.
 * Shared cached materials remain owned by disposeObjectMaterials(), never an instance.
 * Only use for an unshared factory root, not clones or user-added children.
 */
export function createObjectInstanceDisposer(root: THREE.Object3D): () => void {
  const sharedMaterials = new Set(matCache.values());
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse(node => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.geometry) geometries.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (material && !sharedMaterials.has(material)) materials.add(material);
    }
  });
  let disposed = false;
  return () => {
    if (disposed) return; disposed = true;
    let first: unknown;
    try { root.removeFromParent(); } catch(error) { first=error; }
    for (const resource of [...geometries,...materials]) { try { resource.dispose(); } catch(error) { first ??= error; } }
    geometries.clear(); materials.clear();
    if(first)throw first;
  };
}
`;
export const OBJECT_ADAPTER = `import type * as THREE from 'three';
import { createAnimal, createCar, createMotorcycle, createObjectInstanceDisposer } from '../three/objects';
import { createHumanModuleAdapter } from './humanAdapter';
import type { ObjectModuleAdapter, ObjectKind, RuntimeObject } from './composition';

/** Original visual modules, deliberately LITE. No vehicle handling, AI, or physics promised.
 * Each root is exclusively owned and must not be cloned/shared or modified externally.
 */
export function createOriginalModuleAdapter(scene: THREE.Group | THREE.Scene): ObjectModuleAdapter {
 const humans = createHumanModuleAdapter(scene);
 return { create(kind: ObjectKind): RuntimeObject {
  if (kind === 'human') return humans.create(kind);
  const animalKinds = ['dog','cow','horse','deer','goat','tiger'] as const;
  let root: THREE.Group;
  let animate: (dt:number)=>void = () => {};
  if (kind === 'car') root = createCar({detail:'lite'});
  else if (kind === 'motorcycle') {
    const bike = createMotorcycle({detail:'lite'}); root=bike.root;
    animate = dt => bike.roll(0,dt);
  } else if ((animalKinds as readonly string[]).includes(kind)) {
    const animal=createAnimal({kind:kind as typeof animalKinds[number],detail:'lite'});
    root=animal.root; animate=dt=>animal.update(dt,0);
  } else throw new Error('Unsupported original object module.');
  let disposed=false;
  const release=createObjectInstanceDisposer(root);
  try { scene.add(root); } catch(error) { try { release(); } catch {} throw error; }
  return {
    place(x,y,z,origin) {
      if(disposed)throw new Error('Object disposed.');
      if(![x,y,z,origin.x,origin.z].every(Number.isFinite))throw new Error('Invalid object placement.');
      root.position.set(x-origin.x,y,z-origin.z);
    },
    update(dt) {
      if(disposed)throw new Error('Object disposed.');
      if(!Number.isFinite(dt)||dt<0)throw new Error('Invalid object frame.');
      animate(Math.min(dt,0.1));
    },
    dispose() { if(disposed)return;disposed=true;release(); },
  };
 }};
}
`;
