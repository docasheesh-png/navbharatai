// Real local Firestore save -> fresh-process restore. Never runs against a cloud database.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
async function main() {
const endpoint = process.env.FIRESTORE_EMULATOR_HOST;
assert.match(endpoint ?? '', /^127\.0\.0\.1:\d+$/, 'Requires an explicit local emulator');
assert.equal(process.env.VITEST, undefined);
const storageMode=process.env.NBAI_STORAGE_DRILL==='1';
if(storageMode){
  assert.match(process.env.FIREBASE_STORAGE_EMULATOR_HOST??'',/^127\.0\.0\.1:\d+$/);
  assert.equal(process.env.STORAGE_EMULATOR_HOST,'http://'+process.env.FIREBASE_STORAGE_EMULATOR_HOST);
  assert.equal(process.env.WORKSPACE_ASSETS_BUCKET,'demo-navbharatai-phase2.appspot.com');
}
const worker = process.argv[2];
const id = process.argv[3] ?? `synthetic-asset-${process.pid}`;
assert.match(id,/^synthetic-asset-\d+$/);
if (!worker) {
  // Production bundles server code to CJS; test that exact firebase-admin interop, not native-ESM
  // namespace semantics that differ from the running application.
  const { build } = await import('esbuild');
  const bundle = join(process.cwd(), 'scripts/checks', `.tmp-asset-persistence-${process.pid}.cjs`);
  try {
    await build({ entryPoints:[process.argv[1]], outfile:bundle, bundle:true, platform:'node', format:'cjs', packages:'external', logLevel:'silent' });
    for (const phase of ['save','restore']) {
      const r = spawnSync(process.execPath,[bundle,phase,id],{stdio:'inherit',timeout:30000,env:{...process.env,GCLOUD_PROJECT:'demo-navbharatai-phase2',GOOGLE_CLOUD_PROJECT:'demo-navbharatai-phase2',FIRESTORE_DATABASE_ID:'(default)'}});
      assert.equal(r.status,0,`${phase} worker failed`);
    }
    console.log(storageMode ? 'PASS: real local Firestore + Storage emulators acknowledged private-bucket spill, bounded CRC cache reads and fresh-process model/manifest restore. No production-cloud or live-publication claim.' : 'PASS: real emulator acknowledged model/manifest writes; a separate process restored identical bytes, MIME and provenance. No Cloud Storage spill or live publication claim.');
  } finally { await rm(bundle,{force:true}); }
} else {
  assert.equal(process.env.GCLOUD_PROJECT,'demo-navbharatai-phase2');
  const require=createRequire(join(process.cwd(),'package.json'));const admin=require('firebase-admin');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength:2048, privateKeyEncoding:{type:'pkcs8',format:'pem'}, publicKeyEncoding:{type:'spki',format:'pem'} });
  admin.initializeApp({projectId:'demo-navbharatai-phase2',credential:admin.credential.cert({projectId:'demo-navbharatai-phase2',clientEmail:'synthetic@demo-navbharatai-phase2.iam.gserviceaccount.com',privateKey})});
  const db=require('firebase-admin/firestore').getFirestore(admin.app(),'(default)');db.settings({ignoreUndefinedProperties:true});
  const {setServerDb}=await import('../../src/server/lib/serverDb.ts');setServerDb(db);
  const {saveWorkspaceAssets,readWorkspaceAssetBytes,restoreWorkspaceAssets}=await import('../../src/server/AgentV3/WorkspaceAssetStore.ts');
  const {mergeWorkspaceFiles,loadWorkspaceFilesByPath}=await import('../../src/server/AgentV3/WorkspaceFileStore.ts');
  const {paddedSyntheticGlb,syntheticCandidate,encodeFixtureGlb}=await import('../../tests/fixtures/gameAssetFixtures.ts');
  const {compactGlb}=await import('../../src/server/AgentV3/gameAssets/assetOptimize.ts');
  const optimized=compactGlb(paddedSyntheticGlb());assert.ok(optimized.savedBytes>64000);
  let bytes=Buffer.from(optimized.bytes);
  if(storageMode){
    const n=bytes.readUInt32LE(12);const doc=JSON.parse(bytes.subarray(20,20+n).toString());
    const bin=Buffer.concat([bytes.subarray(28+n),Buffer.alloc(800*1024)]);doc.buffers[0].byteLength=bin.length;
    bytes=encodeFixtureGlb(doc,bin); // Valid synthetic large file forces the existing spill path.
  }
  const c={...syntheticCandidate(bytes),...(storageMode?{}:{optimization:'compact-v1',sourceSha256:optimized.sourceSha256})};const path=`public/game-assets/${c.sha256}.glb`;
  const cacheKey='game-assets-public-cc/v1/'+c.sha256+'.glb';
  const {gameAssetObjectStore}=await import('../../src/server/AgentV3/gameAssets/objectStore.ts');
  const cache=storageMode?gameAssetObjectStore():undefined;
  const manifest=JSON.stringify({schema:1,assets:[{subject:'synthetic-test-only',candidate:c}]});
  if(worker==='save'){
    await saveWorkspaceAssets(id,{[path]:`data:model/gltf-binary;base64,${bytes.toString('base64')}`},'synthetic-owner');
    assert.deepEqual(await readWorkspaceAssetBytes(id,path,5*1024*1024),bytes);
    if(cache){
      const stored=(await db.collection('workspace_assets_v3').doc(id).collection('assets').get()).docs[0].data();
      assert.equal(typeof stored.storageObject,'string');assert.equal(stored.dataUri,undefined);
      console.log('STORAGE_STAGE: spill acknowledged');
      await cache.write(cacheKey,bytes,'model/gltf-binary');console.log('STORAGE_STAGE: cache written');
      assert.deepEqual(await cache.read(cacheKey,5*1024*1024),bytes);console.log('STORAGE_STAGE: cache read');
      await assert.rejects(()=>cache.read(cacheKey,1),/exceeds budget/);console.log('STORAGE_STAGE: oversized read rejected');
      // The unmodified SDK + local HTTP emulator resets an immediately reused keepalive socket
      // after abort (reproduced independently). Let local socket cleanup settle, without retrying
      // or relaxing the size/CRC assertions. This does not prove same-tick recovery in production.
      await new Promise(resolve=>setTimeout(resolve,10));
      const [meta]=await admin.storage().bucket(process.env.WORKSPACE_ASSETS_BUCKET).file(cacheKey).getMetadata();
      assert.equal(meta.contentType,'model/gltf-binary');assert.match(meta.cacheControl,/private/);
    }
    assert.equal(await readWorkspaceAssetBytes(id,path,1),null);
    if(storageMode)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(await readWorkspaceAssetBytes(id,'public/missing.glb',5*1024*1024),null);
    assert.equal((await mergeWorkspaceFiles(id,{'public/game-assets/manifest.json':manifest})).status,'saved');
  } else if(worker==='restore') {
    const dir=await mkdtemp(join(tmpdir(),'nbai-restored-asset-'));
    try {
      const n=await restoreWorkspaceAssets({writeBinaryFile:async(_id,p,base64)=>{assert.equal(p,path);const target=join(dir,p);await mkdir(dirname(target),{recursive:true});await writeFile(target,Buffer.from(base64,'base64'));}},id);
      assert.equal(n,1);assert.equal(createHash('sha256').update(await readFile(join(dir,path))).digest('hex'),c.sha256);
      assert.equal((await loadWorkspaceFilesByPath(id,['public/game-assets/manifest.json']))['public/game-assets/manifest.json'],manifest);
    } finally { await rm(dir,{recursive:true,force:true}); }
    if(cache){
      assert.deepEqual(await cache.read(cacheKey,5*1024*1024),bytes);
      const entries=await db.collection('workspace_assets_v3').doc(id).collection('assets').get();
      for(const entry of entries.docs){const object=entry.data().storageObject;assert.match(object,/^workspace-assets-v2\//);await admin.storage().bucket(process.env.WORKSPACE_ASSETS_BUCKET).file(object).delete();}
      await admin.storage().bucket(process.env.WORKSPACE_ASSETS_BUCKET).file(cacheKey).delete();
    }
    await db.recursiveDelete(db.collection('workspace_assets_v3').doc(id));
    await db.recursiveDelete(db.collection('workspace_files_v3').doc(id));
  } else throw Error('Unknown drill worker');
  await db.terminate();await admin.app().delete();
}

}
main().catch(error => { console.error(error); if(process.argv[2])process.exit(1); process.exitCode = 1; });
