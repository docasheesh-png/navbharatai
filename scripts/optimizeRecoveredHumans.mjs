import fs from 'node:fs';
import crypto from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
// Offline build utility only; never invoked by the production builder.
const modulePath = process.argv[2];
if (!modulePath) throw new Error('Supply path to meshoptimizer 0.22.0 meshopt_simplifier.module.js');
const metadata = JSON.parse(fs.readFileSync(resolve(dirname(modulePath), 'package.json'), 'utf8'));
if (metadata.name !== 'meshoptimizer' || metadata.version !== '0.22.0') throw new Error('Requires pinned meshoptimizer 0.22.0');
const { MeshoptSimplifier: M } = await import(pathToFileURL(resolve(modulePath)).href);
await M.ready;
fs.mkdirSync('private-game-assets/humans/optimized', { recursive: true });
const expected = { 'human_01_cap.glb': '7dbe7b32310b89398a8e21ebceb9723986f3109e8c358583647303f038548180', 'human_02_leather.glb': '72896823eef0c702d4479e02fc9bc2306ddbd4cd4310200422aa58710a42c9c3', 'human_03_denim.glb': '86233496f6f4a87cc7e519877002bbf9b33faa1e0295721fdf8089b6d0b86cd1' };
const report=[];
for(const file of Object.keys(expected).sort()){
 const source=fs.readFileSync('private-game-assets/humans/'+file);
 if (source.length > 3_000_000 || crypto.createHash('sha256').update(source).digest('hex') !== expected[file]) throw new Error('Original integrity mismatch');
 const jl=source.readUInt32LE(12), d=JSON.parse(source.subarray(20,20+jl)), bin=source.subarray(28+jl); const replaced=new Map(); const details=[];
 let before=0,after=0;
 for(const mesh of d.meshes)for(const p of mesh.primitives){
  const a=d.accessors[p.indices], v=d.bufferViews[a.bufferView], size={5121:1,5123:2,5125:4}[a.componentType]; const inds=Uint32Array.from({length:a.count},(_,i)=>bin.readUIntLE((v.byteOffset||0)+(a.byteOffset||0)+i*size,size)); before+=inds.length/3;
  const name=d.materials[p.material].name;
  if(['Textile','Leather'].includes(name)){
   const pos=d.accessors[p.attributes.POSITION], pv=d.bufferViews[pos.bufferView];const xyz=Float32Array.from({length:pos.count*3},(_,i)=>bin.readFloatLE((pv.byteOffset||0)+(pos.byteOffset||0)+Math.floor(i/3)*(pv.byteStride||12)+(i%3)*4));
   const [out,error]=M.simplify(inds,xyz,3,Math.floor(inds.length*.88/3)*3,.0005,['LockBorder']);
   if(a.byteOffset||v.byteStride)throw Error('unexpected indexed layout');
   const bytes=Buffer.alloc(out.length*size);out.forEach((n,i)=>bytes.writeUIntLE(n,i*size,size));replaced.set(a.bufferView,bytes);a.count=out.length; if(a.max)a.max=[Math.max(...out)];if(a.min)a.min=[Math.min(...out)];after+=out.length/3;details.push({name,before:inds.length/3,after:out.length/3,relativeError:error,absoluteError:error*M.getScale(xyz,3)});
  }else after+=inds.length/3;
 }
 const chunks=[];let offset=0;
 for(let i=0;i<d.bufferViews.length;i++){const v=d.bufferViews[i],bytes=replaced.get(i)||bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength);const pad=(4-offset%4)%4;if(pad){chunks.push(Buffer.alloc(pad));offset+=pad;}v.byteOffset=offset;v.byteLength=bytes.length;chunks.push(bytes);offset+=bytes.length;}
 const endpad=(4-offset%4)%4;chunks.push(Buffer.alloc(endpad));const newbin=Buffer.concat(chunks);d.buffers[0].byteLength=newbin.length;
 const json=Buffer.from(JSON.stringify(d)),jp=Buffer.alloc(Math.ceil(json.length/4)*4,32);json.copy(jp);const out=Buffer.alloc(28+jp.length+newbin.length);source.copy(out,0,0,20);out.writeUInt32LE(out.length,8);out.writeUInt32LE(jp.length,12);jp.copy(out,20);out.writeUInt32LE(newbin.length,20+jp.length);out.writeUInt32LE(0x004e4942,24+jp.length);newbin.copy(out,28+jp.length);fs.writeFileSync('private-game-assets/humans/optimized/'+file,out);
 report.push({file,before,after,sourceBytes:source.length,bytes:out.length,sha256:crypto.createHash('sha256').update(out).digest('hex'),details});
}
fs.writeFileSync('private-game-assets/humans/optimized/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
