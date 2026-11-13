/** Offline derivation from explicitly downloaded, hash-pinned sources. No network and no automatic activation. */
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {REVIEWED_LIBRARY_EXPANSION} from '../../src/server/AgentV3/gameAssets/reviewedExpansion';
import {selectGlbAnimations} from '../../src/server/AgentV3/gameAssets/assetAnimationSelection';
import {bundleGltf} from '../../src/server/AgentV3/gameAssets/gltfBundle';
import {compactGlb} from '../../src/server/AgentV3/gameAssets/assetOptimize';
import {validateGlb} from '../../src/server/AgentV3/gameAssets/assetPolicy';
const [sourceArg,outputArg]=process.argv.slice(2);assert.ok(sourceArg&&outputArg,'Supply source and output directories');
const source=resolve(sourceArg),output=resolve(outputArg);assert.notEqual(source,output);await mkdir(output,{recursive:true});
const rows=JSON.parse(await readFile(new URL('../../docs/game-engine/asset-candidates/2026-11-13-batch.json',import.meta.url),'utf8'));
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
for(const row of rows){
 const c=REVIEWED_LIBRARY_EXPANSION.find(c=>c.sha256===row.sha256);assert.ok(c);
 const extension=c.format==='gltf'?'.gltf':'.glb';const raw=await readFile(join(source,row.name+extension));assert.equal(hash(raw),c.sourceSha256);
 assert.equal(hash(await readFile(join(source,row.name+'-LICENSE.txt'))),row.licenseFileSha256);
 let derived:Uint8Array;
 if(c.optimization==='animation-selection-v1')derived=selectGlbAnimations(raw,c.sourceSha256!,c.retainedAnimations!);
 else {const resources=new Map<string,Uint8Array>();for(const r of c.resources??[]){const bytes=await readFile(join(source,row.name+'-'+r.path));assert.equal(hash(bytes),r.sha256);resources.set(r.path,bytes);}derived=compactGlb(bundleGltf(raw,resources)).bytes;}
 assert.equal(hash(derived),c.sha256);const stats=validateGlb(derived);assert.equal(stats.bytes,row.bytes);assert.equal(stats.triangles,row.triangles);assert.deepEqual(stats.animations,row.animations);
 await writeFile(join(output,c.sha256+'.glb'),derived,{flag:'wx'});console.log(c.id,stats);
}
