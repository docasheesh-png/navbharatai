/** Bounded optional static LOD generation using the installed Three.js modifier; never simplify rigs. */
export function gameAssetLodSource(): string {
  return `function addStaticGameAssetLods(root: THREE.Object3D, height: number, animated: boolean): number {
  if (animated) return 0;
  const meshes: THREE.Mesh[] = [];
  root.traverse(o => { if (o instanceof THREE.Mesh) meshes.push(o); });
  let vertices = 0, levels = 0;
  const started = performance.now();
  const modifier = new SimplifyModifier();
  for (const mesh of meshes) {
    if (levels >= 8 || performance.now() - started > 80) break;
    const g = mesh.geometry, p = g.getAttribute('position');
    if (!p || p.count < 200 || p.count > 2000 || vertices + p.count > 6000 || !mesh.parent || mesh.children.length
      || mesh instanceof THREE.SkinnedMesh || mesh instanceof THREE.InstancedMesh || !mesh.visible || Array.isArray(mesh.material) || g.groups.length > 1
      || Object.values(g.morphAttributes).some(v => v.length) || (g.index?.count ?? p.count) > 12000
      || Object.keys(g.attributes).some(n => !['position','normal','uv','tangent','color'].includes(n))) continue;
    vertices += p.count;
    let reduced: THREE.BufferGeometry | undefined;
    try {
      reduced = modifier.modify(g, Math.floor(p.count * 0.4));
      const q = reduced.getAttribute('position');
      const before = (g.index?.count ?? p.count) / 3, after = (reduced.index?.count ?? q?.count ?? 0) / 3;
      if (!q || after < 4 || after > before * 0.8) throw Error('No useful LOD saving');
      for (let i=0;i<q.count;i++) if (![q.getX(i),q.getY(i),q.getZ(i)].every(Number.isFinite)) throw Error('Invalid LOD position');
      g.computeBoundingBox(); reduced.computeBoundingBox();
      const a = g.boundingBox!, b = reduced.boundingBox!, extent = a.getSize(new THREE.Vector3());
      for (const axis of ['x','y','z'] as const) if (Math.abs(a.min[axis]-b.min[axis]) > Math.max(extent[axis]*0.1,1e-5)
        || Math.abs(a.max[axis]-b.max[axis]) > Math.max(extent[axis]*0.1,1e-5)) throw Error('LOD silhouette bounds changed');
      const far = new THREE.Mesh(reduced, mesh.material); far.castShadow = mesh.castShadow; far.receiveShadow = mesh.receiveShadow;
      const lod = new THREE.LOD(); lod.position.copy(mesh.position); lod.quaternion.copy(mesh.quaternion); lod.scale.copy(mesh.scale);
      const parent = mesh.parent; parent.add(lod);
      mesh.position.set(0,0,0); mesh.quaternion.identity(); mesh.scale.set(1,1,1);
      lod.addLevel(mesh,0); lod.addLevel(far,Math.max(8,height*12),0.2);
      levels++; reduced = undefined;
    } catch { reduced?.dispose(); } // Original mesh is untouched if generation is unsuitable.
  }
  return levels;
}
`;
}
