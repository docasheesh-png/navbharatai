// Q-621, SECOND HALF — a client that left must stop COSTING, not just stop being shown.
//
// #3551 fixed the first half: `clientDisconnect.ts` made the server genuinely notice a streaming
// client going away (`tests/aClientThatLeavesIsNoticed.test.ts` locks that). But the `AbortController`
// `chat.ts` fires on that event had nowhere to go — `AIRouter.routeStream` read `signal.aborted` only
// BETWEEN rungs and inside its own chunk callback, and `executeStream` took no signal at all. So the
// request already in flight to the provider ran to completion and was billed in full: a user who closed
// the tab after one word still paid for the whole answer, and on a RACED universe paid for it twice.
//
// Reading a flag stops the OUTPUT. Only handing the signal to the SDK stops the BILL. These tests hold
// that distinction in place for every provider, including ones added after this was written.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { AIRouter } from '../src/server/AI/Router/AIRouter';
import type { AIProvider } from '../src/server/AI/Router/ProviderTypes';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const PROVIDERS = 'src/server/AI/Router/providers';

// ── THE CENSUS: of the CLASS, not of the six files that happened to exist on the day ────────────────
//
// Every provider that can stream must accept the signal AND hand it to its SDK. One provider cannot:
// `@google-cloud/vertexai` exposes no abort hook of any kind (`generateContentStream(request)` takes no
// per-call options, and `getGenerativeModel`'s `RequestOptions` carries only `timeout`, `apiClient` and
// `customHeaders`). That is an OPEN root cause (Q-769), listed here by name with its reason so the gap
// is a recorded exception rather than an oversight that looks like one — and so a NEW provider that
// forgets the signal fails this test instead of joining the list silently.
const NO_SDK_ABORT: Record<string, string> = {
  'VertexProvider.ts': '@google-cloud/vertexai exposes no abort hook — Q-769, mitigated by stopping consumption',
};

const providerFiles = readdirSync(join(root, PROVIDERS))
  .filter((f) => f.endsWith('.ts') && !f.includes('.test.'))
  .filter((f) => /async executeStream/.test(read(join(PROVIDERS, f))));

describe('census: every streaming provider takes the abort signal', () => {
  it('there are streaming providers to check (the census is not vacuously green)', () => {
    expect(providerFiles.length).toBeGreaterThanOrEqual(6);
  });

  for (const f of providerFiles) {
    it(`${f} declares signal?: AbortSignal on executeStream`, () => {
      const src = read(join(PROVIDERS, f));
      // The whole declaration LINE: slicing to the first ')' would stop inside `(text: string) =>
      // void` and pass whatever came after, which is how a census quietly stops checking anything.
      const sig = src.split('\n').find((l) => l.includes('async executeStream')) ?? '';
      expect(sig, 'a provider that cannot be told to stop keeps billing an abandoned turn').toContain('signal?: AbortSignal');
    });

    it(`${f} stops consuming the stream once the signal is aborted`, () => {
      const src = read(join(PROVIDERS, f));
      expect(src).toMatch(/if \(signal\?\.aborted\) break;/);
    });

    it(`${f} hands the signal to its SDK, or is a named no-abort exception`, () => {
      const src = read(join(PROVIDERS, f));
      const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      // Each SDK spells it differently; what matters is that the signal reaches the call, not a flag.
      const forwarded = /signal \? \{ signal \} : undefined/.test(code) || /config\.abortSignal = signal/.test(code);
      if (NO_SDK_ABORT[f]) {
        expect(forwarded, `${f} is listed as having no SDK abort but now forwards one — remove it from NO_SDK_ABORT`).toBe(false);
        expect(src, 'a no-abort provider must say why, in the file').toMatch(/Q-621/);
      } else {
        expect(forwarded, `${f} reads the signal but never gives it to its SDK — the request keeps running and keeps billing`).toBe(true);
      }
    });
  }
});

// ── THE WIRING: the signal must survive every hop between chat.ts and the provider ─────────────────
describe('the signal reaches the provider from the route', () => {
  it('ProviderTypes declares the parameter at all', () => {
    expect(read('src/server/AI/Router/ProviderTypes.ts')).toContain('signal?: AbortSignal): Promise<string>;');
  });

  it('a SLOTTED rung forwards it — most of the free ladder is slotted', () => {
    // The same class as the dropped model pin: a wrapper that forgets an argument silently disables
    // the whole feature behind it, on the one path chat actually streams over.
    expect(read('src/server/AI/AIRouterManager.ts')).toContain('base.executeStream!(p, sys, cb, model, signal)');
  });

  it('the sequential ladder passes it, watchdog or not', () => {
    const src = read('src/server/AI/Router/AIRouter.ts');
    expect(src).toContain('await p.executeStream(prompt, systemPrompt, onChunk, undefined, signal)');
    expect(src).toContain('p.executeStream!(prompt, systemPrompt, cb, undefined, signal)');
  });

  it('the RACE passes it too — a raced turn pays two providers, so it has twice the reason to', () => {
    expect(read('src/server/AI/Router/AIRouter.ts')).toContain('}, undefined, signal).then(() => {');
  });

  it('chat.ts still aborts its controller when the client goes (the first half, not undone)', () => {
    const src = read('src/server/routes/chat.ts');
    expect(src).toContain('onClientGone(res, () => controller.abort())');
    expect(src).toContain('controller.signal,');
  });
});

// ── THE BEHAVIOUR: end to end through the real router ──────────────────────────────────────────────
function streamingProvider(name: string, opts: { respectsSignal: boolean; calls: string[] }): AIProvider {
  return {
    name,
    priority: 1,
    healthCheck: async () => true,
    execute: async () => { throw new Error('not used'); },
    executeStream: async (_p, _s, onChunk, _model, signal) => {
      opts.calls.push(name);
      onChunk('first ');
      // The provider is mid-answer when the client leaves.
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 5));
        if (opts.respectsSignal && signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        onChunk('token ');
      }
      return 'first token token';
    },
  } as unknown as AIProvider;
}

describe('an abandoned turn stops at the provider, and no further rung is paid', () => {
  it('the signal reaches the in-flight call and ends the turn', async () => {
    const calls: string[] = [];
    const router = new AIRouter('free');
    router.registerProvider(streamingProvider('FIRST', { respectsSignal: true, calls }));
    router.registerProvider(streamingProvider('SECOND', { respectsSignal: true, calls }));

    const controller = new AbortController();
    const chunks: string[] = [];
    // The client leaves right after the first chunk — exactly what onClientGone does.
    const outcome = await router.routeStream('hi', undefined, (c) => {
      chunks.push(c);
      if (chunks.length === 1) controller.abort();
    }, controller.signal);

    expect(outcome.ok).toBe(false);
    expect('reason' in outcome && outcome.reason).toBe('aborted');
    // 🔴 THE POINT OF THE WHOLE CHANGE: the second rung is never started. Falling through to it after
    // the user left would bill a SECOND provider for an answer nobody will ever read.
    expect(calls).toEqual(['FIRST']);
    // And nothing was written after the abort — including the ladder's "temporarily busy" line.
    expect(chunks.join('')).toBe('first ');
  });

  it('a turn nobody abandoned is untouched — the signal must not become a new way to fail', async () => {
    const calls: string[] = [];
    const router = new AIRouter('free');
    router.registerProvider(streamingProvider('ONLY', { respectsSignal: true, calls }));
    const chunks: string[] = [];
    const outcome = await router.routeStream('hi', undefined, (c) => chunks.push(c), new AbortController().signal);
    expect(outcome.ok).toBe(true);
    expect(calls).toEqual(['ONLY']);
    expect(chunks.length).toBeGreaterThan(1);
  });
});
