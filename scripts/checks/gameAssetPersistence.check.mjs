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
    console.log('PASS: real emulator acknowledged model/manifest writes; a separate process restored identical bytes, MIME and provenance. No Cloud Storage spill or live publication claim.');
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
  const {syntheticGlb,syntheticCandidate}=await import('../../src/server/AgentV3/gameAssets/assetFixtures.testSupport.ts');
  const bytes=syntheticGlb();const c=syntheticCandidate(bytes);const path=`public/game-assets/${c.sha256}.glb`;
  const manifest=JSON.stringify({schema:1,assets:[{subject:'synthetic-test-only',sha256:c.sha256,license:c.license}]});
  if(worker==='save'){
    await saveWorkspaceAssets(id,{[path]:`data:model/gltf-binary;base64,${bytes.toString('base64')}`},'synthetic-owner');
    assert.deepEqual(await readWorkspaceAssetBytes(id,path,5*1024*1024),bytes);
    assert.equal(await readWorkspaceAssetBytes(id,path,1),null);
    assert.equal(await readWorkspaceAssetBytes(id,'public/missing.glb',5*1024*1024),null);
    assert.equal((await mergeWorkspaceFiles(id,{'public/game-assets/manifest.json':manifest})).status,'saved');
  } else if(worker==='restore') {
    const dir=await mkdtemp(join(tmpdir(),'nbai-restored-asset-'));
    try {
      const n=await restoreWorkspaceAssets({writeBinaryFile:async(_id,p,base64)=>{assert.equal(p,path);const target=join(dir,p);await mkdir(dirname(target),{recursive:true});await writeFile(target,Buffer.from(base64,'base64'));}},id);
      assert.equal(n,1);assert.equal(createHash('sha256').update(await readFile(join(dir,path))).digest('hex'),c.sha256);
      assert.equal((await loadWorkspaceFilesByPath(id,['public/game-assets/manifest.json']))['public/game-assets/manifest.json'],manifest);
    } finally { await rm(dir,{recursive:true,force:true}); }
    await db.recursiveDelete(db.collection('workspace_assets_v3').doc(id));
    await db.recursiveDelete(db.collection('workspace_files_v3').doc(id));
  } else throw Error('Unknown drill worker');
  await db.terminate();await admin.app().delete();
}

}
main().catch(error => { console.error(error); process.exitCode = 1; });
