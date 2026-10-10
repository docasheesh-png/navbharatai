/**
 * A pressed Stop stops the build — autopsy 2720e553, 2026-09-27.
 *
 * The secret-calculator build recorded `USER_STOPPED_BUILD` 143 ms after its preview was published,
 * 13.7 minutes in. The stop was not late; its RECORD was. The fast lane never read the build's abort
 * signal, so a Stop pressed during it changed nothing until the lane ran out of things to do — more
 * repair rounds, an install, a dev server — and the agentic loop read the signal only between turns,
 * after paying for the call already in flight.
 *
 * What these tests hold:
 *  1. one error means "stopped", and the provider chain never benches, falls back or counts waste for it;
 *  2. the OpenAI-compatible stream is CLOSED on a stop (the provider stops generating and billing);
 *  3. the Claude request carries the signal and is never retried after a stop;
 *  4. the fast lane checks the signal at every step and saves what it finished;
 *  5. the route hands the signal to the lane and to both text-runner factories.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  BuildStoppedError, isBuildStoppedError, raceStop, onStop, throwIfStopped, withStopSignal, BUILD_STOPPED_MESSAGE,
} from '../src/server/AgentV3/stopSignal';
import { makeMultiProviderTurnRunner, type NamedRunner } from '../src/server/AgentV3/providers/MultiProviderTurnRunner';
import { OpenAiToolRunner, type OpenAiChatClient } from '../src/server/AgentV3/providers/OpenAiToolRunner';
import { ClaudeClient, type MessagesCreateClient, type RunTurnParams, type TurnResult } from '../src/server/AgentV3/ClaudeClient';
import { runSimpleBuild } from '../src/server/AgentV3/SimpleBuilder';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const PARAMS: RunTurnParams = { model: 'm', messages: [{ role: 'user', content: 'hi' }] };
const ok = (text: string): TurnResult => ({
  text, toolUses: [], stopReason: 'end_turn', rawContent: [{ type: 'text', text }],
  usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
});
/** A call that never answers on its own — the way a slow provider looks to the code waiting on it. */
const hanging = () => ({ runTurn: vi.fn(() => new Promise<TurnResult>(() => { /* never settles */ })) });

const savedEnv = { ...process.env };
afterEach(() => { process.env = { ...savedEnv }; });

describe('1 — one error means "stopped"', () => {
  it('raceStop rejects with BuildStoppedError the moment the signal aborts', async () => {
    const ac = new AbortController();
    const p = raceStop(new Promise<string>(() => { /* never */ }), ac.signal);
    ac.abort();
    await expect(p).rejects.toBeInstanceOf(BuildStoppedError);
  });

  it('a value that arrives after the stop is handed to onLate, so a stream can be closed', async () => {
    const ac = new AbortController();
    let resolve!: (v: string) => void;
    const late = vi.fn();
    const p = raceStop(new Promise<string>((r) => { resolve = r; }), ac.signal, late);
    ac.abort();
    await expect(p).rejects.toBeInstanceOf(BuildStoppedError);
    resolve('stream');
    await new Promise((r) => setTimeout(r, 0));
    expect(late).toHaveBeenCalledWith('stream');
  });

  it('no signal, or an untouched one, changes nothing', async () => {
    await expect(raceStop(Promise.resolve(3))).resolves.toBe(3);
    await expect(raceStop(Promise.resolve(4), new AbortController().signal)).resolves.toBe(4);
    expect(() => throwIfStopped(undefined)).not.toThrow();
  });

  it('every waiter removes its listener — a build signal outlives thousands of calls', async () => {
    const ac = new AbortController();
    const remove = vi.spyOn(ac.signal, 'removeEventListener');
    for (let i = 0; i < 20; i++) await raceStop(Promise.resolve(i), ac.signal);
    expect(remove).toHaveBeenCalledTimes(20);
    const off = onStop(ac.signal, () => {});
    off();
    expect(remove).toHaveBeenCalledTimes(21);
  });

  it('isBuildStoppedError recognises the error by class, by marker and by message', () => {
    expect(isBuildStoppedError(new BuildStoppedError())).toBe(true);
    expect(isBuildStoppedError(new Error(BUILD_STOPPED_MESSAGE))).toBe(true);
    expect(isBuildStoppedError(new Error('Request timed out.'))).toBe(false);
  });
});

describe('1b — the provider chain treats a stop as the end, not as a failure', () => {
  it('🔴 a stop while rung 1 is waiting: no fallback to rung 2, no provider error, no waste, no bench', async () => {
    const ac = new AbortController();
    const first = hanging();
    const second = { runTurn: vi.fn().mockResolvedValue(ok('second')) };
    const chain: NamedRunner[] = [{ name: 'STOPTEST_A', runner: first }, { name: 'STOPTEST_B', runner: second }];
    const errors: string[] = [];
    const wasted: string[] = [];
    const benched: string[] = [];
    const runner = makeMultiProviderTurnRunner(chain, {
      onProviderError: (n) => errors.push(n),
      onAttemptWasted: (n) => wasted.push(n),
      onProviderBenched: (n) => benched.push(n),
    });
    const p = runner.runTurn({ ...PARAMS, signal: ac.signal });
    await new Promise((r) => setTimeout(r, 5));
    ac.abort();
    await expect(p).rejects.toBeInstanceOf(BuildStoppedError);
    expect(second.runTurn).not.toHaveBeenCalled();
    expect(errors).toEqual([]);
    expect(wasted).toEqual([]);
    expect(benched).toEqual([]);
  });

  it('a build already stopped asks no rung at all', async () => {
    const ac = new AbortController();
    ac.abort();
    const only = { runTurn: vi.fn().mockResolvedValue(ok('x')) };
    const runner = makeMultiProviderTurnRunner([{ name: 'STOPTEST_C', runner: only }], {});
    await expect(runner.runTurn({ ...PARAMS, signal: ac.signal })).rejects.toBeInstanceOf(BuildStoppedError);
    expect(only.runTurn).not.toHaveBeenCalled();
  });

  it('the signal reaches the rung, so a streaming rung can close its stream', async () => {
    const ac = new AbortController();
    const only = { runTurn: vi.fn().mockResolvedValue(ok('x')) };
    await makeMultiProviderTurnRunner([{ name: 'STOPTEST_D', runner: only }], {}).runTurn({ ...PARAMS, signal: ac.signal });
    expect(only.runTurn.mock.calls[0][0].signal).toBe(ac.signal);
  });

  it('withStopSignal gives every call the build signal unless the caller passed its own', async () => {
    const ac = new AbortController();
    const own = new AbortController();
    const inner = { runTurn: vi.fn().mockResolvedValue(ok('x')) };
    const wrapped = withStopSignal(inner, ac.signal);
    await wrapped.runTurn(PARAMS);
    await wrapped.runTurn({ ...PARAMS, signal: own.signal });
    expect(inner.runTurn.mock.calls[0][0].signal).toBe(ac.signal);
    expect(inner.runTurn.mock.calls[1][0].signal).toBe(own.signal);
  });
});

describe('2 — the GLM/Kimi stream is closed on a stop', () => {
  it('🔴 a stop mid-stream aborts the provider stream and throws BuildStoppedError, not a timeout', async () => {
    process.env.AGENTV3_STREAM_BUILD_CALLS = 'on';
    process.env.AGENTV3_STREAM_IDLE_MS = '5000';
    process.env.AGENTV3_STREAM_HARD_CAP_MS = '10000';
    let aborted = false;
    const stream = {
      controller: { abort: () => { aborted = true; } },
      async *[Symbol.asyncIterator]() {
        yield { choices: [{ delta: { content: 'part' } }] };
        await new Promise((r) => setTimeout(r, 2000));
      },
    };
    const client = { chat: { completions: { create: vi.fn().mockResolvedValue(stream) } } } as unknown as OpenAiChatClient;
    const ac = new AbortController();
    const p = new OpenAiToolRunner(client, { model: 'glm-4.7-flashx' }).runTurn({ ...PARAMS, signal: ac.signal });
    setTimeout(() => ac.abort(), 20);
    await expect(p).rejects.toBeInstanceOf(BuildStoppedError);
    expect(aborted).toBe(true);
  });

  it('a runner handed a stopped build never sends the request', async () => {
    const create = vi.fn();
    const client = { chat: { completions: { create } } } as unknown as OpenAiChatClient;
    const ac = new AbortController();
    ac.abort();
    await expect(new OpenAiToolRunner(client, { model: 'glm-4.7-flashx' }).runTurn({ ...PARAMS, signal: ac.signal }))
      .rejects.toBeInstanceOf(BuildStoppedError);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('3 — the Claude request carries the signal and is never retried after a stop', () => {
  it('passes the signal to the SDK request', async () => {
    const create = vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: {} });
    const client = new ClaudeClient({ messages: { create } } as unknown as MessagesCreateClient);
    const ac = new AbortController();
    await client.runTurn({ ...PARAMS, model: 'claude-haiku-4-5-20251001', signal: ac.signal });
    expect(create.mock.calls[0][1]).toEqual({ signal: ac.signal });
  });

  it('🔴 a transient failure after a stop is not retried', async () => {
    const ac = new AbortController();
    const create = vi.fn(async () => { ac.abort(); throw Object.assign(new Error('overloaded'), { status: 529 }); });
    const client = new ClaudeClient({ messages: { create } } as unknown as MessagesCreateClient, { maxRetries: 3, baseDelayMs: 1 });
    await expect(client.runTurn({ ...PARAMS, model: 'claude-haiku-4-5-20251001', signal: ac.signal }))
      .rejects.toBeInstanceOf(BuildStoppedError);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('4 — the fast lane checks the signal at every step', () => {
  const MANIFEST = 'src/App.tsx :: root\nsrc/components/A.tsx :: a\nsrc/components/B.tsx :: b';
  const fileFrom = (user: string) => (user.match(/write THIS file in full:\s*\n\s*([^\n]+)/) || [])[1]?.trim() || '';

  it('🔴 a stop during generation: no further file call, no verify, no repair, no preview; finished files saved', async () => {
    const ac = new AbortController();
    const calls: string[] = [];
    const saved: string[] = [];
    const verify = vi.fn();
    const repair = vi.fn();
    const startPreview = vi.fn();
    const sb = await runSimpleBuild({
      prompt: 'app', framework: 'vite-react', scaffoldPaths: ['src/App.tsx'], shareContract: false, signal: ac.signal,
      generate: async (_s: string, user: string) => {
        if (user.includes('Plan the file list')) return MANIFEST;
        const path = fileFrom(user);
        calls.push(path);
        // The first finished component is where the user presses Stop.
        if (path === 'src/components/A.tsx') ac.abort();
        return `<<<FILE ${path}>>>\nexport default function X(){return null}\n<<<ENDFILE>>>`;
      },
      writeFiles: async (files) => { saved.push(...files.map((f) => f.path)); },
      verify, repair, startPreview,
    });
    expect(sb.ok).toBe(false);
    expect(sb.stopped).toBe(true);
    expect(calls).not.toContain('src/App.tsx');
    expect(verify).not.toHaveBeenCalled();
    expect(repair).not.toHaveBeenCalled();
    expect(startPreview).not.toHaveBeenCalled();
    expect(saved.length).toBeGreaterThan(0);
    expect(sb.summary).toMatch(/Stopped, as asked/);
  });

  it('🔴 a stop during repair: no further repair round and no dev server', async () => {
    const ac = new AbortController();
    const startPreview = vi.fn();
    let repairs = 0;
    const sb = await runSimpleBuild({
      prompt: 'app', framework: 'vite-react', scaffoldPaths: ['src/App.tsx'], shareContract: false, depOrder: false,
      signal: ac.signal, maxRepairs: 3,
      generate: async (_s: string, user: string) => {
        if (user.includes('Plan the file list')) return 'src/App.tsx :: root\nsrc/Foo.tsx :: foo';
        const path = fileFrom(user) || 'src/App.tsx';
        return `<<<FILE ${path}>>>\nexport default function X(){return null}\n<<<ENDFILE>>>`;
      },
      writeFiles: async () => {},
      verify: async () => ({ ok: false, errors: `err ${repairs}`, ran: true }),
      repair: async () => { repairs++; ac.abort(); return [{ path: 'src/App.tsx', content: 'export default function App(){return 1}' }]; },
      startPreview,
    });
    expect(repairs).toBe(1);
    expect(startPreview).not.toHaveBeenCalled();
    expect(sb.stopped).toBe(true);
  });

  it('no signal: the lane is exactly as before', async () => {
    const sb = await runSimpleBuild({
      prompt: 'app', framework: 'vite-react', scaffoldPaths: ['src/App.tsx'], shareContract: false, depOrder: false,
      generate: async (_s: string, user: string) => (user.includes('Plan the file list')
        ? 'src/App.tsx :: root\nsrc/Foo.tsx :: foo'
        : `<<<FILE ${fileFrom(user) || 'src/App.tsx'}>>>\nexport default function X(){return null}\n<<<ENDFILE>>>`),
      writeFiles: async () => {},
    });
    expect(sb.ok).toBe(true);
    expect(sb.stopped).toBeUndefined();
  });
});

describe('5 — the route wires the signal where no call site can forget it', () => {
  const route = read('src/server/routes/agentv3.ts');
  it('both text-runner factories carry the build signal', () => {
    expect(route).toMatch(/const makeFastTextRunner = \(onUsed\?: \(used: string\) => void\): TurnRunner => (?:withAnswerNotDeliberation\()?withStopSignal\(buildTurnRunner\(/);
    expect(route).toMatch(/const makePlanTextRunner = \(onUsed\?: \(used: string\) => void\): TurnRunner => (?:withAnswerNotDeliberation\()?withStopSignal\(buildTurnRunner\(/);
  });

  it('the fast lane is handed the signal, and a stopped lane starts no one-shot lane', () => {
    const call = route.slice(route.indexOf('const sb = await runSimpleBuild({'));
    expect(call.slice(0, 1500)).toMatch(/signal: abort\.signal/);
    expect(route).toMatch(/!sb\.stopped && !abort\.signal\.aborted && classifyForOneShot/);
  });

  it('the agentic loop passes its signal to the model call it waits on', () => {
    const runner = read('src/server/AgentV3/AgentRunner.ts');
    const call = runner.slice(runner.indexOf('const turnCall = client.runTurn({'));
    // A per-turn timeout is combined with the build signal. The fallback is still this.opts.signal,
    // and the any() arm includes it, so Stop cancels the in-flight model call either way.
    const head = call.slice(0, 900);
    expect(head).toMatch(/AbortSignal\.any\(\[\.\.\.\(this\.opts\.signal \? \[this\.opts\.signal\] : \[\]\), AbortSignal\.timeout\(turnTimeoutMs\)\]\)/);
    expect(head).toMatch(/: this\.opts\.signal/);
    expect(runner).toMatch(/if \(this\.opts\.signal\?\.aborted && isBuildStoppedError\(err\)\) return endAborted\(\);/);
  });
});
