import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { mintAdminToken, verifyAdminTokenValue, adminTokenTtlMs } from '../src/server/lib/adminAuth';
const state = vi.hoisted(() => ({ docs: new Map<string, any>(), writes: [] as Array<{path: string; data: any}> }));
vi.mock('../src/server/lib/serverDb', async (original) => ({
  ...(await original<typeof import('../src/server/lib/serverDb')>()),
  doc: (_db: unknown, collection: string, id: string) => ({ path: `${collection}/${id}` }),
  runTransaction: async (_db: unknown, fn: (tx: any) => Promise<any>) => {
    const pending: Array<{path: string; data: any; replace: boolean}> = [];
    const result = await fn({
      get: async ({ path }: {path: string}) => ({ exists: () => state.docs.has(path), data: () => structuredClone(state.docs.get(path)) }),
      update: ({ path }: {path: string}, data: any) => { pending.push({ path, data, replace: false }); },
      set: ({ path }: {path: string}, data: any) => { pending.push({ path, data, replace: true }); },
    });
    for (const p of pending) { state.docs.set(p.path, p.replace ? p.data : {...state.docs.get(p.path), ...p.data}); state.writes.push(p); }
    return result;
  },
}));
import { previewAdminGiftReclassification, confirmAdminGiftReclassification } from '../src/server/lib/adminGiftReclassification';
import { maskWalletForView } from '../src/server/lib/freeProgram';
import { buildWalletStatement } from '../src/server/lib/walletStatement';
import { computeDebitedWallet } from '../src/server/lib/walletDebit';
import { paidSpendableTokens } from '../src/server/lib/giftSpend';
import { setFreeProgramPausedHint } from '../src/server/lib/freeProgramHint';
const NOW = '2026-10-26T00:00:00.000Z';
const UID = 'synthetic-owner'; const PATH = `user_token_wallets/${UID}`;
const wallet = () => ({ tokenBalance: 1200, remaining_balance: 12, giftTokensRemaining: 1000, totalMoneySpent: 2,
  totalTokensPurchased: 200, total_balance: 12, freeGiftedTokens: 1000, tokenCarry: 0.75,
  walletLedger: [], updatedAt: NOW });
const priorFlag = process.env.WALLET_MERGE_RESOLVE;
beforeEach(() => { state.docs.clear(); state.writes=[]; state.docs.set(PATH,wallet()); process.env.WALLET_MERGE_RESOLVE='on'; });
afterEach(() => { if (priorFlag === undefined) delete process.env.WALLET_MERGE_RESOLVE; else process.env.WALLET_MERGE_RESOLVE=priorFlag; setFreeProgramPausedHint(null); });
const confirm = async (amount=500, requestId='reclass-test-0001') => {
  const preview = await previewAdminGiftReclassification({},UID,amount);
  return confirmAdminGiftReclassification({}, {userId:UID,amount,fingerprint:preview.fingerprint,requestId,reason:'Explicit existing gift policy decision'}, NOW);
};

describe('admin-only explicit reclassification of existing gifts', () => {
  it('preview performs no writes and exposes only account-specific eligibility facts', async () => {
    const before = structuredClone(state.docs.get(PATH));
    const p=await previewAdminGiftReclassification({},UID,500);
    expect(state.docs.get(PATH)).toEqual(before); // Includes ledger, all counters and carry.
    expect(state.writes).toEqual([]); expect(p.balanceTokens).toBe(1200);expect(p.availableGiftTokens).toBe(1000);
    expect(p.afterAdminTokens).toBe(500);expect(p.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.keys(p).sort()).toEqual(['requestedUserId','canonicalUserId','accountEmail','amount','balanceTokens','remainingInr','giftTokens','adminTokens','availableGiftTokens','afterAdminTokens','fingerprint'].sort());
  });
  it('confirmation changes eligibility only, never deposits, purchased money, total gift, carry or payment identity', async () => {
    const before=structuredClone(state.docs.get(PATH)); const result=await confirm(); const w=state.docs.get(PATH);
    expect(result.reclassifiedTokens).toBe(500);expect(w.adminBuildTokensRemaining).toBe(500);
    for(const key of Object.keys(before).filter(k=>!['walletLedger','updatedAt'].includes(k))) expect(w[key]).toEqual(before[key]);
    expect(w.adminBuildTokensTotalGranted).toBeUndefined(); expect(paidSpendableTokens(w)).toBe(200);
    expect(w.walletLedger[0]).toMatchObject({type:'admin_reclassification',amountCoinsOrTokens:0,moneySpent:0,adminBuildTokensDelta:500});
    expect(w.walletLedger[0].description).toContain('no new credit');expect(state.writes).toHaveLength(2);
  });
  it('zero-amount provenance history stays zero after paused projection and does not fabricate a deposit', async () => {
    state.docs.set(PATH,{...wallet(), tokenBalance:1000,remaining_balance:10,totalMoneySpent:0,totalTokensPurchased:0});
    await confirm(); const w=state.docs.get(PATH);const view=maskWalletForView(w,true);
    expect(view.tokenBalance).toBe(500);expect(view.total_balance).toBe(0);expect(view.totalTokensPurchased).toBe(0);
    expect((view.walletLedger as any[])[0].amountCoinsOrTokens).toBe(0);
    expect(buildWalletStatement(view).verdict).toBe('unknown');
    setFreeProgramPausedHint(true);
    const weak=computeDebitedWallet(w,{feature:'build',adminCreditEligible:true,billedInr:1,floorInr:0,buildRef:'weak',description:'Weak build'},NOW);
    expect(weak.tokensDebited).toBe(100);expect(weak.wallet.adminBuildTokensRemaining).toBe(400);
    const normal=computeDebitedWallet(w,{feature:'build',adminCreditEligible:false,billedInr:1,floorInr:0,buildRef:'normal',description:'Normal build'},NOW);
    expect(normal.tokensDebited).toBe(0);expect(normal.wallet.adminBuildTokensRemaining).toBe(500);
    expect(w.tokenCarry).toBe(0.75);expect(weak.wallet.cashRequiredTokenCarry).toBe(0.75);
  });
  it('replay is durable and bound to amount, target, preview and reason', async () => {
    const p=await previewAdminGiftReclassification({},UID,500);
    const input={userId:UID,amount:500,fingerprint:p.fingerprint,requestId:'reclass-test-0001',reason:'Explicit existing gift policy decision'};
    await confirmAdminGiftReclassification({},input,NOW);const count=state.writes.length;
    state.docs.get(PATH).walletLedger=[];
    expect((await confirmAdminGiftReclassification({},input,NOW)).replayed).toBe(true);expect(state.writes).toHaveLength(count);
    for(const change of [{amount:100},{userId:'other'},{fingerprint:'a'.repeat(64)},{reason:'Different approved reason'}]) {
      await expect(confirmAdminGiftReclassification({}, {...input,...change},NOW)).rejects.toThrow('different reclassification');
    }
    expect(state.docs.get(PATH).adminBuildTokensRemaining).toBe(500);
  });
  it.each([
    ['missing provenance',{giftTokensRemaining:undefined},'provenance is missing'],
    ['overstated gift',{giftTokensRemaining:1300},'inconsistent'],
    ['negative total',{tokenBalance:-1},'inconsistent'],
    ['bad admin subset',{adminBuildTokensRemaining:1100},'inconsistent'],
    ['fractional provenance',{giftTokensRemaining:999.5},'inconsistent'],
    ['suspended',{banned:true},'suspended'],
    ['open reservation',{walletLedger:[{openHolds:[{id:'hold',owed:0.5}]}]},'pending wallet reservations'],
  ])('refuses %s without writes',async(_label,patch,reason)=>{
    state.docs.set(PATH,{...wallet(),...patch});
    await expect(previewAdminGiftReclassification({},UID,500)).rejects.toThrow(reason as string);expect(state.writes).toEqual([]);
  });
  it.each([0,-1,0.5,1001,10_000_001,NaN,Infinity])('refuses invalid/excessive amount %s without writes',async(amount)=>{
    await expect(previewAdminGiftReclassification({},UID,amount)).rejects.toThrow();expect(state.writes).toEqual([]);
  });
  it.each(['balance','hold','merge','usage'])('stale %s preview cannot be confirmed',async(change)=>{
    const p=await previewAdminGiftReclassification({},UID,500); const w=state.docs.get(PATH);
    if(change==='balance')w.tokenBalance+=1;
    if(change==='hold')w.walletLedger=[{openHolds:[{id:'new-hold',owed:1}]}];
    if(change==='usage')w.walletLedger=[{type:'usage',amountCoinsOrTokens:0,description:'Pending fractional usage'}];
    if(change==='merge'){w.mergedInto='canonical';state.docs.set('user_token_wallets/canonical',wallet());}
    await expect(confirmAdminGiftReclassification({}, {userId:UID,amount:500,fingerprint:p.fingerprint,requestId:'stale-test-0001',reason:'Explicit existing gift decision'},NOW)).rejects.toThrow();
    expect(state.writes).toEqual([]);
  });
  it('canonical resolution stays transactional and preserves request identity after merging',async()=>{
    state.docs.set(PATH,{...wallet(),mergedInto:'canonical'});state.docs.set('user_token_wallets/canonical',wallet());
    const p=await previewAdminGiftReclassification({},UID,500);expect(p.canonicalUserId).toBe('canonical');
    const r=await confirm();expect(r.canonicalUserId).toBe('canonical');expect(state.docs.get(PATH).adminBuildTokensRemaining).toBeUndefined();
    expect(state.docs.get('user_token_wallets/canonical').adminBuildTokensRemaining).toBe(500);
  });
  it('both routes require admin authorization and the UI explicitly previews before confirming',()=>{
    const route=readFileSync('src/server/routes/admin.ts','utf8');const ui=readFileSync('src/components/AdminDashboard.tsx','utf8');
    for(const action of ['preview','confirm'])expect(route).toContain(`app.post('/api/admin/users/:userId/weak-credit/${action}', verifyAdminToken,`);
    expect(ui).toContain('Existing gifts → Weak');expect(ui).toContain('Reclassify — no new credit');expect(ui).toContain('fingerprint: a.preview.fingerprint');
    expect(ui).toContain('requestId: a.requestId');expect(ui).toContain('canonicalUserId');
  });
  it('executes both actual registered handlers behind the real HMAC/TTL middleware before any wallet access', async () => {
    const source=readFileSync('src/server/routes/admin.ts','utf8');
    const auth=source.slice(source.indexOf('  const verifyAdminToken ='), source.indexOf('  registerLiveModelRegistryRoutes'));
    const routes=source.slice(source.indexOf('  // Separate from adding tokens:'), source.indexOf('  // ── User token adjustment'));
    const code=ts.transpileModule(auth+'\n'+routes,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
    const registered=new Map<string,Array<(...args:any[])=>any>>();
    const register=(path:string,...handlers:Array<(...args:any[])=>any>)=>registered.set(path,handlers);
    const app={post:register,get:register}; // The adjacent read-only receipt route registers a GET too.
    const pass='synthetic-admin-test-only';let signingKey='synthetic-independent-signing-key-only';const username='synthetic-admin';let accesses=0;
    const install=new Function('app','adminPassword','adminSessionSigningKey','adminUsername','verifyAdminTokenValue','adminTokenTtlMs','audit','routeParams','getDb','previewAdminGiftReclassification','confirmAdminGiftReclassification','AdminGiftReclassificationError',code);
    const {AdminGiftReclassificationError}=await import('../src/server/lib/adminGiftReclassification');
    install(app,()=>pass,()=>signingKey,()=>username,verifyAdminTokenValue,adminTokenTtlMs,()=>{},(p:any)=>p,()=>({}),
      (...args:Parameters<typeof previewAdminGiftReclassification>)=>{accesses++;return previewAdminGiftReclassification(...args);},
      (...args:Parameters<typeof confirmAdminGiftReclassification>)=>{accesses++;return confirmAdminGiftReclassification(...args);},AdminGiftReclassificationError);
    const dispatch=async(action:string,token:string|undefined,body:any)=>{
      const path=`/api/admin/users/:userId/weak-credit/${action}`;
      let status=200;let payload:any;
      const res={status(n:number){status=n;return this;},json(p:any){payload=p;return this;}};
      const req={headers:token?{'x-admin-token':token}:{},params:{userId:UID},body,path,ip:'127.0.0.1'};
      for(const handler of registered.get(path)!){let next=false;await handler(req,res,()=>{next=true;});if(!next)break;}
      return {status,payload};
    };
    for(const action of ['preview','confirm'])for(const token of [undefined,'ordinary-user-token',mintAdminToken(signingKey,username,Date.now()-200*86400000),mintAdminToken(pass,username,Date.now())]) {
      expect((await dispatch(action,token,{amount:500})).status).toBe(401);
    }
    expect(accesses).toBe(0);expect(state.writes).toEqual([]);
    const token=mintAdminToken(signingKey,username,Date.now());
    const configuredKey=signingKey; signingKey='';
    for(const action of ['preview','confirm'])expect((await dispatch(action,token,{amount:500})).status).toBe(401);
    expect(accesses).toBe(0);expect(state.writes).toEqual([]); signingKey=configuredKey;
    const preview=await dispatch('preview',token,{amount:500});expect(preview.status).toBe(200);expect(state.writes).toEqual([]);
    const done=await dispatch('confirm',token,{amount:500,fingerprint:preview.payload.preview.fingerprint,requestId:'route-test-0001',reason:'Explicit existing gift decision'});
    expect(done.status).toBe(200);expect(done.payload.ok).toBe(true);expect(state.docs.get(PATH).tokenBalance).toBe(1200);
    expect(state.docs.get(PATH).adminBuildTokensRemaining).toBe(500);
  });

});
