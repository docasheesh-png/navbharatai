import express from 'express';
import type { Server } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { registerProviderDiagnosticRoutes } from './providerDiagnostics';
import { mintAdminToken } from '../lib/adminAuth';
import type { DiagnosticDependencies } from '../lib/providerDiagnosticRunner';
let server: Server | undefined;
afterEach(async () => { if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; } vi.unstubAllEnvs(); });
async function setup() {
  vi.stubEnv('ADMIN_PASSWORD', 'synthetic-password'); vi.stubEnv('ADMIN_USERNAME', 'test-admin');
  const token = mintAdminToken('synthetic-password', 'test-admin', Date.now());
  const call = vi.fn().mockResolvedValue({ text: 'actual mocked response', usage: { inputTokens: 1, outputTokens: 2, cachedTokens: null }, amount: null });
  const deps: DiagnosticDependencies = { adapter: vi.fn(() => ({ model: 'test', call })), verifyEvidence: vi.fn().mockResolvedValue(undefined), store: { read: vi.fn().mockResolvedValue(null), reserve: vi.fn().mockResolvedValue({ mayDispatch: true, run: { runId: '11111111-1111-4111-8111-111111111111', startedAt: Date.now(), state: 'reserved' } }), finish: vi.fn().mockResolvedValue(undefined) } };
  const resolve = vi.fn(() => deps); const app = express(); app.use(express.json()); registerProviderDiagnosticRoutes(app, resolve);
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(done => server!.once('listening', done));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('listener');
  const base = `http://127.0.0.1:${address.port}/api/admin/provider-diagnostics`;
  return { base, token, resolve, deps, call };
}
it('protects status, records, execution and unknown paths with real admin authentication', async () => {
  const { base, resolve } = await setup();
  for (const path of ['/status', '/runs/anything', '/logs', '/surplus/runs', '/cheaperinference/runs']) {
    const r = await fetch(base + path, { method: path.endsWith('/runs') ? 'POST' : 'GET', headers: { authorization: 'Bearer ordinary-user' } });
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
