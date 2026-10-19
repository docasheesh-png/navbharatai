import { describe, it, expect, vi } from 'vitest';
import { mockReq, mockRes } from './helpers/routeTestUtils';
import { AiMaintenanceStore, MAINTENANCE_MESSAGE, maintenanceState, isKimiQuotaFailure, type MaintenanceBackend, type MaintenanceState } from '../src/server/lib/aiMaintenance';
import { aiMaintenanceGuard, maintenanceProtected } from '../src/server/lib/aiMaintenanceGuard';
function fixture(initial: Partial<MaintenanceState> = {}) {
  let value = maintenanceState(initial);
  let now = 100_000;
  const subscribers = new Set<(data: unknown) => void>();
  let serial = Promise.resolve();
  const backend: MaintenanceBackend = {
    read: vi.fn(async () => value),
    change: fn => {
      const result = serial.then(() => { value = fn(value); subscribers.forEach(fn => fn(value)); return value; });
      serial = result.then(() => undefined); return result;
    },
    subscribe: fn => { subscribers.add(fn); return () => { subscribers.delete(fn); }; },
  };
  return { store: new AiMaintenanceStore(() => backend, () => now), backend, tick: (ms: number) => { now += ms; }, value: () => value };
}
describe('real maintenance spending gate', () => {
  it('persists manual on/off, keeps auto separate and resets old strikes when resumed', async () => {
    const f = fixture();
    await f.store.recordFailure('KIMI', new Error('insufficient_quota'));
    expect((await f.store.set({ enabled: true })).reason).toBe('manual');
    expect((await f.store.set({ autoEnabled: false })).enabled).toBe(true);
    const resumed = await f.store.set({ enabled: false });
    expect(resumed).toMatchObject({ enabled: false, autoEnabled: false, failures: [], reason: null });
    await expect(new AiMaintenanceStore(() => f.backend).read()).resolves.toMatchObject({ enabled: false });
  });
  it('counts concurrent quota failures across server instances transactionally, then latches until an admin resumes', async () => {
    const f = fixture(); const other = new AiMaintenanceStore(() => f.backend, () => 100_000);
    f.store.start(); other.start();
    await Promise.all([f.store.recordFailure('KIMI#1', new Error('insufficient balance')), other.recordFailure('kimi-k2.6', new Error('out of tokens')), f.store.recordFailure('KIMI', new Error('quota_exceeded'))]);
    expect((await other.read())).toMatchObject({ enabled: true, reason: 'kimi_quota' });
    f.tick(1_000_000);
    expect((await f.store.read()).enabled).toBe(true);
    expect((await f.store.set({ enabled: false })).enabled).toBe(false);
  });
  it('expires isolated failures and honors disabled auto-on', async () => {
    const f = fixture();
    await f.store.recordFailure('KIMI', new Error('out of tokens')); f.tick(120_001);
    await f.store.recordFailure('KIMI', new Error('out of tokens'));
    await f.store.recordFailure('KIMI', new Error('out of tokens'));
    expect(f.value().enabled).toBe(false);
    await f.store.set({ autoEnabled: false });
    for (let i = 0; i < 5; i++) await f.store.recordFailure('KIMI', new Error('out of tokens'));
    expect(f.value().enabled).toBe(false);
  });
  it('does not turn a user input error, timeout, temporary throttle or another vendor into a site outage', () => {
    for (const err of ['context length exceeded', 'maximum context tokens exceeded', '429 rate limit exceeded', 'tokens per minute exceeded', 'request timed out', 'max_tokens too large']) expect(isKimiQuotaFailure('KIMI', new Error(err))).toBe(false);
    expect(isKimiQuotaFailure('GLM', new Error('insufficient_quota'))).toBe(false);
    for (const err of ['insufficient_quota', 'insufficient balance', 'quota exceeded', 'out of token', 'credit balance is too low']) expect(isKimiQuotaFailure('KIMI', new Error(err))).toBe(true);
  });
  it('fails closed when storage cannot be read and never claims a refused save succeeded', async () => {
    const store = new AiMaintenanceStore(() => ({ read: async () => { throw Error('offline'); }, change: async () => { throw Error('offline'); } }));
    expect(await store.read()).toMatchObject({ enabled: true, unavailable: true });
    await expect(store.set({ enabled: false })).rejects.toThrow('offline');
  });
  it('does not let a stale read reverse a manual pause', async () => {
    let done!: (v: unknown) => void;
    const f = fixture(); f.backend.read = () => new Promise(resolve => { done = resolve; });
    const pending = f.store.read();
    await f.store.set({ enabled: true }); done({ enabled: false });
    expect((await pending).enabled).toBe(true);
  });
  it('blocks present and future AI routes, both API versions, including a forged admin header', async () => {
    const f = fixture({ enabled: true }); const spend = vi.fn();
    const middleware = aiMaintenanceGuard(f.store);
    const req = { ...mockReq({ headers: { 'x-admin-token': 'forged' } }), method: 'POST', path: '/api/v1/chat/completions' };
    const res = mockRes();
    await middleware(req as never, res as never, spend);
    expect(res.statusCode).toBe(503); expect(res.headers['retry-after']).toBe('60');
    expect(res.body).toMatchObject({ error: MAINTENANCE_MESSAGE, reply: MAINTENANCE_MESSAGE });
    expect(spend).not.toHaveBeenCalled();
    await middleware({ ...mockReq(), method: 'GET', path: '/api/admin/ai-maintenance' } as never, mockRes() as never, spend);
    expect(spend).toHaveBeenCalledTimes(1);
    await f.store.set({ enabled: false });
    await middleware(req as never, mockRes() as never, spend);
    expect(spend).toHaveBeenCalledTimes(2);
  });
  it('keeps recovery, authentication, health and payment settlement reachable', () => {
    for (const p of ['/api/admin/ai-maintenance', '/api/v1/admin/ai-maintenance', '/api/payment/webhook', '/api/ready', '/api/live', '/api/auth/login', '/api/public-config', '/api/internal/scheduler-tick']) expect(maintenanceProtected('POST', p)).toBe(false);
    for (const p of ['/api/chat/navbharat', '/api/agentv3/chat', '/api/sda-chat', '/api/image/generate', '/api/professional/doctor/chat', '/api/v1/new-ai-tool', '/api/bots/telegram/webhook']) expect(maintenanceProtected('POST', p)).toBe(true);
    expect(maintenanceProtected('OPTIONS', '/api/agentv3/chat')).toBe(false);
  });
});
