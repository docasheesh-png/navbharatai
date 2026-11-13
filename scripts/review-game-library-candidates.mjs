/** Explicit maintainer acquisition only; not run by builds, CI, or user requests. No credentials. */
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve,join } from 'node:path';
const rows=JSON.parse(await readFile(new URL('../docs/game-engine/asset-candidates/2026-11-13-batch.json',import.meta.url),'utf8'));
const directory=resolve(process.argv[2] ?? '/tmp/nbai-library-candidate-review');await mkdir(directory,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
async function fetchPinned(url,expected,name){
 const parsed=new URL(url);
 if(parsed.origin!=='https://raw.githubusercontent.com'||!/^\/KayKit-Game-Assets\/[^/]+\/[a-f0-9]{40}\//.test(parsed.pathname))throw Error('Unexpected source');
 const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Acquisition failed');
 if(!r.body)throw Error('Missing response');const chunks=[];let length=0;
 for await(const chunk of r.body){length+=chunk.length;if(length>5*1024*1024)throw Error('Source budget exceeded');chunks.push(chunk);}
 const bytes=Buffer.concat(chunks);if(sha(bytes)!==expected)throw Error('Hash mismatch');
 await writeFile(join(directory,name),bytes);
}
for(const row of rows){
 const extension=row.sourceUrl.endsWith('.gltf')?'.gltf':'.glb';
 await fetchPinned(row.sourceUrl,row.sourceSha256,row.name+extension);
 await fetchPinned(row.licenseEvidence,row.licenseFileSha256,row.name+'-LICENSE.txt');
 for(const resource of row.resources??[])await fetchPinned(resource.url,resource.sha256,row.name+'-'+resource.path);
 console.log(row.name+': source and license hashes verified; render and finished-game proof still required');
}
