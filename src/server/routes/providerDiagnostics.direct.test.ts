import express from 'express';
import type { Server } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { mintAdminToken } from '../lib/adminAuth';
const fixture = vi.hoisted(() => ({ db: null as any }));
vi.mock('../lib/serverDb', () => ({ getServerDb: () => fixture.db }));
import { registerProviderDiagnosticRoutes } from './providerDiagnostics';
let server: Server | undefined;
afterEach(async () => {
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; }
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
});
it('real route composition sends only named chat POSTs, no catalog/pricing requests or evidence prerequisites', async () => {
  const docs = new Map<string, any>();
  for (const p of ['surplus', 'cheaperinference']) docs.set(`free_chat_chain/provider_diagnostics/control/${p}`, { enabled: true, revision: 1 });
  const snapshot = (path: string) => ({ exists: docs.has(path), data: () => structuredClone(docs.get(path)) });
  fixture.db = { doc: (path: string) => ({ path, get: async () => snapshot(path) }), runTransaction: async (callback: any) => callback({
    get: async (ref: any) => snapshot(ref.path), create: (ref: any, data: any) => { if (docs.has(ref.path)) throw Error('exists'); docs.set(ref.path, structuredClone(data)); },
    set: (ref: any, data: any) => docs.set(ref.path, structuredClone(data)),
  }) };
  vi.stubEnv('ADMIN_PASSWORD', 'synthetic'); vi.stubEnv('ADMIN_USERNAME', 'test-admin');
  vi.stubEnv('SURPLUS_API_KEY', 'mock-only'); vi.stubEnv('CHEAPERINFERENCE_API_KEY', 'mock-only');
  const token = mintAdminToken('synthetic', 'test-admin', Date.now());
  const originalFetch = globalThis.fetch;
  const providerFetch = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'mock response' }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } }));
  // Return a fresh response for each mocked supplier request; local HTTP uses the real transport.
  providerFetch.mockImplementation(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'mock response' }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } }));
  vi.stubGlobal('fetch', providerFetch);
  const app = express(); app.use(express.json()); registerProviderDiagnosticRoutes(app);
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server!.once('listening', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('listener');
  const base = `http://127.0.0.1:${address.port}/api/admin/provider-diagnostics`;
  const headers = { 'x-admin-token': token, 'content-type': 'application/json' };
  expect((await originalFetch(base + '/status', { headers }).then(r => r.json())).dispatchReady).toBe(true);
  expect(providerFetch).not.toHaveBeenCalled();
  for (const [provider, id] of [['surplus','11111111-1111-4111-8111-111111111111'], ['cheaperinference','22222222-2222-4222-8222-222222222222']]) {
    const request = { method: 'POST', headers, body: JSON.stringify({ idempotencyKey: id, prompt: 'test text' }) };
    const response = await originalFetch(`${base}/${provider}/runs`, request).then(r => r.json());
    expect(response).toMatchObject({ text: 'mock response', accounting: 'unknown_liability', supplierCost: { status: 'unavailable' }, retryCount: 0 });
    expect(response.completedAt).toEqual(expect.any(Number));
    const replay = await originalFetch(`${base}/${provider}/runs`, request).then(r => r.json());
    expect(replay).toMatchObject({ replayed: true, runId: response.runId });
  }
  expect(providerFetch).toHaveBeenCalledTimes(2);
  expect(providerFetch.mock.calls.map(c => String(c[0]))).toEqual(['https://api.surplusintelligence.ai/v1/chat/completions','https://api.cheaperinference.com/v1/chat/completions']);
  for (const call of providerFetch.mock.calls) expect(JSON.parse(String(call[1]?.body))).not.toHaveProperty('max_tokens');
  expect([...docs.keys()].every(path => path.includes('/control/') || path.includes('/runs/'))).toBe(true);
  expect(JSON.stringify([...docs.values()])).not.toMatch(/mock-only|test text|mock response/);
});
