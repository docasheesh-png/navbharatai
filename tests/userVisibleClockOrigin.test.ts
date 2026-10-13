// AUTOPSY 303e8a6f (2026-10-12), item H — the user had waited 23.4 s and the chat said "⏳ Still working — 11s so
// far". The heartbeat measured from the start of the MODEL CALL (11.4 s into the build), not from the moment the
// user started waiting; on a multi-turn build it restarted at "12s" on every slow turn. On the client the line kept
// its FIRST timestamp (a later turn's tick rewrote a bubble far above the fold) and was never removed when the call
// ended, and the status bar's clock started at the first ACTIVITY entry (a template file revealed at +11 s) on the
// server's clock while it ran on the device's.
//
// The CLASS: a user-visible elapsed clock whose origin is not the moment the user started waiting. And the sibling
// found beside it: live-status lines recognised by their first character ('⏱' by some readers, '⏳' by another),
// which let the heartbeat split a real silence and made the report drop real '⏳' progress lines.
//
// ⚠️ CORRECTED BY THE ADVERSARIAL REVIEW: the stream's own construction is up to ~30 s after the request arrives,
// so the origin is now stamped as the handler's first statement; a re-attached page gets the wait as a duration;
// a live line is stale after a later ACTION too (a tool-only turn says nothing); and the build-budget lines are
// told once per build, on the build's clock (§5).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { startWorkingHeartbeat, workingLine, WORKING_FIRST_MS, WORKING_INTERVAL_MS } from '../src/server/AgentV3/workingHeartbeat';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import { isLiveStatusLine, withoutStaleLiveStatus, lastActivityTs, WORKING_LINE_ID, ETA_LINE_ID } from '../src/lib/liveStatusLine';
import { agentV3Reducer } from '../src/components/agentv3/agentV3Reducer';
import { initialAgentV3State } from '../src/components/agentv3/agentV3Types';
import { buildElapsedMs, clockKeptOnReattach, clockFromAttach } from '../src/components/agentv3/buildClock';
import { buildBudgetNarration, BUDGET_NARRATION } from '../src/server/AgentV3/buildBudgetSteer';

afterEach(() => { vi.useRealTimers(); });

// The report's clock: build start, the first model call 11.4 s later.
const T0 = 1791817491537;
const CALL_ARMED = T0 + 11_413;

describe('1 · the heartbeat counts the user\'s wait, and speaks on the call\'s silence', () => {
  it('the report: armed 11.4 s in, the first tick says 23s — not 11s', () => {
    vi.useFakeTimers();
    vi.setSystemTime(CALL_ARMED);
    const seen: string[] = [];
    const stop = startWorkingHeartbeat((ms) => seen.push(workingLine(ms)), { originMs: T0 });
    vi.advanceTimersByTime(WORKING_FIRST_MS - 1);
    expect(seen).toEqual([]); // WHEN is still the call's business: twelve seconds of its silence
    vi.advanceTimersByTime(1);
    expect(seen).toEqual(['⏳ Still working — 23s so far']);
    stop();
  });

  it('a slow turn ten minutes in continues the build clock — it never restarts at 12s', () => {
    vi.useFakeTimers();
    vi.setSystemTime(T0 + 300_000);
    const seen: string[] = [];
    const stop = startWorkingHeartbeat((ms) => seen.push(workingLine(ms)), { originMs: T0 });
    vi.advanceTimersByTime(WORKING_FIRST_MS + WORKING_INTERVAL_MS);
    expect(seen).toEqual(['⏳ Still working — 5m 12s so far', '⏳ Still working — 5m 27s so far']);
    stop();
  });

  it('the origin is the build\'s event stream — made when the request arrives, shared by every runner', () => {
    expect(new AgentEventStream(500, T0).startedAt).toBe(T0);
    const before = Date.now();
    expect(new AgentEventStream().startedAt).toBeGreaterThanOrEqual(before);
  });

  it('🔒 census: every heartbeat in the codebase is given the user\'s origin', () => {
    const ROOT = join(__dirname, '..');
    const walk = (d: string, out: string[] = []): string[] => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
      }
      return out;
    };
    const calls: string[] = [];
    for (const f of [...walk(join(ROOT, 'src')), join(ROOT, 'server.ts')]) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/startWorkingHeartbeat\(/g)) {
        if (/export function startWorkingHeartbeat\($/.test(src.slice(Math.max(0, m.index! - 30), m.index! + 22))) continue;
        calls.push(`${f.slice(ROOT.length + 1)}: ${src.slice(m.index!, m.index! + 400).includes('originMs: events.startedAt') ? 'ok' : 'NO ORIGIN'}`);
      }
    }
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.filter((c) => c.endsWith('NO ORIGIN'))).toEqual([]);
  });
});

describe('2 · live status is read by its id, everywhere', () => {
  it('the heartbeat and the ETA line are live status; real ⏳ progress is not', () => {
    expect(isLiveStatusLine({ id: WORKING_LINE_ID, text: workingLine(1) })).toBe(true);
    expect(isLiveStatusLine({ id: ETA_LINE_ID, text: '⏱️ Rough estimate: ~3–6 min' })).toBe(true);
    expect(isLiveStatusLine({ text: '⏳ Half the build time is used — finishing what is started.' })).toBe(false);
    expect(isLiveStatusLine({ text: '⏳ Not finished yet — I will keep going.' })).toBe(false);
    expect(isLiveStatusLine({ id: 'turn-3', text: 'Writing src/App.tsx' })).toBe(false);
  });

  it('the report files the heartbeat once, as a HEARTBEAT — and keeps real ⏳ progress every time', () => {
    const d = new BuildDiagnostics();
    for (let i = 1; i <= 3; i++) d.ingestEvent({ type: 'narration', agent: 'architect', text: workingLine(i * 15_000), ts: i, id: WORKING_LINE_ID } as never);
    d.ingestEvent({ type: 'narration', agent: 'architect', text: '⏳ Half the build time is used — finishing what is started.', ts: 10 } as never);
    d.ingestEvent({ type: 'narration', agent: 'architect', text: '⏳ Not finished yet — I will keep going.', ts: 11 } as never);
    const issues = d.report().issues;
    expect(issues.filter((i) => i.code === 'HEARTBEAT').map((i) => i.message)).toEqual([workingLine(15_000)]);
    expect(issues.filter((i) => i.code === 'AGENT_STEP').map((i) => i.message)).toEqual([
      '⏳ Half the build time is used — finishing what is started.',
      '⏳ Not finished yet — I will keep going.',
    ]);
  });

  it('a heartbeat tick is not activity: the silence is measured whole (56 s, not 44 s)', () => {
    // The 2b0a3ed5 shape: scaffold narration at 6.7 s, a heartbeat tick at 18.7 s, the next real line at 62.7 s.
    let now = 0;
    const d = new BuildDiagnostics({ now: () => now } as never);
    now = 6_700; d.ingestEvent({ type: 'narration', agent: 'architect', text: 'Setting up your workspace…', ts: now } as never);
    now = 18_700; d.ingestEvent({ type: 'narration', agent: 'architect', text: workingLine(18_700), ts: now, id: WORKING_LINE_ID } as never);
    now = 62_700; d.ingestEvent({ type: 'narration', agent: 'architect', text: 'Writing src/App.tsx', ts: now } as never);
    const gap = BuildDiagnostics.longestSilentGap(d.report().issues, 0, now);
    expect(gap?.seconds).toBe(56);
    expect(gap?.after).toBe('Setting up your workspace…');
  });
});

describe('3 · on screen, live status is NOW — or it is gone', () => {
  const line = (text: string, ts: number, id?: string) => ({ type: 'narration', agent: 'architect', text, ts, ...(id ? { id } : {}) }) as never;

  it('a later turn\'s tick moves the clock to the newest position; a streamed reply keeps its place', () => {
    let s = initialAgentV3State();
    s = agentV3Reducer(s, line('Setting up your workspace…', 1_000));
    s = agentV3Reducer(s, line(workingLine(23_413), 23_413, WORKING_LINE_ID));
    s = agentV3Reducer(s, line('Writing src/App.tsx', 60_000, 'turn-1'));
    s = agentV3Reducer(s, line('Updated the gallery', 300_000, 'turn-2'));
    s = agentV3Reducer(s, line(workingLine(327_000), 327_000, WORKING_LINE_ID));
    expect(s.narration.map((n) => n.text)).toEqual([
      'Setting up your workspace…', 'Writing src/App.tsx', 'Updated the gallery', '⏳ Still working — 5m 27s so far',
    ]);
    expect(s.narration.at(-1)!.ts).toBe(327_000);
    // The finalize-by-turn-id path is untouched: the reply is replaced IN PLACE.
    s = agentV3Reducer(s, line('Writing src/App.tsx — done', 330_000, 'turn-1'));
    expect(s.narration[1]!.text).toBe('Writing src/App.tsx — done');
    expect(s.narration[1]!.ts).toBe(60_000);
  });

  it('the thread shows the clock only while it is true', () => {
    const lines = [
      { text: 'Setting up…', id: undefined },
      { text: workingLine(23_000), id: WORKING_LINE_ID },
    ];
    expect(withoutStaleLiveStatus(lines, true).map((l) => l.text)).toEqual(['Setting up…', workingLine(23_000)]);
    // The call ended: something newer was said.
    expect(withoutStaleLiveStatus([...lines, { text: 'Writing src/App.tsx', id: 'turn-1' }], true).map((l) => l.text)).toEqual(['Setting up…', 'Writing src/App.tsx']);
    // The build stopped.
    expect(withoutStaleLiveStatus(lines, false).map((l) => l.text)).toEqual(['Setting up…']);
    // A saved thread from before the id existed is cleaned by the line's own words.
    expect(withoutStaleLiveStatus([{ text: '⏳ Still working — 11s so far' }], false)).toEqual([]);
  });

  it('🔒 the chat thread reads narration through that filter', () => {
    const panel = readFileSync(join(__dirname, '../src/components/agentv3/AgentV3Panel.tsx'), 'utf8');
    expect(panel).toContain('...withoutStaleLiveStatus(state.narration, running, lastActivityTs(state.activity)).map((n) => ({');
    // …and so does every flush of a finished turn into the thread's history: the build that produced the
    // clock is over, so a "⏳ Still working — 11s so far" must not ride into the next build's thread.
    expect(panel).not.toMatch(/\bstate\.narration\.map\(/);
    expect(panel.match(/withoutStaleLiveStatus\(state\.narration, false\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it('🔒 census: no client surface renders build narration without the filter', () => {
    const ROOT = join(__dirname, '..');
    const walk = (d: string, out: string[] = []): string[] => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.tsx$/.test(n) && !/\.test\.tsx$/.test(n)) out.push(p);
      }
      return out;
    };
    const bare = walk(join(ROOT, 'src/components'))
      .filter((f) => /\bstate\.narration\.(?:map|filter|forEach)\(/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(ROOT.length + 1));
    expect(bare).toEqual([]);
  });
});

describe('4 · the status bar counts from the user\'s Send, on this device', () => {
  it('a first activity arriving 11 s in does not move the origin', () => {
    const sent = 5_000_000;
    expect(buildElapsedMs({ startedAt: sent, running: true, now: sent + 23_400, firstActivityTs: 9_999_999_999 })).toBe(23_400);
  });

  it('it freezes where the build stopped, never resets', () => {
    expect(buildElapsedMs({ startedAt: 1_000, endedAt: 61_000, running: false, now: 999_999 })).toBe(60_000);
  });

  it('a re-attached or restored build, with no Send on this device, reads the server\'s own clock end to end', () => {
    expect(buildElapsedMs({ running: false, now: 0, firstActivityTs: 100_000, lastActivityTs: 160_000 })).toBe(60_000);
    expect(buildElapsedMs({ running: false, now: 0 })).toBe(0);
  });

  it('🔒 the Send stamps the origin, and the indicator reads it', () => {
    const hook = readFileSync(join(__dirname, '../src/hooks/useAgentV3Build.ts'), 'utf8');
    expect(hook).toContain('startedAt: Date.now(),');
    expect(hook).toContain('{ ...prev, endedAt: Date.now() }');
    const panel = readFileSync(join(__dirname, '../src/components/agentv3/AgentV3Panel.tsx'), 'utf8');
    expect(panel).not.toMatch(/activity\.length \? activity\[0\]\.ts : mountTsRef\.current/);
    expect(panel.match(/startedAt=\{state\.startedAt\} endedAt=\{state\.endedAt\}/g)?.length).toBe(panel.match(/<WorkingIndicator\b/g)?.length);
  });
});

describe('5 · 🔒 the corrections of the adversarial review', () => {
  const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');

  it('the origin is stamped as the build handler\'s FIRST statement, before any await of the preamble', () => {
    const at = route.indexOf("app.post('/api/agentv3/chat',");
    const body = route.slice(at, at + 4_000).replace(/\/\/.*$/gm, '');
    const firstAwait = body.search(/\bawait\s/);
    const stamp = body.indexOf('const requestArrivedAt = Date.now();');
    expect(stamp).toBeGreaterThan(0);
    expect(stamp).toBeLessThan(firstAwait);
    // Every stream the request path makes reads it — none falls back to its own construction time.
    const streams = [...route.matchAll(/new AgentEventStream\(([^)]*)\)/g)].map((m) => m[1]);
    expect(streams.length).toBeGreaterThanOrEqual(2);
    for (const args of streams) expect(args).toBe('500, requestArrivedAt');
    expect(route).toContain('originTs: requestArrivedAt,');
  });

  it('a re-attach tells the page how long the user has waited, as a duration, before the replay', () => {
    const at = route.indexOf("sub.write({ type: 'build_clock', startedAgoMs: Math.max(0, Date.now() - rb.originTs) });");
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(route.indexOf('for (const e of rb.buffer) sub.write(e);'));
  });

  it('a reconnect keeps this device\'s own Send; a reload takes the server\'s duration; nothing resets to 0', () => {
    expect(clockKeptOnReattach({ startedAt: 1_000 })).toEqual({ startedAt: 1_000 }); // in-page reconnect, still running
    expect(clockKeptOnReattach({ startedAt: 1_000, endedAt: 5_000 })).toEqual({}); // an earlier, finished build
    expect(clockKeptOnReattach({})).toEqual({});
    expect(clockFromAttach({}, 42_000, 100_000)).toEqual({ startedAt: 58_000, endedAt: undefined }); // reloaded page
    expect(clockFromAttach({ startedAt: 60_000 }, 42_000, 100_000)).toBeNull(); // this device's Send wins
    expect(clockFromAttach({}, 'x', 100_000)).toBeNull();
    // …and the clock it gives reads the real wait, not the time since the page came back.
    const c = clockFromAttach({}, 42_000, 100_000)!;
    expect(buildElapsedMs({ startedAt: c.startedAt, running: true, now: 100_000, firstActivityTs: 99_000 })).toBe(42_000);
  });

  it('🔒 the hook uses both, and the reset never stamps now', () => {
    const hook = readFileSync(join(__dirname, '../src/hooks/useAgentV3Build.ts'), 'utf8');
    expect(hook).toContain('...clockKeptOnReattach(prev),');
    expect(hook).toContain('clockFromAttach(prev, ago, Date.now())');
    const reset = hook.slice(hook.indexOf('...clockKeptOnReattach(prev),') - 600, hook.indexOf('...clockKeptOnReattach(prev),'));
    expect(reset).not.toMatch(/startedAt:\s*Date\.now\(\)/);
  });

  it('a tool-only turn (no prose) ends the clock it was timing — the next action hides it', () => {
    const tick = { id: WORKING_LINE_ID, text: '⏳ Still working — 27s so far', ts: 5_000 };
    const lines = [{ text: 'Planning the app', ts: 1_000 }, tick];
    expect(withoutStaleLiveStatus(lines, true, lastActivityTs([{ ts: 900 }, { ts: 4_000 }]))).toContain(tick);
    expect(withoutStaleLiveStatus(lines, true, lastActivityTs([{ ts: 900 }, { ts: 6_000 }]))).not.toContain(tick);
    // A history copy has no id: its words still identify it.
    expect(withoutStaleLiveStatus([{ text: '⏳ Still working — 27s so far', ts: 5_000 }], false)).toEqual([]);
  });

  it('the "waiting for your answer" line rides the ETA id: it is live status, newest, and gone once the build stops', () => {
    let st = initialAgentV3State();
    st = agentV3Reducer(st, { type: 'narration', agent: 'architect', text: '⏱️ Rough estimate: about 3 minutes', ts: 1_000, id: ETA_LINE_ID } as never);
    st = agentV3Reducer(st, { type: 'narration', agent: 'architect', text: 'Here is the plan.', ts: 2_000 } as never);
    st = agentV3Reducer(st, { type: 'narration', agent: 'architect', text: '⏸️ Waiting for your answer above…', ts: 3_000, id: ETA_LINE_ID } as never);
    expect(st.narration.map((n) => n.text)).toEqual(['Here is the plan.', '⏸️ Waiting for your answer above…']);
    expect(withoutStaleLiveStatus(st.narration, true).map((n) => n.text)).toContain('⏸️ Waiting for your answer above…');
    expect(withoutStaleLiveStatus(st.narration, false).map((n) => n.text)).toEqual(['Here is the plan.']);
  });

  it('🔒 both surfaces that render narration pass the latest action', () => {
    const panel = readFileSync(join(__dirname, '../src/components/agentv3/AgentV3Panel.tsx'), 'utf8');
    const mini = readFileSync(join(__dirname, '../src/components/ide/AgentV3MiniChat.tsx'), 'utf8');
    expect(panel).toContain('withoutStaleLiveStatus(state.narration, running, lastActivityTs(state.activity))');
    expect(mini).toContain('withoutStaleLiveStatus(state.narration, running, lastActivityTs(state.activity))');
  });

  it('the build-budget line is the BUILD\'s: two runners in one build say "half" once, at half the build', () => {
    const said = new Set<string>();
    const TOTAL = 1_800_000;
    // The main runner: 45% of the build, nothing yet; 50% → "half".
    expect(buildBudgetNarration(0.45 * TOTAL, TOTAL, said)).toBeNull();
    expect(buildBudgetNarration(0.5 * TOTAL, TOTAL, said)).toBe(BUDGET_NARRATION.half);
    expect(buildBudgetNarration(0.76 * TOTAL, TOTAL, said)).toBe(BUDGET_NARRATION.wrapping);
    // A retry runner started at 60% with the remaining 40%: its OWN half (80% of the build) must not say "half" again.
    expect(buildBudgetNarration(0.8 * TOTAL, TOTAL, said)).toBeNull();
    expect(buildBudgetNarration(0.91 * TOTAL, TOTAL, said)).toBe(BUDGET_NARRATION.final);
  });

  it('🔒 the runner narrates on the build\'s clock through the build-wide set; a sub-agent shares it', () => {
    const runner = readFileSync(join(__dirname, '../src/server/AgentV3/AgentRunner.ts'), 'utf8');
    expect(runner).toContain('buildBudgetNarration(Date.now() - origin, (buildStartMs - origin) + maxBuildMs, events.budgetStagesSaid)');
    expect(runner).not.toMatch(/text: bs\.narration/);
    const parent = new AgentEventStream(500, 1_000);
    const child = Object.create(parent) as AgentEventStream;
    child.budgetStagesSaid.add('half');
    expect(parent.budgetStagesSaid.has('half')).toBe(true);
    expect(child.startedAt).toBe(1_000);
  });
});
