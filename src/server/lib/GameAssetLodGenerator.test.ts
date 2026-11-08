import { expect, it } from 'vitest';
import * as THREE from 'three';
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js';
import ts from 'typescript';
import { gameAssetLodSource } from './GameAssetLodGenerator';
const code = ts.transpileModule(gameAssetLodSource(), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const add = new Function('THREE','SimplifyModifier',code+';return addStaticGameAssetLods;')(THREE,SimplifyModifier) as (root:THREE.Object3D,height:number,animated:boolean)=>number;
it('switches to fewer triangles at distance, preserves transforms and returns to original geometry nearby', () => {
  const root=new THREE.Group(),geometry=new THREE.SphereGeometry(1,24,16),mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial());
  mesh.position.set(2,1,3);mesh.rotation.y=.4;root.add(mesh);root.updateMatrixWorld(true);const before=mesh.matrixWorld.clone();
  expect(add(root,2,false)).toBe(1);root.updateMatrixWorld(true);expect(mesh.matrixWorld.equals(before)).toBe(true);
  const lod=root.children[0] as THREE.LOD;expect(lod.isLOD).toBe(true);
  const near=new THREE.PerspectiveCamera();near.position.set(2,1,4);near.updateMatrixWorld();lod.update(near);expect(lod.getCurrentLevel()).toBe(0);
  near.position.z=100;near.updateMatrixWorld();lod.update(near);expect(lod.getCurrentLevel()).toBe(1);
  const far=lod.levels[1].object as THREE.Mesh;expect(far.geometry.index!.count).toBeLessThan(geometry.index!.count*.8);
  near.position.z=4;near.updateMatrixWorld();lod.update(near);expect(lod.getCurrentLevel()).toBe(0);expect(mesh.geometry).toBe(geometry);
});
it('does not alter animated rigs, morphs, multi-materials or inputs exceeding the work budget', () => {
  const g=new THREE.SphereGeometry(1,24,16),root=new THREE.Group();root.add(new THREE.SkinnedMesh(g,new THREE.MeshBasicMaterial()));
  root.add(new THREE.Mesh(new THREE.SphereGeometry(1,100,100),new THREE.MeshBasicMaterial()));
  root.add(new THREE.Mesh(g,[new THREE.MeshBasicMaterial(),new THREE.MeshBasicMaterial()]));
  const morph=g.clone();morph.morphAttributes.position=[g.attributes.position.clone()];root.add(new THREE.Mesh(morph,new THREE.MeshBasicMaterial()));
  root.add(new THREE.InstancedMesh(g,new THREE.MeshBasicMaterial(),1));const hidden=new THREE.Mesh(g,new THREE.MeshBasicMaterial());hidden.visible=false;root.add(hidden);
  expect(add(root,2,false)).toBe(0);expect(root.children).toHaveLength(6);
  const animated=new THREE.Group();animated.add(new THREE.Mesh(g,new THREE.MeshBasicMaterial()));expect(add(animated,2,true)).toBe(0);
});
