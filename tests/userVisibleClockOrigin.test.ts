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
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { startWorkingHeartbeat, workingLine, WORKING_FIRST_MS, WORKING_INTERVAL_MS } from '../src/server/AgentV3/workingHeartbeat';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import { isLiveStatusLine, withoutStaleLiveStatus, WORKING_LINE_ID, ETA_LINE_ID } from '../src/lib/liveStatusLine';
import { agentV3Reducer } from '../src/components/agentv3/agentV3Reducer';
import { initialAgentV3State } from '../src/components/agentv3/agentV3Types';
import { buildElapsedMs } from '../src/components/agentv3/buildClock';

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
    expect(panel).toContain('...withoutStaleLiveStatus(state.narration, running).map((n) => ({');
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
