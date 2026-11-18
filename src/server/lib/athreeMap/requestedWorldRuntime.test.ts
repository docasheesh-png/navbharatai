import {describe,it,expect} from 'vitest';
import ts from 'typescript';
import * as THREE from 'three';
import * as Capsule from 'three/addons/math/Capsule.js';
import * as Octree from 'three/addons/math/Octree.js';
import path from 'node:path';
import {generateRequestedAthreeWorld} from './compositionRequest';
function runtime(include?:string[]) {
 const generated=generateRequestedAthreeWorld({seed:7,profile:'explore',widthKm:8,quality:'phone',rivers:false,vegetation:false,objects:[{kind:'human',count:1},{kind:'dog',count:1}]},include);
 const cache=new Map<string,any>();
 const load=(name:string):any=>{
  if(name==='three')return THREE;
  if(name==='three/addons/math/Capsule.js')return Capsule;
  if(name==='three/addons/math/Octree.js')return Octree;
  if(cache.has(name))return cache.get(name);
  const source=generated.files[name];if(!source)throw Error('Missing module '+name);
  const out:any={};cache.set(name,out);
  new Function('exports','require',ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(out,(id:string)=>id.startsWith('.')?load(path.posix.normalize(path.posix.join(path.posix.dirname(name),id))+'.ts'):load(id));
  return out;
 };
 return load('src/game/athree/requestedWorld.ts');
}
describe('actual combined runtime requested world',()=>{
 it.each([{include:undefined},{include:[]},{include:['roads']}])('constructs selected world and visual modules, updates and releases scene ownership: %j',({include})=>{
  const scene=new THREE.Scene(),instance=runtime(include).createRequestedWorld(scene,THREE);
  expect(instance.composition.map.world.sizeMeters).toBe(8000);
  expect(instance.composition.objectCount()+instance.issues.length).toBe(2);
  expect(scene.children.length).toBe(instance.composition.objectCount()+1);
  const point=instance.composition.map.world.spawnPoints('player',1)[0];
  instance.composition.update(point.x,point.z,1,.016);
  instance.dispose();expect(scene.children).toHaveLength(0);instance.dispose();
 });
});
