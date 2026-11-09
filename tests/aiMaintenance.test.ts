import { describe, it, expect, vi } from 'vitest';
import { mockReq, mockRes } from './helpers/routeTestUtils';
import { AiMaintenanceStore, MAINTENANCE_MESSAGE, STATUS_UNAVAILABLE_MESSAGE, maintenanceState, isKimiQuotaFailure, type MaintenanceBackend, type MaintenanceState } from '../src/server/lib/aiMaintenance';
import { chatAvailabilityMessage } from '../src/server/lib/chatAvailabilityMessage';
import { gatewayChatFailure } from '../src/lib/chatResponseStream';
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
  it.each(['factory-sync', 'read-sync', 'read-async'] as const)('recovers from %s without caching unavailable or breaking single-flight reads', async failure => {
    for (const warm of [false, true]) {
      let now = 100_000;
      let fail = false;
      const backend: MaintenanceBackend = {
        read: vi.fn(() => {
          if (fail && failure === 'read-sync') throw new Error('Temporary read setup failure');
          if (fail && failure === 'read-async') return Promise.reject(new Error('Temporary storage failure'));
          return Promise.resolve({ enabled: false });
        }),
        change: async change => change(maintenanceState({ enabled: false })),
      };
      const factory = vi.fn(() => {
        if (fail && failure === 'factory-sync') throw new Error('Temporary initialization failure');
        return backend;
      });
      const store = new AiMaintenanceStore(factory, () => now);
      if (warm) { expect((await store.read()).enabled).toBe(false); now += 2001; }
      const before = factory.mock.calls.length;
      fail = true;
      const unavailable = await Promise.all([store.read(), store.read()]);
      for (const state of unavailable) {
        // Cold: fail-closed (enabled latched). Warm recent known-off: fail-open (enabled stays false).
        expect(state.unavailable).toBe(true);
        expect(state.enabled).toBe(!warm);
      }
      expect(factory).toHaveBeenCalledTimes(before + 1);
      fail = false;
      const recovered = await Promise.all([store.read(), store.read()]);
      for (const state of recovered) {
        expect(state.enabled).toBe(false);
        expect(state.unavailable).toBeUndefined();
      }
      expect(factory).toHaveBeenCalledTimes(before + 2);
    }
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
  it.each(['/api/chat/navbharatai', '/api/chat/navbharat', '/api/free-answers/status'])('preserves the actual maintenance guard outcome for %s', async path => {
    const f = fixture({ enabled: true });
    const next = vi.fn(); const res = mockRes();
    await aiMaintenanceGuard(f.store)({ ...mockReq(), method: path.endsWith('/status') ? 'GET' : 'POST', path } as never, res as never, next);
    expect(res.statusCode).toBe(503);
    expect(next).not.toHaveBeenCalled();
    expect(gatewayChatFailure(res.body)).toEqual({ code: 'CHAT_MAINTENANCE', message: MAINTENANCE_MESSAGE, partial: false });
  });

  it.each(['/api/chat/navbharatai', '/api/chat/navbharat', '/api/free-answers/status'])('recovers %s after warm storage failure without bypassing a real pause', async path => {
    let now = 100_000;
    let broken = false;
    const backend: MaintenanceBackend = { read: async () => ({ enabled: false }), change: async change => change(maintenanceState({ enabled: false })) };
    const store = new AiMaintenanceStore(() => {
      if (broken) throw new Error('Temporary initialization failure');
      return backend;
    }, () => now);
    const guard = aiMaintenanceGuard(store);
    const request = async () => {
      const next = vi.fn(); const res = mockRes();
      await guard({ ...mockReq(), method: path.endsWith('/status') ? 'GET' : 'POST', path } as never, res as never, next);
      return { next, res };
    };
    expect((await request()).next).toHaveBeenCalledOnce();
    // Recent known-off → fail-open: keep serving; do NOT pretend the admin paused AI.
    now += 2001; broken = true;
    const unavailableOpen = await request();
    expect(unavailableOpen.next).toHaveBeenCalledOnce();
    broken = false;
    expect((await request()).next).toHaveBeenCalledOnce();
    await store.set({ enabled: true });
    const paused = await request();
    expect(paused.next).not.toHaveBeenCalled();
    expect(paused.res.statusCode).toBe(503);
    expect(paused.res.body).toMatchObject({ maintenance: true, error: MAINTENANCE_MESSAGE });
  });

  it('fails closed with a distinct status-unavailable message when there is no recent known-off', async () => {
    const store = new AiMaintenanceStore(() => ({ read: async () => { throw Error('offline'); }, change: async () => { throw Error('offline'); } }));
    const next = vi.fn(); const res = mockRes();
    await aiMaintenanceGuard(store)({ ...mockReq(), method: 'POST', path: '/api/agentv3/chat' } as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({
      error: STATUS_UNAVAILABLE_MESSAGE,
      reply: STATUS_UNAVAILABLE_MESSAGE,
      maintenance: false,
      statusUnavailable: true,
    });
    expect(res.body.error).not.toBe(MAINTENANCE_MESSAGE);
    expect(gatewayChatFailure(res.body)).toEqual({ code: 'CHAT_STATUS_UNAVAILABLE', message: STATUS_UNAVAILABLE_MESSAGE, partial: false });
  });

  it('localizes unreadable status neutrally without pretending it is overload or maintenance', async () => {
    const store = new AiMaintenanceStore(() => ({ read: async () => { throw Error('synthetic status backend detail'); }, change: async () => { throw Error('offline'); } }));
    const next = vi.fn(); const res = mockRes();
    const body = { message: 'mujhe batao kya hua', replyLanguage: 'hi' };
    await aiMaintenanceGuard(store)({ ...mockReq({ body }), method: 'POST', path: '/api/chat' } as never, res as never, next);
    const reply = chatAvailabilityMessage('temporary', body);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ error: reply, reply, maintenance: false, statusUnavailable: true });
    expect(res.body.reply).not.toBe(chatAvailabilityMessage('capacity', body));
    expect(res.body.reply).not.toContain('synthetic status backend detail');
    expect(gatewayChatFailure(res.body)).toEqual({ code: 'CHAT_STATUS_UNAVAILABLE', message: reply, partial: false });
  });

  it('fail-opens briefly after a recent successful known-off read, then fails closed once that window ages out', async () => {
    let now = 100_000;
    let broken = false;
    const backend: MaintenanceBackend = {
      read: vi.fn(async () => {
        if (broken) throw new Error('offline');
        return { enabled: false };
      }),
      change: async change => change(maintenanceState({ enabled: false })),
    };
    const store = new AiMaintenanceStore(() => backend, () => now);
    expect(await store.read()).toMatchObject({ enabled: false });
    now += 2_001; broken = true;
    expect(await store.read()).toMatchObject({ enabled: false, unavailable: true });
    const next = vi.fn(); const res = mockRes();
    await aiMaintenanceGuard(store)({ ...mockReq(), method: 'POST', path: '/api/agentv3/chat' } as never, res as never, next);
    expect(next).toHaveBeenCalledOnce();
    // Age past the fail-open window (10 min) — latch closed, but still not the maintenance sentence.
    now += 10 * 60_000 + 1;
    const closed = await store.read();
    expect(closed).toMatchObject({ enabled: true, unavailable: true });
    const next2 = vi.fn(); const res2 = mockRes();
    await aiMaintenanceGuard(store)({ ...mockReq(), method: 'POST', path: '/api/agentv3/chat' } as never, res2 as never, next2);
    expect(next2).not.toHaveBeenCalled();
    expect(res2.body).toMatchObject({ statusUnavailable: true, maintenance: false, error: STATUS_UNAVAILABLE_MESSAGE });
  });

});

describe('maintenance fail-open after a watch error (guest chat 503 DNA)', () => {
  it('a known-OFF setting stays served when the watch drops and a later read times out', async () => {
    let now = 1_000_000; let fail = false; let onErr: (() => void) | undefined;
    const backend = {
      read: async () => { if (fail) throw Error('slow firestore'); return { enabled: false, autoEnabled: true, failures: [] }; },
      change: async () => { throw Error('offline'); },
      subscribe: (_fn: (d: unknown) => void, err: () => void) => { onErr = err; return () => {}; },
    };
    const store = new AiMaintenanceStore(() => backend as never, () => now);
    store.start();
    await expect(store.read()).resolves.toMatchObject({ enabled: false });
    onErr?.(); fail = true; now += 5_000;
    await expect(store.read()).resolves.toMatchObject({ enabled: false, unavailable: true });
  });
});

describe('opt-in strict maintenance availability observations', () => {
  it.each([false, true])('reports a failed read with warm=%s without changing old notifications or fail-open behavior', async warm => {
    let now = 100_000, failing = false;
    const backend: MaintenanceBackend = {
      read: async () => { if (failing) throw new Error('synthetic read failure'); return { enabled: false }; },
      change: async fn => fn(maintenanceState({ enabled: false })),
    };
    const store = new AiMaintenanceStore(() => backend, () => now);
    const changes = vi.fn(), unavailable = vi.fn();
    store.onChange(changes);
    // Faulty optional observers must not change the shared store's result or prevent later observers.
    store.onUnavailable(() => { throw new Error('synthetic observer failure'); });
    const off = store.onUnavailable(unavailable);
    if (warm) { await store.read(); now += 2_001; changes.mockClear(); }
    failing = true;
    expect(await store.read()).toMatchObject({ enabled: !warm, unavailable: true });
    expect(unavailable).toHaveBeenCalledOnce(); expect(changes).not.toHaveBeenCalled();
    off();
    await store.read(); expect(unavailable).toHaveBeenCalledOnce();
    failing = false;
    expect(await store.read()).toMatchObject({ enabled: false });
    expect(changes).toHaveBeenCalledOnce();
  });
  it.each(['factory', 'subscribe', 'watch'] as const)('reports %s availability failure without sending a fake pause to existing observers', async failure => {
    let watchError: () => void = () => {}, broken = false;
    const backend: MaintenanceBackend = {
      read: async () => ({ enabled: false }),
      change: async fn => fn(maintenanceState({ enabled: false })),
      subscribe: (_fn, error) => {
        if (failure === 'subscribe') throw new Error('synthetic subscribe failure');
        watchError = error; return () => {};
      },
    };
    const store = new AiMaintenanceStore(() => { if (broken && failure === 'factory') throw new Error('synthetic factory failure'); return backend; }, () => 100_000);
    const changes = vi.fn(), unavailable = vi.fn();
    await store.read(); store.onChange(changes); store.onUnavailable(unavailable);
    broken = true; store.start(); if (failure === 'watch') watchError();
    expect(unavailable).toHaveBeenCalledOnce(); expect(changes).not.toHaveBeenCalled();
    broken = false;
    expect(await store.read()).toMatchObject({ enabled: false });
  });
});
