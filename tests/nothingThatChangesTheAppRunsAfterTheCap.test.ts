import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { finishingPassMayRun, capStoppedTheRun, finishingPassesHeldNote, recordFinishingPassesHeld, createFinishingPassGuard, FINISHING_PROOF_RESERVE_MS } from '../src/server/AgentV3/finishingPassesAtCap';
import { abortCauseOf } from '../src/server/AgentV3/buildAbortCause';

/**
 * Q-1069 (autopsy 398db9f3): after the 25-minute cap, 16 files were written into an app that could not be
 * re-opened ("nothing is known about whether they broke it"). The CLASS: a pass meant to be verified
 * afterwards runs when no verification is possible. Every pass that writes into the app on the finishing
 * path must ask `finishingPassMayRun(result)` first.
 */
describe('after the wall-clock cap, passes that change the app wait', () => {
  it('a capped run holds them; an ordinary or missing result does not', () => {
    expect(finishingPassMayRun({ timedOut: true })).toBe(false);
    expect(capStoppedTheRun({ timedOut: true })).toBe(true);
    expect(finishingPassMayRun({ timedOut: false })).toBe(true);
    expect(finishingPassMayRun({})).toBe(true);
    expect(finishingPassMayRun(null)).toBe(true);
  });

  it('the report line says what waited and why, and records at info', () => {
    expect(finishingPassesHeldNote(['a', 'b'])).toContain('a and b did not write into the app');
    const rows: Array<{ code: string; severity: string }> = [];
    recordFinishingPassesHeld({ record: (r) => { rows.push(r); } });
    expect(rows).toEqual([expect.objectContaining({ code: 'FINISHING_PASSES_HELD_AT_CAP', severity: 'info' })]);
  });

  it('the route gates BOTH finishing writers and records the hold', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain("importSweepEnabled() && finishingGuard.allow('unused-import-sweep')");
    expect(route).toContain("finishingGuard.allow('production-defaults')) {\n          await runInPass('production-defaults'");
    expect(route).toContain('recordFinishingPassesHeld(buildDiag);');
  });
});

describe('the live finishing guard preserves time to verify the app', () => {
  function fixture() {
    let left = 300_000;
    let stopped = false;
    let result: { timedOut?: boolean } = {};
    const notes: Array<{ message: string; code: string }> = [];
    const guard = createFinishingPassGuard({
      result: () => result, aborted: () => stopped, remainingMs: () => left,
      record: (note) => { notes.push(note); },
    });
    return { guard, notes, left: (ms: number) => { left = ms; }, stop: () => { stopped = true; }, result: (r: { timedOut?: boolean }) => { result = r; } };
  }

  it('uses the live signal even when a repair replaced the earlier timeout result', async () => {
    const f = fixture();
    f.result({ timedOut: true });
    expect(f.guard.allow('production-defaults')).toBe(false);
    f.result({ timedOut: false });
    f.stop();
    let wrote = false;
    expect(await f.guard.write('architecture-note', async () => { wrote = true; })).toBe(false);
    expect(wrote).toBe(false);
    expect(f.notes.at(-1)?.message).toContain('build has been stopped');
  });

  it('does not start optional writes after a read consumed their headroom', async () => {
    const f = fixture();
    expect(f.guard.allow('production-defaults')).toBe(true);
    await Promise.resolve().then(() => f.left(FINISHING_PROOF_RESERVE_MS));
    let wrote = false;
    await expect(f.guard.writeOrThrow('production-defaults', async () => { wrote = true; })).rejects.toThrow('deferred');
    expect(wrote).toBe(false);
  });

  it('re-checks every file in a pass, keeping completed writes and deferring the rest once', async () => {
    const f = fixture();
    const saved: string[] = [];
    for (const path of ['manifest.json', 'sw.js', 'index.html']) {
      await f.guard.writeOrThrow('production-defaults', async () => {
        saved.push(path);
        f.left(FINISHING_PROOF_RESERVE_MS - 1);
      }).catch(() => {});
    }
    expect(saved).toEqual(['manifest.json']);
    expect(f.notes).toHaveLength(1);
    expect(f.notes[0].message).toContain('Completed writes are kept');
    expect(f.notes[0].message).toContain('reserved for opening and verifying');
  });

  it('reads the repair budget at invocation, after analysis has spent time', async () => {
    const f = fixture();
    expect(f.guard.allow('design-consistency-heal')).toBe(true);
    f.left(200_000);
    const budgets: number[] = [];
    await f.guard.repair('design-consistency-heal', async (budget) => {
      budgets.push(budget);
      f.left(200_000 - budget);
      return { ok: true };
    });
    expect(budgets).toEqual([200_000 - FINISHING_PROOF_RESERVE_MS]);
    expect(f.guard.allow('production-defaults')).toBe(false);
    expect(f.guard.repairBudgetMs()).toBe(1); // exhausted finite clock must never disable a watchdog
  });

  it('never starts a repair at the proof boundary, at the wall, or after Stop', async () => {
    for (const remaining of [FINISHING_PROOF_RESERVE_MS, 0, -1, NaN]) {
      const f = fixture();
      f.left(remaining);
      let called = false;
      expect(await f.guard.repair('design-consistency-heal', async () => { called = true; return {}; })).toBeNull();
      expect(called).toBe(false);
    }
    const f = fixture();
    f.stop();
    expect(await f.guard.repair('design-consistency-heal', async () => { throw new Error('must not run'); })).toBeNull();
  });

  it('cancels an in-flight repair at its own deadline, leaving the preview reserve intact', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      let signal: AbortSignal | undefined;
      const run = f.guard.repair('design-consistency-heal', async (budget, ownSignal) => {
        expect(budget).toBe(300_000 - FINISHING_PROOF_RESERVE_MS);
        signal = ownSignal;
        return new Promise<void>((resolve) => ownSignal.addEventListener('abort', () => resolve(), { once: true }));
      });
      await vi.advanceTimersByTimeAsync(300_000 - FINISHING_PROOF_RESERVE_MS);
      await run;
      expect(signal?.aborted).toBe(true);
      expect(abortCauseOf(signal)).toBe('repair-budget');
    } finally { vi.useRealTimers(); }
  });

  it('passes a later user Stop through to the in-flight repair too', async () => {
    const parent = new AbortController();
    const guard = createFinishingPassGuard({ result: () => ({}), aborted: () => parent.signal.aborted,
      signal: parent.signal, remainingMs: () => Infinity, record: () => {} });
    let received: AbortSignal | undefined;
    const run = guard.repair('design-consistency-heal', async (_budget, signal) => {
      received = signal;
      return new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    });
    parent.abort('user requested stop');
    await run;
    expect(received?.reason).toBe('user requested stop');
  });

  it('preserves an explicitly disabled watchdog without overlooking Stop', async () => {
    const f = fixture();
    f.left(Infinity);
    expect(await f.guard.repair('design-consistency-heal', async (budget) => budget)).toBe(0);
    expect(f.guard.allow('production-defaults')).toBe(true);
    f.stop();
    expect(f.guard.allow('production-defaults')).toBe(false);
  });

  it('a broken note recorder cannot authorize a post-cap write', async () => {
    const guard = createFinishingPassGuard({ result: () => ({}), aborted: () => true, remainingMs: () => 0,
      record: () => { throw new Error('record unavailable'); } });
    expect(await guard.write('production-defaults', async () => { throw new Error('must not write'); })).toBe(false);
  });

  it('the actual writers use the guard and the optional repair cannot replace the build verdict', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    for (const pass of ['unused-import-sweep', 'single-file-kit-inline', 'e2e-scaffold', 'e2e-tsconfig-exclude', 'architecture-note', 'starter-tests', 'production-defaults']) {
      expect(route).toContain(`finishingGuard.writeOrThrow('${pass}'`);
    }
    const start = route.indexOf("const healed = await finishingGuard.repairOrThrow('design-consistency-heal'");
    expect(start).toBeGreaterThan(0);
    const heal = route.slice(start, route.indexOf('// The measurement the autopsy asked for', start));
    expect(heal).toContain('...baseRunnerOpts,\n                  maxBuildMs,');
    expect(heal).toContain('maxBuildMs,\n                  signal,');
    expect(heal).not.toMatch(/result\s*=\s*\{\s*\.\.\.healed/);
    // A deferred scaffold can be partial. Its build exclusion must already exist before any
    // create-only test file lands, so stopping midway cannot break the app's production typecheck.
    const scaffold = route.slice(route.indexOf('if (decision.scaffold) {'));
    expect(scaffold.indexOf("finishingGuard.writeOrThrow('e2e-tsconfig-exclude'")).toBeLessThan(scaffold.indexOf("finishingGuard.writeOrThrow('e2e-scaffold'"));
  });
});
