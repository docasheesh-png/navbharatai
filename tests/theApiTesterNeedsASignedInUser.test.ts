import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { captureRoutes, mockReq, mockRes } from './helpers/routeTestUtils';
import { registerDevtoolsProxyRoutes } from '../src/server/routes/devtoolsProxy';

/**
 * BLD-14. The API tester proxy is an open relay unless the caller is a verified user,
 * and it must not dial arbitrary methods or ports.
 */
const routes = captureRoutes(registerDevtoolsProxyRoutes);
const proxy = routes.get('POST /api/devtools/proxy')!;

const savedPorts = process.env.DEVTOOLS_PROXY_PORTS;

afterEach(() => {
  if (savedPorts === undefined) delete process.env.DEVTOOLS_PROXY_PORTS;
  else process.env.DEVTOOLS_PROXY_PORTS = savedPorts;
});

describe('the API tester needs a signed-in user', () => {
  it('a request with no verified header is 401', async () => {
    const res = mockRes();
    await proxy(mockReq({ body: { url: 'https://example.com/', method: 'GET' } }), res);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('Sign in to use the API tester.');
  });

  it('CONNECT or port 25 is refused', async () => {
    const headers = { 'x-test-verified-uid': 'user-1' };
    const connect = mockRes();
    await proxy(mockReq({
      body: { url: 'https://example.com/', method: 'CONNECT' },
      headers,
    }), connect);
    expect(connect.statusCode).toBe(400);

    const smtp = mockRes();
    await proxy(mockReq({
      body: { url: 'http://example.com:25/', method: 'GET' },
      headers,
    }), smtp);
    expect(smtp.statusCode).toBe(400);
    expect(smtp.body.error).toMatch(/not allowed/i);
  });

  it('the client sends authedHeaders()', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/ide/APITester.tsx'), 'utf8');
    expect(src).toContain('authedHeaders(');
    expect(src).toContain('authHeaders');
  });
});
