import {describe,it,expect} from 'vitest';
import ts from 'typescript';
import * as THREE from 'three';
import {generateGame3D} from '../Game3DGenerator';
import {HUMAN_ADAPTER} from './athreeHumanAdapterSource';
function load() {
 const emitted=generateGame3D(['humanoid']).files;
 const strings={HUMANOID:emitted['src/game/three/humanoid.ts'],SURFACES:emitted['src/game/three/surfaces.ts']};
 const files:Record<string,string>={'adapter':HUMAN_ADAPTER,'../three/humanoid':strings.HUMANOID,'./surfaces':strings.SURFACES};
 const cache:Record<string,any>={};
 const get=(name:string):any=>{
   if(name==='three')return THREE;
   if(cache[name])return cache[name];
   if(!files[name])throw Error(name);
   const out:any={};cache[name]=out;
   new Function('exports','require',ts.transpileModule(files[name],{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(out,get);
   return out;
 };return get('adapter');
}
describe('concrete existing original human module adapter',()=>{
 it('creates real articulated geometry and rebases it without replacing world position',()=>{
  const scene=new THREE.Scene(), adapter=load().createHumanModuleAdapter(scene);
  const h=adapter.create('human');
  expect(scene.children).toHaveLength(1);
  const root=scene.children[0];let meshes=0;root.traverse(n=>{if((n as THREE.Mesh).isMesh)meshes++;});
  expect(meshes).toBeGreaterThan(10);
  h.place(25000,23,-20000,{x:24960,z:-20096});expect(root.position.toArray()).toEqual([40,23,96]);
  h.update(.016);expect(root.position.toArray()).toEqual([40,23,96]);
  h.dispose();expect(scene.children).toHaveLength(0);h.dispose();
  expect(()=>h.update(.01)).toThrow(/disposed/);
 });
 it('does not silently substitute humans for unsupported animals or vehicles',()=>{
  const scene=new THREE.Scene(), a=load().createHumanModuleAdapter(scene);
  expect(()=>a.create('car')).toThrow(/human modules only/);expect(scene.children).toHaveLength(0);
 });
 it('releases visible owned resources once and rejects invalid positions',()=>{
  const scene=new THREE.Scene(),h=load().createHumanModuleAdapter(scene).create('human');
  const resources=new Set<any>();
  scene.children[0].traverse(n=>{const m=n as THREE.Mesh;if(m.isMesh){resources.add(m.geometry);for(const mat of Array.isArray(m.material)?m.material:[m.material])resources.add(mat);}});
  let released=0;for(const r of resources)r.addEventListener('dispose',()=>released++);
  expect(()=>h.place(NaN,0,0,{x:0,z:0})).toThrow(/placement/);
  h.dispose();expect(released).toBe(resources.size);h.dispose();expect(released).toBe(resources.size);
 });
});
