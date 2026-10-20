import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type ClientRequest, type IncomingMessage, type RequestOptions, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import axios from 'axios';

const require = createRequire(import.meta.url);
// Resolve through the production consumer, not an unrelated duplicate dependency.
const axiosRequire = createRequire(require.resolve('axios/package.json'));
const redirects = axiosRequire('follow-redirects') as {
  http: { request(options: RequestOptions & { sensitiveHeaders?: string[] }, cb: (response: IncomingMessage) => void): ClientRequest };
};
interface Captured { headers: Record<string, string>; method: string; body: string }
let origin: Server, target: Server, originPort: number, targetPort: number;
const listen = (server: Server): Promise<number> => new Promise((done, fail) => {
  server.once('error', fail);
  server.listen(0, '127.0.0.1', () => done((server.address() as AddressInfo).port));
});
function capture(request: IncomingMessage, response: import('node:http').ServerResponse) {
  let body = '';
  request.on('data', chunk => { body += chunk; });
  request.on('end', () => response.end(JSON.stringify({ headers: request.headers, method: request.method, body })));
}
const pairs = () => [
  'Authorization', 'Bearer synthetic-only', 'Cookie', 'synthetic=only',
  'Proxy-Authorization', 'Basic synthetic-only', 'X-Api^Key', 'synthetic-caret',
  'X-Token|Secret', 'synthetic-pipe', 'X-Control-Key', 'synthetic-control',
  'X-Token', 'harmless-token-label', 'Secret', 'harmless-label', 'X-Public', 'keep-me',
];
function headers(array: boolean) {
  const values = ['Host', `127.0.0.1:${originPort}`, ...pairs()];
  return array ? values : Object.fromEntries(Array.from({ length: values.length / 2 }, (_, i) => [values[i * 2], values[i * 2 + 1]]));
}
const sensitive = ['X-Api^Key', 'X-Token|Secret', 'X-Control-Key'];
function request(path: string, options: RequestOptions & { sensitiveHeaders?: string[] }, body?: string): Promise<Captured> {
  return new Promise((done, fail) => {
    const req = redirects.http.request({ hostname: '127.0.0.1', port: originPort, path, ...options }, response => {
      let text = '';
      response.on('data', chunk => { text += chunk; });
      response.on('error', fail);
      response.on('end', () => { try { done(JSON.parse(text)); } catch (error) { fail(error); } });
    });
    req.setTimeout(1500, () => req.destroy(new Error('Loopback redirect deadline exceeded')));
    req.on('error', fail);
    req.end(body);
  });
}

beforeAll(async () => {
  target = createServer(capture);
  targetPort = await listen(target);
  origin = createServer((req, res) => {
    if (req.url === '/capture') { capture(req, res); return; }
    req.resume();
    res.writeHead(302, { Location: req.url === '/same' ? '/capture' : `http://127.0.0.1:${targetPort}/capture` });
    res.end();
  });
  originPort = await listen(origin);
});
afterAll(async () => {
  await Promise.all([origin, target].filter(Boolean).map(server => new Promise<void>(done => {
    server.closeAllConnections(); server.close(() => done());
  })));
});

describe('the locked redirect dependency protects declared credential names', () => {
  it('installs the same patched version through Axios and every lockfile instance', () => {
    const lock = JSON.parse(readFileSync(resolve(process.cwd(), 'package-lock.json'), 'utf8'));
    const versions = Object.entries(lock.packages as Record<string, { version: string }>)
      .filter(([path]) => /(?:^|\/)node_modules\/follow-redirects$/.test(path)).map(([, pkg]) => pkg.version);
    expect(versions.length).toBeGreaterThan(0);
    for (const version of versions) expect(require('semver').satisfies(version, '>=1.16.1')).toBe(true);
    expect(versions).toContain(axiosRequire('follow-redirects/package.json').version);
  });
  it.each([false, true])('strips cross-origin credentials without stripping harmless sibling names (array=%s)', async array => {
    const result = await request('/cross', { headers: headers(array), sensitiveHeaders: sensitive });
    for (const name of ['authorization', 'cookie', 'proxy-authorization', 'x-api^key', 'x-token|secret', 'x-control-key']) {
      expect(result.headers[name], name).toBeUndefined();
    }
    expect(result.headers['x-token']).toBe('harmless-token-label');
    expect(result.headers.secret).toBe('harmless-label');
    expect(result.headers['x-public']).toBe('keep-me');
    expect(result.headers.host).toBe(`127.0.0.1:${targetPort}`);
  });
  it.each([false, true])('retains intended credentials on same-origin relative redirects (array=%s)', async array => {
    const result = await request('/same', { headers: headers(array), sensitiveHeaders: sensitive });
    expect(result.headers.authorization).toBe('Bearer synthetic-only');
    expect(result.headers['x-api^key']).toBe('synthetic-caret');
    expect(result.headers['x-token|secret']).toBe('synthetic-pipe');
  });
  it('drops raw-array content headers when POST becomes GET', async () => {
    const result = await request('/cross', { method: 'POST', sensitiveHeaders: sensitive,
      headers: [...pairs(), 'Content-Type', 'text/plain', 'Content-Length', '3'] }, 'abc');
    expect(result.method).toBe('GET');
    expect(result.body).toBe('');
    expect(result.headers['content-length']).toBeUndefined();
    expect(result.headers['content-type']).toBeUndefined();
  });
  it('accepts a bracket-containing declared name without crashing an ordinary request', async () => {
    const result = await request('/same', { headers: { 'X-Public': 'keep-me' }, sensitiveHeaders: ['X-['] });
    expect(result.headers['x-public']).toBe('keep-me');
  });
  it('preserves the production Axios object-header path while stripping on cross-origin redirect', async () => {
    const response = await axios.get<Captured>(`http://127.0.0.1:${originPort}/cross`, {
      headers: headers(false) as Record<string, string>, sensitiveHeaders: sensitive,
      proxy: false, timeout: 1500, maxRedirects: 5,
    });
    expect(response.data.headers.authorization).toBeUndefined();
    expect(response.data.headers['x-api^key']).toBeUndefined();
    expect(response.data.headers['x-token|secret']).toBeUndefined();
    expect(response.data.headers['x-public']).toBe('keep-me');
  });
});
