import express from 'express';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ status: vi.fn(), run: vi.fn(), audit: vi.fn(), readiness: vi.fn(), approval: vi.fn(), catalog: vi.fn(), balance: vi.fn() }));
vi.mock('../lib/testChatBot', () => ({ testChatStatus: fake.status, runTestChat: fake.run,
  TestChatUnavailable: class extends Error { constructor(readonly reason: string, readonly status = 503) { super(reason); } } }));
vi.mock('../lib/audit', () => ({ audit: fake.audit }));
vi.mock('../lib/adminAuth', () => ({ adminUsername: () => 'server-admin' }));
vi.mock('../lib/qubaxReadiness', () => ({ checkTestChatReadiness: fake.readiness, importTestChatApproval: fake.approval, importTestChatCatalog: fake.catalog,
  QubaxAdminReviewError: class extends Error { constructor(readonly code: string, readonly status = 409) { super(code); } } }));
vi.mock('../lib/qubaxBalance', () => ({ readQubaxBalance: fake.balance }));
import { registerTestChatBotRoutes } from './testChatBot';
import { TestChatUnavailable } from '../lib/testChatBot';
import { jsonBodyParser } from '../lib/requestBodyLimits';
import { apiVersionMiddleware } from './apiVersion';
let server: Server;
const action = { provider: 'qubax', requestId: '1d2efc71-6d00-4514-83c0-e31461ea9f35', messages: [{ role: 'user', content: 'Synthetic prompt' }], confirmGatewayDisclosure: true };
async function setup() {
  const app = express(); app.use(jsonBodyParser()); app.use(apiVersionMiddleware);
  registerTestChatBotRoutes(app, (req, res, next) => { if (req.headers['x-admin-token'] === 'synthetic-admin') next(); else res.status(401).end(); });
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const { port } = server.address() as { port: number };
  return (body?: unknown, authenticated = true, versioned = true, path?: string) => fetch(`http://127.0.0.1:${port}/api/${versioned ? 'v1/' : ''}admin/test-chat-bot/${path ?? (body === undefined ? 'providers' : 'chat')}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { ...(authenticated ? { 'x-admin-token': 'synthetic-admin' } : {}), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(() => vi.resetAllMocks());
afterEach(async () => { if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } });
describe('admin-only test chat boundary', () => {
  it('requires the existing admin gate for reads and sends, including compatibility URLs', async () => {
    const request = await setup();
    expect((await request(undefined, false)).status).toBe(401); expect((await request(action, false)).status).toBe(401);
    expect((await request(action, false, false)).status).toBe(401);
    expect(fake.status).not.toHaveBeenCalled(); expect(fake.run).not.toHaveBeenCalled(); expect(fake.audit).not.toHaveBeenCalled();
  });
  it('status loads are no-store and never start inference', async () => {
    fake.status.mockReturnValue({ noFallback: true }); const request = await setup(); const response = await request();
    expect(await response.json()).toEqual({ noFallback: true }); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-api-version')).toBe('v1'); expect(fake.run).not.toHaveBeenCalled();
  });
  it.each([{ ...action, provider: 'mitrify' }, { ...action, baseURL: 'https://evil.test' }, { ...action, confirmGatewayDisclosure: false },
    { ...action, messages: [{ role: 'user', content: { file: 'private' } }] }])('rejects malformed and broadened dispatch %#', async body => {
    const request = await setup(); expect((await request(body)).status).toBe(400); expect(fake.run).not.toHaveBeenCalled();
  });
  it('passes actual text to exactly one selected adapter with a server-derived identity', async () => {
    fake.run.mockResolvedValue({ content: 'reply', noFallback: true }); const request = await setup();
    const response = await request(action); expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(fake.run).toHaveBeenCalledExactlyOnceWith(action, 'server-admin', expect.any(AbortSignal));
    const metadata = { admin: 'server-admin', provider: action.provider, requestId: action.requestId };
    expect(fake.audit.mock.calls).toEqual([['ADMIN_TEST_CHAT_STARTED', metadata], ['ADMIN_TEST_CHAT_FINISHED', metadata]]);
    expect(JSON.stringify(fake.audit.mock.calls)).not.toContain('Synthetic prompt'); expect(JSON.stringify(fake.audit.mock.calls)).not.toContain('reply');
  });
  it('uses safe unavailable errors and never reflects provider secrets', async () => {
    const request = await setup(); fake.run.mockRejectedValueOnce(new TestChatUnavailable('approval-or-budget', 409));
    const rejected = await request(action); expect(rejected.status).toBe(409); expect(await rejected.text()).toContain('No provider was called');
    fake.run.mockRejectedValueOnce(new Error('secret-key-and-patient-record'));
    const failed = await request(action); expect(failed.status).toBe(503); const body = await failed.text();
    expect(body).not.toContain('secret-key'); expect(body).toContain('No other provider was tried');
    expect(JSON.stringify(fake.audit.mock.calls)).not.toContain('patient-record');
    for (const [, metadata] of fake.audit.mock.calls) expect(metadata.admin).toBe('server-admin');
    expect(fake.audit).toHaveBeenCalledWith('ADMIN_TEST_CHAT_FAILED', expect.objectContaining({ admin: 'server-admin', code: 'unconfirmed' }));
  });
  it('rejects oversized JSON before any paid action', async () => {
    const request = await setup(); expect((await request({ ...action, messages: [{ role: 'user', content: 'x'.repeat(270_000) }] })).status).toBe(413);
    expect(fake.run).not.toHaveBeenCalled();
  });
  it('rate-limits repeated sends without a provider fallback', async () => {
    fake.run.mockResolvedValue({ content: 'reply' }); const request = await setup();
    for (let i = 0; i < 6; i++) expect((await request(action)).status).toBe(200);
    expect((await request(action)).status).toBe(429); expect(fake.run).toHaveBeenCalledTimes(6);
  });
});

describe('read-only readiness and independent review endpoints', () => {
  const signed = { action, attestation: { keyId: 'fixture-reviewer', payload: '{}', signature: 'a'.repeat(86) } };
  it.each(['readiness', 'approval', 'catalog', 'balance'] as const)('requires admin middleware before %s', async path => {
    const request = await setup();
    expect((await request(path === 'balance' ? {} : path === 'readiness' ? action : signed, false, true, path)).status).toBe(401);
    expect(fake.readiness).not.toHaveBeenCalled(); expect(fake.approval).not.toHaveBeenCalled(); expect(fake.catalog).not.toHaveBeenCalled(); expect(fake.balance).not.toHaveBeenCalled();
  });
  it('routes read-only readiness with verified identity and no inference', async () => {
    fake.readiness.mockResolvedValue({ requestId: action.requestId, readOnly: true, noProviderCall: true, ready: false });
    const request = await setup(), response = await request(action, true, true, 'readiness');
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({ readOnly: true, noProviderCall: true });
    expect(fake.readiness).toHaveBeenCalledExactlyOnceWith(action, 'server-admin'); expect(fake.run).not.toHaveBeenCalled();
  });
  it.each(['approval', 'catalog'])('imports %s only via signed-envelope parser with a metadata-only audit', async path => {
    const handler = path === 'approval' ? fake.approval : fake.catalog;
    handler.mockResolvedValue({ imported: true, requestId: action.requestId, expiresAtMs: 123, noProviderCall: true, noFallback: true });
    const request = await setup(), response = await request(signed, true, true, path);
    expect(response.status).toBe(200); expect(handler).toHaveBeenCalledExactlyOnceWith(signed, 'server-admin');
    expect(JSON.stringify(fake.audit.mock.calls)).not.toContain('Synthetic prompt'); expect(JSON.stringify(fake.audit.mock.calls)).not.toContain('signature');
    expect(fake.run).not.toHaveBeenCalled();
    expect((await request({ ...signed, publicKey: 'client-key' }, true, true, path)).status).toBe(400);
    expect(handler).toHaveBeenCalledOnce();
  });
  it('reads provider balance only on an explicit empty authenticated request', async () => {
    fake.balance.mockResolvedValue({ status: 'available', currency: 'USD', balanceMicros: '18000000', checkedAtMs: 123 });
    const request = await setup();
    expect((await request({}, true, true, 'balance')).status).toBe(200); expect(fake.balance).toHaveBeenCalledExactlyOnceWith({ signal: expect.any(AbortSignal) });
    for (const body of [{ key: 'injected' }, { endpoint: 'https://untrusted.test' }, []]) expect((await request(body, true, true, 'balance')).status).toBe(400);
    expect(fake.balance).toHaveBeenCalledOnce(); expect(fake.run).not.toHaveBeenCalled();
    expect(JSON.stringify(fake.audit.mock.calls)).not.toContain('18000000');
  });
  it.each(['readiness', 'approval', 'catalog', 'balance'] as const)('never exposes a raw exception from %s', async path => {
    ({ readiness: fake.readiness, approval: fake.approval, catalog: fake.catalog, balance: fake.balance })[path]!.mockRejectedValue(new Error('secret-key-and-private-record'));
    const request = await setup(), response = await request(path === 'balance' ? {} : path === 'readiness' ? action : signed, true, true, path);
    expect(response.status).toBe(503); expect(await response.text()).not.toMatch(/secret-key|private-record/);
    expect(JSON.stringify(fake.audit.mock.calls)).not.toMatch(/secret-key|private-record/); expect(fake.run).not.toHaveBeenCalled();
  });
  it('distinguishes catalog and payload envelope size limits before import', async () => {
    const request = await setup(), larger = { ...signed, attestation: { ...signed.attestation, payload: 'x'.repeat(16_001) } };
    expect((await request(larger, true, true, 'approval')).status).toBe(400);
    fake.catalog.mockResolvedValue({ imported: true }); expect((await request(larger, true, true, 'catalog')).status).toBe(200);
    expect((await request({ ...signed, attestation: { ...signed.attestation, payload: 'x'.repeat(128_001) } }, true, true, 'catalog')).status).toBe(400);
    expect(fake.approval).not.toHaveBeenCalled(); expect(fake.catalog).toHaveBeenCalledOnce();
  });
});
