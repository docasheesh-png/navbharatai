// Local-only Storage + Firestore drill. Supply already-downloaded emulator files; no network setup.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {join,resolve} from 'node:path';
import net from 'node:net';
const [cacheArg,firestoreArg]=process.argv.slice(2);
assert.ok(cacheArg && firestoreArg,'Supply verified storage-emulator cache directory and Firestore jar');
const require=createRequire(join(process.cwd(),'package.json'));
const info=require('firebase-tools/lib/emulator/downloadableEmulatorInfo.json');
const cacheDir=resolve(cacheArg),firestoreJar=resolve(firestoreArg);
for(const [spec,path] of [[info.storage,join(cacheDir,info.storage.downloadPathRelativeToCacheDir)],[info.firestore,firestoreJar]]){
  const bytes=await readFile(path);assert.equal(bytes.length,spec.expectedSize);assert.equal(createHash('sha256').update(bytes).digest('hex'),spec.expectedChecksumSHA256);
}
const dir=await mkdtemp('/tmp/nbai-storage-emulator-');
// These affect only this isolated local test process and its children, never cloud configuration.
process.env.TMPDIR=dir;process.env.FIREBASE_EMULATORS_PATH=cacheDir;
const {StorageEmulator}=require('firebase-tools/lib/emulator/storage');
const {EmulatorRegistry}=require('firebase-tools/lib/emulator/registry');
const rules="rules_version = '2'; service firebase.storage { match /b/{bucket}/o { match /{path=**} { allow read, write: if false; } } }";
const ruleFile=join(dir,'storage.rules');await writeFile(ruleFile,rules);
const storage=new StorageEmulator({projectId:'demo-navbharatai-phase2',host:'127.0.0.1',port:18783,auto_download:false,rules:{name:ruleFile,content:rules}});
const firestore=spawn('java',['-Xmx512m','-jar',firestoreJar,'--host','127.0.0.1','--port','18782','--project_id','demo-navbharatai-phase2','--single_project_mode','true','--single_project_mode_error','true'],{stdio:['ignore','ignore','inherit']});
async function ready(port){
  const until=Date.now()+30000;
  for(;;){const ok=await new Promise(r=>{const s=net.connect(port,'127.0.0.1');s.once('connect',()=>{s.destroy();r(true);});s.once('error',()=>r(false));});if(ok)return;if(Date.now()>until)throw Error('Local emulator startup deadline');await new Promise(r=>setTimeout(r,100));}
}
try{
  await EmulatorRegistry.start(storage);await Promise.all([ready(18782),ready(18783)]);
  const worker=spawn(process.execPath,['scripts/checks/gameAssetPersistence.check.mjs'],{stdio:'inherit',env:{...process.env,NBAI_STORAGE_DRILL:'1',FIRESTORE_EMULATOR_HOST:'127.0.0.1:18782',FIREBASE_STORAGE_EMULATOR_HOST:'127.0.0.1:18783',STORAGE_EMULATOR_HOST:'http://127.0.0.1:18783',WORKSPACE_ASSETS_BUCKET:'demo-navbharatai-phase2.appspot.com'}});
  const timer=setTimeout(()=>worker.kill(),90000);
  const result=await new Promise(r=>worker.once('exit',r));clearTimeout(timer);assert.equal(result,0,'Storage persistence worker failed');
}finally{await EmulatorRegistry.stop('storage');if(firestore.exitCode===null && firestore.signalCode===null){const stopped=new Promise(r=>firestore.once('exit',r));firestore.kill();await stopped;}await rm(dir,{recursive:true,force:true});}
