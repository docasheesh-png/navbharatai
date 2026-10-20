import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const ROOT = resolve(__dirname, '..');
const WORKSPACE = 'agentv3-owner-session123';
const ticket = { itemId: 'A', claimToken: 'claim-A', predecessorAttemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', nonce: '11111111-1111-4111-8111-111111111111', state: 'pending', planRemaining: 3, ordinal: 1 };
const row = (phase: string) => ({ id: 'A', prompt: 'Approved queued work', source: 'planner', status: 'running', createdTs: 1, claimToken: 'claim-A', continuation: { version: 1, nonce: ticket.nonce, predecessorAttemptId: ticket.predecessorAttemptId, phase, planRemaining: 3, ordinal: 1 } });
let bundle = '';
const mounted: Array<() => void> = [];
afterAll(() => { for (const unmount of mounted) unmount(); });

beforeAll(async () => {
  const result = await build({
    stdin: { contents: `
      import { mount, jsx } from './tests/helpers/hookRuntime';
      import { useAgentV3Build } from './src/hooks/useAgentV3Build';
      export { awaitQueuedContinuation, queuedContinuationStartOptions } from './src/components/agentv3/queuedContinuationClient';
      export { QueueSessionScope } from './src/components/agentv3/queueSessionScope';
      export function mountClient() { let value; function Host() { value = useAgentV3Build(); return null; } const view = mount(() => jsx(Host, {})); return { api: () => value, unmount: view.unmount }; }
    `, resolveDir: ROOT, sourcefile: 'queued-client-entry.ts' },
    bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'silent',
    plugins: [{ name: 'only-auth-and-react-boundaries', setup(plugin) {
      plugin.onResolve({ filter: /^react$/ }, () => ({ path: resolve(ROOT, 'tests/helpers/hookRuntime.ts') }));
      plugin.onResolve({ filter: /(?:^|\/)firebase$/ }, () => ({ path: 'firebase', namespace: 'fixture' }));
      plugin.onResolve({ filter: /(?:^|\/)authHeaders$/ }, () => ({ path: 'authHeaders', namespace: 'fixture' }));
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path === 'firebase'
        ? 'export const auth = { get currentUser() { return globalThis.__auth; } };'
        : 'export async function authedHeaders() { return { Authorization: "Bearer " + await globalThis.__auth.getIdToken(false) }; }', loader: 'js' }));
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
const opts = { userId: 'owner', email: 'owner@example.test', sessionId: 'session123', framework: 'vite-react', queueItemId: 'A', queueClaimToken: 'claim-A', queueContinuationProtocol: 1 as const };

describe('mounted production build hook with the production READY handoff client', () => {
  it('preserves the approved claim, waits for cleanup and refreshes auth for a distinct next-window receipt', async () => {
    const requests: any[] = []; let ready = false; let queueReads = 0;
    const client = mountClient(async (url, init) => {
      if (url.startsWith('/api/agentv3/queue?')) { queueReads++; return json({ items: [row(ready ? 'ready' : 'pending')], paused: false }); }
      if (url === '/api/agentv3/chat') {
        requests.push({ body: JSON.parse(init.body), headers: init.headers });
        return requests.length === 1
          ? stream([{ type: 'workspace', workspaceId: WORKSPACE, ts: 1 }, { type: 'result', ok: true, summary: 'Module complete', steps: 1, billedUsd: 0.1, resumable: true, planRemaining: 3, queueContinuation: ticket }])
          : stream([{ type: 'result', ok: true, summary: 'Queued work complete', steps: 1, billedUsd: 0.2 }]);
      }
      throw Error(`Unexpected request ${url}`);
    });
    await client.api().start('Approved queued work', opts);
    expect(client.api().state.queueContinuation).toMatchObject(ticket);
    expect(client.api().state.resumable).toBe(true);
    const scope = new client.lib.QueueSessionScope(); scope.update(WORKSPACE, 'session123', 'owner');
    const claim = { id: 'A', claimToken: 'claim-A', scope: scope.capture() };
    let releaseWait!: () => void; let continued: Promise<void> | undefined;
    const handoff = client.lib.awaitQueuedContinuation({ ticket: client.api().state.queueContinuation, scope, claim, signal: new AbortController().signal,
      load: client.api().queueState, wait: () => new Promise<void>((resolveWait) => { releaseWait = resolveWait; }),
      run: (next: any, snapshot: any) => { continued = client.api().start('continue', { ...opts, ...client.lib.queuedContinuationStartOptions(next, snapshot) }); },
    });
    await flush(); expect(queueReads).toBe(1); expect(requests).toHaveLength(1);
    client.token('fresh-token'); ready = true; releaseWait();
    expect(await handoff).toBe('started'); await continued;
    expect(requests).toHaveLength(2);
    expect(requests[1].body).toMatchObject({ prompt: 'continue', queueItemId: 'A', queueClaimToken: 'claim-A', queueContinuationProtocol: 1, queueContinuationNonce: ticket.nonce, queuePredecessorAttemptId: ticket.predecessorAttemptId });
    expect(requests[1].body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(requests[1].body.requestId).not.toBe(requests[0].body.requestId);
    expect(requests[1].headers.Authorization).toBe('Bearer fresh-token');
    expect(client.tokens).toHaveBeenCalledWith(true);
    expect(client.api().state.queueContinuation).toBeUndefined();
    expect(client.api().state.ok).toBe(true);
    client.unmount();
  });

  it('retains one request UUID for an uncertain retry of the same authorized window', async () => {
    const requests: any[] = []; let chat = 0;
    const client = mountClient(async (url, init) => {
      if (url === '/api/agentv3/chat') {
        requests.push(JSON.parse(init.body));
        if (++chat === 1) throw Error('committed acknowledgement lost');
        return stream([{ type: 'error', code: 'BUILD_REQUEST_IN_PROGRESS', message: 'Progress remains unconfirmed' }]);
      }
      if (url.startsWith('/api/agentv3/status?')) return json({ buildRunning: false, buildRunningHere: false });
      throw Error(`Unexpected request ${url}`);
    });
    const continued = { ...opts, queueContinuationNonce: ticket.nonce, queuePredecessorAttemptId: ticket.predecessorAttemptId };
    await client.api().start('continue', continued);
    await client.api().start('continue', continued);
    expect(requests).toHaveLength(2);
    expect(requests[0].requestId).toBeTruthy();
    expect(requests[1].requestId).toBe(requests[0].requestId);
    expect(requests[1].queueContinuationNonce).toBe(ticket.nonce);
    client.unmount();
  });

  it('retries only the explicit predecessor-retiring refusal with the same window UUID and no predecessor attach', async () => {
    const requests: any[] = [];
    const client = mountClient(async (url, init) => {
      expect(url).toBe('/api/agentv3/chat');
      requests.push(JSON.parse(init.body));
      if (requests.length === 1) return new Response(JSON.stringify({ error: 'Previous work is finishing', code: 'QUEUE_CONTINUATION_RETIRING', retryable: true, resumable: false }), { status: 409 });
      return stream([{ type: 'result', ok: true, summary: 'Next module complete', steps: 1, billedUsd: 0 }]);
    });
    await client.api().start('continue', { ...opts, queueContinuationNonce: ticket.nonce, queuePredecessorAttemptId: ticket.predecessorAttemptId });
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    expect(client.api().state.ok).toBe(true);
    client.unmount();
  });

  it('an unexpected queued 409 never attaches to the predecessor workspace stream', async () => {
    const requests: string[] = [];
    const client = mountClient(async (url) => {
      requests.push(url);
      return new Response(JSON.stringify({ error: 'A build is still running', resumable: true }), { status: 409 });
    });
    client.api().adoptWorkspace(WORKSPACE);
    await client.api().start('continue', { ...opts, queueContinuationNonce: ticket.nonce, queuePredecessorAttemptId: ticket.predecessorAttemptId });
    expect(requests).toEqual(['/api/agentv3/chat']);
    expect(client.api().error).toBe('A build is still running');
    client.unmount();
  });

  it('Stop during predecessor-retiring admission prevents a delayed automatic retry', async () => {
    const requests: string[] = [];
    const client = mountClient(async (url) => {
      requests.push(url);
      if (url === '/api/agentv3/stop') return json({ stopped: true });
      return new Response(JSON.stringify({ error: 'Previous work is finishing', code: 'QUEUE_CONTINUATION_RETIRING', retryable: true, resumable: false }), { status: 409 });
    });
    const pending = client.api().start('continue', { ...opts, queueContinuationNonce: ticket.nonce, queuePredecessorAttemptId: ticket.predecessorAttemptId });
    for (let turn = 0; turn < 20; turn++) await Promise.resolve();
    client.api().stop(WORKSPACE);
    await pending; await flush();
    expect(requests.filter((url) => url === '/api/agentv3/chat')).toHaveLength(1);
    expect(requests).toContain('/api/agentv3/stop');
    client.unmount();
  });

  it('does not turn a queued window with no result into an unbound please-continue request', async () => {
    const requests: any[] = [];
    const client = mountClient(async (url, init) => {
      if (url === '/api/agentv3/chat') {
        requests.push(JSON.parse(init.body));
        return new Response(new ReadableStream({ start(controller) { init.signal.addEventListener('abort', () => controller.close(), { once: true }); } }));
      }
      if (url.startsWith('/api/agentv3/status?')) return json({ buildRunning: false, buildRunningHere: false });
      throw Error(`Unexpected request ${url}`);
    });
    const running = client.api().start('Approved queued work', opts);
    await flush(); client.advance(40_000); await flush(); await running;
    expect(requests).toHaveLength(1);
    expect(client.api().error).toContain("queued step's progress could not be confirmed");
    client.unmount();
  });

  it('sends the captured workspace when Stop cancels a reopened idle handoff', async () => {
    const requests: any[] = [];
    const client = mountClient(async (url, init) => { requests.push({ url, body: JSON.parse(init.body) }); return json({ stopped: true }); });
    client.api().stop(WORKSPACE); await flush();
    expect(requests).toEqual([{ url: '/api/agentv3/stop', body: { workspaceId: WORKSPACE } }]);
    client.unmount();
  });

  it.each(['Stop', 'Unsend', 'Edit'] as const)('a delayed READY answer cannot restart the request after %s', async (action) => {
    const requests: any[] = []; let finishRead!: (response: Response) => void;
    const client = mountClient(async (url, init) => {
      if (url === '/api/agentv3/chat') { requests.push(JSON.parse(init.body)); return stream([{ type: 'workspace', workspaceId: WORKSPACE, ts: 1 }, { type: 'result', ok: true, summary: 'Module complete', steps: 1, billedUsd: 0, resumable: true, planRemaining: 3, queueContinuation: ticket }]); }
      if (url.startsWith('/api/agentv3/queue?')) return new Promise<Response>((resolveRead) => { finishRead = resolveRead; });
      if (url === '/api/agentv3/stop' || url === '/api/agentv3/unsend') return json({ ok: true, stopped: true });
      throw Error(`Unexpected request ${url}`);
    });
    await client.api().start('Approved queued work', opts);
    const scope = new client.lib.QueueSessionScope(); scope.update(WORKSPACE, 'session123', 'owner');
    const abort = new AbortController(); const claim = { id: 'A', claimToken: 'claim-A', scope: scope.capture() };
    const run = vi.fn();
    const handoff = client.lib.awaitQueuedContinuation({ ticket: client.api().state.queueContinuation, scope, claim, signal: abort.signal, load: client.api().queueState, run });
    for (let turn = 0; turn < 8; turn++) await Promise.resolve();
    // The panel's shared invalidation runs before Stop or either message-purge handler awaits I/O.
    scope.invalidate(); abort.abort();
    if (action === 'Stop') client.api().stop(WORKSPACE); else await client.api().unsend();
    expect(await handoff).toBe('stale');
    finishRead(json({ items: [row('ready')], paused: false })); await flush();
    expect(run).not.toHaveBeenCalled(); expect(requests).toHaveLength(1);
    expect(client.api().state.queueContinuation).toBeUndefined();
    expect(client.api().state.resumable).toBe(false);
    client.unmount();
  });
});

describe('the panel wires the scoped handoff into its existing queue lifecycle', () => {
  const source = readFileSync(resolve(ROOT, 'src/components/agentv3/AgentV3Panel.tsx'), 'utf8');
  it('uses the tested READY client and retains A until a non-resumable terminal result', () => {
    expect(source).toContain('void awaitQueuedContinuation({');
    expect(source).toContain('...queuedContinuationStartOptions(ticket, snapshot)');
    expect(source).toContain('!state.resumable && activeQueuedItemRef.current');
    expect(source).toContain('queueContinuationProtocol: 1, userId');
  });
  it('a Stop invalidates the queue scope and waiting client; reopened handoffs keep a Stop action', () => {
    const stop = source.slice(source.indexOf('const invalidateQueuedContinuation = useCallback('), source.indexOf('// HOW MUCH OF THE APP'));
    expect(stop).toContain('queueScopeRef.current.invalidate()');
    expect(stop).toContain('queueContinuationAbortRef.current?.abort()');
    expect(source).toContain('running || queueContinuationWaiting || !!state.queueContinuation || queueItems.some((item) => item.continuation)');
  });
  it.each(['handleUnsend', 'handleEdit'])('%s invalidates a waiting handoff before the purge can wait', (name) => {
    const handler = source.slice(source.indexOf(`const ${name} = async`), source.indexOf(`const ${name} = async`) + 1000);
    expect(handler.indexOf('invalidateQueuedContinuation();')).toBeGreaterThan(0);
    expect(handler.indexOf('invalidateQueuedContinuation();')).toBeLessThan(handler.indexOf('await unsend()'));
  });
});
