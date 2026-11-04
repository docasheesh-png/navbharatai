/**
 * Admin 2026-11-04: "sabhi ai provider ko on off karne ka switch banao … 100% real and working".
 *
 * The switches NavBharatAI had before were removed (audit F16, 2026-10-11) because nothing read them. This file
 * is the proof that these ones are ENFORCED: the key is really withdrawn and restored, the network really refuses
 * the provider — including an SDK client created before the switch was thrown — and nothing else is touched.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
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
const fetchCalls: string[] = [];
beforeAll(() => {
  // A stand-in network so nothing here reaches the internet: the guard wraps whatever fetch it finds.
  globalThis.fetch = (async (input: any) => { fetchCalls.push(String(input instanceof URL ? input.href : input?.url ?? input)); return new Response('{"data":[]}', { status: 200, headers: { 'content-type': 'application/json' } }); }) as typeof fetch;
  installProviderSwitchGuard();
});
afterEach(() => { __resetProviderSwitchesForTests(); state.db = null; fetchCalls.length = 0; });

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

describe('🔴 the network really refuses — fetch, https.request, and an SDK client made BEFORE the switch', () => {
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
  it('with nothing switched off, https.request is the untouched original behaviour', () => {
    const req = https.request('https://api.anthropic.com/v1/messages', { method: 'POST' });
    expect(req.destroyed).toBe(false);
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
