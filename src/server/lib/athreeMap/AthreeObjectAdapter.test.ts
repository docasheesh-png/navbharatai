import {describe,it,expect} from 'vitest';
import ts from 'typescript';
import * as THREE from 'three';
import * as Capsule from 'three/addons/math/Capsule.js';
import * as Octree from 'three/addons/math/Octree.js';
import {generateGame3D} from '../Game3DGenerator';
import {OBJECT_ADAPTER,OBJECT_DISPOSAL} from './athreeObjectAdapterSource';
import {HUMAN_ADAPTER} from './athreeHumanAdapterSource';
function load() {
 const emitted=generateGame3D(['objects','humanoid']).files;
 const strings={HUMANOID:emitted['src/game/three/humanoid.ts'],SURFACES:emitted['src/game/three/surfaces.ts'],OBJECTS:emitted['src/game/three/objects.ts'],MATERIALS:emitted['src/game/three/materials.ts'],COLLISION:emitted['src/game/three/collision.ts']};
 const build={GAME_BUILDINGS:emitted['src/game/three/buildings.ts']};
 const files:Record<string,string>={adapter:OBJECT_ADAPTER,'./humanAdapter':HUMAN_ADAPTER,'../three/humanoid':strings.HUMANOID,'../three/objects':strings.OBJECTS+OBJECT_DISPOSAL,'./surfaces':strings.SURFACES,'./materials':strings.MATERIALS,'./collision':strings.COLLISION,'./buildings':build.GAME_BUILDINGS};
 const cache:Record<string,any>={};
 const get=(name:string):any=>{
   if(name==='three')return THREE;
   if(name==='three/addons/math/Capsule.js')return Capsule;
   if(name==='three/addons/math/Octree.js')return Octree;
   if(cache[name])return cache[name];
   if(!files[name])throw Error(name);
   const out:any={};cache[name]=out;
   new Function('exports','require',ts.transpileModule(files[name],{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(out,get);
   return out;
 };return get('adapter');
}
describe('actual original animal and vehicle adapter',()=>{
 it.each(['dog','cow','horse','deer','goat','tiger','car','motorcycle'])('constructs and disposes real %s geometry',kind=>{
  const scene=new THREE.Scene(),a=load().createOriginalModuleAdapter(scene),obj=a.create(kind);
  expect(scene.children).toHaveLength(1);
  const root=scene.children[0],geometries=new Set<any>();
  root.traverse(n=>{if((n as THREE.Mesh).isMesh)geometries.add((n as THREE.Mesh).geometry)});
  expect(geometries.size).toBeGreaterThan(1);
  let disposal=0;for(const g of geometries)g.addEventListener('dispose',()=>disposal++);
  obj.place(1200,15,2400,{x:1152,z:2304});expect(root.position.toArray()).toEqual([48,15,96]);
  obj.update(.016);obj.dispose();expect(scene.children).toHaveLength(0);
  expect(disposal).toBe(geometries.size);obj.dispose();expect(disposal).toBe(geometries.size);
 });
 it('does not dispose material resources still shared by a second factory object',()=>{
  const scene=new THREE.Scene(),a=load().createOriginalModuleAdapter(scene),one=a.create('cow'),two=a.create('cow');
  const mats=(root:THREE.Object3D)=>{const out=new Set<any>();root.traverse(n=>{const m=n as THREE.Mesh;if(m.isMesh)for(const v of Array.isArray(m.material)?m.material:[m.material])out.add(v)});return out;};
  const first=mats(scene.children[0]),second=mats(scene.children[1]),shared=[...first].filter(m=>second.has(m));
  expect(shared.length).toBeGreaterThan(0);
  let disposed=0;for(const m of shared)m.addEventListener('dispose',()=>disposed++);
  one.dispose();expect(disposed).toBe(0);two.update(.02);two.dispose();expect(disposed).toBe(0);
 });
 it('keeps foreign attached resources intact and releases all owned geometry after a listener throws',()=>{
  const scene=new THREE.Scene(),h=load().createOriginalModuleAdapter(scene).create('car');
  const root=scene.children[0],owned=new Set<THREE.BufferGeometry>();
  root.traverse(n=>{if((n as THREE.Mesh).isMesh)owned.add((n as THREE.Mesh).geometry)});
  const extra=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());root.add(extra);
  let foreign=0,count=0;extra.geometry.addEventListener('dispose',()=>foreign++);
  for(const g of owned)g.addEventListener('dispose',()=>count++);
  [...owned][0].addEventListener('dispose',()=>{throw Error('gpu-listener')});
  expect(()=>h.dispose()).toThrow('gpu-listener');
  expect(count).toBe(owned.size);expect(foreign).toBe(0);expect(scene.children).toHaveLength(0);
  h.dispose();expect(count).toBe(owned.size);
  extra.geometry.dispose();(extra.material as THREE.Material).dispose();
 });

});
