import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { request as httpRequest } from 'node:http';
import type { Server } from 'node:http';
const mocked = vi.hoisted(() => ({ page: vi.fn(), detail: vi.fn(), create: vi.fn(), list: vi.fn(), revoke: vi.fn(), tokenOk: vi.fn() }));
vi.mock('../src/server/lib/failedReportAccess', () => ({ createReportAccess: mocked.create, listReportAccess: mocked.list, revokeReportAccess: mocked.revoke, reportTokenOk: mocked.tokenOk }));
vi.mock('../src/server/lib/failedBuildReports', async (original) => ({ ...await original<any>(), readFailedBuildPage: mocked.page, readFailedBuild: mocked.detail }));
import { registerFailedReportRoutes } from '../src/server/routes/failedReports';
import { apiVersionMiddleware } from '../src/server/routes/apiVersion';
import { mintAdminToken } from '../src/server/lib/adminAuth';

let server: Server; let port: number; let adminToken: string;
function request(path: string, opts: { method?: string; headers?: Record<string, string>; body?: unknown } = {}): Promise<{ status: number; headers: any; body: any }> {
  return new Promise((resolve, reject) => {
    const r = httpRequest({ hostname: '127.0.0.1', port, path, method: opts.method ?? 'GET', headers: { 'Content-Type': 'application/json', ...(opts.body ? { 'Content-Length': String(Buffer.byteLength(JSON.stringify(opts.body))) } : {}), ...opts.headers } }, (s) => {
      let body = ''; s.on('data', (b) => { body += b; }); s.on('end', () => resolve({ status: s.statusCode!, headers: s.headers, body: body ? JSON.parse(body) : null }));
    }); r.on('error', reject); if (opts.body) r.write(JSON.stringify(opts.body)); r.end();
  });
}
beforeAll(async () => {
  vi.stubEnv('ADMIN_USERNAME', 'owner'); vi.stubEnv('ADMIN_PASSWORD', 'test-private-password');
  adminToken = mintAdminToken('test-private-password', 'owner', Date.now());
  const app = express(); app.use(express.json()); app.use(apiVersionMiddleware); registerFailedReportRoutes(app);
  server = await new Promise<Server>((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  port = (server.address() as { port: number }).port;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });
beforeEach(() => { mocked.page.mockReset().mockResolvedValue({ reports: [], nextCursor: null, scanned: 1 }); mocked.detail.mockReset().mockResolvedValue({ ok: false }); mocked.tokenOk.mockReset().mockImplementation(async (s) => s === 'Bearer read-only'); mocked.create.mockReset().mockResolvedValue({ id: 'a'.repeat(64), token: 'only-once' }); mocked.list.mockResolvedValue([]); mocked.revoke.mockResolvedValue(undefined); });
const bearer = { Authorization: 'Bearer read-only' };
const rpc = (method: string, params?: unknown) => ({ jsonrpc: '2.0', id: 1, method, params });
describe('private report HTTP boundary', () => {
  it('rejects the public, forged tokens, query credentials and normal user auth before reading', async () => {
    for (const [path, headers] of [['/api/v1/failedbr/reports', {}], ['/api/v1/failedbr/reports?token=read-only', {}], ['/api/v1/failedbr/reports', { Authorization: 'Bearer user-firebase-token' }], ['/api/v1/failedbr/reports', { 'x-admin-token': 'forged' }]] as const) expect((await request(path, { headers })).status).toBe(401);
    expect(mocked.page).not.toHaveBeenCalled();
  });
  it('admits admin and delegated reads but forbids delegate credential management', async () => {
    const a = await request('/api/v1/failedbr/reports', { headers: { 'x-admin-token': adminToken } });
    expect(a.status).toBe(200); expect(a.headers['cache-control']).toContain('no-store'); expect(a.headers['x-api-version']).toBe('v1');
    expect((await request('/api/v1/failedbr/reports', { headers: bearer })).status).toBe(200);
    expect((await request('/api/v1/failedbr/reports/app/100', { headers: bearer })).status).toBe(200);
    for (const method of ['GET', 'POST', 'DELETE']) expect((await request('/api/v1/admin/failedbr/access' + (method === 'DELETE' ? '/'+ 'a'.repeat(64) : ''), { method, headers: bearer, body: { label: 'tool', reason: 'For analysis' } })).status).toBe(401);
    expect(mocked.create).not.toHaveBeenCalled(); expect(mocked.revoke).not.toHaveBeenCalled();
  });
  it('returns unavailable, never a false empty inbox, on authorization or storage failure', async () => {
    mocked.tokenOk.mockRejectedValueOnce(new Error('offline'));
    expect((await request('/api/v1/failedbr/reports', { headers: bearer })).status).toBe(503);
    mocked.page.mockRejectedValueOnce(new Error('offline'));
    expect((await request('/api/v1/failedbr/reports', { headers: bearer })).status).toBe(503);
    mocked.detail.mockResolvedValueOnce(null);
    expect((await request('/api/v1/failedbr/reports/app/100', { headers: bearer })).status).toBe(404);
  });
  it('requires an admin and a reason to create or revoke a credential', async () => {
    const headers = { 'x-admin-token': adminToken };
    expect((await request('/api/v1/admin/failedbr/access', { method: 'POST', headers, body: { label: 'tool' } })).status).toBe(400);
    expect((await request('/api/v1/admin/failedbr/access', { method: 'POST', headers, body: { label: 'tool', reason: 'Analyze build failures' } })).status).toBe(201);
    expect((await request('/api/v1/admin/failedbr/access/'+ 'a'.repeat(64), { method: 'DELETE', headers, body: { reason: 'Finished the analysis' } })).status).toBe(200);
    expect(mocked.revoke).toHaveBeenCalledWith('a'.repeat(64));
  });
  it('serves authenticated MCP initialization, read tools, notifications and honest errors', async () => {
    const call = (body: unknown, headers = bearer) => request('/api/v1/failedbr/mcp', { method: 'POST', headers, body });
    expect((await call(rpc('initialize'))).body.result.capabilities).toEqual({ tools: {} });
    expect((await call(rpc('tools/list'))).body.result.tools).toHaveLength(2);
    expect((await call(rpc('tools/call', { name: 'list_failed_builds', arguments: { cursor: 'next' } }))).body.result.content[0].text).toContain('nextCursor');
    expect(mocked.page).toHaveBeenCalledWith('next', undefined);
    expect((await call(rpc('tools/call', { name: 'get_failed_build', arguments: { workspaceId: 'app', historyId: '100' } }))).body.result.content[0].text).toContain('false');
    expect((await call({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202);
    expect((await call(rpc('delete_build'))).body.error.code).toBe(-32601);
    expect((await call(rpc('tools/call', { name: 'delete_build' }))).body.error.code).toBe(-32602);
    expect((await call(rpc('ping'), { ...bearer, Origin: 'https://attacker.example' } as any)).status).toBe(403);
    expect((await request('/api/v1/failedbr/mcp', { headers: bearer })).status).toBe(405);
    mocked.page.mockRejectedValueOnce(new Error('offline'));
    expect((await call(rpc('tools/call', { name: 'list_failed_builds' }))).body.error.code).toBe(-32603);
  });
});
