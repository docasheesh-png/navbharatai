import { generateAthreeMap } from './AthreeMapGenerator';
import { generateGame3D } from '../Game3DGenerator';
import { composeAthreeRecipe } from './composeAthreeRecipe';
export interface CompositionRequest {
 seed:number; profile:'open-world'|'racing'|'battle-royale'|'flight'|'explore';
 widthKm:number; quality:'phone'|'mid'|'desktop'; rivers:boolean; vegetation:boolean;
 objects:Array<{kind:'human'|'dog'|'cow'|'horse'|'deer'|'goat'|'tiger'|'car'|'motorcycle';count:number}>;
}
export function parseCompositionRequest(raw:unknown):CompositionRequest {
 if(!raw || typeof raw!=='object' || Array.isArray(raw))throw new Error('Composition must be an explicit structured world request.');
 const r=raw as Record<string,unknown>, keys=['seed','profile','widthKm','quality','rivers','vegetation','objects'];
 if(Object.keys(r).some(k=>!keys.includes(k)))throw new Error('Unsupported composition property.');
 if(typeof r.seed!=='number'||!Number.isInteger(r.seed)||r.seed < -2147483648||r.seed > 2147483647)throw new Error('Seed must be int32.');
 if(typeof r.profile!=='string'||!['open-world','racing','battle-royale','flight','explore'].includes(String(r.profile)))throw new Error('Unsupported world profile.');
 if(typeof r.widthKm!=='number'||!Number.isFinite(r.widthKm)||r.widthKm<1||r.widthKm>100)throw new Error('Runtime width must be 1–100 km; larger worlds are not validated.');
 if(typeof r.quality!=='string'||!['phone','mid','desktop'].includes(String(r.quality)))throw new Error('Unsupported quality.');
 if(typeof r.rivers!=='boolean'||typeof r.vegetation!=='boolean')throw new Error('Explicit river/vegetation choices required.');
 if(!Array.isArray(r.objects)||r.objects.length>9)throw new Error('At most nine object groups.');
 const kinds=['human','dog','cow','horse','deer','goat','tiger','car','motorcycle'], seen=new Set<string>();
 let count=0;
 for(const x of r.objects) {
  if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!['kind','count'].includes(k))||!kinds.includes(x.kind)||seen.has(x.kind)||!Number.isInteger(x.count)||x.count<1)throw new Error('Unsupported or duplicate object group.');
  seen.add(x.kind);count+=x.count;
 }
 const budget={phone:16,mid:32,desktop:64}[r.quality as 'phone'|'mid'|'desktop'];
 if(count>budget)throw new Error('Object request exceeds active quality budget.');
 return {seed:r.seed,profile:r.profile as CompositionRequest['profile'],widthKm:r.widthKm,quality:r.quality as CompositionRequest['quality'],rivers:r.rivers,vegetation:r.vegetation,objects:r.objects.map(x=>({kind:x.kind,count:x.count}))};
}
export function generateRequestedAthreeWorld(raw:unknown, include?:string[], excludedModules: readonly string[] = []) {
 const request=parseCompositionRequest(raw);
 if(excludedModules.includes('vehicles') && request.objects.some(o=>o.kind==='car'||o.kind==='motorcycle'))throw new Error('User excluded vehicles; visual vehicle objects are not allowed.');
 const world=generateAthreeMap(include, excludedModules);
 // Native module selection is authoritative: never silently restore omitted renderers.
 if(request.vegetation && !world.files['src/game/athree/plants.ts'])throw new Error('Vegetation requested but plants module is not selected.');
 if(request.rivers && !world.files['src/game/athree/riverwater.ts'])throw new Error('Visible rivers requested but rivers module is not selected.');
 const result=composeAthreeRecipe(world,generateGame3D(['objects','humanoid']));
 const serialized=JSON.stringify(request);
 result.files['src/game/athree/requestedWorld.ts']=`import type * as THREE from 'three';
import { createComposedWorld } from './composition';
import { createOriginalModuleAdapter } from './objectAdapter';
const request = ${serialized} as const;
/** Instantiate this request from seeded modules at runtime. Returns honest placement failures. */
export function createRequestedWorld(scene: THREE.Scene, three: typeof THREE) {
 const composition=createComposedWorld(request,{three},createOriginalModuleAdapter(scene));
 const group=composition.map.chunks?.group;
 const issues:string[]=[];
 try {
  if(group)scene.add(group);
  const total=request.objects.reduce((n,g)=>n+g.count,0);
  const points=composition.map.world.spawnPoints('player',total);
  let index=0;
  for(const group of request.objects)for(let n=0;n<group.count;n++) {
   const point=points[index], id=group.kind+'-'+index++;
   if(!point){issues.push(id+': no safe spawn found');continue;}
   try { composition.add({id,kind:group.kind,x:point.x,z:point.z}); }
   catch { issues.push(id+': placement unavailable'); }
  }
 } catch(error) {
  try{group?.removeFromParent();}finally{composition.dispose();}
  throw error;
 }
 let disposed=false;
 return {composition,issues,dispose(){
  if(disposed)return;disposed=true;
  try{group?.removeFromParent();}finally{composition.dispose();}
 }};
}
`;
 result.instructions+='\nCall createRequestedWorld(scene, THREE) from ./game/athree/requestedWorld in the existing game lifecycle. It instantiates the explicit user-shaped world and bounded original visual objects at runtime. Use composition.update for frames and returned dispose on teardown. Display returned placement issues honestly. This does not supply vehicle driving, NPC AI, combat, or automatic UI mounting.';
 return result;
}
