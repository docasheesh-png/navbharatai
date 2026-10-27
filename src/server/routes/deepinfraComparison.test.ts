import express from 'express';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ status: vi.fn(), run: vi.fn(), audit: vi.fn() }));
vi.mock('../lib/deepinfraComparison', () => ({ comparisonStatus: fake.status, runComparison: fake.run,
  ComparisonUnavailable: class extends Error { constructor(readonly reason: string, readonly status = 503) { super(reason); } } }));
vi.mock('../lib/audit', () => ({ audit: fake.audit }));
vi.mock('../lib/adminAuth', () => ({ adminUsername: () => 'server-derived-admin' }));
import { registerDeepinfraComparisonRoutes } from './deepinfraComparison';
import { ComparisonUnavailable } from '../lib/deepinfraComparison';
let server: Server;
const root = '/api/admin/free-chat-chain/deepinfra-comparison';
const action = { runId: '1d2efc71-6d00-4514-83c0-e31461ea9f35', reason: 'Review the two model candidates', tariffDigest: 'a'.repeat(64), acceptPublishedRates: true };
async function setup() {
  const app = express(); app.use(express.json());
  registerDeepinfraComparisonRoutes(app, (req, res, next) => { if (req.headers['x-admin-token'] === 'synthetic-admin') next(); else res.status(401).end(); });
  server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number };
  return (body?: unknown, authenticated = true) => fetch(`http://127.0.0.1:${address.port}${root}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { ...(authenticated ? { 'x-admin-token': 'synthetic-admin' } : {}), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(() => vi.clearAllMocks());
afterEach(async () => { if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } });
describe('admin comparison HTTP boundary', () => {
  it('requires admin auth before both status and paid execution', async () => {
    const request = await setup();
    expect((await request(undefined, false)).status).toBe(401); expect((await request(action, false)).status).toBe(401);
    expect(fake.status).not.toHaveBeenCalled(); expect(fake.run).not.toHaveBeenCalled();
  });
  it('GET never starts inference and is not cached', async () => {
    const request = await setup(); fake.status.mockResolvedValue({ configured: true });
    const response = await request(); expect(await response.json()).toEqual({ configured: true });
    expect(response.headers.get('cache-control')).toBe('private, no-store'); expect(fake.run).not.toHaveBeenCalled();
  });
  it.each([{ ...action, model: 'unapproved' }, { ...action, acceptPublishedRates: false }, { ...action, reason: 'short' }])('rejects custom models and requests without a reviewed rate card %#', async body => {
    const request = await setup();
    expect((await request(body)).status).toBe(400);
    expect(fake.run).not.toHaveBeenCalled();
  });
  it('uses a server-derived actor and passes only fixed action fields', async () => {
    const request = await setup(); fake.run.mockResolvedValue({ completed: true });
    const response = await request(action); expect(response.status).toBe(200);
    expect(fake.run).toHaveBeenCalledWith(action.runId, 'server-derived-admin', expect.any(AbortSignal), action.tariffDigest);
    expect(fake.audit).toHaveBeenCalledWith('ADMIN_DEEPINFRA_COMPARISON_STARTED', expect.objectContaining({ admin: 'server-derived-admin', runId: action.runId }));
  });
  it('returns a conflict for an active run, and never reflects a raw provider error', async () => {
    const request = await setup(); fake.run.mockRejectedValueOnce(new ComparisonUnavailable('comparison-already-running', 409));
    expect((await request(action)).status).toBe(409);
    fake.run.mockRejectedValueOnce(new Error('private-credential-and-provider-body'));
    const response = await request(action); expect(response.status).toBe(503); expect(await response.text()).not.toContain('private-credential');
  });
});
