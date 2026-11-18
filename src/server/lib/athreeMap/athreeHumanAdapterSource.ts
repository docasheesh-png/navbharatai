/** Explicit original procedural human adapter; other kinds intentionally fail closed. */
export const HUMAN_ADAPTER = `import type * as THREE from 'three';
import { createHumanoid } from '../three/humanoid';
import type { ObjectModuleAdapter, ObjectKind, RuntimeObject } from './composition';

/** Visual modules only. No NPC navigation, combat AI or physics collider is promised here.
 * The composition owns each returned handle. Scene ownership remains with the caller.
 */
export function createHumanModuleAdapter(scene: THREE.Group | THREE.Scene): ObjectModuleAdapter {
  return {
    create(kind: ObjectKind): RuntimeObject {
      if (kind !== 'human') throw new Error('This adapter supports human modules only.');
      const human = createHumanoid();
      let disposed = false;
      const resources = new Set<{dispose():void}>();
      human.root.traverse(node => {
        const mesh = node as THREE.Mesh;
        if (!mesh.isMesh) return;
        resources.add(mesh.geometry);
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) resources.add(material);
      });
      function release() {
        if (disposed) return;
        disposed=true;
        let first: unknown;
        try { human.root.removeFromParent(); } catch(error) { first=error; }
        for (const resource of resources) { try { resource.dispose(); } catch(error) { first ??= error; } }
        resources.clear();
        if(first) throw first;
      }
      try { scene.add(human.root); }
      catch (error) { try { release(); } catch {} throw error; }
      return {
        place(x,y,z,origin) {
          if (disposed) throw new Error('Human module disposed.');
          if (![x,y,z,origin.x,origin.z].every(Number.isFinite)) throw new Error('Invalid human placement.');
          human.root.position.set(x-origin.x,y,z-origin.z);
        },
        update(dt) {
          if (disposed) throw new Error('Human module disposed.');
          if (!Number.isFinite(dt) || dt < 0) throw new Error('Invalid human frame.');
          human.update(Math.min(dt,0.1),0,true);
        },
        dispose() {
          release();
        },
      };
    },
  };
}
`;
