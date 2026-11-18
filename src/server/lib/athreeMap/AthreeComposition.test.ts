import {describe,it,expect} from 'vitest';
import ts from 'typescript';
import { generateAthreeMap } from './AthreeMapGenerator';
import { COMPOSITION } from './athreeCompositionSource';
function load() {
 const files={...generateAthreeMap().files,'src/game/athree/composition.ts':COMPOSITION};
 const cache=new Map<string,any>();
 const get=(name:string):any=>{
  if(cache.has(name))return cache.get(name);
  const src=files[`src/game/athree/${name}.ts`];if(!src)throw Error(name);
  const out:any={};cache.set(name,out);
  const js=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('exports','require',js)(out,(id:string)=>{if(!id.startsWith('./'))throw Error(id);return get(id.slice(2));});return out;
 };return get('composition');
}
const C=load();
const spec={seed:7,profile:'battle-royale',widthKm:8,quality:'phone',rivers:false,vegetation:false};
describe('actual emitted Athree runtime composition',()=>{
 it('uses existing world implementation rather than a preset replacement',()=>{
  const c=C.createComposedWorld(spec);expect(c.map.world.sizeMeters).toBe(8000);expect(c.map.world.seed).toBe(7);
  expect(Number.isFinite(c.map.world.heightAt(0,0))).toBe(true);c.dispose();c.dispose();
 });
 it('requires explicit unsupported size and object failures',()=>{
  expect(()=>C.createComposedWorld({...spec,widthKm:1000})).toThrow(/validation/);
  expect(()=>C.createComposedWorld({...spec,widthKm:NaN})).toThrow();
  const c=C.createComposedWorld(spec);expect(()=>c.add({id:'x',kind:'human',x:0,z:0})).toThrow(/adapter/);c.dispose();
 });
 it('places a real adapter at safe world height, animates and disposes it',()=>{
  let positions:number[][]=[],updates:number[]=[],disposed=0;
  const c=C.createComposedWorld(spec,{}, {create:(kind:string)=>{expect(kind).toBe('human');return {place:(x:number,y:number,z:number)=>positions.push([x,y,z]),update:(dt:number)=>updates.push(dt),dispose:()=>disposed++};}});
  const spawn=c.map.world.spawnPoints('player',1)[0];expect(spawn).toBeTruthy();
  c.add({id:'hero',kind:'human',x:spawn.x,z:spawn.z});expect(c.objectCount()).toBe(1);
  c.update(spawn.x,spawn.z,1,0.5);expect(updates).toEqual([0.1]);
  expect(positions[0][1]).toBe(c.map.world.heightAt(spawn.x,spawn.z));
  expect(()=>c.add({id:'hero',kind:'human',x:spawn.x,z:spawn.z})).toThrow(/already/);
  expect(()=>c.add({id:'bad',kind:'script',x:spawn.x,z:spawn.z})).toThrow(/Unsupported/);
  c.remove('hero');expect(disposed).toBe(1);c.dispose();expect(disposed).toBe(1);
 });
 it('rejects unsafe locations before object creation and cleans failed placement',()=>{
  let created=0,disposed=0;
  const c=C.createComposedWorld(spec,{}, {create:()=>{created++;return {place:()=>{throw Error('place failure')},update(){},dispose:()=>disposed++};}});
  expect(()=>c.add({id:'out',kind:'car',x:5000,z:5000})).toThrow(/outside/);expect(created).toBe(0);
  const spawn=c.map.world.spawnPoints('player',1)[0];
  expect(()=>c.add({id:'car',kind:'car',x:spawn.x,z:spawn.z})).toThrow(/place/);expect(disposed).toBe(1);expect(c.objectCount()).toBe(0);c.dispose();
 });
 it('freezes configuration and bounds coordinate requests before allocation',()=>{
  let creates=0;
  const c=C.createComposedWorld({...spec,profile:'open-world'},{},{create:()=>{creates++;return {place(){},update(){},dispose(){}}}});
  expect(Object.isFrozen(c.spec)).toBe(true);
  expect(()=>c.add({id:'far',kind:'human',x:1e300,z:0})).toThrow(/coordinates/);
  expect(()=>c.update(1e300,0,1,0.01)).toThrow(/frame/);
  expect(creates).toBe(0);c.dispose();
 });
 it('enforces active phone budget and releases it on removal',()=>{
  const c=C.createComposedWorld(spec,{}, {create:()=>({place(){},update(){},dispose(){}})});
  const p=c.map.world.spawnPoints('player',1)[0];
  for(let n=0;n<16;n++) c.add({id:'object'+n,kind:'human',x:p.x,z:p.z});
  expect(()=>c.add({id:'overflow',kind:'human',x:p.x,z:p.z})).toThrow(/budget/);
  c.remove('object0');c.add({id:'replacement',kind:'human',x:p.x,z:p.z});
  expect(c.objectCount()).toBe(16);c.dispose();expect(c.objectCount()).toBe(0);
 });

});
