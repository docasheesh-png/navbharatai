import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

const MATERIALS = {
  wall: [0.91,0.88,0.90,1], mauve:[0.545,0.404,0.486,1], trim:[0.345,0.259,0.310,1],
  stone:[0.569,0.592,0.608,1], stoneDark:[0.294,0.325,0.357,1], floor:[0.745,0.761,0.773,1],
  wood:[0.435,0.275,0.169,1], metal:[0.212,0.239,0.259,1], green:[0.216,0.439,0.247,1],
  roof:[0.804,0.780,0.792,1], white:[0.961,0.949,0.933,1], interior:[0.855,0.812,0.780,1],
};
const boxes=[];
const box=(name,x,y,z,sx,sy,sz,material)=>boxes.push({name,x,y,z,sx,sy,sz,material});
// Real-world scale, metres. Front facade faces -Y. The interior is deliberately modeled, not a closed shell.
box('Foundation_Slab',0,0,-.08,14,10,.16,'stoneDark'); box('Interior_Floor',0,0,.015,13.55,9.55,.08,'floor');
const H=3.15, t=.22, fy=-4.78;
box('Front_Left_Wall',-5.55,fy,H/2,2.5,t,H,'wall');
box('Front_Left_Window_Lintel',-3.35,fy,2.78,1.9,t,.74,'wall'); box('Front_Left_Window_Sill',-3.35,fy,.95,1.9,t,.22,'stone');
box('Front_Left_Window_LeftJamb',-4.25,fy,1.82,.14,t,1.7,'white'); box('Front_Left_Window_RightJamb',-2.45,fy,1.82,.14,t,1.7,'white');
// Clear 1.5 m entrance: no door leaf or collision blocker in the opening.
box('Front_Door_Left_Pier',-1.35,fy,H/2,.3,t,H,'mauve'); box('Front_Door_Right_Pier',.55,fy,H/2,.7,t,H,'mauve'); box('Front_Door_Lintel',-.4,fy,2.86,1.5,t,.58,'mauve');
box('Front_Right_Lower',3,fy,.46,4.2,t,.92,'mauve'); box('Front_Right_Upper',3,fy,2.82,4.2,t,.66,'mauve');
box('Front_Right_LeftJamb',.9,fy,1.72,.2,t,1.72,'white'); box('Front_Right_RightJamb',5.1,fy,1.72,.2,t,1.72,'white');
for (const x of [1.7,2.65,3.6,4.55]) box(`Front_Window_Mullion_${x}`,x,fy-.02,1.72,.055,.10,1.5,'wood');
box('Left_Wall_Front',-6.78,-3.1,H/2,t,3.4,H,'wall'); box('Left_Wall_Back',-6.78,3.1,H/2,t,3.4,H,'wall');
box('Left_Window_FrontJamb',-6.78,-1.05,1.75,t,.16,1.7,'white'); box('Left_Window_BackJamb',-6.78,1.05,1.75,t,.16,1.7,'white');
box('Left_Window_Lintel',-6.78,0,2.82,t,2.1,.62,'wall'); box('Left_Window_Sill',-6.78,0,.9,t,2.1,.2,'stone');
box('Right_Exterior_Wall',6.78,0,H/2,t,9.55,H,'mauve');
box('Rear_Wall_Left',-3.8,4.78,H/2,6,t,H,'wall'); box('Rear_Wall_Right',4.3,4.78,H/2,5,t,H,'wall');
box('Rear_Window_Lintel',.9,4.78,2.8,3.4,t,.7,'wall'); box('Rear_Window_Sill',.9,4.78,.95,3.4,t,.2,'stone');
// Internal room partitions have walk-through gaps instead of sealed door panels.
box('Partition_X_Left_Front',-2.2,-2.5,1.45,.16,3.6,2.9,'interior'); box('Partition_X_Left_Back',-2.2,2.2,1.45,.16,4.8,2.9,'interior');
box('Partition_X_Center_Front',1.45,-2.5,1.45,.16,3.4,2.9,'interior'); box('Partition_X_Center_Back',1.45,2.35,1.45,.16,4.5,2.9,'interior');
box('Partition_Y_Left_A',-4.5,-.6,1.45,4.4,.16,2.9,'interior'); box('Partition_Y_Left_B',-.7,-.6,1.45,1.8,.16,2.9,'interior');
box('Partition_Y_Right_A',3.2,-.6,1.45,3.2,.16,2.9,'interior'); box('Partition_Y_Right_B',5.9,-.6,1.45,1.5,.16,2.9,'interior');
box('Main_Flat_Roof',0,0,3.28,14,10,.22,'roof');
box('Front_Parapet_Base',0,-4.98,3.62,14.4,.35,.16,'trim'); box('Front_Parapet_Fascia',0,-4.98,4.05,14.4,.35,.12,'mauve');
box('Upper_Louvre_Band',-1.4,-5,4.35,7,.25,.72,'wall');
for (const x of [-4.1,-2.8,-1.5,-.2,1.1]) box(`Louvre_Slat_${x}`,x,-5.15,4.35,.95,.08,.10,'metal');
box('Upper_Right_Volume',5,-4.9,4.18,4.1,.35,1.15,'wall'); box('Upper_Right_Trim',5,-5.12,4.78,4.35,.12,.12,'mauve');
box('Porch_Canopy',0,-6.25,3.12,8.5,2.8,.18,'white'); box('Porch_Canopy_Fascia',0,-7.65,3.04,8.55,.16,.22,'mauve');
for (const x of [-3.65,0,3.65]) { box(`Porch_Column_${x}`,x,-7.35,1.52,.34,.34,3.04,'white'); box(`Porch_Column_Base_${x}`,x,-7.35,.18,.52,.52,.30,'stone'); box(`Porch_Column_Cap_${x}`,x,-7.35,2.94,.52,.52,.22,'stone'); box(`Column_Stone_Inlay_${x}`,x,-7.53,1.55,.36,.035,.72,'stone'); }
for (let i=0;i<3;i++) box(`Entry_Step_${i+1}`,0,-8.15+i*.48,-.14+i*.16,9-i*.65,.55,.28,'stoneDark');
box('Front_Planter',4.7,-8.25,.22,4,.55,.38,'stone');
for (let i=0;i<12;i++) box(`Planter_Green_${i}`,-1+i*.18,-8.22,.48,.15,.3,.34,'green');
box('Living_Sofa',-4.55,-3.25,.48,2.3,.85,.75,'mauve'); box('Living_Table',-4.55,-2.1,.28,1.1,.75,.42,'wood');
box('Bedroom_Bed_1',-4.55,2.6,.30,2.1,1.6,.45,'wood'); box('Bedroom_Bed_1_Mattress',-4.55,2.6,.58,1.95,1.45,.18,'white');
box('Kitchen_Counter',4.5,2.7,.48,3.4,.75,.85,'stone'); box('Dining_Table',3.5,-2.6,.42,1.8,1,.75,'wood');
box('Bedroom_Bed_2',3.5,2.7,.30,2,1.5,.45,'wood'); box('Bedroom_Bed_2_Mattress',3.5,2.7,.58,1.9,1.4,.18,'white');

const faceDefs = [
  {n:[1,0,0],v:[1,3,7,5]},{n:[-1,0,0],v:[0,4,6,2]},
  {n:[0,1,0],v:[2,6,7,3]},{n:[0,-1,0],v:[0,1,5,4]},
  {n:[0,0,1],v:[4,5,7,6]},{n:[0,0,-1],v:[0,2,3,1]},
];
function geometryFor(parts) {
  const pos=[], normals=[], indices=[]; let base=0;
  for (const p of parts) {
    const x0=p.x-p.sx/2,x1=p.x+p.sx/2,y0=p.y-p.sy/2,y1=p.y+p.sy/2,z0=p.z-p.sz/2,z1=p.z+p.sz/2;
    const v=[[x0,y0,z0],[x1,y0,z0],[x0,y1,z0],[x1,y1,z0],[x0,y0,z1],[x1,y0,z1],[x0,y1,z1],[x1,y1,z1]];
    for (const f of faceDefs) {
      for (const vi of f.v) { pos.push(...v[vi]); normals.push(...f.n); }
      indices.push(base,base+1,base+2,base,base+2,base+3); base+=4;
    }
  }
  return {pos,normals,indices};
}
const align4 = n => (n+3)&~3;
export function createGlbBuffer() {
  const grouped=new Map(); for (const p of boxes) { const a=grouped.get(p.material)??[]; a.push(p); grouped.set(p.material,a); }
  const chunks=[]; let binLength=0; const views=[],accessors=[],meshes=[],nodes=[],materials=[];
  const addBytes=(typed,target) => { const raw=Buffer.from(typed.buffer,typed.byteOffset,typed.byteLength); const offset=align4(binLength); if(offset>binLength) chunks.push(Buffer.alloc(offset-binLength)); chunks.push(raw); binLength=offset+raw.length; const index=views.length; views.push({buffer:0,byteOffset:offset,byteLength:raw.length,target}); return index; };
  for (const [material,parts] of grouped) {
    const g=geometryFor(parts), p=new Float32Array(g.pos), n=new Float32Array(g.normals), ix=new Uint16Array(g.indices);
    const pv=addBytes(p,34962),nv=addBytes(n,34962),iv=addBytes(ix,34963);
    const mins=[Infinity,Infinity,Infinity],maxs=[-Infinity,-Infinity,-Infinity]; for(let i=0;i<p.length;i+=3)for(let a=0;a<3;a++){mins[a]=Math.min(mins[a],p[i+a]);maxs[a]=Math.max(maxs[a],p[i+a]);}
    const pa=accessors.length; accessors.push({bufferView:pv,componentType:5126,count:p.length/3,type:'VEC3',min:mins,max:maxs});
    const na=accessors.length; accessors.push({bufferView:nv,componentType:5126,count:n.length/3,type:'VEC3'});
    const ia=accessors.length; accessors.push({bufferView:iv,componentType:5123,count:ix.length,type:'SCALAR',min:[0],max:[p.length/3-1]});
    const mi=materials.length; const color=MATERIALS[material]; materials.push({name:material,pbrMetallicRoughness:{baseColorFactor:color,metallicFactor:0,roughnessFactor:.82}, ...(color[3]<1?{alphaMode:'BLEND'}:{})});
    const meshName=`House_${material}`; meshes.push({name:meshName,primitives:[{attributes:{POSITION:pa,NORMAL:na},indices:ia,material:mi,mode:4}],extras:{parts:parts.map(x=>x.name)}}); nodes.push({name:meshName,mesh:meshes.length-1});
  }
  const bin=Buffer.concat(chunks); const doc={asset:{version:'2.0',generator:'NavBharatAI Indian Modern House H01 builder'},scene:0,scenes:[{nodes:nodes.map((_,i)=>i),name:'Indian Modern House H01'}],nodes,meshes,materials,accessors,bufferViews:views,buffers:[{byteLength:bin.length}],extras:{asset:'Indian Modern House H01',units:'metres',reference:'Owner-provided exterior and floor-plan reference',license:'CC BY 4.0',walkthrough:{frontDoorOpeningMetres:1.5,interiorPartitions:true,roomDoorwaysOpen:true,rooms:['living room','bedroom 1','kitchen/dining','bedroom 2']}}};
  let json=Buffer.from(JSON.stringify(doc)); json=Buffer.concat([json,Buffer.alloc(align4(json.length)-json.length,0x20)]);
  const binPad=Buffer.concat([bin,Buffer.alloc(align4(bin.length)-bin.length)]);
  const total=12+8+json.length+8+binPad.length; const header=Buffer.alloc(12); header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(total,8);
  const jh=Buffer.alloc(8);jh.writeUInt32LE(json.length,0);jh.writeUInt32LE(0x4e4f534a,4);
  const bh=Buffer.alloc(8);bh.writeUInt32LE(binPad.length,0);bh.writeUInt32LE(0x004e4942,4);
  return Buffer.concat([header,jh,json,bh,binPad]);
}
export async function buildIndianModernHouse(root=process.cwd()) {
  const bytes=createGlbBuffer(); const sha=createHash('sha256').update(bytes).digest('hex');
  const path=join(root,'assets','game-models',`${sha}.glb`); await mkdir(dirname(path),{recursive:true}); await writeFile(path,bytes);
  return {path,sha256:sha,bytes:bytes.length,parts:boxes.length,materials: new Set(boxes.map(b=>b.material)).size};
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const result=await buildIndianModernHouse(); process.stdout.write(JSON.stringify(result)+'\n');
}
