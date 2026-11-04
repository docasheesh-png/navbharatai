import * as THREE from 'three';

/** Test oracle: the SAME Mesh.raycast and triangles, partitioned into bounded index batches.
 * Dense terrain otherwise scans ~33k triangles for every one of thousands of surface probes.
 * No sampling, simplified geometry, analytic height function, or omitted assertions.
 */
const cache = new WeakMap<THREE.BufferGeometry, { version: number; indexVersion: number; parts: THREE.Mesh[] }>();
export function indexedRaycast(ray: THREE.Raycaster, object: THREE.Object3D): THREE.Intersection[] {
  const hits: THREE.Intersection[] = [];
  object.traverse(child => {
    if (!(child instanceof THREE.Mesh)) return;
    const geometry = child.geometry as THREE.BufferGeometry;
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute;
    const index = geometry.getIndex();
    // Preserve specialized/material-group behavior through the original raycaster.
    if (!index || geometry.groups.length || Array.isArray(child.material) || index.count < 768
      || geometry.drawRange.start !== 0 || geometry.drawRange.count !== Infinity
      || child.raycast !== THREE.Mesh.prototype.raycast) {
      hits.push(...ray.intersectObject(child, false)); return;
    }
    let entry = cache.get(geometry);
    if (!entry || entry.version !== pos.version || entry.indexVersion !== index.version) {
      const parts: THREE.Mesh[] = [];
      for (let start = 0; start < index.count; start += 768) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', pos);
        const ids = Array.from(index.array.slice(start, Math.min(start + 768, index.count)));
        g.setIndex(ids);
        const box = new THREE.Box3(); const v = new THREE.Vector3();
        for (const id of ids) box.expandByPoint(v.fromBufferAttribute(pos, id));
        g.boundingBox = box; g.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
        parts.push(new THREE.Mesh(g, child.material));
      }
      entry = { version: pos.version, indexVersion: index.version, parts }; cache.set(geometry, entry);
    }
    for (const part of entry.parts) {
      part.material = child.material;
      part.matrixWorld.copy(child.matrixWorld);
      hits.push(...ray.intersectObject(part, false));
    }
  });
  return hits.sort((a, b) => a.distance - b.distance);
}
