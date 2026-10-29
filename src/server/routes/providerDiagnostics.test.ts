import express from 'express';
import type { Server } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { registerProviderDiagnosticRoutes, readDiagnosticProviderState } from './providerDiagnostics';
import { mintAdminToken } from '../lib/adminAuth';
import type { DiagnosticDependencies } from '../lib/providerDiagnosticRunner';
let server: Server | undefined;
afterEach(async () => { if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; } vi.unstubAllEnvs(); });
async function setup() {
  vi.stubEnv('ADMIN_PASSWORD', 'synthetic-password'); vi.stubEnv('ADMIN_USERNAME', 'test-admin');
  const token = mintAdminToken('synthetic-password', 'test-admin', Date.now());
  const call = vi.fn().mockResolvedValue({ text: 'actual mocked response', usage: { inputTokens: 1, outputTokens: 2, cachedTokens: null }, amount: null });
  const deps: DiagnosticDependencies = { adapter: vi.fn(() => ({ model: 'test', call })), verifyAdmission: vi.fn().mockResolvedValue(undefined), store: { claimDispatch: vi.fn().mockResolvedValue(true), read: vi.fn().mockResolvedValue(null), reserve: vi.fn().mockResolvedValue({ mayDispatch: true, run: { runId: '11111111-1111-4111-8111-111111111111', startedAt: Date.now(), state: 'reserved' } }), finish: vi.fn().mockResolvedValue(undefined) } };
  const resolve = vi.fn(() => deps); const app = express(); app.use(express.json()); registerProviderDiagnosticRoutes(app, resolve);
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(done => server!.once('listening', done));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('listener');
  const base = `http://127.0.0.1:${address.port}/api/admin/provider-diagnostics`;
  return { base, token, resolve, deps, call };
}
it('protects status, records, execution and unknown paths with real admin authentication', async () => {
  const { base, resolve } = await setup();
  for (const path of ['/status', '/runs/anything', '/logs', '/surplus/runs', '/cheaperinference/runs', '/surplus/control', '/cheaperinference/control']) {
    const r = await fetch(base + path, { method: (path.endsWith('/runs') || path.endsWith('/control')) ? 'POST' : 'GET', headers: { authorization: 'Bearer ordinary-user' } });
    expect(r.status).toBe(401); expect(r.headers.get('cache-control')).toBe('no-store');
  }
  expect(resolve).not.toHaveBeenCalled();
});
it('GET status never spends and gives actionable evidence blocker', async () => {
  const { base, token, resolve } = await setup(); const r = await fetch(base + '/status', { headers: { 'x-admin-token': token } });
  expect(r.status).toBe(200); expect(await r.json()).toMatchObject({ dispatchReady: false, reason: 'budget_evidence_unavailable' }); expect(resolve).toHaveBeenCalledOnce();
});
it.each(['surplus', 'cheaperinference'])('runs authenticated %s with response and honest unknown cost', async provider => {
  const { base, token, deps, call } = await setup();
  const r = await fetch(`${base}/${provider}/runs`, { method: 'POST', headers: { 'x-admin-token': token, 'content-type': 'application/json' }, body: JSON.stringify({ idempotencyKey: '11111111-1111-4111-8111-111111111111', prompt: 'private prompt' }) });
  expect(r.status).toBe(200); expect(await r.json()).toMatchObject({ text: 'actual mocked response', supplierCost: { status: 'unavailable' }, accounting: 'unknown_liability', retryCount: 0 });
  expect(deps.adapter).toHaveBeenCalledExactlyOnceWith(provider, undefined); expect(call).toHaveBeenCalledOnce();
});

it('only verified admins can change one control using a revision-checked body', async () => {
  const { base, token, deps } = await setup();
  deps.setControl = vi.fn().mockResolvedValue({ enabled: false, revision: 2 });
  const r = await fetch(base + '/surplus/control', { method: 'POST', headers: { 'x-admin-token': token, 'content-type': 'application/json' }, body: JSON.stringify({ enabled: false, expectedRevision: 1 }) });
  expect(r.status).toBe(200); expect(await r.json()).toEqual({ provider: 'surplus', enabled: false, revision: 2 });
  expect(deps.setControl).toHaveBeenCalledExactlyOnceWith('surplus', false, 1, 'test-admin');
  expect(deps.store.reserve).not.toHaveBeenCalled();
});
it('OFF blocks authenticated direct POST and leaves history readable', async () => {
  const { DiagnosticAdmissionError } = await import('../lib/providerDiagnosticStore');
  const { base, token, deps, call } = await setup();
  vi.mocked(deps.verifyAdmission).mockRejectedValue(new DiagnosticAdmissionError('diagnostics_disabled'));
  const r = await fetch(base + '/surplus/runs', { method: 'POST', headers: { 'x-admin-token': token, 'content-type': 'application/json' }, body: JSON.stringify({ idempotencyKey: '11111111-1111-4111-8111-111111111111', prompt: 'mock' }) });
  expect((await r.json()).timeline.at(-1).reason).toBe('diagnostics_disabled');
  expect(deps.store.reserve).not.toHaveBeenCalled(); expect(call).not.toHaveBeenCalled();
  expect((await fetch(base + '/runs/11111111-1111-4111-8111-111111111111', { headers: { 'x-admin-token': token } })).status).toBe(404);
});

it('OFF status skips adapters and pricing; failed ON preflight still exposes the disable control', async () => {
  const store = { control: vi.fn().mockResolvedValue({ enabled: false, revision: 0 }), status: vi.fn() };
  const adapter = vi.fn(() => { throw new Error('mock missing configuration'); });
  expect(await readDiagnosticProviderState('surplus', store, adapter)).toMatchObject({ enabled: false, revision: 0, reason: 'diagnostics_disabled' });
  expect(adapter).not.toHaveBeenCalled(); expect(store.status).not.toHaveBeenCalled();
  store.control.mockResolvedValue({ enabled: true, revision: 1 });
  expect(await readDiagnosticProviderState('surplus', store, adapter)).toMatchObject({ enabled: true, revision: 1, dispatchReady: false, reason: 'config_missing' });
});

it('a failed control read is accounting-unavailable and does not probe providers', async () => {
  const store = { control: vi.fn().mockRejectedValue(new Error('unavailable')), status: vi.fn() };
  const adapter = vi.fn();
  expect(await readDiagnosticProviderState('surplus', store, adapter)).toEqual({ dispatchReady: false, reason: 'accounting_unavailable', missingFields: ['providers.surplus.control'] });
  expect(adapter).not.toHaveBeenCalled(); expect(store.status).not.toHaveBeenCalled();
});
