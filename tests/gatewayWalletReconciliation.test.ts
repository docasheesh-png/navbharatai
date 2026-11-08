import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({docs:new Map<string,any>(),queue:Promise.resolve() as Promise<any>,lose:false,fail:false}));
vi.mock('../src/server/lib/serverDb',()=>({
 doc:(_db:unknown,c:string,id:string)=>`${c}/${id}`,
 getDoc:async(ref:string)=>({exists:()=>state.docs.has(ref),data:()=>structuredClone(state.docs.get(ref))}),
 runTransaction:(_db:unknown,run:(tx:any)=>Promise<any>)=>{
  const work=state.queue.then(async()=>{
   const writes=new Map<string,unknown>();
   const result=await run({get:async(ref:string)=>({exists:()=>state.docs.has(ref),data:()=>structuredClone(state.docs.get(ref))}),set:(ref:string,value:unknown)=>writes.set(ref,structuredClone(value))});
   if(state.fail){state.fail=false;throw new Error('synthetic precommit failure');}
   for(const [k,v] of writes)state.docs.set(k,v);
   if(state.lose){state.lose=false;throw new Error('synthetic lost commit response');} return result;
  });state.queue=work.catch(()=>{});return work;
 }
}));
vi.mock('../src/server/lib/ledgerV2',()=>({withLedgerV2:(_t:unknown,_d:unknown,_o:unknown,_c:unknown,next:unknown)=>next}));
import {debitWalletRolledUp} from '../src/server/lib/walletDebit';
const db={}; const tx=(ids=['dispatch-a'],day='day-one',amount=1)=>({billedInr:amount,rollupRef:day,description:'NavBharatAI assistants',operationIds:ids});
beforeEach(()=>{state.docs.clear();state.queue=Promise.resolve();state.lose=false;state.fail=false;vi.stubEnv('WALLET_MERGE_RESOLVE','off');state.docs.set('user_token_wallets/user',{userId:'user',tokenBalance:10000,totalTokensUsed:0,remaining_balance:100,walletLedger:[]});});
afterEach(()=>vi.unstubAllEnvs());
describe('transactional Gateway wallet reconciliation',()=>{
 it('charges concurrent retries once and survives a rolled ledger/new day',async()=>{
  const result=await Promise.all(Array.from({length:8},()=>debitWalletRolledUp(db,'user',tx())));
  expect(result.every(r=>r.ok)).toBe(true); expect(result.reduce((n,r)=>n+(r.ok?r.tokensDebited:0),0)).toBe(100);
  const before=structuredClone(state.docs.get('user_token_wallets/user'));
  state.docs.set('user_token_wallets/user',{...before,walletLedger:[]});
  expect(await debitWalletRolledUp(db,'user',tx(['dispatch-a'],'day-two'))).toMatchObject({ok:true,tokensDebited:0});
  expect(state.docs.get('user_token_wallets/user').tokenBalance).toBe(before.tokenBalance);
 });
 it('reconciles a lost commit response without charging again',async()=>{
  state.lose=true;expect(await debitWalletRolledUp(db,'user',tx())).toMatchObject({ok:false});
  const before=structuredClone(state.docs.get('user_token_wallets/user'));
  expect(await debitWalletRolledUp(db,'user',tx())).toMatchObject({ok:true,tokensDebited:0});
  expect(state.docs.get('user_token_wallets/user')).toEqual(before);
 });
 it('can retry a true transaction failure, with no premature dedupe receipt',async()=>{
  state.fail=true;expect(await debitWalletRolledUp(db,'user',tx())).toMatchObject({ok:false});
  expect(state.docs.get('user_token_wallets/user').tokenBalance).toBe(10000);
  expect(await debitWalletRolledUp(db,'user',tx())).toMatchObject({ok:true,tokensDebited:100});
 });
 it('keeps sub-token carry exactly once and refuses overlapping charge groups',async()=>{
  await debitWalletRolledUp(db,'user',tx(['a'],'day',0.004)); const before=structuredClone(state.docs.get('user_token_wallets/user'));
  await debitWalletRolledUp(db,'user',tx(['a'],'day',0.004));expect(state.docs.get('user_token_wallets/user')).toEqual(before);
  expect(await debitWalletRolledUp(db,'user',tx(['a','b']))).toMatchObject({ok:false});expect(state.docs.get('user_token_wallets/user')).toEqual(before);
 });
 it('dedupes using verified principal identity even after canonical wallet migration',async()=>{
  await debitWalletRolledUp(db,'user',tx()); const before=structuredClone(state.docs.get('user_token_wallets/user'));
  state.docs.set('user_token_wallets/canonical',{...before,userId:'canonical'});
  state.docs.set('user_token_wallets/user',{...before,mergedInto:'canonical'});vi.stubEnv('WALLET_MERGE_RESOLVE','on');
  expect(await debitWalletRolledUp(db,'user',tx())).toMatchObject({ok:true,tokensDebited:0});expect(state.docs.get('user_token_wallets/canonical').tokenBalance).toBe(before.tokenBalance);
 });
});
