import { describe, it, expect } from 'vitest';
import {
  sandboxesToReap, idleLimitMs, maxBuildMs, reapAfterMs, touchIntervalMs, shouldTouchDurable,
  type ReapableSandbox,
} from '../src/server/AgentV3/sandboxReaper';

// Every v5 build runs a real E2B cloud VM, billed by wall-clock. Two things were costing money:
//
//  1. The sandbox was kept alive for 45 idle minutes after a build that typically takes five — about
//     nine times more idle VM than working VM, much of it for someone who had closed the tab.
//  2. Worse: the idle sweep read an IN-MEMORY map on one Cloud Run instance. Cloud Run recycles
//     instances and NavBharatAI redeploys on every merge, so any sandbox whose instance went away
//     became invisible to the sweep and billed until E2B's own 60-minute lifetime expired.
//
// The reaper below works from the DURABLE record instead. The tests are mostly about the ONE thing it
// must never do: pause a sandbox a build is still using.

const MIN = 60_000;
const T0 = Date.parse('2026-07-28T12:00:00.000Z');
const rec = (id: string, ageMinutes: number): ReapableSandbox =>
  ({ workspaceId: `ws-${id}`, sandboxId: id, updatedAt: T0 - ageMinutes * MIN });

describe('the defaults', () => {
  it('idles for 5 minutes — 45 → 15 → 5, each from a measured bill', () => {
    // 5 is only safe because the in-memory sweep now SKIPS a workspace with a build in flight
    // (E2BActuator.setBuildActive). Idle is measured from the last sandbox operation, and a long model
    // call is not one — without that hold, five minutes would pause live builds. See
    // tests/sandboxIdleBuildAware.test.ts, which holds the two halves together.
    expect(idleLimitMs({})).toBe(5 * MIN);
  });

  it('every threshold is retunable from Cloud Run without a deploy', () => {
    expect(idleLimitMs({ AGENTV3_SANDBOX_IDLE_MINUTES: '20' })).toBe(20 * MIN);
    expect(maxBuildMs({ AGENTV3_MAX_BUILD_SECONDS: '600' })).toBe(10 * MIN);
  });

  it('ignores rubbish and keeps the safe default', () => {
    expect(idleLimitMs({ AGENTV3_SANDBOX_IDLE_MINUTES: 'soon' })).toBe(5 * MIN);
    expect(idleLimitMs({ AGENTV3_SANDBOX_IDLE_MINUTES: '-5' })).toBe(5 * MIN);
    expect(maxBuildMs({ AGENTV3_MAX_BUILD_SECONDS: 'lots' })).toBe(30 * MIN);
  });
});

describe('the reaper can never reach a running build', () => {
  it('waits out a whole max-length build plus a margin, not just the idle limit', () => {
    // 30-minute build ceiling + 10-minute margin = 40 minutes, far past the 5-minute idle limit. The
    // durable reaper deliberately does NOT follow the idle window down: it catches sandboxes orphaned
    // by an instance recycle, where no in-memory build hold survives to protect a running build.
    expect(reapAfterMs({})).toBe(40 * MIN);
    expect(reapAfterMs({})).toBeGreaterThan(idleLimitMs({}));
    expect(reapAfterMs({})).toBeGreaterThan(maxBuildMs({}));
  });

  it('follows the admin raising the build ceiling — the margin moves with it', () => {
    // If a build may legally run 90 minutes, the reaper must not fire at 40.
    const env = { AGENTV3_MAX_BUILD_SECONDS: String(90 * 60) };
    expect(reapAfterMs(env)).toBe(100 * MIN);
  });

  it('never reaps a record younger than the longest legal build', () => {
    for (const ageMinutes of [0, 1, 5, 15, 29, 30, 39]) {
      expect(sandboxesToReap([rec('s', ageMinutes)], T0, {}), `age ${ageMinutes}m`).toHaveLength(0);
    }
  });

  it('reaps once the record is genuinely older than that', () => {
    expect(sandboxesToReap([rec('s', 41)], T0, {})).toHaveLength(1);
    expect(sandboxesToReap([rec('s', 180)], T0, {})[0].sandboxId).toBe('s');
  });
});

describe('the orphans this exists for', () => {
  it('catches a sandbox left behind by a recycled instance — hours old, nothing pausing it', () => {
    // This is the deploy case: the instance that made it is gone, so the in-memory sweep will never
    // see it again. Without the reaper it bills until E2B's own lifetime expires.
    const orphans = [rec('orphan-a', 55), rec('orphan-b', 200)];
    expect(sandboxesToReap(orphans, T0, {})).toHaveLength(2);
  });

  it('picks only the stale ones out of a mixed list', () => {
    const reaped = sandboxesToReap([rec('fresh', 2), rec('stale', 90), rec('building', 20)], T0, {});
    expect(reaped.map((r) => r.sandboxId)).toEqual(['stale']);
  });
});

describe('a broken record is left alone rather than guessed at', () => {
  it('never reaps a sandbox whose age is unknown', () => {
    // Leaving one VM running costs a little and is bounded by E2B's own lifetime. Pausing a live build
    // is a broken app for a real user, so an unreadable timestamp always resolves to "leave it".
    const broken = [
      { workspaceId: 'w', sandboxId: 's1', updatedAt: NaN },
      { workspaceId: 'w', sandboxId: 's2', updatedAt: 0 },
      { workspaceId: 'w', sandboxId: 's3', updatedAt: -1 },
      { workspaceId: 'w', sandboxId: 's4', updatedAt: undefined as unknown as number },
    ];
    expect(sandboxesToReap(broken, T0, {})).toHaveLength(0);
  });

  it('skips a record with no sandbox id', () => {
    expect(sandboxesToReap([{ workspaceId: 'w', sandboxId: '', updatedAt: T0 - 200 * MIN }], T0, {})).toHaveLength(0);
  });

  it('a future timestamp is not reaped either', () => {
    expect(sandboxesToReap([rec('s', -60)], T0, {})).toHaveLength(0);
  });

  it('survives an empty or absent list', () => {
    expect(sandboxesToReap([], T0, {})).toEqual([]);
    expect(sandboxesToReap(null as unknown as ReapableSandbox[], T0, {})).toEqual([]);
  });
});

describe('a sandbox already paused is left alone', () => {
  // Without this the sweep would re-pause the same dead record every two minutes, forever: E2B refuses
  // to pause an already-paused sandbox, so the attempt fails, nothing changes, and it comes back around
  // on the next tick. The record itself is deliberately kept — the sandbox still exists and a returning
  // user resumes it by id; only its compute was stopped.
  it('skips a record paused since its last use', () => {
    const rec = { workspaceId: 'w', sandboxId: 's', updatedAt: T0 - 90 * MIN, pausedAt: T0 - 50 * MIN };
    expect(sandboxesToReap([rec], T0, {})).toHaveLength(0);
  });

  it('reaps again once the sandbox was used AFTER that pause', () => {
    // The user came back, resumed it, and abandoned it a second time.
    const rec = { workspaceId: 'w', sandboxId: 's', updatedAt: T0 - 50 * MIN, pausedAt: T0 - 90 * MIN };
    expect(sandboxesToReap([rec], T0, {})).toHaveLength(1);
  });

  it('ignores a pausedAt that is missing or unreadable', () => {
    const stale = T0 - 90 * MIN;
    const records = [
      { workspaceId: 'w', sandboxId: 'a', updatedAt: stale },
      { workspaceId: 'w', sandboxId: 'b', updatedAt: stale, pausedAt: NaN },
      { workspaceId: 'w', sandboxId: 'c', updatedAt: stale, pausedAt: 0 },
    ];
    expect(sandboxesToReap(records, T0, {}).map((r) => r.sandboxId)).toEqual(['a', 'b', 'c']);
  });
});

describe('keeping a live build looking alive', () => {
  // The durable record used to be written only when a build FINISHED, so `updatedAt` meant "last
  // released" and a build in progress was indistinguishable from one abandoned an hour ago. Refreshing
  // it during the build is what makes the timestamp mean what the reaper reads it as.
  it('refreshes about once every five minutes, not on every file write', () => {
    expect(touchIntervalMs({})).toBe(5 * MIN);
    expect(shouldTouchDurable(T0 - 1 * MIN, T0, {})).toBe(false);
    expect(shouldTouchDurable(T0 - 5 * MIN, T0, {})).toBe(true);
    expect(shouldTouchDurable(T0 - 30 * MIN, T0, {})).toBe(true);
  });

  it('always refreshes a workspace it has never stamped', () => {
    expect(shouldTouchDurable(null, T0, {})).toBe(true);
    expect(shouldTouchDurable(undefined, T0, {})).toBe(true);
    expect(shouldTouchDurable(NaN, T0, {})).toBe(true);
  });

  it('refreshes rather than trusting a timestamp from the future', () => {
    // A clock adjustment must not be able to freeze the refresh and let the reaper see a live build as
    // abandoned — the cheap write is always the safe answer here.
    expect(shouldTouchDurable(T0 + 60 * MIN, T0, {})).toBe(true);
  });

  it('is retunable without a deploy, and holds the safe default against rubbish', () => {
    expect(touchIntervalMs({ AGENTV3_SANDBOX_TOUCH_MINUTES: '2' })).toBe(2 * MIN);
    expect(touchIntervalMs({ AGENTV3_SANDBOX_TOUCH_MINUTES: 'often' })).toBe(5 * MIN);
    expect(touchIntervalMs({ AGENTV3_SANDBOX_TOUCH_MINUTES: '0' })).toBe(5 * MIN);
  });

  it('refreshes far more often than the reaper waits — the safety margin, stated as a test', () => {
    expect(touchIntervalMs({})).toBeLessThan(reapAfterMs({}) / 4);
  });
});
