// AUTOPSY 303e8a6f (2026-10-12), item B — "GLM benched: glm-4.7-flashx was answering far below a usable rate after
// 15s — abandoned mid-answer", "By kind: 1 crawl (15s)". The provider had not answered at all: "after 15000ms" to the
// millisecond can only come from the never-opened bound, which since autopsy 1389f0d5 reuses the crawl marker so the
// crawl bench (not the timeout bench) owns it. Routing was right. Everything that turned the marker into words or
// numbers still assumed a stream answering slowly — and the failure ledger filed the same error under "timeout",
// disagreeing with the waste ledger. The admin was told for twenty reports that the cheap rung is SLOW when the
// dominant event is that it does not ANSWER, and Q-009's accepted reopen line ("crawls > 10% of a day's wall time")
// had no instrument at all.
//
// The CLASS: one routing marker shared by two failure modes, read by every reporter as if it were only one.
//
// ⚠️ CORRECTED BY THE ADVERSARIAL REVIEW (§5): the bench sentence's TAIL still said "it crawled again"; a silence
// we waited out (a timed-out request that never opened, an opened stream idle with zero bytes) was filed as a
// timeout — the longest silences, left out of the silent share; time-to-open alone could not size "opened, then
// nothing", so the time to the first word is recorded too; and the classifier census now lists the vocabulary
// differences on purpose and includes the lane classifier.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { OpenAiToolRunner, type OpenAiChatClient } from '../src/server/AgentV3/providers/OpenAiToolRunner';
import { makeMultiProviderTurnRunner, wasteKindFor } from '../src/server/AgentV3/providers/MultiProviderTurnRunner';
import { SLOW_STREAM_MESSAGE, SILENT_OPEN_MARK, isSilentAbandon, isSlowStreamAbandon, providerNeverAnswered, BUDGET_REACHED_MESSAGE } from '../src/server/AgentV3/turnDeadline';
import { classifyLaneFailure } from '../src/server/AgentV3/laneFailure';
import { answerTimeOf } from '../src/server/AgentV3/answeringModel';
import { classifyProviderFailure, providerFailuresLookDegraded, BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import { emptyWasteLedger, recordWaste, wasteSummary } from '../src/server/AgentV3/providerWaste';
import { modelStatsFromCalls, providerFailureStats } from '../src/server/AgentV3/modelPerformance';

const saved = { ...process.env };
afterEach(() => { process.env = { ...saved }; });
const env = () => {
  process.env.AGENTV3_STREAM_BUILD_CALLS = 'on';
  process.env.AGENTV3_STREAM_IDLE_MS = '12000';
  process.env.AGENTV3_STREAM_THROUGHPUT_GRACE_MS = '5000';
  process.env.AGENTV3_STREAM_FIRST_BYTE_GRACE_MS = '5000'; // zero-byte grace pinned to the same short window for timing
};
const params = { model: 'glm-4.7-flashx', system: 's', messages: [{ role: 'user' as const, content: 'build' }], tools: [], canAbandonSlowStream: () => true, hasNextRung: true };

/** A stream that sends `first` once and then never another byte. */
function stalledStream(first: string | null) {
  let sent = false;
  return {
    controller: { abort: () => {} },
    [Symbol.asyncIterator]() {
      return {
        next: () => (!sent && first !== null
          ? (sent = true, Promise.resolve({ done: false, value: { choices: [{ index: 0, delta: { content: first } }] } }))
          : new Promise<never>(() => {})),
      };
    },
  };
}
const run = (client: unknown) => new OpenAiToolRunner(client as OpenAiChatClient, { model: 'glm-4.7-flashx' }).runTurn(params as never).then(() => null, (e: unknown) => e as Error);

describe('1 · the runner says which it was', () => {
  it('🔴 the report\'s event — a request that never opens — is silence, and still routes as a crawl', async () => {
    env();
    const err = await run({ chat: { completions: { create: () => new Promise(() => {}) } } });
    expect(err?.message).toMatch(/abandoned for crawling after 5000ms — the provider had not started answering$/);
    expect(isSlowStreamAbandon(err)).toBe(true); // routing unchanged: the crawl bench still owns it
    expect(isSilentAbandon(err)).toBe(true);
    expect(wasteKindFor(err)).toBe('silent');
    expect(classifyProviderFailure(err)).toBe('silent');
  }, 20_000);

  it('a stream that opens and never speaks is silence too', async () => {
    env();
    const err = await run({ chat: { completions: { create: async () => stalledStream(null) } } });
    expect(isSilentAbandon(err)).toBe(true);
  }, 20_000);

  it('a stream that answered a little and then crawled stays a crawl', async () => {
    env();
    const err = await run({ chat: { completions: { create: async () => stalledStream('Hello') } } });
    expect(isSlowStreamAbandon(err)).toBe(true);
    expect(isSilentAbandon(err)).toBe(false);
    expect(wasteKindFor(err)).toBe('crawl');
    expect(classifyProviderFailure(err)).toBe('crawl');
  }, 20_000);
});

describe('2 · the bench sentence says what the provider was doing', () => {
  const benchReasonFor = async (message: string) => {
    let reason = '';
    const answer = { text: 'ok', toolUses: [], stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 }, rawContent: [], model: 'kimi-k2.7-code' };
    const chain = makeMultiProviderTurnRunner([
      { name: 'GLM', modelId: 'glm-4.7-flashx', runner: { runTurn: async () => { throw new Error(message); } } },
      { name: 'KIMI', modelId: 'kimi-k2.7-code', runner: { runTurn: async () => answer } },
    ] as never, { onProviderBenched: (_f: string, r: string) => { reason = r; } } as never);
    await chain.runTurn({ messages: [], tools: [] } as never);
    return reason;
  };

  it('silence: "had not started answering", never "mid-answer"', async () => {
    const reason = await benchReasonFor(`${SLOW_STREAM_MESSAGE} after 15000ms — ${SILENT_OPEN_MARK}`);
    expect(reason).toMatch(/glm-4\.7-flashx had not started answering after \d+s — given up before its first word/);
    expect(reason).not.toMatch(/answering far below|mid-answer/);
  });

  it('a trickle keeps its own sentence', async () => {
    expect(await benchReasonFor(`${SLOW_STREAM_MESSAGE} after 17500ms`)).toMatch(/was answering far below a usable rate/);
  });
});

describe('3 · 🔒 the two classifiers of one error agree', () => {
  // The three string classifiers of one error, side by side. Where their vocabularies differ, the pair is written
  // out on purpose (a server error is 'server-error' to one and 'error' to the other; our own budget is 'other:'
  // to the failure ledger and null — not the vendor's waste — to the waste ledger).
  const TABLE: Array<[string, string, ReturnType<typeof wasteKindFor>, string]> = [
    [`${SLOW_STREAM_MESSAGE} after 15000ms — ${SILENT_OPEN_MARK}`, 'silent', 'silent', 'provider-degraded'],
    [`${SLOW_STREAM_MESSAGE} after 17500ms`, 'crawl', 'crawl', 'provider-degraded'],
    [`OpenAI-compatible call (GLM/Kimi) timed out after 12000ms — ${SILENT_OPEN_MARK}`, 'silent', 'silent', 'provider-degraded'],
    ['OpenAI-compatible call (GLM/Kimi) timed out after 60000ms', 'timeout', 'timeout', 'provider-degraded'],
    ['429 Too Many Requests', 'rate-limit', 'rate-limit', 'provider-degraded'],
    ['500 internal error', 'server-error', 'error', 'unknown'],
  ];
  it.each(TABLE)('%s', (message, bucket, kind, lane) => {
    expect(classifyProviderFailure(new Error(message))).toBe(bucket);
    expect(wasteKindFor(new Error(message))).toBe(kind);
    expect(classifyLaneFailure(message)).toBe(lane);
  });

  it('our own budget is nobody\'s waste and never silence', () => {
    expect(wasteKindFor(new Error(BUDGET_REACHED_MESSAGE))).toBeNull();
    expect(classifyProviderFailure(new Error(BUDGET_REACHED_MESSAGE))).toMatch(/^other:/);
    expect(providerNeverAnswered(new Error(BUDGET_REACHED_MESSAGE))).toBe(false);
  });

  it('our own clock is neither', () => {
    expect(wasteKindFor(new Error(BUDGET_REACHED_MESSAGE))).toBeNull();
  });

  it('a provider that went silent still makes the provider look degraded, as a crawl/timeout did', () => {
    expect(providerFailuresLookDegraded({ GLM: '1 silent' })).toBe(true);
    expect(providerFailuresLookDegraded({ GLM: '1 crawl' })).toBe(true);
  });

  it('the cross-build evidence counts silent and crawl apart from timeouts', () => {
    const [glm] = providerFailureStats({ providerFailures: { GLM: 3 }, providerFailureReasons: { GLM: '2 silent, 1 crawl' } } as never);
    expect(glm).toMatchObject({ silentCalls: 2, crawlCalls: 1, timeoutCalls: 0 });
  });

  it('🔒 census: every place the crawl marker is thrown decides whether it was silence', () => {
    const ROOT = join(__dirname, '..');
    const walk = (d: string, out: string[] = []): string[] => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.ts$/.test(n) && !/\.test\.ts$/.test(n)) out.push(p);
      }
      return out;
    };
    const sites: string[] = [];
    // EVERY reference in any shape (template, concatenation, bare) outside the module that defines it and import
    // lines — and the statement around it must DECIDE silence by the mark itself, never by a variable's name.
    for (const f of walk(join(ROOT, 'src'))) {
      if (f.endsWith('turnDeadline.ts')) continue;
      const lines = readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!/\bSLOW_STREAM_MESSAGE\b/.test(line) || /^\s*import\b/.test(line)) return;
        sites.push(`${f.slice(ROOT.length + 1)}:${i + 1}: ${lines.slice(Math.max(0, i - 2), i + 1).join(' ')}`);
      });
    }
    expect(sites.length).toBeGreaterThanOrEqual(2);
    for (const s of sites) expect(s, s).toContain('SILENT_OPEN_MARK');
  });
});

describe('4 · the reopen line can be measured', () => {
  it('the waste ledger is stored as numbers, with the clock it is a share of', () => {
    const ledger = emptyWasteLedger();
    recordWaste(ledger, 'GLM', 'silent', 15_000);
    expect(wasteSummary(ledger, 43_839)).toContain('1 silent (15s)');
    const d = new BuildDiagnostics();
    d.setProviderWaste(ledger, 43_839);
    expect(d.report().providerWaste).toEqual({
      msByKind: { timeout: 0, crawl: 0, silent: 15_000, 'rate-limit': 0, error: 0 },
      callsByKind: { timeout: 0, crawl: 0, silent: 1, 'rate-limit': 0, error: 0 },
      msByFamily: { GLM: 15_000 }, buildMs: 43_839,
    });
  });

  it('🔒 the route stores it and the admin listing carries it', () => {
    expect(readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8')).toContain('buildDiag.setProviderWaste(providerWaste, Date.now() - buildStartedAt);');
    expect(readFileSync(join(__dirname, '../src/server/AgentV3/DiagnosticsStore.ts'), 'utf8')).toContain('providerWaste: r.providerWaste ?? null,');
  });

  it('time-to-open of the calls that answered is recorded per model — the data a shorter bound is chosen from', () => {
    const [kimi] = modelStatsFromCalls([
      { ts: 1, model: 'glm-4.7-flashx', latencyMs: 4_000, answerMs: 4_000, openMs: 900, ok: true },
      { ts: 2, model: 'glm-4.7-flashx', latencyMs: 6_000, answerMs: 6_000, openMs: 2_100, ok: true },
    ]);
    expect(kimi).toMatchObject({ openSamples: 2, medianOpenMs: 1_500, maxOpenMs: 2_100 });
  });
});

describe('5 · 🔒 the corrections of the adversarial review', () => {
  it('a rung silent again on its re-probe is said to be silent again — never "crawled again"', async () => {
    // The re-probe only exists on the kill-switch path since autopsy ca99778e (a silent rung is sticky for the
    // build by default — tests/brCa99778eAutopsy.test.ts); the wording it pins must still hold there.
    const prevSticky = process.env.AGENTV3_SILENCE_STICKY;
    process.env.AGENTV3_SILENCE_STICKY = 'off';
    const clock = { t: 0 };
    const reasons: string[] = [];
    const answer = { text: 'ok', toolUses: [], stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 }, rawContent: [], model: 'kimi-k2.7-code' };
    const chain = makeMultiProviderTurnRunner([
      { name: 'GLM', modelId: 'glm-4.7-flashx', runner: { runTurn: async () => { clock.t += 15_000; throw new Error(`${SLOW_STREAM_MESSAGE} after 15000ms — ${SILENT_OPEN_MARK}`); } } },
      { name: 'KIMI', modelId: 'kimi-k2.7-code', runner: { runTurn: async () => answer } },
    ] as never, { now: () => clock.t, onProviderBenched: (_f: string, r: string) => { reasons.push(r); } } as never);
    await chain.runTurn({ messages: [], tools: [] } as never);
    clock.t += 60 * 60_000; // long past any crawl-bench window — the rung is tried once more
    await chain.runTurn({ messages: [], tools: [] } as never);
    expect(reasons.length).toBeGreaterThanOrEqual(2);
    for (const r of reasons) expect(r, r).not.toMatch(/crawl|far below|mid-answer/);
    expect(reasons.at(-1)).toMatch(/it was silent again when tried once more/);
    if (prevSticky === undefined) delete process.env.AGENTV3_SILENCE_STICKY; else process.env.AGENTV3_SILENCE_STICKY = prevSticky;
  });

  it('🔴 a silence we WAITED OUT is silence too — still a timeout to every routing reader', async () => {
    env();
    process.env.AGENTV3_STREAM_IDLE_MS = '1500';
    const noAbandon = { ...params, canAbandonSlowStream: () => false };
    const err = await new OpenAiToolRunner({ chat: { completions: { create: () => new Promise(() => {}) } } } as never, { model: 'glm-4.7-flashx' })
      .runTurn(noAbandon as never).then(() => null, (e: unknown) => e as Error);
    expect(err?.message).toMatch(/timed out after \d+ms — the provider had not started answering$/);
    expect(isSlowStreamAbandon(err)).toBe(false); // not a walk-away — the crawl bench never sees it
    expect(providerNeverAnswered(err)).toBe(true);
    expect(wasteKindFor(err)).toBe('silent');
    expect(classifyProviderFailure(err)).toBe('silent');
  }, 20_000);

  it('an opened stream idle with zero bytes is silence; one that answered a little and went idle is not', async () => {
    env();
    process.env.AGENTV3_STREAM_IDLE_MS = '1500';
    const noAbandon = { ...params, canAbandonSlowStream: () => false };
    const silent = await new OpenAiToolRunner({ chat: { completions: { create: async () => stalledStream(null) } } } as never, { model: 'glm-4.7-flashx' })
      .runTurn(noAbandon as never).then(() => null, (e: unknown) => e as Error);
    expect(providerNeverAnswered(silent)).toBe(true);
    // A stream that said something keeps it (truncated) — it answered, so nothing calls it silence.
    const spoke = await new OpenAiToolRunner({ chat: { completions: { create: async () => stalledStream('Hel') } } } as never, { model: 'glm-4.7-flashx' })
      .runTurn(noAbandon as never).then(() => 'answered', (e: unknown) => e as Error);
    expect(spoke === 'answered' || !providerNeverAnswered(spoke)).toBe(true);
  }, 20_000);

  it('🔒 time to open AND time to first word ride from the runner, through the chain, into the report', async () => {
    env();
    let sent = 0;
    const stream = {
      controller: { abort: () => {} },
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            sent++;
            if (sent === 1) { await new Promise((r) => setTimeout(r, 30)); return { done: false, value: { choices: [{ index: 0, delta: { content: 'Done.' } }] } }; }
            if (sent === 2) return { done: false, value: { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2 } } };
            return { done: true, value: undefined };
          },
        };
      },
    };
    const runner = new OpenAiToolRunner({ chat: { completions: { create: async () => { await new Promise((r) => setTimeout(r, 20)); return stream; } } } } as never, { model: 'kimi-k2.7-code' });
    const chain = makeMultiProviderTurnRunner([{ name: 'KIMI', modelId: 'kimi-k2.7-code', runner }] as never, {} as never);
    const t0 = Date.now();
    const turn = await chain.runTurn({ ...params, model: 'kimi-k2.7-code' } as never);
    const d = new BuildDiagnostics();
    d.recordLlmCall({ model: 'kimi-k2.7-code', latencyMs: Date.now() - t0, ...answerTimeOf(turn as never), ok: true } as never);
    const row = d.report().llmCalls![0]!;
    expect(row.openMs).toBeGreaterThanOrEqual(15);
    expect(row.firstOutputMs).toBeGreaterThanOrEqual(row.openMs!);
    const [m] = modelStatsFromCalls(d.report().llmCalls!);
    expect(m).toMatchObject({ firstOutputSamples: 1 });
  }, 20_000);
});
