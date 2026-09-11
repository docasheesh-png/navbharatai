import { describe, it, expect } from 'vitest';
import {
  reapAfterMs, buildFlagExpiryMs, touchIntervalMs, maxBuildMs, idleLimitMs,
  MISSED_TOUCHES_BEFORE_REAP, countLiveSandboxes,} from './sandboxReaper';


describe('the orphan window was left behind by its own fix (admin E2B bill, 2026-08-24)', () => {
  /**
   * `reapAfterMs` was `maxBuildMs + 10 min` — FORTY minutes — and the reason is written in
   * `touchIntervalMs`'s own comment: the durable record used to be written only when a build FINISHED,
   * so it could not tell a running build from an abandoned one, and the only safe cut-off was a whole
   * build-length away. That was fixed — a live build now stamps the record every few minutes — and the
   * cut-off it existed to compensate for was never lowered.
   *
   * Every Cloud Run deploy orphans whatever was running, on a machine costing $0.083/hour.
   */
  it('derives the window from the TOUCH interval, not the build cap', () => {
    const env = {} as NodeJS.ProcessEnv;
    expect(reapAfterMs(env)).toBe(touchIntervalMs(env) * MISSED_TOUCHES_BEFORE_REAP + 5 * 60_000);
    expect(reapAfterMs(env)).toBeLessThan(maxBuildMs(env)); // the whole point: no longer build-length
  });

  it('is halved from the forty minutes it used to be', () => {
    expect(reapAfterMs({} as NodeJS.ProcessEnv)).toBe(20 * 60_000);
  });

  it('never drops below the idle limit', () => {
    // A shorter touch interval must not make the orphan net tighter than the precise in-memory sweep.
    const env = { AGENTV3_SANDBOX_TOUCH_MINUTES: '1', AGENTV3_SANDBOX_IDLE_MINUTES: '30' } as never;
    expect(reapAfterMs(env)).toBe(idleLimitMs(env));
  });

  it('still gives a live build three missed stamps before doubting it', () => {
    const env = {} as NodeJS.ProcessEnv;
    expect(reapAfterMs(env)).toBeGreaterThan(touchIntervalMs(env) * 2);
  });
});

describe('the build-in-flight flag is a DIFFERENT question — do not re-merge them', () => {
  /**
   * These were one function until 2026-08-24. Shortening the orphan window would silently have
   * shortened the flag too — the one change in this file that can break a RUNNING build, because a long
   * model call performs no sandbox operation and the 5-minute sweep would then pause the machine
   * mid-build.
   */
  it('outlasts the longest build that may legally run', () => {
    const env = {} as NodeJS.ProcessEnv;
    expect(buildFlagExpiryMs(env)).toBeGreaterThan(maxBuildMs(env));
  });

  it('is UNCHANGED by the orphan-window reduction', () => {
    expect(buildFlagExpiryMs({} as NodeJS.ProcessEnv)).toBe(40 * 60_000);
    expect(buildFlagExpiryMs({} as NodeJS.ProcessEnv)).toBeGreaterThan(reapAfterMs({} as NodeJS.ProcessEnv));
  });

  it('still expires, so a crashed build cannot pin its VM forever', () => {
    const env = { AGENTV3_MAX_BUILD_SECONDS: '600' } as never;
    expect(buildFlagExpiryMs(env)).toBe(600_000 + 10 * 60_000);
    expect(Number.isFinite(buildFlagExpiryMs(env))).toBe(true);
  });
});

/**
 * 🔴 THE TILE THAT OVERSTATED, AND NEARLY COST MONEY BY DOING IT (admin report 2026-09-11).
 *
 * The Monitor's "Live sandboxes" tile counted every record without a `pausedAt` stamp and read **18**,
 * while E2B's own dashboard — the only thing that decides the bill — showed **2**. Sixteen ghosts.
 *
 * `pausedAt` is written only when OUR reaper pauses a sandbox, so a sandbox E2B ended on its own
 * lifetime, a pause that failed, and a record `sandboxesToReap` refuses to touch ("unknown age → never
 * reap") all leave a record that is not paused, not running, and counted forever.
 *
 * Reading 18, the admin was about to switch OFF `AGENTV3_SANDBOX_RESUME` to save money — the one flag
 * that lets the orphan sweep pause anything at all, so it would have RAISED the bill. That is the real
 * cost of a dashboard that overstates, and it is what these tests exist to prevent.
 */
describe('countLiveSandboxes — only what we can honestly call running', () => {
  const NOW = 1_700_000_000_000;
  const fresh = NOW - 60_000;            // a minute ago: a live sandbox touches its record every ~5 min
  const ancient = NOW - 6 * 60 * 60_000; // six hours ago, the gap in the report

  it('🔒 REPLAYS THE REPORT: two fresh, sixteen ancient ⇒ 2, not 18', () => {
    const records = [
      ...Array.from({ length: 2 }, (_, i) => ({ sandboxId: `live${i}`, updatedAt: fresh })),
      ...Array.from({ length: 16 }, (_, i) => ({ sandboxId: `ghost${i}`, updatedAt: ancient })),
    ];
    expect(countLiveSandboxes(records, NOW)).toBe(2);
  });

  it('a paused record never counts, however fresh its stamp', () => {
    expect(countLiveSandboxes([{ sandboxId: 's', updatedAt: fresh, pausedAt: fresh }], NOW)).toBe(0);
  });

  it('🔒 unknown age is NOT evidence of running — the reaper skips it, and so does the count', () => {
    // sandboxesToReap deliberately never touches these, so they can never acquire a pausedAt stamp.
    // Counting them as "running now, billed by the minute" is the exact claim we cannot support.
    for (const bad of [undefined, null, 0, -1, NaN, 'nonsense']) {
      expect(countLiveSandboxes([{ sandboxId: 's', updatedAt: bad as never }], NOW), String(bad)).toBe(0);
    }
  });

  it('the boundary is the reaper\'s own window, so a sandbox is never dropped while still reapable', () => {
    const edge = NOW - reapAfterMs({} as NodeJS.ProcessEnv);
    expect(countLiveSandboxes([{ sandboxId: 's', updatedAt: edge }], NOW)).toBe(1);
    expect(countLiveSandboxes([{ sandboxId: 's', updatedAt: edge - 1 }], NOW)).toBe(0);
  });

  it('survives an empty or malformed list rather than breaking the Monitor', () => {
    expect(countLiveSandboxes([], NOW)).toBe(0);
    expect(countLiveSandboxes(null as never, NOW)).toBe(0);
    expect(countLiveSandboxes([null as never, undefined as never], NOW)).toBe(0);
  });
});
