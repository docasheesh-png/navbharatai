// Local emulator-only on-demand admission -> private cache -> fresh-process cache hit. No provider network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
async function main() {
  assert.match(process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? '', /^127\.0\.0\.1:\d+$/);
  assert.equal(process.env.STORAGE_EMULATOR_HOST,'http://'+process.env.FIREBASE_STORAGE_EMULATOR_HOST);
  assert.equal(process.env.WORKSPACE_ASSETS_BUCKET,'demo-navbharatai-phase2.appspot.com');
  const phase=process.argv[2];
  if(!phase){
    const {build}=await import('esbuild');const bundle=join(process.cwd(),'scripts/checks',`.tmp-discovery-${process.pid}.cjs`);
    try{await build({entryPoints:[process.argv[1]],outfile:bundle,bundle:true,platform:'node',format:'cjs',packages:'external',logLevel:'silent'});
      for(const mode of ['save','restore'])assert.equal(spawnSync(process.execPath,[bundle,mode],{stdio:'inherit',timeout:30000}).status,0);
    }finally{await rm(bundle,{force:true});}
    console.log('PASS real private Storage discovery index + hash-addressed bytes, fresh-process cache hit with zero provider calls. Synthetic asset/provider responses, not live discovery or browser proof.');return;
  }
  const require=createRequire(join(process.cwd(),'package.json')),admin=require('firebase-admin');
  const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
  admin.initializeApp({projectId:'demo-navbharatai-phase2',credential:admin.credential.cert({projectId:'demo-navbharatai-phase2',clientEmail:'synthetic@demo-navbharatai-phase2.iam.gserviceaccount.com',privateKey})});
  const {paddedSyntheticGlb}=await import('../../tests/fixtures/gameAssetFixtures.ts');
  const {gameAssetObjectStore}=await import('../../src/server/AgentV3/gameAssets/objectStore.ts');
  const {createDurableAssetCache}=await import('../../src/server/AgentV3/gameAssets/assetCache.ts');
  const {createPolyHavenDiscovery,withDiscoveredAssetCache}=await import('../../src/server/AgentV3/gameAssets/polyHavenDiscovery.ts');
  const {acquireGameAsset}=await import('../../src/server/AgentV3/gameAssets/assetEngine.ts');
  const {validateGlb}=await import('../../src/server/AgentV3/gameAssets/assetPolicy.ts');
  const b=Buffer.from(paddedSyntheticGlb()),n=b.readUInt32LE(12),doc=JSON.parse(b.subarray(20,20+n).toString()),bin=b.subarray(28+n);
  doc.buffers[0].uri='model.bin';doc.animations=[];const source=Buffer.from(JSON.stringify(doc));
  const prefix='https://dl.polyhaven.org/file/ph-assets/Models/gltf/1k/synthetic_table/';
  const leaf=(name,bytes)=>({url:prefix+name,size:bytes.length,md5:createHash('md5').update(bytes).digest('hex')});
  const info={type:2,name:'Synthetic Table',categories:['table'],authors:{'Original synthetic fixture':'All'},date_published:1,polycount:4,files_hash:'1'.repeat(40)};
  let calls=0,persisted=0;
  const discover=createPolyHavenDiscovery({async get(url){assert.equal(phase,'save');calls++;return url.includes('/search?')?{results:[{slug:'synthetic_table'}]}:url.includes('/info/')?info:{gltf:{'1k':{gltf:{...leaf('synthetic_table.gltf',source),include:{'model.bin':leaf('model.bin',bin)}}}}};}},async url=>{assert.equal(phase,'save');calls++;return url.endsWith('.gltf')?source:bin;});
  const store=gameAssetObjectStore();const outcome=await acquireGameAsset({subject:'table'},{cache:withDiscoveredAssetCache(createDurableAssetCache(store,[]),store),providers:[],discover,download:async()=>{throw Error('Unexpected curated download');},parse:async bytes=>{validateGlb(bytes);},persist:async(entry,bytes)=>{assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);persisted++;}},new AbortController().signal);
  assert.equal(outcome.kind,'model');assert.equal(persisted,1);
  const index='game-assets-public-cc/discovered/v1/table.json',bucket=admin.storage().bucket(process.env.WORKSPACE_ASSETS_BUCKET);
  const [metadata]=await bucket.file(index).getMetadata();assert.equal(metadata.cacheControl,'private, no-store');assert.equal(metadata.contentType,'application/json');
  if(phase==='restore'){assert.equal(outcome.cacheHit,true);assert.equal(outcome.downloadedBytes,0);assert.equal(calls,0);await bucket.file(index).delete();await bucket.file('game-assets-public-cc/v1/'+outcome.entry.sha256+'.glb').delete();}
  else {assert.equal(outcome.cacheHit,false);assert.equal(calls,6);}
  await admin.app().delete();
}
main().catch(e=>{console.error(e);process.exitCode=1;});
