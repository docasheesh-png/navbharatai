import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { indexedRaycast } from './helpers/indexedRaycast';

describe('the accelerated terrain test oracle keeps the original geometry proof', () => {
  it('matches native Mesh.raycast on every probe, including transforms, misses and vertex changes', () => {
    const g = new THREE.PlaneGeometry(40, 40, 32, 32); g.rotateX(-Math.PI / 2);
    const p = g.getAttribute('position');
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    m.position.set(3, 2, -4); m.rotation.y = 0.4; m.scale.set(1.2, 0.8, 0.9); m.updateMatrixWorld(true);
    for (const amplitude of [0, 3]) {
      for (let i = 0; i < p.count; i++) p.setY(i, Math.sin(p.getX(i)) * amplitude);
      p.needsUpdate = true; g.computeBoundingBox(); g.computeBoundingSphere();
      for (let x = -25; x <= 25; x += 5) for (let z = -25; z <= 25; z += 5) {
        const ray = new THREE.Raycaster(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0));
        const original = ray.intersectObject(m); const accelerated = indexedRaycast(ray, m);
        expect(accelerated.length).toBe(original.length);
        for (let i = 0; i < original.length; i++) expect(accelerated[i].point.distanceTo(original[i].point)).toBeLessThan(1e-8);
      }
    }
  });
  it('retains native draw-range and material-group behavior', () => {
    const g = new THREE.PlaneGeometry(40, 40, 32, 32); g.rotateX(-Math.PI / 2); g.setDrawRange(0, 300);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial()); m.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 100, 0), new THREE.Vector3(0, -1, 0));
    expect(indexedRaycast(ray, m)).toEqual(ray.intersectObject(m));
    g.addGroup(0, 300, 0);
    expect(indexedRaycast(ray, m)).toEqual(ray.intersectObject(m));
  });
});
