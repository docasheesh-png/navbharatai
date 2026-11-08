/**
 * Admin 2026-11-04: "sabhi ai provider ko on off karne ka switch banao … 100% real and working".
 *
 * The switches NavBharatAI had before were removed (audit F16, 2026-10-11) because nothing read them. This file
 * checks key withdrawal/restoration and guard wrapper behavior, including cached SDK clients. Separate real Node
 * HTTPS/HTTP2 tests use only a local TLS server. These are not live-provider or production-network verification.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { EventEmitter, once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect as connectTls, type TLSSocket } from 'node:tls';
import type { Socket } from 'node:net';
import type { IncomingMessage } from 'node:http';
const state = vi.hoisted(() => ({ db: null as any }));
vi.mock('../src/server/lib/serverDb', () => ({ getServerDb: () => state.db }));
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import {
  PROVIDER_FAMILIES, ProviderSwitchConflictError, ProviderSwitchInputError, __resetProviderSwitchesForTests, applySwitchedOff,
  installProviderSwitchGuard, isProviderSwitchedOff, lastSwitchSync, providerHasKey, switchedOffProviderFor, syncSwitchesOnce, writeSwitch,
} from '../src/server/lib/providerSwitches';
import { API_PROVIDERS } from '../src/server/lib/apiProviderDirectory';

const https = createRequire(`${process.cwd()}/`)('node:https') as typeof import('node:https');
const http2 = createRequire(`${process.cwd()}/`)('node:http2') as typeof import('node:http2');
const originalNetwork = { fetch: globalThis.fetch, request: https.request, get: https.get, connect: http2.connect };
// Ordinary cases exercise wrapper logic with no sockets. Real-transport cases opt
// into the same adapters, which construct EVERY connection option themselves.
// Caller hosts/ports, agents, lookup functions, SDK defaults and redirects cannot
// select a physical destination: it is always the bound 127.0.0.1 test server.
class InMemoryTransport extends EventEmitter {
  destroyed = false;
  destroy(error?: Error) {
    this.destroyed = true;
    if (error) queueMicrotask(() => this.emit('error', error));
    return this;
  }
}
interface LoopbackTransport {
  port: number;
  ca: Buffer;
  requests: { path: string; httpVersion: string; remoteAddress: string | undefined }[];
  close: () => Promise<void>;
}
let loopbackTransport: LoopbackTransport | undefined;
const transportCalls: string[] = [];
const refuseDns: import('node:net').LookupFunction = (_host, _options, callback) => {
  callback(new Error('Loopback transport must never perform DNS resolution'), '', 4);
};
function loopbackRequest(kind: 'request' | 'get', args: unknown[]) {
  const local = loopbackTransport;
  if (!local) throw new Error('Local test transport is not active');
  const target = new URL(String(args[0]));
  const callerOptions = args[1] && typeof args[1] === 'object' ? args[1] as { method?: string } : {};
  const callback = args.find(arg => typeof arg === 'function') as ((response: IncomingMessage) => void) | undefined;
  // No spread of caller options: not even an accidental SDK option can change the
  // destination, TLS trust, agent or resolver. Literal IPv4 requires no DNS lookup.
  const request = originalNetwork[kind]({
    hostname: '127.0.0.1', port: local.port, servername: 'localhost',
    ca: local.ca, rejectUnauthorized: true, agent: false, timeout: 2000, lookup: refuseDns,
    path: target.pathname + target.search, method: callerOptions.method ?? 'GET',
  }, callback);
  request.once('timeout', () => request.destroy(new Error('Local transport timed out')));
  return request;
}
const fakeRequest = ((...args: unknown[]) => {
  transportCalls.push(String(args[0]));
  return loopbackTransport ? loopbackRequest('request', args) : new InMemoryTransport();
}) as unknown as typeof https.request;
const fakeGet = ((...args: unknown[]) => {
  transportCalls.push(String(args[0]));
  return loopbackTransport ? loopbackRequest('get', args) : new InMemoryTransport();
}) as unknown as typeof https.get;
const fakeConnect = ((url: unknown) => {
  transportCalls.push(String(url));
  const local = loopbackTransport;
  if (!local) return new InMemoryTransport();
  return originalNetwork.connect(`https://localhost:${local.port}`, {
    // Supplying the connected socket avoids authority-host DNS entirely. There is
    // no default connector fallback, even when TLS establishment fails.
    createConnection: () => connectTls({
      host: '127.0.0.1', port: local.port, servername: 'localhost', ca: local.ca,
      rejectUnauthorized: true, ALPNProtocols: ['h2'], lookup: refuseDns,
    }),
  });
}) as unknown as typeof http2.connect;
const fetchCalls: string[] = [];
beforeAll(() => {
  // SDKs capture this isolated fetch wrapper. In real-transport cases the response
  // bytes come from Node HTTPS over loopback, never native fetch or a remote URL.
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = String(input instanceof URL ? input.href : input?.url ?? input);
    fetchCalls.push(url);
    if (!loopbackTransport) return new Response('{"data":[]}', { status: 200, headers: { 'content-type': 'application/json' } });
    return await new Promise<Response>((resolve, reject) => {
      const request = loopbackRequest('request', [url, { method: init?.method ?? input?.method ?? 'GET' }, (response: IncomingMessage) => {
        const chunks: Buffer[] = [];
        response.on('data', chunk => chunks.push(Buffer.from(chunk)));
        response.once('error', reject);
        response.once('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: { 'content-type': 'application/json' } })));
      }]);
      request.once('error', reject);
      request.end();
    });
  }) as typeof fetch;
  https.request = fakeRequest; https.get = fakeGet; http2.connect = fakeConnect;
  installProviderSwitchGuard();
});
afterEach(() => { loopbackTransport = undefined; __resetProviderSwitchesForTests(); state.db = null; fetchCalls.length = 0; transportCalls.length = 0; });
afterAll(() => { globalThis.fetch = originalNetwork.fetch; https.request = originalNetwork.request; https.get = originalNetwork.get; http2.connect = originalNetwork.connect; syncBuiltinESMExports(); });

describe('layer 1 — the key is withdrawn, and put back byte for byte', () => {
  it('withdraws every key of the provider (patterns included) and nothing else', () => {
    const env: NodeJS.ProcessEnv = { GLM_API_KEY: 'g1', GLM_API_KEY_2: 'g2', FREE_CHAIN_GLM_API_KEY: 'g3', KIMI_API_KEY: 'k', GLM_BASE_URL: 'https://x', CLOUDFLARE_API_TOKEN: 'dns' };
    applySwitchedOff(['glm'], env);
    expect(env).toEqual({ KIMI_API_KEY: 'k', GLM_BASE_URL: 'https://x', CLOUDFLARE_API_TOKEN: 'dns' });
    expect(isProviderSwitchedOff('glm')).toBe(true);
    expect(providerHasKey('glm', env)).toBe(true); // it HAS a key — it is only withdrawn
    applySwitchedOff([], env);
    expect(env).toEqual({ GLM_API_KEY: 'g1', GLM_API_KEY_2: 'g2', FREE_CHAIN_GLM_API_KEY: 'g3', KIMI_API_KEY: 'k', GLM_BASE_URL: 'https://x', CLOUDFLARE_API_TOKEN: 'dns' });
  });
  it('is idempotent, and a key that appears while off is withdrawn too', () => {
    const env: NodeJS.ProcessEnv = { OPENAI_API_KEY: 'o' };
    applySwitchedOff(['openai'], env); applySwitchedOff(['openai'], env);
    env.FREE_CHAIN_OPENAI_API_KEY = 'late';
    applySwitchedOff(['openai'], env);
    expect(env).toEqual({});
    applySwitchedOff([], env);
    expect(env).toEqual({ OPENAI_API_KEY: 'o', FREE_CHAIN_OPENAI_API_KEY: 'late' });
  });
  it('Cloudflare withdraws only the AI token — the domains token stays', () => {
    const env: NodeJS.ProcessEnv = { CLOUDFLARE_AI_TOKEN: 'ai', CLOUDFLARE_API_TOKEN: 'dns' };
    applySwitchedOff(['cloudflare'], env);
    expect(env).toEqual({ CLOUDFLARE_API_TOKEN: 'dns' });
  });
  it('unknown ids are ignored, never a crash', () => {
    applySwitchedOff(['not-a-provider'], {});
    expect(isProviderSwitchedOff('not-a-provider')).toBe(false);
  });
  it('Mitrify OFF withdraws its key and blocks default or configured gateway hosts, not upstream providers', async () => {
    const env: NodeJS.ProcessEnv = { MITRIFY_API_KEY: 'synthetic-local-only', MITRIFY_BASE_URL: 'https://gateway.example.test/v1', OPENROUTER_API_KEY: 'other' };
    applySwitchedOff(['mitrify'], env);
    expect(env.MITRIFY_API_KEY).toBeUndefined();
    expect(env.OPENROUTER_API_KEY).toBe('other');
    expect(switchedOffProviderFor('mitrify.com', '/v1/chat/completions', env)).toBe('mitrify');
    expect(switchedOffProviderFor('gateway.example.test', '/v1/chat/completions', env)).toBe('mitrify');
    expect(switchedOffProviderFor('openrouter.ai', '/api/v1/chat/completions', env)).toBeNull();
    await expect(fetch('https://mitrify.com/v1/chat/completions')).rejects.toMatchObject({ code: 'PROVIDER_SWITCHED_OFF' });
    expect(fetchCalls).toEqual([]);
    applySwitchedOff([], env);
    expect(env.MITRIFY_API_KEY).toBe('synthetic-local-only');
  });
});

describe('layer 2 — which requests are refused', () => {
  it('each provider’s own hosts, and only while it is off', () => {
    expect(switchedOffProviderFor('api.openai.com', '/v1/chat')).toBeNull();
    applySwitchedOff(['openai', 'vertex', 'bedrock', 'cloudflare', 'kimi'], {});
    expect(switchedOffProviderFor('api.openai.com', '/v1/chat', {})).toBe('openai');
    expect(switchedOffProviderFor('API.OPENAI.COM.', '/', {})).toBe('openai');
    expect(switchedOffProviderFor('us-central1-aiplatform.googleapis.com', '/v1/x', {})).toBe('vertex');
    expect(switchedOffProviderFor('aiplatform.googleapis.com', '/', {})).toBe('vertex');
    expect(switchedOffProviderFor('bedrock-runtime.us-east-1.amazonaws.com', '/model', {})).toBe('bedrock');
    expect(switchedOffProviderFor('api.cloudflare.com', '/client/v4/accounts/abc/ai/v1/chat', {})).toBe('cloudflare');
    expect(switchedOffProviderFor('api.moonshot.ai', '/v1', {})).toBe('kimi');
    expect(switchedOffProviderFor('coding.example.dev', '/v1', { KIMI_BASE_URL: 'https://coding.example.dev/v1' })).toBe('kimi');
  });
  it('🔒 never touches what is not that provider: Firestore, Gemini when only Vertex is off, Cloudflare DNS, S3', async () => {
    state.db = fakeDb(); await syncSwitchesOnce(); // known durable ON, not the unknown boot state
    applySwitchedOff(['vertex', 'cloudflare', 'bedrock'], {});
    expect(switchedOffProviderFor('firestore.googleapis.com', '/', {})).toBeNull();
    expect(switchedOffProviderFor('www.googleapis.com', '/', {})).toBeNull();
    expect(switchedOffProviderFor('generativelanguage.googleapis.com', '/', {})).toBeNull();
    expect(switchedOffProviderFor('api.cloudflare.com', '/client/v4/zones/abc/dns_records', {})).toBeNull();
    expect(switchedOffProviderFor('s3.us-east-1.amazonaws.com', '/', {})).toBeNull();
    expect(switchedOffProviderFor('evil-bedrock-runtime.amazonaws.com.attacker.io', '/', {})).toBeNull();
  });
});

describe('guard wrapper behavior with in-memory transports and cached SDK clients', () => {
  it('fetch to a switched-off provider rejects before anything is sent; other calls pass through', async () => {
    applySwitchedOff(['openai'], {});
    await expect(fetch('https://api.openai.com/v1/models')).rejects.toMatchObject({ code: 'PROVIDER_SWITCHED_OFF', providerId: 'openai' });
    expect(fetchCalls).toEqual([]);
    await fetch('https://api.anthropic.com/v1/models');
    expect(fetchCalls).toEqual(['https://api.anthropic.com/v1/models']);
  });
  it('https.request to a switched-off provider is destroyed before it connects, with the switch error', async () => {
    applySwitchedOff(['anthropic'], {});
    const req = https.request('https://api.anthropic.com/v1/messages', { method: 'POST' });
    expect(req.destroyed).toBe(true);
    const err = await new Promise<any>((resolve) => req.on('error', resolve));
    expect(err).toMatchObject({ code: 'PROVIDER_SWITCHED_OFF', providerId: 'anthropic' });
  });
  it('http2 (Nova Sonic voice) to a switched-off Bedrock host is destroyed with the switch error', async () => {
    const http2 = createRequire(`${process.cwd()}/`)('node:http2') as typeof import('node:http2');
    applySwitchedOff(['bedrock'], {});
    const session = http2.connect('https://bedrock-runtime.us-east-1.amazonaws.com');
    expect(session.destroyed).toBe(true);
    const err = await new Promise<any>((resolve) => session.on('error', resolve));
    expect(err).toMatchObject({ code: 'PROVIDER_SWITCHED_OFF', providerId: 'bedrock' });
  });
  it('with nothing switched off, https.request delegates to the captured stand-in unchanged', () => {
    const req = https.request('https://api.anthropic.com/v1/messages', { method: 'POST' });
    expect(req.destroyed).toBe(false);
    expect(req).toBeInstanceOf(InMemoryTransport);
    expect(transportCalls).toEqual(['https://api.anthropic.com/v1/messages']);
    req.on('error', () => {}); req.destroy();
  });
  it('a cached OpenAI SDK client stops working the moment its provider is off, and works again when on', async () => {
    const client = new OpenAI({ apiKey: 'sk-synthetic', baseURL: 'https://api.openai.com/v1', maxRetries: 0 });
    await client.models.list();
    expect(fetchCalls.length).toBe(1);
    applySwitchedOff(['openai'], {});
    await expect(client.models.list()).rejects.toThrow();
    expect(fetchCalls.length).toBe(1); // nothing reached the network
    applySwitchedOff([], {});
    await client.models.list();
    expect(fetchCalls.length).toBe(2);
  });
  it('a cached Anthropic SDK client is refused too', async () => {
    const client = new Anthropic({ apiKey: 'sk-synthetic', maxRetries: 0 });
    applySwitchedOff(['anthropic'], {});
    await expect(client.messages.create({ model: 'x', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow();
    expect(fetchCalls).toEqual([]);
  });
});

async function startLoopbackTransport(): Promise<LoopbackTransport> {
  const directory = mkdtempSync(join(tmpdir(), 'provider-switch-loopback-'));
  let ca: Buffer, key: Buffer, cert: Buffer;
  try {
    // Ephemeral CA and leaf, trusted only by this fixture's explicit ca option.
    // OpenSSL runs locally; no production trust store or TLS setting is changed.
    const openssl = (...args: string[]) => execFileSync('openssl', args, { cwd: directory, stdio: 'pipe' });
    openssl('req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes', '-days', '1',
      '-keyout', 'ca.key', '-out', 'ca.pem', '-subj', '/CN=Provider Switch Loopback Test CA',
      '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign');
    openssl('req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256', '-nodes',
      '-keyout', 'server.key', '-out', 'server.csr', '-subj', '/CN=localhost');
    writeFileSync(join(directory, 'server.ext'), [
      'basicConstraints=critical,CA:FALSE', 'keyUsage=critical,digitalSignature',
      'extendedKeyUsage=serverAuth', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ].join('\n'));
    openssl('x509', '-req', '-in', 'server.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial',
      '-out', 'server.pem', '-days', '1', '-extfile', 'server.ext');
    ca = readFileSync(join(directory, 'ca.pem'));
    key = readFileSync(join(directory, 'server.key'));
    cert = readFileSync(join(directory, 'server.pem'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
  const server = http2.createSecureServer({ key, cert, allowHTTP1: true });
  const sockets = new Set<Socket>();
  const sessions = new Set<import('node:http2').ServerHttp2Session>();
  const requests: LoopbackTransport['requests'] = [];
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.on('session', session => { sessions.add(session); session.once('close', () => sessions.delete(session)); });
  server.on('request', (request, response) => {
    requests.push({ path: request.url!, httpVersion: request.httpVersion, remoteAddress: request.socket.remoteAddress });
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ object: 'list', data: [] }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string' || address.address !== '127.0.0.1') throw new Error('Loopback listener unavailable');
  return { port: address.port, ca, requests, close: async () => {
    const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    for (const session of sessions) session.destroy();
    for (const socket of sockets) socket.destroy();
    await closed;
  } };
}

describe('real Node TLS transports against 127.0.0.1 only, not live providers', () => {
  let local: LoopbackTransport;
  beforeAll(async () => { local = await startLoopbackTransport(); });
  beforeEach(() => { local.requests.length = 0; loopbackTransport = local; });
  afterAll(async () => { loopbackTransport = undefined; await local?.close(); });

  async function readHttps(kind: 'request' | 'get') {
    return await new Promise<{ body: string; authorized: boolean; remoteAddress: string | undefined }>((resolve, reject) => {
      const request = https[kind]('https://api.anthropic.com/v1/messages', { method: 'GET' }, response => {
        const authorized = (response.socket as TLSSocket).authorized;
        const remoteAddress = response.socket.remoteAddress;
        let body = ''; response.setEncoding('utf8');
        response.on('data', chunk => { body += chunk; });
        response.once('error', reject);
        response.once('end', () => resolve({ body, authorized, remoteAddress }));
      });
      request.once('error', reject);
      if (kind === 'request') request.end();
    });
  }

  it.each(['request', 'get'] as const)('https.%s carries local TLS bytes when ON, refuses OFF, and resumes ON', async kind => {
    const first = await readHttps(kind);
    expect(first.authorized).toBe(true);
    expect(first.remoteAddress).toBe('127.0.0.1');
    expect(JSON.parse(first.body)).toEqual({ object: 'list', data: [] });
    expect(local.requests).toEqual([{ path: '/v1/messages', httpVersion: '1.1', remoteAddress: '127.0.0.1' }]);

    applySwitchedOff(['anthropic'], {});
    const refused = https[kind]('https://api.anthropic.com/v1/messages', { method: 'GET' });
    expect(refused.destroyed).toBe(true);
    const error = await new Promise<Error>(resolve => refused.once('error', resolve));
    expect(error).toMatchObject({ code: 'PROVIDER_SWITCHED_OFF', providerId: 'anthropic' });
    await new Promise(resolve => setImmediate(resolve));
    expect(local.requests).toHaveLength(1); // no HTTP request reached even the local server

    applySwitchedOff([], {});
    expect((await readHttps(kind)).authorized).toBe(true);
    expect(local.requests).toHaveLength(2);
  });

  async function readHttp2() {
    const session = http2.connect('https://bedrock-runtime.us-east-1.amazonaws.com');
    const closed = new Promise<void>(resolve => session.once('close', resolve));
    session.setTimeout(2000, () => session.destroy(new Error('Local HTTP/2 transport timed out')));
    try {
      return await new Promise<{ body: string; authorized: boolean; remoteAddress: string | undefined }>((resolve, reject) => {
        session.once('error', reject);
        session.once('connect', () => {
          const authorized = (session.socket as TLSSocket).authorized;
          const remoteAddress = session.socket.remoteAddress;
          const request = session.request({ ':path': '/model/local-test', ':method': 'GET' });
          let body = ''; request.setEncoding('utf8');
          request.on('data', chunk => { body += chunk; });
          request.once('error', reject);
          request.once('end', () => resolve({ body, authorized, remoteAddress }));
          request.end();
        });
      });
    } finally { session.close(); await closed; }
  }

  it('HTTP/2 carries local TLS bytes when ON, refuses OFF, and resumes ON', async () => {
    const first = await readHttp2();
    expect(first.authorized).toBe(true);
    expect(first.remoteAddress).toBe('127.0.0.1');
    expect(JSON.parse(first.body)).toEqual({ object: 'list', data: [] });
    expect(local.requests).toEqual([{ path: '/model/local-test', httpVersion: '2.0', remoteAddress: '127.0.0.1' }]);

    applySwitchedOff(['bedrock'], {});
    const refused = http2.connect('https://bedrock-runtime.us-east-1.amazonaws.com');
    const closed = new Promise<void>(resolve => refused.once('close', resolve));
    expect(refused.destroyed).toBe(true);
    const error = await new Promise<Error>(resolve => refused.once('error', resolve));
    expect(error).toMatchObject({ code: 'PROVIDER_SWITCHED_OFF', providerId: 'bedrock' });
    await closed;
    expect(local.requests).toHaveLength(1);

    applySwitchedOff([], {});
    expect((await readHttp2()).authorized).toBe(true);
    expect(local.requests).toHaveLength(2);
  });

  it('a cached SDK receives local HTTPS responses, stops before transport when OFF, and resumes ON', async () => {
    const client = new OpenAI({ apiKey: 'sk-synthetic', baseURL: 'https://api.openai.com/v1', maxRetries: 0 });
    expect((await client.models.list()).data).toEqual([]);
    expect(local.requests).toEqual([{ path: '/v1/models', httpVersion: '1.1', remoteAddress: '127.0.0.1' }]);
    expect(fetchCalls).toHaveLength(1);
    applySwitchedOff(['openai'], {});
    await expect(client.models.list()).rejects.toThrow();
    expect(local.requests).toHaveLength(1);
    expect(fetchCalls).toHaveLength(1);
    applySwitchedOff([], {});
    expect((await client.models.list()).data).toEqual([]);
    expect(local.requests).toHaveLength(2);
    expect(fetchCalls).toHaveLength(2);
  });
});

function fakeDb(opts: { failRead?: boolean } = {}) {
  let doc: any = null;
  const ref = { get: async () => { if (opts.failRead) throw new Error('down'); return { exists: !!doc, data: () => doc }; } };
  return {
    get doc() { return doc; },
    collection: () => ({ doc: () => ref }),
    runTransaction: async (fn: any) => fn({ get: async () => ({ exists: !!doc, data: () => doc }), set: (_r: any, d: any) => { doc = JSON.parse(JSON.stringify(d)); } }),
  };
}

describe('the shared state: audited, conflict-safe, and never switched back on by a storage blip', () => {
  it('Gemini and Vertex cannot dispatch at boot or after a failed first read', async () => {
    state.db = fakeDb({ failRead: true });
    for (const phase of ['boot', 'failed-read']) {
      if (phase === 'failed-read') await syncSwitchesOnce();
      await expect(fetch('https://generativelanguage.googleapis.com/v1beta/models/test:generateContent')).rejects.toThrow();
      await expect(fetch('https://us-central1-aiplatform.googleapis.com/v1/projects/test')).rejects.toThrow();
    }
    expect(fetchCalls).toEqual([]);
    await fetch('https://firestore.googleapis.com/v1/projects/test');
    expect(fetchCalls).toHaveLength(1); // storage remains reachable so state can be read
    state.db = fakeDb();
    await syncSwitchesOnce(); // only a successful durable snapshot can establish ON
    await fetch('https://generativelanguage.googleapis.com/v1beta/models/test');
    expect(fetchCalls).toHaveLength(2);
    state.db = fakeDb({ failRead: true }); await syncSwitchesOnce();
    await expect(fetch('https://generativelanguage.googleapis.com/v1beta/models/test')).rejects.toThrow();
    await expect(fetch('https://aiplatform.googleapis.com/v1/projects/test')).rejects.toThrow();
    expect(fetchCalls).toHaveLength(2); // cached ON cannot authorize during a read outage
  });
  it('admin Gemini and Vertex OFF survive a restart, read failure, then resync', async () => {
    const durable = fakeDb(); state.db = durable;
    await writeSwitch({ id: 'gemini', on: false, reason: 'owner disabled', expectedRevision: 0, by: 'admin' });
    await writeSwitch({ id: 'vertex', on: false, reason: 'owner disabled', expectedRevision: 1, by: 'admin' });
    __resetProviderSwitchesForTests();
    state.db = fakeDb({ failRead: true }); await syncSwitchesOnce();
    expect(switchedOffProviderFor('generativelanguage.googleapis.com', '/')).toBe('gemini');
    expect(switchedOffProviderFor('aiplatform.googleapis.com', '/')).toBe('vertex');
    state.db = durable; await syncSwitchesOnce();
    expect(isProviderSwitchedOff('gemini')).toBe(true);
    expect(isProviderSwitchedOff('vertex')).toBe(true);
    state.db = fakeDb({ failRead: true }); await syncSwitchesOnce();
    await expect(fetch('https://generativelanguage.googleapis.com/v1beta/models/test')).rejects.toThrow();
    await expect(fetch('https://aiplatform.googleapis.com/v1/projects/test')).rejects.toThrow();
    expect(fetchCalls).toEqual([]);
  });

  it('a delayed old read cannot undo a newer local Gemini OFF write', async () => {
    const db = fakeDb();
    let finish!: (snapshot: unknown) => void;
    state.db = { ...db, collection: () => ({ doc: () => ({ get: () => new Promise(resolve => { finish = resolve; }) }) }) };
    const delayed = syncSwitchesOnce(() => 1);
    await writeSwitch({ id: 'gemini', on: false, reason: 'owner disabled', expectedRevision: 0, by: 'admin', now: () => 2 });
    finish({ exists: false, data: () => ({}) });
    await delayed;
    expect(isProviderSwitchedOff('gemini')).toBe(true);
    expect(lastSwitchSync()).toEqual({ at: 2, ok: true });
  });
  it('out-of-order poll completion cannot restore older Gemini or Vertex ON state', async () => {
    let finish!: (snapshot: unknown) => void;
    state.db = { collection: () => ({ doc: () => ({ get: () => new Promise(resolve => { finish = resolve; }) }) }) };
    const delayed = syncSwitchesOnce(() => 1);
    state.db = { collection: () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => ({ off: ['gemini', 'vertex'], revision: 5 }) }) }) }) };
    await syncSwitchesOnce(() => 2);
    finish({ exists: true, data: () => ({ off: [], revision: 4 }) });
    await delayed;
    expect(isProviderSwitchedOff('gemini')).toBe(true);
    expect(isProviderSwitchedOff('vertex')).toBe(true);
  });

  it('a change needs a known provider, a boolean, a reason and the revision the admin saw', async () => {
    state.db = fakeDb();
    await expect(writeSwitch({ id: 'nope', on: false, reason: 'test', expectedRevision: 0, by: 'admin' })).rejects.toThrow(ProviderSwitchInputError);
    await expect(writeSwitch({ id: 'glm', on: 'no', reason: 'test', expectedRevision: 0, by: 'admin' })).rejects.toThrow(ProviderSwitchInputError);
    await expect(writeSwitch({ id: 'glm', on: false, reason: '', expectedRevision: 0, by: 'admin' })).rejects.toThrow(ProviderSwitchInputError);
    const s = await writeSwitch({ id: 'glm', on: false, reason: 'balance finished', expectedRevision: 0, by: 'admin', now: () => 5 });
    expect(s).toMatchObject({ off: ['glm'], revision: 1, history: [{ at: 5, by: 'admin', id: 'glm', on: false, reason: 'balance finished' }] });
    expect(isProviderSwitchedOff('glm')).toBe(true); // applied on this instance at once
    await expect(writeSwitch({ id: 'kimi', on: false, reason: 'stale tab', expectedRevision: 0, by: 'other' })).rejects.toThrow(ProviderSwitchConflictError);
    const back = await writeSwitch({ id: 'glm', on: true, reason: 'topped up', expectedRevision: 1, by: 'admin' });
    expect(back.off).toEqual([]);
    expect(isProviderSwitchedOff('glm')).toBe(false);
  });
  it('the history keeps the last 50 changes', async () => {
    state.db = fakeDb();
    for (let i = 0; i < 55; i++) await writeSwitch({ id: 'groq', on: i % 2 === 1, reason: `change ${i}`, expectedRevision: i, by: 'admin' });
    expect(state.db.doc.history.length).toBe(50);
    expect(state.db.doc.history.at(-1).reason).toBe('change 54');
  });
  it('🔒 a failed read keeps the last known state — it never switches a provider back on', async () => {
    state.db = fakeDb();
    await writeSwitch({ id: 'surplus', on: false, reason: 'outage', expectedRevision: 0, by: 'admin' });
    const good = state.db;
    state.db = fakeDb({ failRead: true });
    await syncSwitchesOnce();
    expect(isProviderSwitchedOff('surplus')).toBe(true);
    expect(lastSwitchSync().ok).toBe(false);
    state.db = good;
    await syncSwitchesOnce();
    expect(lastSwitchSync().ok).toBe(true);
  });
});

describe('🔒 wiring that must not drift', () => {
  it('every AI provider on the API Providers page has a switch, and every switch is a real provider row', () => {
    const ai = API_PROVIDERS.filter((p) => (p.group === 'ai' || p.group === 'registered') && p.id !== 'custom-image').map((p) => p.id).sort();
    expect(PROVIDER_FAMILIES.map((f) => f.id).sort()).toEqual(ai);
    for (const f of PROVIDER_FAMILIES) expect(f.hosts({}).length, f.id).toBeGreaterThan(0);
  });
  it('server.ts installs the network layer right after dotenv, before any other import', () => {
    const lines = readFileSync('server.ts', 'utf8').split('\n').filter((l) => l.startsWith('import '));
    expect(lines[0]).toBe("import 'dotenv/config';");
    expect(lines[1]).toBe("import './src/server/lib/providerSwitchInstall';");
    expect(readFileSync('server.ts', 'utf8')).toContain('startProviderSwitchSync()');
  });
  it('the switch error names no vendor (it can reach a user)', () => {
    applySwitchedOff(['openai'], {});
    return fetch('https://api.openai.com/').catch((e: Error) => {
      for (const v of ['OpenAI', 'Anthropic', 'Gemini', 'Google', 'GLM', 'Kimi', 'Claude']) expect(e.message).not.toContain(v);
    });
  });
});
