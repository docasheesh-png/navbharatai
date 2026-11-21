import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const ROOT = resolve(__dirname, '..');
let bundle = '';
const mounted: Array<() => void> = [];
afterAll(() => { for (const unmount of mounted) unmount(); });

beforeAll(async () => {
  const result = await build({
    stdin: { contents: `
      import { mount, jsx } from './tests/helpers/hookRuntime';
      import { useAgentV3Build } from './src/hooks/useAgentV3Build';
      export function mountClient() { let value; function Host() { value = useAgentV3Build(); return null; } const view = mount(() => jsx(Host, {})); return { api: () => value, unmount: view.unmount }; }
    `, resolveDir: ROOT, sourcefile: 'queued-client-entry.ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'silent',
    plugins: [{ name: 'only-auth-and-react-boundaries', setup(plugin) {
      plugin.onResolve({ filter: /^react$/ }, () => ({ path: resolve(ROOT, 'tests/helpers/hookRuntime.ts') }));
      plugin.onResolve({ filter: /(?:^|\/)firebase$/ }, () => ({ path: 'firebase', namespace: 'fixture' }));
      plugin.onResolve({ filter: /(?:^|\/)authHeaders$/ }, () => ({ path: 'authHeaders', namespace: 'fixture' }));
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path === 'firebase'
        ? 'export const auth = { get currentUser() { return globalThis.__auth; } };'
        : 'export async function authedHeaders() { return { Authorization: "Bearer " + await globalThis.__auth.getIdToken(false) }; }'
          + ' export async function authJsonHeaders(force = false) { const h = { "Content-Type": "application/json" }; const u = globalThis.__auth; if (u) { try { const t = await u.getIdToken(force); if (t) h.Authorization = "Bearer " + t; } catch {} } return h; }'
          + ' export function signInRefusalMessage(m) { return m; }', loader: 'js' }));
    } }],
  });
  bundle = result.outputFiles[0].text;
});

function mountClient(fetch: (url: string, init?: any) => Promise<Response>) {
  let token = 'old-token'; let now = Date.now();
  const tokens = vi.fn(async (_force: boolean) => token);
  const timers = new Map<number, () => void>(); let timerId = 0;
  class ClockDate extends Date { static now() { return now; } }
  const module = { exports: {} as any };
  const context = vm.createContext({ module, exports: module.exports, console, URLSearchParams, Response, ReadableStream, TextDecoder, TextEncoder, AbortController, AbortSignal, DOMException, crypto: webcrypto, Date: ClockDate,
    __auth: { getIdToken: tokens }, fetch, localStorage: { getItem: () => null },
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms <= 5_000 ? 0 : ms), clearTimeout,
    setInterval: (fn: () => void) => { const id = ++timerId; timers.set(id, fn); return id; }, clearInterval: (id: number) => timers.delete(id),
  });
  vm.runInContext(bundle, context);
  const client = module.exports.mountClient(); mounted.push(client.unmount);
  return { ...client, lib: module.exports, tokens, token: (value: string) => { token = value; }, advance: (ms: number) => { now += ms; for (const fn of [...timers.values()]) fn(); } };
}
const stream = (events: unknown[]) => new Response(events.map((event) => JSON.stringify(event)).join('\n') + '\n');
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise<void>((resolveTick) => setTimeout(resolveTick, 0)); };
const opts = { userId: 'owner', sessionId: 'session123', userMessageTs: 10_000 };


describe('production Pro hook submission lifecycle', () => {
  it('is running before auth/network resolves and rejects same-tick duplicate starts', async () => {
    let release!: (response: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>(resolve => { release = resolve; }));
    const client = mountClient(fetch);
    const api = client.api();
    const first = api.start('Build an app', opts);
    expect(client.api().running).toBe(true);
    expect(api.isBusy()).toBe(true);
    await api.start('Build an app', opts);
    await flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.prompt).toBe('Build an app');
    expect(body.userMessageTs).toBeUndefined(); // display-only; never part of persisted request identity
    release(stream([{ type: 'narration', agent: 'architect', text: 'Starting', ts: 1 }, { type: 'result', ok: true, summary: 'Done', steps: 1, billedUsd: 0 }]));
    await first;
    expect(client.api().state.narration[0].ts).toBeGreaterThan(opts.userMessageTs);
    expect(client.api().running).toBe(false);
  });

  it('can send again after result while the old response body remains open', async () => {
    let sink!: ReadableStreamDefaultController<Uint8Array>;
    let count = 0;
    const client = mountClient(async () => ++count === 1
      ? new Response(new ReadableStream<Uint8Array>({ start(controller) { sink = controller; } }))
      : stream([{ type: 'result', ok: true, summary: 'Second done', steps: 1, billedUsd: 0 }]));
    const first = client.api().start('First', opts);
    await flush();
    sink.enqueue(new TextEncoder().encode(JSON.stringify({ type: 'result', ok: true, summary: 'First done', steps: 1, billedUsd: 0 }) + '\n'));
    await flush();
    expect(client.api().running).toBe(false);
    await client.api().start('Second', { ...opts, userMessageTs: 20_000 });
    expect(count).toBe(2);
    sink.close(); await first;
    expect(client.api().state.summary).toBe('Second done');
  });

  it('reset during pending auth prevents the abandoned request from being sent', async () => {
    const fetch = vi.fn(async () => stream([]));
    const client = mountClient(fetch);
    const pending = client.api().start('Abandoned', opts);
    client.api().reset();
    await pending;
    expect(fetch).not.toHaveBeenCalled();
    expect(client.api().running).toBe(false);
    expect(client.api().state.narration).toEqual([]);
  });

  it('a failed HTTP request ends pending state and permits a deliberate retry', async () => {
    let count = 0;
    const client = mountClient(async () => ++count === 1
      ? new Response(JSON.stringify({ error: 'Try again' }), { status: 503 })
      : stream([{ type: 'result', ok: true, summary: 'Done', steps: 1, billedUsd: 0 }]));
    await client.api().start('Retry me', opts);
    expect(client.api().running).toBe(false);
    expect(client.api().error).toBe('Try again');
    await client.api().start('Retry me', opts);
    expect(count).toBe(2);
    expect(client.api().error).toBeNull();
  });
});

describe('handoff and stale-response boundaries', () => {
  it('releases send ownership when a resumed stream delivers result before its tail closes', async () => {
    let sink!: ReadableStreamDefaultController<Uint8Array>;
    let chats = 0;
    const client = mountClient(async (url) => {
      if (url === '/api/agentv3/chat') {
        if (++chats === 1) throw new Error('Connection lost');
        return stream([{ type: 'result', ok: true, summary: 'Next done', steps: 1, billedUsd: 0 }]);
      }
      if (url.startsWith('/api/agentv3/status?')) return json({ buildRunning: true, buildRunningHere: true });
      if (url === '/api/agentv3/attach') return new Response(new ReadableStream<Uint8Array>({ start(controller) { sink = controller; } }));
      throw Error(`Unexpected request ${url}`);
    });
    const first = client.api().start('First', opts);
    await flush();
    expect(sink).toBeDefined();
    sink.enqueue(new TextEncoder().encode(JSON.stringify({ type: 'result', ok: true, summary: 'Recovered', steps: 1, billedUsd: 0 }) + '\n'));
    await flush();
    expect(client.api().running).toBe(false);
    await client.api().start('Next', { ...opts, userMessageTs: 20_000 });
    expect(chats).toBe(2);
    sink.close(); await first;
  });

  it('ignores an old HTTP refusal after switching projects', async () => {
    let release!: (response: Response) => void;
    const client = mountClient(() => new Promise<Response>(resolve => { release = resolve; }));
    const pending = client.api().start('Old project', opts);
    await flush();
    client.api().reset();
    release(new Response(JSON.stringify({ error: 'Old error' }), { status: 403 }));
    await pending;
    expect(client.api().error).toBeNull();
    expect(client.api().running).toBe(false);
  });
});
