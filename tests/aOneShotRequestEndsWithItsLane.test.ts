import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import OpenAI from 'openai';
import { runOneShot, type OneShotDeps } from '../src/server/AgentV3/OneShotBuilder';
import { continueFastLaneGeneration, MAX_CONTINUATIONS } from '../src/server/AgentV3/FastLaneContinuation';
import { OpenAiToolRunner, type OpenAiChatClient } from '../src/server/AgentV3/providers/OpenAiToolRunner';
import {
  createBuildBenchRegistry, createRateLimitCooldowns, isReasoningRungStop, makeMultiProviderTurnRunner,
  type NamedRunner,
} from '../src/server/AgentV3/providers/MultiProviderTurnRunner';
import { BUDGET_REACHED_MESSAGE, isBudgetEndedError } from '../src/server/AgentV3/turnDeadline';
import { BUILD_STOPPED_MESSAGE } from '../src/server/AgentV3/stopSignal';
import { anchorOf, codeOnly } from './helpers/sourceSlice';

const COMPLETE = '<<<FILE src/App.tsx>>>\nexport default function App() { return <main>Ready</main>; }\n<<<ENDFILE>>>';
const PARTIAL = '<<<FILE src/App.tsx>>>\nexport default function App() { return <main>';
const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
// Execute the route's actual two closures. A test-only forwarding adapter would still pass if the
// production fastGenerate/continuation forgot the deadline. Only surrounding telemetry is replaced.
const routeGeneration = ts.transpileModule(
  route.slice(anchorOf(route, 'const fastGenerateOnce ='), anchorOf(route, 'const fastWriteRaw =')),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
).outputText;

function response(text = COMPLETE, finishReason = 'stop'): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { role: 'assistant', content: text }, finish_reason: finishReason }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  }), { headers: { 'content-type': 'application/json' } });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function provider() {
  const pending: Array<{ signal: AbortSignal | null | undefined; reply: (r: Response) => void }> = [];
  const began = deferred<void>();
  let immediate = false;
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit): Promise<Response> => {
    if (immediate) return response();
    return new Promise<Response>((resolve, reject) => {
      const signal = init?.signal;
      pending.push({ signal, reply: resolve });
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      began.resolve();
    });
  });
  // Real SDK, injected fetch. No provider credentials, network, paid calls or workspace writes.
  const sdk = new OpenAI({ apiKey: 'test-only', baseURL: 'https://unused.invalid', maxRetries: 0, timeout: 60_000, fetch });
  const runner = new OpenAiToolRunner(sdk as unknown as OpenAiChatClient, { model: 'test-text-model', timeoutMs: 60_000 });
  return {
    runner, pending, fetch, started: began.promise,
    answerNormally: () => { immediate = true; },
    release: () => { for (const request of pending) request.reply(response(PARTIAL, 'length')); },
  };
}

function routeHarness(chain: NamedRunner[]) {
  const build = new AbortController();
  const bench = createBuildBenchRegistry();
  const attemptErrors = vi.fn();
  const wasted = vi.fn();
  const records: Array<Record<string, unknown>> = [];
  const env = {
    abort: build, thinking: false, randomUUID, MAX_CONTINUATIONS, continueFastLaneGeneration,
    fastBuildModel: () => 'test-text-model',
    makeFastTextRunner: (onProviderUsed: (name: string) => void) => makeMultiProviderTurnRunner(chain, {
      onProviderUsed, onProviderError: attemptErrors, onAttemptWasted: wasted, bench, cooldowns: createRateLimitCooldowns(0),
    }),
    fastLaneReasoningGateEnabled: () => false,
    streamThinkingToChat: () => false,
    modelAlwaysReasons: () => false,
    isReasoningRungStop,
    fastLaneCallIdentity: (_reported: boolean, providerName: string, model: string) => ({ provider: providerName, model }),
    answerTimeOf: () => ({}),
    buildDiag: { record: (row: Record<string, unknown>) => records.push(row), recordLlmCall: (row: Record<string, unknown>) => records.push(row) },
    events: { emit: vi.fn() },
    buildUsage: { add: vi.fn() },
    captureTurnUsage: vi.fn(),
    discardTurnOutput: vi.fn(),
  };
  const generate = new Function(...Object.keys(env), `
    let fastLaneReasoningRung = null;
    const laneReasoningStays = [];
    const osUsage = { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
    ${routeGeneration}
    return fastGenerate;
  `)(...Object.values(env)) as OneShotDeps['generate'];
  const writeFiles = vi.fn(async (_files: Parameters<OneShotDeps['writeFiles']>[0]) => {});
  const run = (extra: Partial<OneShotDeps> = {}) => runOneShot({
    prompt: 'A tiny offline test app', framework: 'vite-react', scaffoldPaths: [],
    generate, writeFiles, overallTimeoutMs: 1_000, ...extra,
  });
  return { build, bench, attemptErrors, wasted, records, generate, writeFiles, run };
}

describe('one-shot ownership reaches the actual provider request, not just the waiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T00:00:00Z'));
    vi.stubEnv('AGENTV3_STREAM_BUILD_CALLS', 'off');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it.each(['off', 'on'])('cancels the in-flight SDK request at the lane deadline (streaming %s), without stopping the build', async (streaming) => {
    vi.stubEnv('AGENTV3_STREAM_BUILD_CALLS', streaming);
    const p = provider();
    const h = routeHarness([{ name: 'TEST', runner: p.runner }]);
    const ended = h.run();
    await p.started;
    await vi.advanceTimersByTimeAsync(1_000);
    try {
      expect((await ended).ok).toBe(false);
      expect(p.pending[0].signal?.aborted).toBe(true);
      expect(h.build.signal.aborted).toBe(false);
      expect(h.attemptErrors).toHaveBeenCalledTimes(1);
      expect(isBudgetEndedError(h.attemptErrors.mock.calls[0][1])).toBe(true);
      expect(h.attemptErrors.mock.calls[0][1]).toMatchObject({ message: BUDGET_REACHED_MESSAGE });
      expect(h.wasted).not.toHaveBeenCalled(); // our clock is not provider waste
      expect(h.bench.benchedFamilies.size).toBe(0);
      expect(h.bench.timeoutStreak.size).toBe(0);
      expect(h.records.some((r) => isBudgetEndedError(r.error))).toBe(true);
      expect(h.writeFiles).not.toHaveBeenCalled();
      p.release(); // a late truncated reply must not open a continuation
      await vi.advanceTimersByTimeAsync(0);
      expect(p.fetch).toHaveBeenCalledTimes(1);

      // A successor can still use the SAME build signal. Lane expiry is not a whole-build Stop.
      vi.stubEnv('AGENTV3_STREAM_BUILD_CALLS', 'off');
      p.answerNormally();
      expect(await h.generate('system', 'successor')).toBe(COMPLETE);
      expect(p.fetch).toHaveBeenCalledTimes(2);
    } finally { p.release(); await vi.advanceTimersByTimeAsync(0); }
  });

  it('charges config reads to the same deadline instead of giving the provider a fresh budget', async () => {
    const p = provider();
    const h = routeHarness([{ name: 'TEST', runner: p.runner }]);
    const config = deferred<string>();
    const ended = h.run({ scaffoldPaths: ['package.json'], readExisting: () => config.promise });
    await vi.advanceTimersByTimeAsync(400);
    config.resolve('{}');
    await p.started;
    await vi.advanceTimersByTimeAsync(599);
    expect(p.pending[0].signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    try {
      expect((await ended).ok).toBe(false);
      expect(p.pending[0].signal?.aborted).toBe(true);
      expect(h.writeFiles).not.toHaveBeenCalled();
    } finally { p.release(); await vi.advanceTimersByTimeAsync(0); }
  });

  it('a fallback receives the remaining lane budget and exhaustion cannot walk to another rung', async () => {
    const p = provider();
    let rejectFirst!: (error: Error) => void;
    const first = new Promise<never>((_resolve, reject) => { rejectFirst = reject; });
    const last = { runTurn: vi.fn(async () => { throw new Error('must not start after deadline'); }) };
    const h = routeHarness([
      { name: 'FIRST', runner: { runTurn: () => first } },
      { name: 'SECOND', runner: p.runner },
      { name: 'LAST', runner: last },
    ]);
    const ended = h.run();
    await vi.advanceTimersByTimeAsync(400);
    rejectFirst(new Error('transient upstream failure'));
    await p.started;
    await vi.advanceTimersByTimeAsync(600);
    try {
      expect((await ended).ok).toBe(false);
      expect(p.pending[0].signal?.aborted).toBe(true);
      expect(last.runTurn).not.toHaveBeenCalled();
      expect(h.attemptErrors).toHaveBeenCalledTimes(2);
      expect(isBudgetEndedError(h.attemptErrors.mock.calls[1][1])).toBe(true);
      expect(h.bench.timeoutStreak.size).toBe(0);
      expect(h.build.signal.aborted).toBe(false);
    } finally { p.release(); await vi.advanceTimersByTimeAsync(0); }
  });

  it('a truncated response gives its continuation the original deadline, not another full window', async () => {
    const p = provider();
    const h = routeHarness([{ name: 'TEST', runner: p.runner }]);
    const ended = h.run();
    await p.started;
    await vi.advanceTimersByTimeAsync(400);
    p.pending[0].reply(response(PARTIAL, 'length'));
    await vi.advanceTimersByTimeAsync(0);
    expect(p.pending).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(599);
    expect(p.pending[1].signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    try {
      expect((await ended).ok).toBe(false);
      expect(p.pending[1].signal?.aborted).toBe(true);
      expect(h.records.some((r) => r.code === 'FASTLANE_CONTINUATION_FAILED' && isBudgetEndedError(r.detail))).toBe(true);
      p.release();
      await vi.advanceTimersByTimeAsync(0);
      expect(p.fetch).toHaveBeenCalledTimes(2);
      expect(h.writeFiles).not.toHaveBeenCalled();
    } finally { p.release(); await vi.advanceTimersByTimeAsync(0); }
  });

  it('preserves an actual build Stop as Stop, not a lane budget or a provider failure', async () => {
    const p = provider();
    const h = routeHarness([{ name: 'TEST', runner: p.runner }]);
    const ended = h.run();
    await p.started;
    h.build.abort();
    try {
      expect((await ended).reason).toBe(BUILD_STOPPED_MESSAGE);
      expect(p.pending[0].signal?.aborted).toBe(true);
      expect(h.attemptErrors).not.toHaveBeenCalled();
      expect(h.writeFiles).not.toHaveBeenCalled();
    } finally { p.release(); await vi.advanceTimersByTimeAsync(0); }
  });

  it('keeps live generation and successful continuation working through the production wrapper', async () => {
    const p = provider();
    const h = routeHarness([{ name: 'TEST', runner: p.runner }]);
    const ended = h.run();
    await p.started;
    p.pending[0].reply(response(PARTIAL, 'length'));
    await vi.advanceTimersByTimeAsync(0);
    p.pending[1].reply(response('Ready</main>; }\n<<<ENDFILE>>>'));
    await vi.advanceTimersByTimeAsync(0);
    expect((await ended).ok).toBe(true);
    expect(h.writeFiles).toHaveBeenCalledTimes(1);
    expect(h.writeFiles.mock.calls[0][0]).toEqual([{ path: 'src/App.tsx', content: 'export default function App() { return <main>Ready</main>; }' }]);
    expect(h.build.signal.aborted).toBe(false);
  });

  it('uses the existing 150-second default and the route actually hands this wrapper to one-shot', async () => {
    const now = Date.now();
    const generate = vi.fn<OneShotDeps['generate']>(async () => COMPLETE);
    const result = await runOneShot({
      prompt: 'offline', framework: 'vite-react', scaffoldPaths: [], generate, writeFiles: async () => {},
    });
    expect(result.ok).toBe(true);
    expect(generate.mock.calls[0][2]).toEqual({ deadlineAt: now + 150_000 });
    expect(codeOnly(route)).toMatch(/runOneShot\(\{[^;]+generate:\s*fastGenerate,/);
  });
});
