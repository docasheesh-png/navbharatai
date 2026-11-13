/** Retry-safe app-lock decisions. No external side effects; the transaction caller commits before replying. */
import { hasPin,pinGate,afterWrongPin,afterCorrectPin,matchesPin,hashPin,otpCheck,otpSendGate,afterOtpSent,type VaultPinRecord,type OtpPurpose } from './vaultPin';
export interface LockDecision { status: number; body: Record<string,unknown>; audit?: { action: string; details: Record<string,unknown> }; grant?: true }
export interface LockTransition { next?: VaultPinRecord; result: LockDecision }
const refusal=(status:number,body:Record<string,unknown>):LockTransition=>({result:{status,body}});
export function attemptPin(r:VaultPinRecord,pin:string,now:number,newPin?:{pin:string;salt:string}):LockTransition {
 if(!hasPin(r))return refusal(409,{error:'Set up your PIN first.',needsSetup:true});
 const gate=pinGate(r,now);
 if(gate.locked){const mins=Math.ceil(gate.lockedForMs/60000);return refusal(429,{error:`Too many wrong PINs. Try again in ${mins} minute${mins===1?'':'s'}, or use "Forgot PIN".`,lockedForMs:gate.lockedForMs});}
 if(!matchesPin(pin,r.pinSalt,r.pinHash)){
  const next=afterWrongPin(r,now),after=pinGate(next,now),mins=Math.ceil(after.lockedForMs/60000);
  return {next,result:{status:after.locked?429:401,body:after.locked?{error:`Too many wrong PINs. Your app lock is held for ${mins} minute${mins===1?'':'s'}.`,lockedForMs:after.lockedForMs}:{error:`${newPin?'Your current PIN':'That PIN'} is not right. ${after.attemptsLeft} ${after.attemptsLeft===1?'try':'tries'} left before it locks for a while.`,attemptsLeft:after.attemptsLeft},audit:{action:'pin-refused',details:{attempts_left:after.attemptsLeft,...(newPin?{during:'change'}:{})}}}};
 }
 if(newPin?.pin===pin)return refusal(400,{error:'Your new PIN is the same as the current one. Choose a different PIN.'});
 return {next:afterCorrectPin(newPin?{...r,pinHash:hashPin(newPin.pin,newPin.salt),pinSalt:newPin.salt}:r),result:{status:200,body:newPin?{success:true}:{},grant:true,audit:{action:newPin?'pin-changed':'unlock',details:{unlock_method:'pin'}}}};
}
export function setPin(r:VaultPinRecord,input:{pin:string;salt:string;otp:string;fresh:boolean;now:number}):LockTransition {
 const check=input.fresh?{ok:true,next:r,reason:''}:otpCheck(r,input.otp,input.now);
 if(!check.ok)return {next:check.next,result:{status:400,body:{error:check.reason}}};
 const next=afterCorrectPin({...check.next,pinHash:hashPin(input.pin,input.salt),pinSalt:input.salt});
 return {next,result:{status:200,body:{success:true},grant:true,audit:{action:hasPin(r)?'pin-reset':'pin-created',details:{}}}};
}
export function reserveOtp(r:VaultPinRecord,code:string,purpose:OtpPurpose,now:number):LockTransition {
 const gate=otpSendGate(r,now);if(!gate.allowed)return refusal(429,{error:gate.reason,waitMs:gate.waitMs});
 return {next:afterOtpSent(r,code,purpose,now),result:{status:200,body:{}}};
}
