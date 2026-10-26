import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { Sandbox } from 'e2b';
import { CanaryReservationStore, type CanaryAuthority } from './canarySpendGuard';
import { CanarySandboxController, e2bCanaryProvider } from './canarySandboxController';
import { type CanarySandboxManifest, sandboxManifestHash } from './canarySandboxPolicy';
import { canaryWorkspaceId } from './canaryIsolation';
import { database } from './canarySandboxTestDb';
const now = 1_800_000_000_000;
const key = 'synthetic-test-key';
const hash = createHash('sha256').update(key).digest('hex');
const binding = { uid: 'synthetic', requestId: 'todo', fixtureHash: 'a'.repeat(64), tier: 'weak' as const };
function setup(overrides: Partial<CanarySandboxManifest> = {}) {
  const db = database();
  const m: CanarySandboxManifest = { version: 1, ...binding, workspaceId: canaryWorkspaceId(binding.uid, binding.requestId, binding.fixtureHash),
    expiresAtMs: now + 10000, providerTtlMs: 10000, requestTimeoutMs: 1000, cpuCount: 2, memoryMiB: 4096, templateId: 'offline-synthetic', templateDigest: 'b'.repeat(64), credentialSha256: hash,
    tariffEvidence: 'synthetic', providerContractEvidence: 'synthetic', templateEvidence: 'synthetic', allCostsApproved: true, maxAllCostsPaise: 100000,
    nanoUsdPerBillableSecond: 46000, billableSecondsCeiling: 10, preinstalledOfflineToolchain: true, noCredentialsInTemplate: true, filesystemConfinementVerified: true,
    providerEnforcedNoEgress: true, oneRequestAtMostOneSandbox: true, nativeIdAliasContainmentVerified: true, ...overrides };
  const authority: CanaryAuthority = { ...binding, version: 1, enabled: true, expiresAtMs: now+600000, accountCredentialSha256: hash,
    tariffEvidence: 'synthetic', inputPerMillionNanoUsd: 950000000, outputPerMillionNanoUsd: 4000000000, maxPhysicalAttempts: 12,
    maxApiPaise: 100000, allInPaisePerUsdCeiling: 10000, sandboxManifestSha256: sandboxManifestHash(m) };
  db.seed('benchmark_canary_authorities/pilot', authority); db.seed('benchmark_canary_authorities/pilot/sandbox/manifest', m);
  const store = new CanaryReservationStore(db.db, () => Date.now());
  const handle = { execute: vi.fn(async (_payload: string, _timeoutMs: number, _signal: AbortSignal) => '{"written":true}'), kill: vi.fn(async () => true) };
  const provider = { create: vi.fn(async (_options: import('e2b').SandboxOpts) => handle) };
  const controller = new CanarySandboxController('pilot', binding, store, provider);
  return { db, store, m, authority, handle, provider, controller };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe('dormant bounded sandbox controller', () => {
  it('reserves one full-TTL hold before create, uses no retry/network/public ingress, and never returns a native ID', async () => {
    vi.useFakeTimers(); vi.setSystemTime(now); const s=setup();
    await s.controller.start(key);
    expect(s.provider.create).toHaveBeenCalledTimes(1);
    expect(s.provider.create.mock.calls[0][0]).toMatchObject({ retries: 0, lifecycle: { onTimeout: 'kill', autoResume: false }, network: { allowOut: [], allowPublicTraffic: false }, envs: {} });
    expect((s.db.docs.get('benchmark_canary_authorities/pilot/ledger/total') as any).reservedNanoUsd).toBe(460000);
    expect(await s.controller.tool({name:'write_file',path:'src/App.tsx',content:'synthetic'})).toContain('written');
    await expect(s.controller.start(key)).rejects.toThrow(); await s.controller.close();
    expect(s.handle.kill).toHaveBeenCalled();
    expect((s.db.docs.get('benchmark_canary_authorities/pilot/ledger/total') as any).reservedNanoUsd).toBe(460000);
  });
  it('two workers cannot reserve/create the same workspace', async () => {
    vi.useFakeTimers();vi.setSystemTime(now);const s=setup();
    const second=new CanarySandboxController('pilot',binding,new CanaryReservationStore(s.db.db),s.provider);
    await Promise.allSettled([s.controller.start(key),second.start(key)]);
    expect(s.provider.create.mock.calls.length).toBeLessThanOrEqual(1);
    expect(s.db.docs.has(`benchmark_canary_workspaces/${s.m.workspaceId}`)).toBe(true);
    await s.controller.close();
  });
  it('lost transaction acknowledgement never dispatches or retries a create',async()=>{
    vi.useFakeTimers();vi.setSystemTime(now);const s=setup();s.db.loseResponse();
    await expect(s.controller.start(key)).rejects.toThrow();await expect(s.controller.start(key)).rejects.toThrow();
    expect(s.provider.create).not.toHaveBeenCalled();expect(s.db.docs.has(`benchmark_canary_workspaces/${s.m.workspaceId}`)).toBe(true);
  });
  it('unknown create times out, retains reserve, kills a late known handle without replacement',async()=>{
    vi.useFakeTimers();vi.setSystemTime(now);const s=setup();let resolve!:(v:typeof s.handle)=>void;
    s.provider.create.mockImplementation(()=>new Promise(r=>{resolve=r;}));
    const result=s.controller.start(key);const rejected=expect(result).rejects.toThrow(/unknown/);
    await vi.advanceTimersByTimeAsync(1001);await rejected;resolve(s.handle);await vi.advanceTimersByTimeAsync(1);
    expect(s.handle.kill).toHaveBeenCalledTimes(1);expect(s.provider.create).toHaveBeenCalledTimes(1);
    expect((s.db.docs.get('benchmark_canary_authorities/pilot/ledger/total') as any).reservedNanoUsd).toBe(460000);
  });
  it('absolute job deadline closes even while idle and no tool renews its window',async()=>{
    vi.useFakeTimers();vi.setSystemTime(now);const s=setup();await s.controller.start(key);
    await vi.advanceTimersByTimeAsync(10001);await expect(s.controller.tool({name:'build'})).rejects.toThrow();
    expect(s.handle.kill).toHaveBeenCalled();expect(s.provider.create).toHaveBeenCalledTimes(1);
  });
  it.each([{allCostsApproved:false},{filesystemConfinementVerified:false},{providerEnforcedNoEgress:false},{nativeIdAliasContainmentVerified:false},{billableSecondsCeiling:1},{maxAllCostsPaise:0},{workspaceId:'someone-else'}])('denies unverified manifest %j before create',async override=>{
    vi.useFakeTimers();vi.setSystemTime(now);const s=setup(override as any);await expect(s.controller.start(key)).rejects.toThrow();expect(s.provider.create).not.toHaveBeenCalled();
  });
  it.each([{name:'deploy'},{name:'write_file',path:'src/../../.env',content:'x'},{name:'read_file',path:'/etc/passwd'},{name:'build',command:'curl'}])('denies tool override %j before execution',async tool=>{
    vi.useFakeTimers();vi.setSystemTime(now);const s=setup();await s.controller.start(key);await expect(s.controller.tool(tool as any)).rejects.toThrow();expect(s.handle.execute).not.toHaveBeenCalled();await s.controller.close();
  });
  it('a separate worker halt stops later tools before execution',async()=>{
    vi.useFakeTimers();vi.setSystemTime(now);const s=setup();await s.controller.start(key);
    await new CanaryReservationStore(s.db.db).halt('pilot');
    await expect(s.controller.tool({name:'build'})).rejects.toThrow();expect(s.handle.execute).not.toHaveBeenCalled();
  });
  it('hung tools cannot hold the job open past its local deadline',async()=>{
    vi.useFakeTimers();vi.setSystemTime(now);const s=setup();await s.controller.start(key);
    s.handle.execute.mockImplementation(()=>new Promise(()=>{}));
    const work=s.controller.tool({name:'build'});const rejection=expect(work).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(10001);await rejection;expect(s.handle.kill).toHaveBeenCalled();
  });
  it('API and compute share a total cap even after compute reserve',async()=>{
    vi.useFakeTimers();vi.setSystemTime(now);const s=setup({maxAllCostsPaise:1000});await s.controller.start(key);
    await expect(s.store.reserve('pilot',binding,'one',hash,32768)).rejects.toThrow(/restricted benchmark/);
    expect((s.db.docs.get('benchmark_canary_authorities/pilot/ledger/total') as any).reservedNanoUsd).toBe(460000);
    await s.controller.close();
  });
  it('a crash/restart cannot reacquire a consumed durable creation claim',async()=>{
    vi.useFakeTimers();vi.setSystemTime(now);const s=setup();await s.controller.start(key);
    const restarted=new CanarySandboxController('pilot',binding,new CanaryReservationStore(s.db.db),s.provider);
    await expect(restarted.start(key)).rejects.toThrow();expect(s.provider.create).toHaveBeenCalledTimes(1);await s.controller.close();
  });

  it.each([429, 307, 308])('one pinned REST create on HTTP %s retains liability and never follows or retries',async status=>{
    vi.useFakeTimers();vi.setSystemTime(now);const s=setup();
    const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('{}',{status,headers:{location:'https://example.invalid/redirect','retry-after':'0'}}));
    const controller=new CanarySandboxController('pilot',binding,s.store,e2bCanaryProvider);
    await expect(controller.start(key)).rejects.toThrow(/refused/);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe('https://api.e2b.app/sandboxes');
    expect(fetcher.mock.calls[0][1]).toMatchObject({method:'POST',redirect:'error'});
    expect((s.db.docs.get('benchmark_canary_authorities/pilot/ledger/total') as any).reservedNanoUsd).toBe(460000);
  });
  it('valid REST response constructs a local SDK handle without create/connect or environment endpoint fallback',async()=>{
    vi.useFakeTimers();vi.setSystemTime(now);const s=setup();
    vi.stubEnv('E2B_API_URL','https://example.invalid/api');vi.stubEnv('E2B_SANDBOX_URL','https://example.invalid/envd');
    const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({sandboxID:'synthetic-id',envdVersion:'0.5.7',envdAccessToken:'synthetic-token',domain:'e2b.app'})));
    const create=vi.spyOn(Sandbox,'create').mockRejectedValue(new Error('Must not create via SDK'));
    const connect=vi.spyOn(Sandbox,'connect').mockRejectedValue(new Error('Must not connect'));
    const kill=vi.spyOn(Sandbox.prototype,'kill').mockResolvedValue(true);
    const controller=new CanarySandboxController('pilot',binding,s.store,e2bCanaryProvider);
    try {
      await controller.start(key);expect(fetcher).toHaveBeenCalledTimes(1);expect(create).not.toHaveBeenCalled();expect(connect).not.toHaveBeenCalled();
      expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string)).toMatchObject({templateID:'offline-synthetic',timeout:10,secure:true,envVars:{},allow_internet_access:false,network:{denyOut:['0.0.0.0/0'],allowPublicTraffic:false},autoPause:false,autoResume:{enabled:false}});
      await controller.close();expect(kill).toHaveBeenCalledTimes(1);
      const handle=kill.mock.instances[0] as any;
      expect(handle.connectionConfig.apiUrl).toBe('https://api.e2b.app');expect(handle.connectionConfig.sandboxUrl).toBe('https://sandbox.e2b.app');
    } finally {vi.unstubAllEnvs();}
  });
  it.each(['oversized','malformed','wrong-domain'])('refuses %s response with no second request',async kind=>{
    vi.useFakeTimers();vi.setSystemTime(now);const s=setup();
    const body=kind==='oversized'?'x'.repeat(16385):kind==='malformed'?'synthetic-private-response-token':JSON.stringify({sandboxID:'synthetic',envdVersion:'0.5.7',envdAccessToken:'synthetic-token',domain:'example.invalid'});
    const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(body));
    const controller=new CanarySandboxController('pilot',binding,s.store,e2bCanaryProvider);
    const failure=await controller.start(key).catch(error=>error as Error);
    expect(failure).toBeInstanceOf(Error);expect(String(failure)).not.toContain('synthetic-private-response-token');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('body EOF is bounded even when response headers already arrived',async()=>{
    vi.useFakeTimers();vi.setSystemTime(now);const s=setup();const cancel=vi.fn();
    const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(new ReadableStream({cancel})));
    const controller=new CanarySandboxController('pilot',binding,s.store,e2bCanaryProvider);
    const work=controller.start(key);const rejection=expect(work).rejects.toThrow(/unknown/);
    await vi.advanceTimersByTimeAsync(1001);await rejection;expect(fetcher).toHaveBeenCalledTimes(1);expect(cancel).toHaveBeenCalled();
    expect((s.db.docs.get('benchmark_canary_authorities/pilot/ledger/total') as any).reservedNanoUsd).toBe(460000);
  });

  it('hung halt persistence cannot delay the known-handle kill or cleanup completion',async()=>{
    vi.useFakeTimers();vi.setSystemTime(now);const s=setup();await s.controller.start(key);
    vi.spyOn(s.store,'halt').mockImplementation(()=>new Promise(()=>{}));
    const close=s.controller.close();expect(s.handle.kill).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1001);await close;
    await expect(s.controller.tool({name:'read_file',path:'src/a'})).rejects.toThrow();
  });
  it('manifest cannot outlive the authority that authorizes it',async()=>{
    vi.useFakeTimers();vi.setSystemTime(now);const s=setup();
    s.db.seed('benchmark_canary_authorities/pilot',{...s.authority,expiresAtMs:now+5000});
    await expect(s.controller.start(key)).rejects.toThrow();expect(s.provider.create).not.toHaveBeenCalled();
  });
  it('test requires a proven current build and every write invalidates it',async()=>{
    vi.useFakeTimers();vi.setSystemTime(now);const s=setup();await s.controller.start(key);
    await expect(s.controller.tool({name:'test'})).rejects.toThrow(/verified build/);
    s.handle.execute.mockResolvedValue(JSON.stringify({sourceDigest:'f'.repeat(64)}));
    await s.controller.tool({name:'build'});await s.controller.tool({name:'test'});
    const encoded=s.handle.execute.mock.calls[1][0];
    expect(JSON.parse(Buffer.from(encoded,'base64').toString())).toEqual({name:'test',expectedSourceDigest:'f'.repeat(64)});
    await s.controller.tool({name:'write_file',path:'src/App.jsx',content:'changed'});
    await expect(s.controller.tool({name:'test'})).rejects.toThrow(/verified build/);await s.controller.close();
  });

});
