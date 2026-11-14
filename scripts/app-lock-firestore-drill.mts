/** Two independent clients; loopback/demo-only, synthetic records, never provider emails or real users. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Loopback emulator required');
process.env.VITEST='true';
const {setServerDb}=await import('../src/server/lib/serverDb.ts');
const {loadLockRecord,updateLockRecord}=await import('../src/server/lib/appLockStore.ts');
const {attemptPin,setPin,reserveOtp}=await import('../src/server/lib/appLockTransitions.ts');
const {emptyPinRecord,writePinRecord,readPinRecord,hashPin,afterOtpSent,pinGate}=await import('../src/server/lib/vaultPin.ts');
const apps=[initializeApp({projectId:'demo-navbharatai-phase2'},'lock-a'),initializeApp({projectId:'demo-navbharatai-phase2'},'lock-b')];
const clients=apps.map(a=>getFirestore(a));const uid='synthetic-'+randomUUID();const ref=clients[0].doc('user_vault_pin/'+uid);const now=Date.now();
function update(index:number,fn:any){setServerDb(clients[index%2]);return updateLockRecord(uid,fn);}
const initial=()=>({...emptyPinRecord(),pinSalt:'synthetic-salt',pinHash:hashPin('8274','synthetic-salt')});
try{
 setServerDb(null);await assert.rejects(()=>loadLockRecord(uid),/unavailable/);
 await ref.set(writePinRecord(initial()));
 const wrong=await Promise.all(Array.from({length:5},(_,i)=>update(i,r=>attemptPin(r,'9152',now,i%2?{pin:'3682',salt:'new-salt'}:undefined))));
 assert.equal(wrong.filter((r:any)=>r.status===401).length,4);assert.equal(wrong.filter((r:any)=>r.status===429).length,1);
 assert.equal(pinGate(readPinRecord((await ref.get()).data()),now).locked,true);
 await ref.set(writePinRecord(afterOtpSent(initial(),'738194','reset',now)));
 const consumed=await Promise.all([0,1].map(i=>update(i,r=>setPin(r,{pin:'3682',salt:'new-salt',otp:'738194',fresh:false,now}))));
 assert.equal(consumed.filter((r:any)=>r.grant).length,1);assert.equal(readPinRecord((await ref.get()).data()).otpHash,'');
 await ref.set(writePinRecord(initial()));
 const sends=await Promise.all([0,1].map(i=>update(i,r=>reserveOtp(r,'738194','reset',now))));
 assert.deepEqual(sends.map((r:any)=>r.status).sort(),[200,429]);
 await ref.set(writePinRecord(initial()));
 await Promise.all([update(0,r=>attemptPin(r,'9152',now)),update(1,r=>({next:{...r,lockedAreas:['api_keys','wallet_recharge']},result:true}))]);
 const final=readPinRecord((await ref.get()).data());assert.equal(final.failCount,1);assert.ok(final.lockedAreas.includes('wallet_recharge'));
 console.log(JSON.stringify({passed:true,clients:2,cases:['db-null','shared-unlock-change-lockout','otp-single-consumption','send-reservation','areas-counter-preserved']}));
}finally{await ref.delete();setServerDb(null);await Promise.all(clients.map(db=>db.terminate()));await Promise.all(apps.map(deleteApp));}
