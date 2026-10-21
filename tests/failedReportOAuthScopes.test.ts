import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { request as httpRequest } from 'node:http';
import type { Server } from 'node:http';
const oauth = vi.hoisted(() => ({ register: vi.fn(), pending: vi.fn(), decide: vi.fn() }));
vi.mock('../src/server/lib/failedReportOAuth', async original => ({ ...await original<any>(), reportOAuthService: () => oauth }));
vi.mock('../src/server/lib/audit', () => ({ audit: vi.fn() }));
import { registerFailedReportOAuthRoutes } from '../src/server/routes/failedReportOAuth';
import { ReportOAuthError, REPORT_SCOPE, REPORT_AUTOPSY_SCOPE } from '../src/server/lib/failedReportOAuth';
import { apiVersionMiddleware } from '../src/server/routes/apiVersion';
import { mintAdminToken } from '../src/server/lib/adminAuth';
import { audit } from '../src/server/lib/audit';

let server: Server; let port: number; let adminToken: string;
const id = 'a'.repeat(64);
const dual = `${REPORT_SCOPE} ${REPORT_AUTOPSY_SCOPE}`;
function request(path: string, body?: unknown, authenticated = false): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const r = httpRequest({ hostname: '127.0.0.1', port, path, method: payload === undefined ? 'GET' : 'POST', headers: {
      'Content-Type': 'application/json',
      ...(payload === undefined ? {} : { 'Content-Length': String(Buffer.byteLength(payload)) }),
      ...(authenticated ? { 'x-admin-token': adminToken } : {}),
    } }, response => {
      let raw = ''; response.on('data', chunk => { raw += chunk; });
      response.on('end', () => resolve({ status: response.statusCode!, body: raw ? JSON.parse(raw) : null }));
    });
    r.on('error', reject); if (payload !== undefined) r.write(payload); r.end();
  });
}
beforeAll(async () => {
  vi.stubEnv('ADMIN_USERNAME', 'owner'); vi.stubEnv('ADMIN_PASSWORD', 'test-private-password');
  adminToken = mintAdminToken('test-private-password', 'owner', Date.now());
  const app = express(); app.use(express.json()); app.use(apiVersionMiddleware); registerFailedReportOAuthRoutes(app);
  server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  port = (server.address() as { port: number }).port;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); vi.unstubAllEnvs(); });
beforeEach(() => { oauth.register.mockReset(); oauth.pending.mockReset(); oauth.decide.mockReset(); vi.mocked(audit).mockReset(); });

describe('the report OAuth HTTP boundary advertises and binds its optional scope', () => {
  it('resource and authorization metadata advertise only read and narrow autopsy access', async () => {
    for (const path of ['/.well-known/oauth-protected-resource/api/v1/failedbr/mcp', '/.well-known/oauth-authorization-server/api/v1/failedbr/oauth']) {
      const res = await request(path);
      expect(res.status).toBe(200);
      expect(res.body.scopes_supported).toEqual([REPORT_SCOPE, REPORT_AUTOPSY_SCOPE]);
    }
  });
  it('preserves omitted registration scope and returns the server-provisioned capability metadata', async () => {
    const body = { redirect_uris: ['https://client.example/callback'], token_endpoint_auth_method: 'none' };
    oauth.register.mockResolvedValue({ client_id: 'registered', scope: dual, ...body });
    const res = await request('/api/v1/failedbr/oauth/register', body);
    expect(res.status).toBe(201);
    expect(oauth.register).toHaveBeenCalledWith(body);
    expect(res.body.scope).toBe(dual);
    expect(res.body.access_token).toBeUndefined();
    expect(oauth.decide).not.toHaveBeenCalled();
  });
  it('passes the exact reviewed scope through to the decision service', async () => {
    oauth.decide.mockResolvedValue('https://client.example/callback?code=accepted');
    const res = await request(`/api/v1/admin/failedbr/oauth/request/${id}`, { approve: true, scope: dual }, true);
    expect(res.status).toBe(200);
    expect(oauth.decide).toHaveBeenCalledWith(id, true, dual);
    expect(audit).toHaveBeenCalledWith('ADMIN_FAILED_REPORT_OAUTH_CONSENT', { admin: 'owner', requestId: id, approved: true, scope: dual });
  });
  it('does not fabricate a scope for historical read-only consent', async () => {
    oauth.decide.mockResolvedValue('https://client.example/callback?code=accepted');
    expect((await request(`/api/v1/admin/failedbr/oauth/request/${id}`, { approve: true }, true)).status).toBe(200);
    expect(oauth.decide).toHaveBeenCalledWith(id, true);
    expect(audit).toHaveBeenCalledWith('ADMIN_FAILED_REPORT_OAUTH_CONSENT', { admin: 'owner', requestId: id, approved: true, scope: REPORT_SCOPE });
  });
  it('surfaces a scope mismatch without redirecting or returning a false success', async () => {
    oauth.decide.mockRejectedValue(new ReportOAuthError('invalid_scope', 'Review the requested permissions.'));
    const res = await request(`/api/v1/admin/failedbr/oauth/request/${id}`, { approve: true, scope: REPORT_SCOPE }, true);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_scope');
    expect(res.body.redirect).toBeUndefined();
    expect(audit).not.toHaveBeenCalled();
  });
  it('scope knowledge is not permission to inspect or approve another connection', async () => {
    const path = `/api/v1/admin/failedbr/oauth/request/${id}`;
    expect((await request(path)).status).toBe(401);
    expect((await request(path, { approve: true, scope: dual })).status).toBe(401);
    expect(oauth.pending).not.toHaveBeenCalled();
    expect(oauth.decide).not.toHaveBeenCalled();
  });
});
