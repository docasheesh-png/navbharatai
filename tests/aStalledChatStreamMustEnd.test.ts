import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  watchdogLimits,
  runWatchedStream,
  mayTryNextRung,
  awaitWithIdleBound,
  DEFAULT_FIRST_TOKEN_MS,
  DEFAULT_IDLE_MS,
  DEFAULT_HARD_CAP_MS,
  type WatchdogLimits,
} from '../src/server/AI/Router/streamWatchdog';

/**
 * 🔴 A STREAMED CHAT TURN COULD ONLY END IF THE USER CLOSED THE TAB (found 2026-09-17).
 *
 * `routeDetailed` has a wall clock (`TIMEOUT_MS`). `routeStream` had none, and `streamSequential`
 * awaited `p.executeStream(...)` with no bound at all — so a provider that accepted the connection
 * and then never spoke stalled the turn for ever, while `chat.ts`'s 20-second `: ping` keepalive —
 * written to stop a proxy closing an IDLE connection — actively held the dead turn open. The only
 * thing that could end it was `req.on('close')`.
 *
 * ⚠️ AND A CORRECT FIX INTRODUCED IT. Before the money audit of 2026-09-12 every universe RACED its
 * top two providers, and the race carried a 12-second commit timeout. Removing the race for FREE
 * (rightly — it billed two models on every turn) removed the only time bound on the path most users
 * are on. That is the "a fix must never trade one problem for another" rule, caught in the act.
 */

const L = (over: Partial<WatchdogLimits> = {}): WatchdogLimits =>
  ({ firstTokenMs: 30_000, idleMs: 30_000, hardCapMs: 180_000, ...over });

/** A controllable clock, so no test waits on a real timer. */
function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('watchdogLimits — the switch and the floors', () => {
  it('is ON by default, at the documented values', () => {
    expect(watchdogLimits({} as NodeJS.ProcessEnv)).toEqual({
      firstTokenMs: DEFAULT_FIRST_TOKEN_MS, idleMs: DEFAULT_IDLE_MS, hardCapMs: DEFAULT_HARD_CAP_MS,
    });
  });

  it('CHAT_STREAM_WATCHDOG=off restores the old unbounded behaviour exactly', () => {
    expect(watchdogLimits({ CHAT_STREAM_WATCHDOG: 'off' } as never)).toBeNull();
    expect(watchdogLimits({ CHAT_STREAM_WATCHDOG: 'OFF' } as never)).toBeNull();
    expect(watchdogLimits({ CHAT_STREAM_WATCHDOG: ' off ' } as never)).toBeNull();
    // Anything else is ON — a typo must not silently disable a safety bound.
    expect(watchdogLimits({ CHAT_STREAM_WATCHDOG: 'no' } as never)).not.toBeNull();
  });

  it('an unreadable value falls back to the default, never to "wait for ever"', () => {
    const l = watchdogLimits({ CHAT_STREAM_IDLE_MS: 'abc', CHAT_STREAM_FIRST_TOKEN_MS: '', CHAT_STREAM_HARD_CAP_MS: '-5' } as never)!;
    expect(l).toEqual({ firstTokenMs: DEFAULT_FIRST_TOKEN_MS, idleMs: DEFAULT_IDLE_MS, hardCapMs: DEFAULT_HARD_CAP_MS });
  });

  it('a too-small value is floored, so a mistyped env cannot cut off a healthy provider', () => {
    const l = watchdogLimits({ CHAT_STREAM_IDLE_MS: '10', CHAT_STREAM_FIRST_TOKEN_MS: '1', CHAT_STREAM_HARD_CAP_MS: '2' } as never)!;
    expect(l.idleMs).toBe(5_000);
    expect(l.firstTokenMs).toBe(5_000);
    expect(l.hardCapMs).toBe(30_000);
  });

  it('a real value is honoured', () => {
    expect(watchdogLimits({ CHAT_STREAM_IDLE_MS: '45000' } as never)!.idleMs).toBe(45_000);
  });
});

describe('runWatchedStream — bounded by SILENCE, not by duration', () => {
  it('a provider that never speaks is cut at the first-token bound', async () => {
    const c = clock();
    const chunks: string[] = [];
    const p = runWatchedStream(
      () => new Promise(() => { /* never settles — the reported hang */ }),
      (t) => chunks.push(t),
      L({ firstTokenMs: 30_000 }),
      c.now,
    );
    // Drive the poller's wall clock forward past the bound.
    await new Promise((r) => setTimeout(r, 0));
    c.advance(31_000);
    const w = await p;
    expect(w.verdict).toBe('first-token-timeout');
    expect(w.delivered).toBe(false);
    expect(chunks).toEqual([]);
  });

  it('a SLOW provider that keeps emitting is never cut off — the whole point', async () => {
    const c = clock();
    const got: string[] = [];
    // Emits one chunk every 20s of simulated time, for 10 chunks: far slower than the 30s idle bound
    // would allow if it were a TOTAL clock (200s > 180s hard cap would also trip a duration bound),
    // yet it never goes silent for 30s.
    const w = await runWatchedStream(
      async (cb) => { for (let i = 0; i < 5; i++) { c.advance(20_000); cb(`c${i}`); await new Promise((r) => setTimeout(r, 0)); } },
      (t) => got.push(t),
      L(),
      c.now,
    );
    expect(w.verdict).toBe('completed');
    expect(w.delivered).toBe(true);
    expect(got).toEqual(['c0', 'c1', 'c2', 'c3', 'c4']);
  });

  it('a provider that speaks and then hangs is cut at the IDLE bound, keeping what arrived', async () => {
    const c = clock();
    const got: string[] = [];
    const p = runWatchedStream(
      (cb) => { cb('hello'); return new Promise(() => { /* then hangs */ }); },
      (t) => got.push(t),
      L({ idleMs: 30_000 }),
      c.now,
    );
    await new Promise((r) => setTimeout(r, 0));
    c.advance(31_000);
    const w = await p;
    expect(w.verdict).toBe('idle-timeout');
    expect(w.delivered).toBe(true);
    expect(got).toEqual(['hello']); // the user keeps the text they were shown
  });

  it('a chunk arriving AFTER we gave up is dropped — two rungs never interleave', async () => {
    const c = clock();
    const got: string[] = [];
    let late!: (t: string) => void;
    const p = runWatchedStream(
      (cb) => { late = cb; return new Promise(() => {}); },
      (t) => got.push(t),
      L({ firstTokenMs: 30_000 }),
      c.now,
    );
    await new Promise((r) => setTimeout(r, 0));
    c.advance(31_000);
    await p;
    late('too late');
    expect(got).toEqual([]);
  });

  it('a provider error is a verdict, not a throw — the ladder already handles it', async () => {
    const w = await runWatchedStream(async () => { throw new Error('502'); }, () => {}, L());
    expect(w.verdict).toBe('failed');
    expect((w.error as Error)?.message).toBe('502');
  });

  it('a normal fast stream completes, unchanged', async () => {
    const got: string[] = [];
    const w = await runWatchedStream(async (cb) => { cb('a'); cb('b'); }, (t) => got.push(t), L());
    expect(w.verdict).toBe('completed');
    expect(got).toEqual(['a', 'b']);
  });

  it('an EMPTY completed stream is honest about having delivered nothing', async () => {
    const w = await runWatchedStream(async () => { /* resolves, says nothing */ }, () => {}, L());
    expect(w.verdict).toBe('completed');
    expect(w.delivered).toBe(false);
  });
});

describe('mayTryNextRung — the difference between "retry" and "end"', () => {
  it('nothing delivered ⇒ the next rung may answer, with nothing duplicated', () => {
    expect(mayTryNextRung({ verdict: 'first-token-timeout', delivered: false })).toBe(true);
    expect(mayTryNextRung({ verdict: 'failed', delivered: false })).toBe(true);
    expect(mayTryNextRung({ verdict: 'hard-cap', delivered: false })).toBe(true);
  });

  it('text already on screen ⇒ NEVER a second rung — it would repeat itself', () => {
    expect(mayTryNextRung({ verdict: 'idle-timeout', delivered: true })).toBe(false);
    expect(mayTryNextRung({ verdict: 'hard-cap', delivered: true })).toBe(false);
  });

  it('a completed stream is never retried, delivered or not', () => {
    expect(mayTryNextRung({ verdict: 'completed', delivered: true })).toBe(false);
    // An empty-but-completed stream is a provider that answered with nothing. Retrying it here would
    // double-bill on a turn that did not fail; the caller's own empty-answer handling owns that case.
    expect(mayTryNextRung({ verdict: 'completed', delivered: false })).toBe(false);
  });
});

describe('awaitWithIdleBound — the race path\'s half of the same rule', () => {
  it('a committed provider that hangs is cut at the idle bound', async () => {
    const c = clock();
    let last = 0;
    const p = awaitWithIdleBound(new Promise(() => {}), () => last, 0, L({ idleMs: 30_000 }), c.now);
    await new Promise((r) => setTimeout(r, 0));
    c.advance(31_000);
    await expect(p).resolves.toBe('idle-timeout');
  });

  it('a steadily-emitting committed provider is not cut until the hard cap', async () => {
    const c = clock();
    let last = 0;
    const p = awaitWithIdleBound(new Promise(() => {}), () => last, 0, L({ idleMs: 30_000, hardCapMs: 60_000 }), c.now);
    await new Promise((r) => setTimeout(r, 0));
    // It keeps speaking: silence never reaches 30s, but total time passes the 60s cap.
    for (let i = 0; i < 6; i++) { c.advance(10_000); last = c.now(); await new Promise((r) => setTimeout(r, 0)); }
    await expect(p).resolves.toBe('hard-cap');
  });

  it('a stream that finishes normally reports completed — including when it rejects', async () => {
    await expect(awaitWithIdleBound(Promise.resolve(), () => 0, 0, L())).resolves.toBe('completed');
    // A rejection is the CALLER's to classify (it already catches); this helper only decides waiting.
    await expect(awaitWithIdleBound(Promise.reject(new Error('x')), () => 0, 0, L())).resolves.toBe('completed');
  });
});

/** ⚠️ REVERSION GUARD — reads CODE with comments stripped. */
describe('both streaming paths are bounded, and "stalled" is not reported as a failure', () => {
  const code = readFileSync(join(__dirname, '../src/server/AI/Router/AIRouter.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('the SEQUENTIAL ladder runs each rung under the watchdog', () => {
    expect(code).toContain('runWatchedStream(');
    expect(code).toContain('mayTryNextRung(watched)');
  });

  it('the RACE path bounds its committed stream too (the sibling)', () => {
    expect(code).toContain('awaitWithIdleBound(committedStream');
    // The bare unbounded await must not be the only path any more.
    expect(code).not.toMatch(/if \(committed === p1\.name\) await s1\.catch/);
  });

  it('a stall keeps ok:true — the delivered answer is not retracted', () => {
    // A mid-stream stall is not a failed turn: the user has real text. Reporting ok:false would make
    // every reader downstream treat a partially-answered turn as broken.
    expect(code).toContain("reason: 'stalled'");
    expect(code).not.toContain("ok: false, provider: p.name");
  });

  it('a stall is logged under its OWN field, never as a failureReason', () => {
    // 🔴 CAUGHT IN REVIEW OF THIS VERY CHANGE. The streamed turn's usage row already wrote
    // `failureReason: outcome.reason`, so introducing 'stalled' would have filed a turn that
    // ANSWERED (ok: true, real text on screen) under a field whose name says it failed — and any
    // panel counting a present `failureReason` as a failure would have agreed. Same class as
    // `isAppFinding` and NEVER_ROOT_CAUSE, arriving through a field name rather than a code.
    const chat = readFileSync(join(__dirname, '../src/server/routes/chat.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(chat).toContain("outcome?.reason === 'stalled'");
    expect(chat).toContain('{ stalled: true }');
    // The old unconditional form must be gone: it is what made the name wrong.
    expect(chat).not.toMatch(/\.\.\.\(outcome\?\.reason \? \{ failureReason/);
    // …and a genuine failure reason still lands in the field that means failure.
    expect(chat).toContain('{ failureReason: outcome.reason }');
  });

  it('the kill switch reaches BOTH paths', () => {
    expect((code.match(/watchdogLimits\(\)/g) ?? []).length).toBe(2);
  });
});
