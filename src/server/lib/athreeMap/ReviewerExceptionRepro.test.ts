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

describe('independent exception-path review',()=>{
 it('cleans a human if scene.add attaches it then a scene listener throws',()=>{
  const scene=new THREE.Scene();
  scene.addEventListener('childadded',()=>{throw new Error('listener failure')});
  const a=load().createHumanModuleAdapter(scene);
  expect(()=>a.create('human')).toThrow('listener failure');
  expect(scene.children).toHaveLength(0);
 });
 it('releases resources even when scene removal listener throws',()=>{
  const scene=new THREE.Scene(),h=load().createHumanModuleAdapter(scene).create('human');
  let disposed=0;
  scene.children[0].traverse(n=>{const m=n as THREE.Mesh;if(m.isMesh)m.geometry.addEventListener('dispose',()=>disposed++);});
  scene.addEventListener('childremoved',()=>{throw new Error('listener failure')});
  try{h.dispose();}catch{}
  expect(disposed).toBeGreaterThan(0);
 });
});
