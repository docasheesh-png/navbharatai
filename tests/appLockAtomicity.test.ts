import {describe,it,expect,vi,beforeEach} from 'vitest';
import {emptyPinRecord,writePinRecord,readPinRecord,hashPin,afterOtpSent,pinGate} from '../src/server/lib/vaultPin';
import {attemptPin,setPin,reserveOtp} from '../src/server/lib/appLockTransitions';
const state=vi.hoisted(()=>({available:true,doc:null as any,revision:0,retries:0,fail:false}));
vi.mock('../src/server/lib/serverDb',()=>({
 getServerDb:()=>state.available?{}:null,doc:()=>({}),
 getDoc:async()=>{const value=structuredClone(state.doc);return {exists:()=>value!==null,data:()=>value};},setDoc:vi.fn(),
 runTransaction:async(_db:any,fn:any)=>{
  for(let n=0;n<50;n++){
   const rev=state.revision,value=structuredClone(state.doc);let staged:any;
   const result=await fn({get:async()=>({exists:()=>value!==null,data:()=>value}),set:(_r:any,d:any)=>{staged=d;}});
   await Promise.resolve();
   if(rev!==state.revision){state.retries++;continue;}
   if(state.fail)throw Error('commit unavailable');
   if(staged){state.doc={...state.doc,...staged};state.revision++;}return result;
  }throw Error('contention');
 }
}));
import {loadLockRecord,updateLockRecord} from '../src/server/lib/appLockStore';
const now=1700000000000;
beforeEach(()=>{state.available=true;state.doc=null;state.revision=0;state.retries=0;state.fail=false;});
describe('app lock fail closed and cross-instance atomic attempts',()=>{
 it('distinguishes missing DB from missing document',async()=>{
  expect(await loadLockRecord('u')).toEqual(emptyPinRecord());state.available=false;
  await expect(loadLockRecord('u')).rejects.toThrow('unavailable');
  await expect(updateLockRecord('u',r=>({result:r}))).rejects.toThrow('unavailable');
 });
 it('reproduces the former read/set lost update without touching a real account',()=>{
  const first=emptyPinRecord(),second={...first};
  const a={...first,failCount:first.failCount+1},b={...second,failCount:second.failCount+1};
  let saved=a;saved=b;expect(saved.failCount).toBe(1);
 });
 it('concurrent wrong PINs reach lockout, not one overwritten attempt',async()=>{
  state.doc=writePinRecord({...emptyPinRecord(),pinSalt:'salt',pinHash:hashPin('8274','salt')});
  const result=await Promise.all(Array.from({length:12},()=>updateLockRecord('u',r=>attemptPin(r,'9152',now))));
  expect(state.retries).toBeGreaterThan(0);expect(pinGate(readPinRecord(state.doc),now).locked).toBe(true);
  expect(result.filter(r=>r.status===401)).toHaveLength(4);expect(result.filter(r=>r.status===429)).toHaveLength(8);
 });
 it('concurrent wrong OTPs consume the bounded allowance and cannot accept the code after exhaustion',async()=>{
  state.doc=writePinRecord(afterOtpSent(emptyPinRecord(),'738194','create',now));
  await Promise.all(Array.from({length:12},()=>updateLockRecord('u',r=>setPin(r,{pin:'8274',salt:'salt',otp:'111111',fresh:false,now}))));
  const correct=await updateLockRecord('u',r=>setPin(r,{pin:'8274',salt:'salt',otp:'738194',fresh:false,now}));
  expect(correct.grant).toBeUndefined();expect(correct.status).toBe(400);expect(readPinRecord(state.doc).pinHash).toBe('');
 });
 it('one OTP can reset the PIN only once and is consumed in the same commit',async()=>{
  state.doc=writePinRecord(afterOtpSent(emptyPinRecord(),'738194','create',now));
  const result=await Promise.all(Array.from({length:8},()=>updateLockRecord('u',r=>setPin(r,{pin:'8274',salt:'salt',otp:'738194',fresh:false,now}))));
  expect(result.filter(r=>r.grant)).toHaveLength(1);expect(readPinRecord(state.doc).otpHash).toBe('');
 });
 it('concurrent sends reserve only one code and preserve other lock settings',async()=>{
  state.doc=writePinRecord({...emptyPinRecord(),lockedAreas:['api_keys','wallet_recharge']});
  const result=await Promise.all(Array.from({length:6},()=>updateLockRecord('u',r=>reserveOtp(r,'738194','create',now))));
  expect(result.filter(r=>r.status===200)).toHaveLength(1);expect(readPinRecord(state.doc).lockedAreas).toContain('wallet_recharge');
 });
 it('commit failure yields no grant and does not consume code or change PIN',async()=>{
  state.doc=writePinRecord(afterOtpSent(emptyPinRecord(),'738194','create',now));const before=structuredClone(state.doc);state.fail=true;
  await expect(updateLockRecord('u',r=>setPin(r,{pin:'8274',salt:'salt',otp:'738194',fresh:false,now}))).rejects.toThrow('commit');expect(state.doc).toEqual(before);
 });
});
