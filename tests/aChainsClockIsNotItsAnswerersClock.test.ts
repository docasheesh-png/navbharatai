// AUTOPSY 303e8a6f (2026-10-12), item G — the first model call's row read `kimi-k2.7-code · 18,423 ms`. It was a
// fallback walk: GLM (glm-4.7-flashx) crawled for 15,000 ms and was abandoned, then KIMI answered in 3,415 ms.
// One stopwatch wrapped the whole chain, and the row it filled named only the engine that answered — so the
// rescuer was charged with the crawl it rescued the build from, TIME_TO_FIRST_CALL called the walk "the first
// call itself … model time", and the per-model speed table (the instrument routing is to be judged by) recorded
// KIMI ~5× slower than it was.
//
// The CLASS: a duration measured around a provider fallback chain is filed on a per-model row labelled with only
// the chain's answering member. Two earlier fixes (quiz-app 2026-07-17, f152c1ab 2026-09-20) moved the row's
// MODEL to the answerer and never moved its clock. The chain now hands out the answering attempt's own time
// (`TurnResult.attemptMs`), every success row carries it as `answerMs`, and `latencyMs` keeps meaning the
// caller's wait — the number preparation is measured against.
//
// ⚠️ CORRECTED BY THE ADVERSARIAL REVIEW: the time on the engines left behind was first DERIVED as "wait minus
// answer", which charged the caller's own pre-call work (compaction, working-set reads) to the engines. The chain
// now MEASURES it (`fallbackMs`, the number the waste ledger already receives); the text render keeps the wait
// as its headline; and §5 drives the real AgentRunner through the real chain, so a runner that stops forwarding
// the measurement — or files the answer time as the wait — fails here, not only a unit of BuildDiagnostics.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { makeMultiProviderTurnRunner } from '../src/server/AgentV3/providers/MultiProviderTurnRunner';
import { BuildDiagnostics, renderDiagnosticsText } from '../src/server/AgentV3/BuildDiagnostics';
import { modelStatsFromCalls } from '../src/server/AgentV3/modelPerformance';
import { answerTimeOf } from '../src/server/AgentV3/answeringModel';
import { AgentRunner } from '../src/server/AgentV3/AgentRunner';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { defaultToolCatalog } from '../src/server/AgentV3/ToolCatalog';

// The report's own clock.
const STARTED_AT = 1791817491537;
const FIRST_CALL_BEGAN = 1791817502950; // 11.4 s of preparation
const GLM_CRAWL_MS = 15_000;
const KIMI_ANSWER_MS = 3_415;

type Rung = { name: string; modelId: string; runner: { runTurn: (p: unknown) => Promise<unknown> } };
const answer = (model: string) => ({
  text: '', toolUses: [{ id: 't', name: 'read_file', input: {} }], stopReason: 'tool_use',
  usage: { inputTokens: 35588, outputTokens: 139 }, rawContent: [], model,
});

function theReportsChain(clock: { t: number }) {
  const rungs: Rung[] = [
    { name: 'GLM', modelId: 'glm-4.7-flashx', runner: { runTurn: async () => { clock.t += GLM_CRAWL_MS; throw new Error('OpenAI-compatible call (GLM/Kimi) timed out — abandoned for crawling after 15000ms'); } } },
    { name: 'KIMI', modelId: 'kimi-k2.7-code', runner: { runTurn: async () => { clock.t += KIMI_ANSWER_MS; return answer('kimi-k2.7-code'); } } },
  ];
  return makeMultiProviderTurnRunner(rungs as never, { now: () => clock.t } as never);
}

describe('1 · the chain hands out the answering attempt\'s own time', () => {
  it('the report\'s walk: GLM crawls 15 s and is left, KIMI answers in 3.4 s → attemptMs is KIMI\'s', async () => {
    const clock = { t: FIRST_CALL_BEGAN };
    const turn = await theReportsChain(clock).runTurn({ model: 'requested', messages: [], tools: [] } as never) as { attemptMs?: number; fallbackMs?: number; model?: string };
    expect(turn.model).toBe('kimi-k2.7-code');
    expect(turn.attemptMs).toBe(KIMI_ANSWER_MS);
    expect(turn.fallbackMs).toBe(GLM_CRAWL_MS); // measured on the failed attempt, not derived
    expect(clock.t - FIRST_CALL_BEGAN).toBe(GLM_CRAWL_MS + KIMI_ANSWER_MS); // the caller still waited the whole walk
  });

  it('a first-rung answer: its own time is the whole time', async () => {
    const clock = { t: 0 };
    const chain = makeMultiProviderTurnRunner([
      { name: 'KIMI', modelId: 'kimi-k2.7-code', runner: { runTurn: async () => { clock.t += 2_000; return answer('kimi-k2.7-code'); } } },
    ] as never, { now: () => clock.t } as never);
    expect(await chain.runTurn({ messages: [], tools: [] } as never)).toMatchObject({ attemptMs: 2_000, fallbackMs: 0 });
  });

  it('a chain inside a chain keeps the innermost answerer\'s time, and adds up the engines left behind at both levels', async () => {
    const clock = { t: 0 };
    const inner = theReportsChain(clock);
    const outer = makeMultiProviderTurnRunner([
      { name: 'GROK', modelId: 'grok-x', runner: { runTurn: async () => { clock.t += 2_000; throw new Error('429 Too Many Requests'); } } },
      { name: 'KIMI', modelId: 'kimi-k2.7-code', runner: inner },
    ] as never, { now: () => clock.t } as never);
    expect(await outer.runTurn({ messages: [], tools: [] } as never)).toMatchObject({ attemptMs: KIMI_ANSWER_MS, fallbackMs: 2_000 + GLM_CRAWL_MS });
  });

  it('answerTimeOf spreads only a real measurement', () => {
    expect(answerTimeOf({ attemptMs: 3415 })).toEqual({ answerMs: 3415 });
    expect(answerTimeOf({ attemptMs: 3415, fallbackMs: 15000 })).toEqual({ answerMs: 3415, fallbackMs: 15000 });
    expect(answerTimeOf({})).toEqual({});
    expect(answerTimeOf({ attemptMs: Number.NaN })).toEqual({});
    expect(answerTimeOf(null)).toEqual({});
  });
});

function theReportsFirstCall(answerMs?: number, fallbackMs?: number, latencyMs = 18_423) {
  const clock = { t: STARTED_AT };
  const d = new BuildDiagnostics({ buildId: '303e8a6f', now: () => clock.t } as never);
  clock.t = FIRST_CALL_BEGAN + latencyMs; // the row's own ts: 1791817521373
  d.recordLlmCall({ model: 'kimi-k2.7-code', latencyMs, ...(answerMs !== undefined ? { answerMs } : {}), ...(fallbackMs !== undefined ? { fallbackMs } : {}), ok: true, outputTokens: 139 } as never);
  return d.report();
}
const ttfcOf = (r: ReturnType<typeof theReportsFirstCall>) => r.issues.find((i) => i.code === 'TIME_TO_FIRST_CALL')!.message;

describe('2 · the report tells the measured parts apart', () => {
  it('preparation is still measured against the caller\'s wait — 11 s, never 26 s', () => {
    const ttfc = ttfcOf(theReportsFirstCall(KIMI_ANSWER_MS, GLM_CRAWL_MS));
    expect(ttfc).toMatch(/^11s of preparation/);
    expect(ttfc).toContain('The first call then took 18s: 15s on engine(s) that did not answer and were left behind');
    expect(ttfc).toContain('then 3s for the engine that answered — provider time, not setup.');
  });

  it('🔒 the caller\'s own pre-call work is never charged to the engines — it is named as what it is', () => {
    // 2 s inside the runner's window before the chain was asked (compaction, working-set reads).
    const ttfc = ttfcOf(theReportsFirstCall(KIMI_ANSWER_MS, GLM_CRAWL_MS, 20_423));
    expect(ttfc).toContain('15s on engine(s) that did not answer');
    expect(ttfc).toContain("and 2s of the runner's own work before the provider call");
  });

  it('with no measured fallback there is no split — an answer time alone is never turned into one', () => {
    expect(ttfcOf(theReportsFirstCall())).toContain('The first call itself then took 18s; that is model time, not setup.');
    expect(ttfcOf(theReportsFirstCall(KIMI_ANSWER_MS))).toContain('The first call itself then took 18s; that is model time, not setup.');
    expect(ttfcOf(theReportsFirstCall(18_200, 0))).toContain('The first call itself then took 18s; that is model time, not setup.');
  });

  it('the row keeps every number; the text render keeps the wait as its headline', () => {
    const r = theReportsFirstCall(KIMI_ANSWER_MS, GLM_CRAWL_MS);
    expect(r.llmCalls?.[0]).toMatchObject({ model: 'kimi-k2.7-code', latencyMs: 18_423, answerMs: KIMI_ANSWER_MS, fallbackMs: GLM_CRAWL_MS });
    expect(renderDiagnosticsText(r)).toMatch(/kimi-k2\.7-code finish=\S+ tokens=\S+ 18s \(answering engine 3s; 15s on engines left behind\) ok/);
    // A few milliseconds of difference is not a fallback.
    expect(renderDiagnosticsText(theReportsFirstCall(18_400, 0))).toMatch(/tokens=\S+ 18s ok/);
  });

  it('a measurement longer than the wait is not one — it is clamped to the wait', () => {
    expect(theReportsFirstCall(99_000, 99_000).llmCalls?.[0]).toMatchObject({ answerMs: 18_423, fallbackMs: 18_423 });
  });
});

describe('3 · the per-model speed is the model\'s own', () => {
  it('KIMI\'s median is 3,415 ms, not 18,423', () => {
    const [kimi] = modelStatsFromCalls([{ ts: 1, model: 'kimi-k2.7-code', latencyMs: 18_423, answerMs: KIMI_ANSWER_MS, ok: true }]);
    expect(kimi!.medianLatencyMs).toBe(KIMI_ANSWER_MS);
    expect(kimi!.wallClockLatencySamples).toBe(0);
  });

  it('a row without its own time is counted as a wall-clock sample, never silently mixed', () => {
    const [m] = modelStatsFromCalls([
      { ts: 1, model: 'kimi-k2.7-code', latencyMs: 18_423, ok: true },
      { ts: 2, model: 'kimi-k2.7-code', latencyMs: 4_000, answerMs: 3_000, ok: true },
    ]);
    expect(m!.latencySamples).toBe(2);
    expect(m!.wallClockLatencySamples).toBe(1);
  });
});

describe('4 · 🔒 census: every SUCCESS row of a model call carries the answerer\'s own time', () => {
  const ROOT = join(__dirname, '..');
  const walk = (d: string, out: string[] = []): string[] => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.ts$/.test(n) && !/\.test\.ts$/.test(n)) out.push(p);
    }
    return out;
  };
  const objectAt = (src: string, open: number): string => {
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
    }
    return '';
  };

  it('a `recordLlmCall({…})` or `onLlmCall?.({…})` with `ok: true` and a latency spreads answerTimeOf', () => {
    const files = [...walk(join(ROOT, 'src/server')), join(ROOT, 'server.ts')];
    const successRows: string[] = [];
    const bare: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const re = /(?:recordLlmCall|onLlmCall\?\.)\(\s*\{/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const obj = objectAt(src, src.indexOf('{', m.index));
        if (!/\bok:\s*true\b/.test(obj) || !/\blatencyMs:/.test(obj)) continue;
        const where = `${f.slice(ROOT.length + 1)}:${src.slice(0, m.index).split('\n').length}`;
        successRows.push(where);
        // The ONLY source: the chain's own measurement, read through answerTimeOf — a hand-written
        // `answerMs: Date.now() - x` or `answerMs: turn.latencyMs` would satisfy a word check and be wrong.
        if (!/\.\.\.answerTimeOf\(/.test(obj) || /\b(?:answerMs|fallbackMs)\s*:/.test(obj)) bare.push(where);
      }
    }
    // The five known: the agent loop, the roadmap planner, the blueprint, the project planner, the fast lane.
    expect(successRows.length).toBeGreaterThanOrEqual(5);
    expect(bare).toEqual([]);
  });

  it('a FAILURE row carries no answer time — nobody answered', () => {
    const route = readFileSync(join(ROOT, 'src/server/routes/agentv3.ts'), 'utf8');
    const failures = [...route.matchAll(/recordLlmCall\(\{[^\n]*ok: false[^\n]*\}\)/g)].map((x) => x[0]);
    expect(failures.length).toBeGreaterThan(0);
    for (const f of failures) expect(f).not.toMatch(/answerTimeOf|answerMs/);
  });

  it('answerTimeOf reads only the chain\'s fields', () => {
    const src = readFileSync(join(ROOT, 'src/server/AgentV3/answeringModel.ts'), 'utf8');
    const body = src.slice(src.indexOf('export function answerTimeOf'), src.indexOf('\n}\n', src.indexOf('export function answerTimeOf')));
    expect(body).toContain('turn!.attemptMs');
    expect(body).toContain('turn!.fallbackMs');
    expect(body).not.toMatch(/latencyMs|Date\.now/);
  });
});

describe('5 · 🔒 end to end: the real AgentRunner, through the real chain, into the real report', () => {
  afterEach(() => { vi.useRealTimers(); });

  async function replay(preCallMs: number) {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(STARTED_AT);
    const diag = new BuildDiagnostics({ buildId: '303e8a6f' } as never);
    vi.setSystemTime(FIRST_CALL_BEGAN);
    let glmCalls = 0;
    let kimiCalls = 0;
    const chain = makeMultiProviderTurnRunner([
      { name: 'GLM', modelId: 'glm-4.7-flashx', runner: { runTurn: async () => {
        glmCalls++;
        vi.setSystemTime(Date.now() + GLM_CRAWL_MS);
        throw new Error('OpenAI-compatible call (GLM/Kimi) timed out — abandoned for crawling after 15000ms');
      } } },
      { name: 'KIMI', modelId: 'kimi-k2.7-code', runner: { runTurn: async () => {
        kimiCalls++;
        vi.setSystemTime(Date.now() + KIMI_ANSWER_MS);
        return kimiCalls === 1 ? answer('kimi-k2.7-code') : { ...answer('kimi-k2.7-code'), toolUses: [], stopReason: 'end_turn', text: 'Done.' };
      } } },
    ] as never);
    // Work the RUNNER does inside its own window before it asks the chain (compaction, working-set reads).
    const client = { runTurn: async (p: never) => { if (preCallMs && glmCalls === 0) vi.setSystemTime(Date.now() + preCallMs); return chain.runTurn(p); } };
    const stream = new AgentEventStream();
    await new AgentRunner({
      client: client as never,
      dispatcher: { dispatch: async (tu: { id: string }) => ({ tool_use_id: tu.id, content: 'ok', is_error: false }) } as never,
      state: new WorkspaceState(stream), events: stream, model: 'kimi-k2.7-code', system: 's', tools: defaultToolCatalog(),
      onLlmCall: (c: never) => diag.recordLlmCall(c),
    } as never).run('make an AI image app');
    return diag.report();
  }

  it('the report\'s first call: the rescuer is filed with its own 3.4 s, the walk with 15 s, preparation 11 s', async () => {
    const r = await replay(0);
    expect(r.llmCalls?.[0]).toMatchObject({ model: 'kimi-k2.7-code', latencyMs: GLM_CRAWL_MS + KIMI_ANSWER_MS, answerMs: KIMI_ANSWER_MS, fallbackMs: GLM_CRAWL_MS });
    const ttfc = r.issues.find((i) => i.code === 'TIME_TO_FIRST_CALL')!.message;
    expect(ttfc).toMatch(/^11s of preparation/);
    expect(ttfc).toContain('18s: 15s on engine(s) that did not answer');
    const [kimi] = modelStatsFromCalls(r.llmCalls!.filter((c) => c.model === 'kimi-k2.7-code'));
    expect(kimi!.medianLatencyMs).toBe(KIMI_ANSWER_MS);
  });

  it('two seconds of the runner\'s own pre-call work stay the runner\'s', async () => {
    const r = await replay(2_000);
    expect(r.llmCalls?.[0]).toMatchObject({ latencyMs: 2_000 + GLM_CRAWL_MS + KIMI_ANSWER_MS, fallbackMs: GLM_CRAWL_MS });
    const ttfc = r.issues.find((i) => i.code === 'TIME_TO_FIRST_CALL')!.message;
    expect(ttfc).toContain('15s on engine(s) that did not answer');
    expect(ttfc).toContain("2s of the runner's own work before the provider call");
  });
});
