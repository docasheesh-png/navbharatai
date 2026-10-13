/**
 * A MODEL CALL THAT WE STOPPED, ON OUR OWN CLOCK, IS ON THE RECORD AS OURS (autopsy 9c612cdb, Q-998).
 *
 * 🔴 THE BUILD. A green video-list app; the suggest-only review got one call and 45 s (+11.25 s grace). At 453.1 s it
 * was conceded (REVIEW_SUGGESTIONS_NOT_READY) and `reviewAbort.abort()` stopped the call in flight. The report then
 * listed 27 model calls — the builder's — and nothing between 396.9 s and 453.1 s: no engine, no latency. The
 * investigation had to DERIVE from the bench state which engine had run the review.
 *
 * 🔑 THE CLASS: AgentRunner's stop path was written for the USER's Stop ("a stop is not a provider failure",
 * autopsy 2720e553), and every abort took it. Since #3685 (autopsy 15e69839) the stopped call is recorded — but as
 * "cancelled because the build was stopped", under the nominal model id, for a build nobody stopped. Our own budget
 * read as the user's Stop. And the pass's abort was BARE (`controller.abort()`), so the runner could not have known
 * better: the cause was never on the signal.
 *
 * THE FIX, at the one place every runner ends on an abort: the cause is read from the signal and decided by
 * `stoppedCallOwner` for EVERY cause the code defines —
 *   • the user's Stop, and an unknown cause → recorded exactly as before (pinned byte for byte below);
 *   • our clock → a budget end (LLM_CALL_BUDGET_ENDED): no provider blamed, not a provider's wasted time, not a
 *     delivery — naming the clock, the engine that was serving the call, and how long it had run;
 *   • our platform → a stopped call that names the platform event.
 * and every post-build pass's signal comes from `passAbort`, whose own stop must name its cause.
 *
 * ⚠️ MONEY IS UNTOUCHED. What a stream we cut had already cost is a billing question (Q-880..Q-894) — not decided here.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { AgentRunner } from '../src/server/AgentV3/AgentRunner';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { BuildStoppedError, BUILD_STOPPED_MESSAGE, stoppedCallServedBy } from '../src/server/AgentV3/stopSignal';
import {
  ALL_ABORT_CAUSES, abortBuild, passAbort, stoppedCallOwner, stoppedCallCauseWords, stoppedCallError, type AbortCause,
} from '../src/server/AgentV3/buildAbortCause';
import { BUDGET_REACHED_MESSAGE, isBudgetEndedError } from '../src/server/AgentV3/turnDeadline';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import { makeMultiProviderTurnRunner, sharedRateLimitCooldowns, isTimeoutProviderError, wasteKindFor } from '../src/server/AgentV3/providers/MultiProviderTurnRunner';

beforeEach(() => sharedRateLimitCooldowns.reset());

type Rec = Record<string, unknown> & { ok: boolean; error?: string; latencyMs: number; model: string };

/** A provider that thinks until it is stopped — the review's Kimi call at 396.9 s → 453.1 s. */
const thinksUntilStopped = (servedBy?: { provider: string; model?: string }) => ({
  runTurn: (p: { signal?: AbortSignal }) => new Promise((_res, rej) => {
    const stop = () => rej(new BuildStoppedError(servedBy));
    if (p.signal?.aborted) stop(); else p.signal?.addEventListener('abort', stop, { once: true });
  }),
});

async function runAndStop(o: {
  client: unknown;
  stop: (c: AbortController) => void;
  afterMs?: number;
  role?: string;
}): Promise<{ calls: Rec[]; result: { ok: boolean; summary: string }; events: Array<Record<string, unknown>> }> {
  const controller = new AbortController();
  const calls: Rec[] = [];
  const stream = new AgentEventStream();
  const events: Array<Record<string, unknown>> = [];
  stream.subscribe((e) => events.push(e as never), false);
  const runner = new AgentRunner({
    client: o.client as never,
    dispatcher: { dispatch: async () => ({}) } as never,
    state: new WorkspaceState(stream),
    events: stream,
    model: 'nominal-model',
    system: 'You are the reviewer.',
    tools: [],
    ...(o.role ? { agentRole: o.role as never } : {}),
    signal: controller.signal,
    onLlmCall: ((c: Rec) => calls.push(c)) as never,
  });
  const done = runner.run('review these files');
  await new Promise((r) => setTimeout(r, o.afterMs ?? 60));
  o.stop(controller);
  const result = await done as { ok: boolean; summary: string };
  return { calls, result, events };
}

const diag = () => new BuildDiagnostics({ buildId: 'b-9c612cdb', workspaceId: 'w', sessionId: 's', prompt: 'p', startedAt: 1 });

// ── §1 · the review our budget cut off ───────────────────────────────────────────────────────────────────────
describe('§1 a call OUR clock stopped is one record, as ours, with the engine and how long it ran', () => {
  it('🔴 the review budget: exactly one ok:false record, the serving engine, the latency, a budget end', async () => {
    const { calls } = await runAndStop({
      client: thinksUntilStopped({ provider: 'KIMI', model: 'kimi-k2.7-code' }),
      stop: (c) => abortBuild(c, 'review-budget'),
      role: 'reviewer',
    });
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.ok).toBe(false);
    expect(call.latencyMs).toBeGreaterThanOrEqual(50);
    // The engine that was SERVING the call — not the nominal id the runner was built with.
    expect(call.model).toBe('kimi-k2.7-code');
    expect(call.provider).toBe('KIMI');
    expect(call.stopCause).toBe('review-budget');
    // Filed as our budget ending — never a provider failure, never the user's Stop.
    expect(isBudgetEndedError(call.error)).toBe(true);
    expect(call.error).toContain(BUDGET_REACHED_MESSAGE);
    expect(call.error).toContain("the post-build review's own time budget");
    expect(call.error).not.toBe(BUILD_STOPPED_MESSAGE);
    expect(isTimeoutProviderError(new Error(call.error))).toBe(false); // a provider is never benched for it
    expect(wasteKindFor(new Error(call.error))).toBeNull(); // nor counted as its wasted time
  });

  it('the report reads it as LLM_CALL_BUDGET_ENDED, naming the clock, the engine and the seconds — and nothing else', async () => {
    const { calls } = await runAndStop({
      client: thinksUntilStopped({ provider: 'KIMI', model: 'kimi-k2.7-code' }),
      stop: (c) => abortBuild(c, 'review-budget'),
    });
    const d = diag();
    d.recordLlmCall(calls[0] as never);
    const r = d.report();
    const codes = r.issues.map((i) => i.code);
    expect(codes).toContain('LLM_CALL_BUDGET_ENDED');
    expect(codes).not.toContain('LLM_CALL_STOPPED');
    expect(codes).not.toContain('LLM_CALL_FAILED');
    const issue = r.issues.find((i) => i.code === 'LLM_CALL_BUDGET_ENDED')!;
    expect(issue.severity).toBe('info');
    expect(issue.autoResolved).toBe(true);
    expect(issue.message).toContain('kimi-k2.7-code');
    expect(issue.detail).toContain('provider=KIMI');
    expect(issue.detail).toContain("stopped by the post-build review's own time budget");
    expect(issue.detail).toMatch(/it had been running \d+s/);
    // In the call log, and not a delivery: providerDelivery counts only turns a provider answered.
    expect(r.llmCalls).toHaveLength(1);
    expect(r.providerDelivery ?? {}).toEqual({});
    expect(r.counts.errors).toBe(0);
  });

  it('through the REAL provider chain: the stop names the rung it was on, and no provider is blamed or credited', async () => {
    const onProviderUsed = vi.fn();
    const onProviderError = vi.fn();
    const onTurnComplete = vi.fn();
    const chain = makeMultiProviderTurnRunner([
      { name: 'KIMI', runner: { runTurn: () => new Promise(() => { /* still reasoning */ }) } as never, modelId: 'kimi-k2.7-code' },
      { name: 'GLM', runner: { runTurn: vi.fn() } as never, modelId: 'glm-5.3' },
    ], { onProviderUsed, onProviderError, onTurnComplete });
    const { calls } = await runAndStop({ client: chain, stop: (c) => abortBuild(c, 'review-budget') });
    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe('kimi-k2.7-code');
    expect(calls[0].provider).toBe('KIMI');
    expect(isBudgetEndedError(calls[0].error)).toBe(true);
    expect(onProviderUsed).not.toHaveBeenCalled();
    expect(onProviderError).not.toHaveBeenCalled();
    expect(onTurnComplete).not.toHaveBeenCalled(); // money is untouched: nothing new is attributed or billed
  });
});

// ── §2 · the user's Stop, byte for byte ─────────────────────────────────────────────────────────────────────
describe('§2 the user\'s Stop is recorded exactly as it was (#3685, autopsy 15e69839)', () => {
  // ⚠️ The ticket said "user stop → no record (as today)". That was true when the report was written; #3685 (merged
  // 2026-10-12) made a Stop record the call in flight as LLM_CALL_STOPPED. THAT is today, and it is what stays.
  const TODAY_KEYS = ['model', 'promptPreview', 'promptChars', 'responsePreview', 'responseChars', 'finishReason', 'toolCalls', 'inputTokens', 'outputTokens', 'latencyMs', 'ok', 'error'];

  it('one record: the nominal model, the stop message, no provider, no cause — the same keys in the same order', async () => {
    const { calls, result } = await runAndStop({
      client: thinksUntilStopped({ provider: 'KIMI', model: 'kimi-k2.7-code' }),
      stop: (c) => abortBuild(c, 'user-stop'),
    });
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0])).toEqual(TODAY_KEYS);
    expect(calls[0].model).toBe('nominal-model');
    expect(calls[0].error).toBe(BUILD_STOPPED_MESSAGE);
    expect(result.summary).toMatch(/^Stopped, as you asked\./);
    const d = diag();
    d.recordLlmCall(calls[0] as never);
    const stopped = d.report().issues.find((i) => i.code === 'LLM_CALL_STOPPED')!;
    expect(stopped.detail).toMatch(/^no provider had answered yet · it had been running \d+s$/);
  });
});

// ── §3 · the census: every abort cause the code defines is decided ──────────────────────────────────────────
function causesInSource(): string[] {
  const src = readFileSync(join(process.cwd(), 'src/server/AgentV3/buildAbortCause.ts'), 'utf8');
  const block = src.slice(src.indexOf('export type AbortCause ='), src.indexOf('const EVERY_CAUSE'));
  return [...block.matchAll(/^\s*\|\s*'([a-z-]+)'/gm)].map((m) => m[1]);
}

describe('§3 census — every abort cause is classified, and each is recorded as its owner says', () => {
  it('the list the census walks is the union in the source', () => {
    expect([...ALL_ABORT_CAUSES].sort()).toEqual(causesInSource().sort());
    expect(ALL_ABORT_CAUSES.length).toBeGreaterThanOrEqual(12);
  });

  it('each owner is one of four, and every cause that is ours has words naming it', () => {
    for (const cause of ALL_ABORT_CAUSES) {
      const owner = stoppedCallOwner(cause);
      expect(['user', 'our-clock', 'our-platform', 'unknown'], cause).toContain(owner);
      if (owner === 'our-clock' || owner === 'our-platform') expect(stoppedCallCauseWords(cause), cause).not.toBe('');
      else expect(stoppedCallCauseWords(cause), cause).toBe('');
    }
    expect(stoppedCallOwner('user-stop')).toBe('user');
    expect(stoppedCallOwner('unknown')).toBe('unknown');
    for (const c of ['review-budget', 'recheck-budget', 'repair-budget', 'advisory-cap', 'watchdog'] as const) expect(stoppedCallOwner(c), c).toBe('our-clock');
  });

  for (const cause of ALL_ABORT_CAUSES) {
    it(`${cause}: exactly one record, filed as its owner says`, async () => {
      const { calls } = await runAndStop({
        client: thinksUntilStopped({ provider: 'KIMI', model: 'kimi-k2.7-code' }),
        // 'unknown' is what a BARE abort produces — the state passAbort exists to remove.
        stop: (c) => (cause === 'unknown' ? c.abort() : abortBuild(c, cause as AbortCause)),
        afterMs: 15,
      });
      expect(calls, cause).toHaveLength(1);
      const call = calls[0];
      expect(call.ok).toBe(false);
      const d = diag();
      d.recordLlmCall(call as never);
      const codes = d.report().issues.map((i) => i.code);
      expect(codes, cause).not.toContain('LLM_CALL_FAILED');
      switch (stoppedCallOwner(cause)) {
        case 'user':
        case 'unknown':
          expect(call.error).toBe(BUILD_STOPPED_MESSAGE);
          expect(call.model).toBe('nominal-model');
          expect('stopCause' in call).toBe(false);
          expect(codes).toContain('LLM_CALL_STOPPED');
          break;
        case 'our-clock':
          expect(call.error).toBe(stoppedCallError(cause, BUILD_STOPPED_MESSAGE));
          expect(isBudgetEndedError(call.error)).toBe(true);
          expect(call.model).toBe('kimi-k2.7-code');
          expect(call.stopCause).toBe(cause);
          expect(codes).toContain('LLM_CALL_BUDGET_ENDED');
          expect(codes).not.toContain('LLM_CALL_STOPPED');
          break;
        case 'our-platform': {
          expect(call.error).toBe(BUILD_STOPPED_MESSAGE);
          expect(call.model).toBe('kimi-k2.7-code');
          expect(call.stopCause).toBe(cause);
          const stopped = d.report().issues.find((i) => i.code === 'LLM_CALL_STOPPED')!;
          expect(stopped.detail).toContain(`stopped by us: ${stoppedCallCauseWords(cause)}`);
          break;
        }
        default:
          throw new Error(`unclassified cause ${cause}`);
      }
    });
  }
});

// ── §4 · the sibling: our per-turn stall guard is not a Stop either ──────────────────────────────────────────
describe('§4 the per-turn timeout, fired through a chain that honours it, ends as the stall it is', () => {
  it('🔴 not "Error: Stopped — the build was asked to stop": the honest stall ending, and a timeout on the record', async () => {
    const calls: Rec[] = [];
    const stream = new AgentEventStream();
    const runner = new AgentRunner({
      // Exactly what the provider chain does: the turn signal aborts → a stop error.
      client: thinksUntilStopped({ provider: 'KIMI', model: 'kimi-k2.7-code' }) as never,
      dispatcher: { dispatch: async () => ({}) } as never,
      state: new WorkspaceState(stream),
      events: stream,
      model: 'nominal-model',
      system: 's',
      tools: [],
      turnTimeoutMs: 80,
      onLlmCall: ((c: Rec) => calls.push(c)) as never,
    });
    const result = await runner.run('build') as { ok: boolean; summary: string };
    expect(result.summary).not.toContain('Stopped');
    expect(result.summary).toMatch(/didn't respond in time|stalled/);
    expect(calls).toHaveLength(1);
    expect(calls[0].error).toMatch(/model turn 1 timed out after 80ms/);
    const d = diag();
    d.recordLlmCall(calls[0] as never);
    expect(d.report().issues.map((i) => i.code)).not.toContain('LLM_CALL_STOPPED');
  });
});

// ── §5 · the pass's own abort ─────────────────────────────────────────────────────────────────────────────────
describe('§5 passAbort — the build\'s cause crosses the link, the pass\'s own stop names its cause', () => {
  const reasonCause = (s: AbortSignal) => (s.reason as Record<string, unknown>)?.['__nbaiAbortCause'];

  it('a user Stop reaches the pass WITH its cause (it used to arrive as "unknown")', () => {
    const build = new AbortController();
    const pass = passAbort(build.signal);
    abortBuild(build, 'user-stop');
    expect(pass.signal.aborted).toBe(true);
    expect(reasonCause(pass.signal)).toBe('user-stop');
    pass.dispose();
  });

  it('the pass\'s own stop names its cause, the first stop wins, and dispose detaches', () => {
    const build = new AbortController();
    const pass = passAbort(build.signal);
    pass.abort('review-budget');
    abortBuild(build, 'user-stop');
    expect(reasonCause(pass.signal)).toBe('review-budget');
    const other = passAbort(build.signal);
    expect(reasonCause(other.signal)).toBe('user-stop'); // already stopped ⇒ born stopped, with the cause
    const b2 = new AbortController();
    const p2 = passAbort(b2.signal);
    p2.dispose();
    abortBuild(b2, 'user-stop');
    expect(p2.signal.aborted).toBe(false);
  });

  it('the stopped-call error a chain throws carries the rung; one that never reached a rung carries none', () => {
    expect(stoppedCallServedBy(new BuildStoppedError({ provider: 'KIMI', model: 'kimi-k2.7-code' }))).toEqual({ provider: 'KIMI', model: 'kimi-k2.7-code' });
    expect(stoppedCallServedBy(new BuildStoppedError())).toBeUndefined();
    expect(new BuildStoppedError({ provider: 'KIMI' }).message).toBe(BUILD_STOPPED_MESSAGE);
  });
});

// ── §6 · source census: no pass gets a signal that cannot carry a cause ─────────────────────────────────────────
function serverFiles(): string[] {
  const root = process.cwd();
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.ts$/.test(e) && !/\.test\.ts$/.test(e)) out.push(relative(root, p).split('\\').join('/'));
    }
  };
  walk(join(root, 'src/server'));
  out.push('server.ts');
  return out;
}

describe('§6 every model pass\'s signal can say why it stopped', () => {
  it('a file that runs a model pass (AgentRunner, a sub-agent spawn, a repair) makes no AbortController of its own — except the build\'s', () => {
    // A runner's signal must come from the build's controller (aborted only through `abortBuild`) or from `passAbort`.
    // A bare controller here is how the review's budget read as an unexplained stop. Listed: the ONE allowed.
    const ALLOWED: Record<string, number> = { 'src/server/routes/agentv3.ts': 1 /* `const abort = new AbortController()` — the build's own */ };
    const offenders: string[] = [];
    for (const f of serverFiles()) {
      const src = readFileSync(join(process.cwd(), f), 'utf8');
      if (!/new AgentRunner\(|makeSubAgentSpawn\(|runExplorerRepair|deps\.repair\(/.test(src)) continue;
      const n = (src.match(/new AbortController\(\)/g) ?? []).length;
      if (n !== (ALLOWED[f] ?? 0)) offenders.push(`${f}: ${n}`);
    }
    expect(offenders).toEqual([]);
  });

  it('the route\'s three post-build passes each take their signal from passAbort and stop it with their own cause', () => {
    const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');
    for (const [name, cause] of [['reviewAbort', 'review-budget'], ['recheckAbort', 'recheck-budget'], ['repairAbort', 'repair-budget']] as const) {
      expect(route, name).toContain(`const ${name} = passAbort(abort.signal);`);
      expect(route, name).toContain(`${name}.abort('${cause}')`);
      expect(route, name).toContain(`${name}.dispose()`);
      expect(route, name).not.toMatch(new RegExp(`${name}\\.abort\\(\\)`));
    }
  });
});
