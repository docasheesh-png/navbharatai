import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { deleteUserData, purgeExpired, RETENTION_POLICIES } from './DataRetentionManager';
const owner = (uid: string) => createHash('sha256').update(`user:${uid}`).digest('hex');
function fixture() {
 const rows = new Map<string, Record<string, unknown>>(); let beforeTransaction = () => {};
 const ref = (id: string) => ({ id, get: async()=>({exists:rows.has(id)}), delete:async()=>{rows.delete(id);} });
 const db:any = { collection:(name:string)=>({doc:(id:string)=>ref(`${name}/${id}`), listDocuments:async()=>[],where:(field:string,op:string,value:any)=>{
  let cap=Infinity; const query={limit:(n:number)=>{cap=n;return query;},get:async()=>({docs:[...rows].filter(([id,data])=>id.startsWith(`${name}/`) && (op==='==' ? data[field]===value : typeof data[field]==='number' && (data[field] as number)<value)).slice(0,cap).map(([id])=>({ref:ref(id)}))})}; return query;
 }}),runTransaction:async(run:any)=>{beforeTransaction();beforeTransaction=()=>{};return run({get:async(r:any)=>({exists:rows.has(r.id),data:()=>rows.get(r.id)}),delete:(r:any)=>rows.delete(r.id)});} };
 return {db,rows,before:(fn:()=>void)=>{beforeTransaction=fn;}};
}
describe('Free answer quota account erasure and scheduled retention',()=>{
 it('erases only the verified user hash, not guest/IP/other-user records',async()=>{
  const f=fixture();f.rows.set('free_answer_quota/principal_a',{principalHash:owner('alice')}); f.rows.set('free_answer_quota/day_a',{principalHash:owner('alice')}); f.rows.set('free_answer_quota/attempt_a',{principalHash:owner('alice')}); f.rows.set('free_answer_quota/other',{principalHash:owner('bob')});f.rows.set('free_answer_quota/guest',{principalHash:'guest-hash'});f.rows.set('free_answer_quota/ip',{attempts:3});
  const result=await deleteUserData(f.db,'alice');expect(result.collections.find(r=>r.collection==='free_answer_quota')?.deleted).toBe(3); expect([...f.rows.keys()]).toHaveLength(3);
 });
 it('purges expired quota leaves, including abandoned guest principals, through existing schedule',async()=>{
  const policy=RETENTION_POLICIES.filter(p=>p.collection==='free_answer_quota');expect(policy).toHaveLength(1);const f=fixture();f.rows.set('free_answer_quota/old',{purgeAfterMs:1,active:null});f.rows.set('free_answer_quota/fresh',{purgeAfterMs:1001});const result=await purgeExpired(f.db,1000,policy);expect(result.totalDeleted).toBe(1);expect(f.rows.has('free_answer_quota/fresh')).toBe(true);
 });
 it('transaction rechecks a new reservation instead of deleting a refreshed principal',async()=>{
  const f=fixture();f.rows.set('free_answer_quota/principal',{purgeAfterMs:1,active:null}); f.before(()=>f.rows.set('free_answer_quota/principal',{purgeAfterMs:2000,active:{leaseExpiresAt:1500,deadlineAt:1900}}));const result=await purgeExpired(f.db,1000,RETENTION_POLICIES.filter(p=>p.collection==='free_answer_quota'));expect(result.totalDeleted).toBe(0);expect(f.rows.size).toBe(1);
 });
 it('fails closed without transactional deletion and never deletes an active lease',async()=>{
  const f=fixture(); f.rows.set('free_answer_quota/live',{purgeAfterMs:1,active:{leaseExpiresAt:1500,deadlineAt:1900}});const policies=RETENTION_POLICIES.filter(p=>p.collection==='free_answer_quota');expect((await purgeExpired(f.db,1000,policies)).totalDeleted).toBe(0);delete f.db.runTransaction;const result=await purgeExpired(f.db,1000,policies);expect(result.totalDeleted).toBe(0);expect(result.collections[0].error).toBeTruthy();
 });
});
