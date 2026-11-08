import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  reapAfterMs, buildFlagExpiryMs, touchIntervalMs, maxBuildMs, idleLimitMs,
  MISSED_TOUCHES_BEFORE_REAP, PAUSE_FAILURE_WARNING_THRESHOLD,
} from './sandboxReaper';


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

describe('pause failures warn without destructive escalation', () => {
  it('keeps the diagnostic threshold at three unconfirmed attempts', () => {
    expect(PAUSE_FAILURE_WARNING_THRESHOLD).toBe(3);
  });

  it('neither automatic sweep kills nor settles an unconfirmed pause', () => {
    const src = readFileSync(new URL('./sandbox/EngineerAI/actuators/E2BActuator.ts', import.meta.url), 'utf8');
    const start = src.indexOf('private async _sweepIdleSandboxes(');
    const end = src.indexOf('private _touchDurable(', start);
    const sweeps = src.slice(start, end);
    expect(sweeps).not.toMatch(/(?:this\.killSandbox|Sandbox\.kill)\(/);
    expect(sweeps).not.toContain('markPaused(');
    expect(sweeps).not.toContain('shouldMarkPausedAfterFailure');
    expect(sweeps).not.toContain('actionAfterPauseFailure');
    expect(src).toContain('SANDBOX_PAUSE_UNCONFIRMED');
    expect(src).not.toContain('SANDBOX_PAUSE_FAILED_KILLED');
    // Public/manual kill support is separate from unattended cost sweeping.
    expect(src).toContain('Sandbox.kill(sandboxId)');
  });
});
