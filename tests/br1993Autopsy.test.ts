/**
 * BR1993 — build-report autopsy (docs/build-report-autopsy-BR1993.md). Synthetic fixtures only; no customer payload.
 *
 * A first-attempt, free Weak/Surplus LARGE-scope build: the scope admission call and the mega-roadmap planner ran,
 * the roadmap message and a rough ETA were shown, then workspace setup refused to reconnect within about a second
 * (SANDBOX_RECOVERY_UNAVAILABLE). The report was written by code deployed BEFORE BR1983 (#4251) and BR1984 (#4254).
 * This file pins, on THIS report's shape, the main-branch facts those PRs shipped. No product code changes here.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { SandboxRecoveryUnavailableError, latestSettledAttemptWasSandboxRecoveryUnavailable, SANDBOX_RECOVERY_FIRST_MESSAGE, SANDBOX_RECOVERY_REPEAT_MESSAGE } from '../src/server/AgentV3/SandboxRecoveryError';
import { buildExceptionDetails } from '../src/server/AgentV3/BuildRequestCoordination';
import { BuildDiagnostics, userFacingReport } from '../src/server/AgentV3/BuildDiagnostics';
import { isTeachableBuild } from '../src/server/AgentV3/etaHistory';

const REASONS = ['identity-lookup', 'identity-unavailable', 'connect-unknown', 'allocation-unrecorded', 'allocation-lost', 'winner-reconnect'] as const;

function recordedRefusal(err: unknown) {
  const crash = buildExceptionDetails(err);
  const diag = new BuildDiagnostics({ now: () => 1 });
  diag.record({ phase: 'plan', severity: 'info', code: 'MEGA_ROADMAP_ACTIVE', message: 'Synthetic roadmap active', autoResolved: true });
  diag.record({ phase: crash.phase, severity: 'error', code: crash.code, message: crash.message, autoResolved: false, ...(crash.adminDetail ? { adminDetail: crash.adminDetail } : {}) });
  diag.record({ phase: 'sandbox', severity: 'error', code: 'OUTCOME_SANDBOX_UNAVAILABLE', message: 'Synthetic outcome', autoResolved: false });
  diag.finish(false, crash.summary);
  return { crash, report: diag.report() };
}

describe('E1 · the refusal now names its reason — for admins only (closed by BR1983, #4251)', () => {
  it.each(REASONS)('%s reaches adminDetail on the admin report and never the user view', (reason) => {
    const { crash, report } = recordedRefusal(new SandboxRecoveryUnavailableError(reason));
    expect(crash.code).toBe('SANDBOX_RECOVERY_UNAVAILABLE');
    expect(crash.message).toBe(SANDBOX_RECOVERY_FIRST_MESSAGE);
    expect(crash.message).not.toContain(reason);
    expect(crash.summary).not.toContain(reason);
    expect((crash as { detail?: string }).detail).toBeUndefined(); // a reason in `detail` would reach the user view
    const issue = report.issues.find((i) => i.code === 'SANDBOX_RECOVERY_UNAVAILABLE');
    expect(issue?.adminDetail).toBe(reason);
    expect(issue?.detail).toBeUndefined();
    expect(JSON.stringify(userFacingReport(report))).not.toContain(reason);
  });
  it('neighbour: a refusal with no reason records no adminDetail (nothing invented)', () => {
    const { report } = recordedRefusal(new SandboxRecoveryUnavailableError());
    expect(report.issues.find((i) => i.code === 'SANDBOX_RECOVERY_UNAVAILABLE')?.adminDetail).toBeUndefined();
  });
});

describe('E2 · the terminal outcome is a build-phase error whatever phase the caller passed', () => {
  it('OUTCOME_SANDBOX_UNAVAILABLE recorded as phase sandbox is normalised to build/error/unresolved', () => {
    const { report } = recordedRefusal(new SandboxRecoveryUnavailableError('connect-unknown'));
    const outcome = report.issues.find((i) => i.code === 'OUTCOME_SANDBOX_UNAVAILABLE');
    expect(outcome).toMatchObject({ phase: 'build', severity: 'error', autoResolved: false });
    expect(report.ok).toBe(false);
  });
});

describe('E3 · the retry after this refusal is told not to retry at once (closed by BR1984, #4254)', () => {
  const settledRefusal = { ok: false, endedAt: 2, summary: SANDBOX_RECOVERY_FIRST_MESSAGE, issues: [{ code: 'SANDBOX_RECOVERY_UNAVAILABLE' }] };
  it('the newest settled attempt being this refusal is a repeat; the repeat wording is not retryable', () => {
    expect(latestSettledAttemptWasSandboxRecoveryUnavailable([settledRefusal])).toBe(true);
    const repeat = new SandboxRecoveryUnavailableError('connect-unknown', { repeated: true });
    expect(repeat.message).toBe(SANDBOX_RECOVERY_REPEAT_MESSAGE);
    expect(repeat.retryable).toBe(false);
  });
  it('neighbours: in-progress rows are skipped; a user stop, a later success or an unreadable list are not a repeat', () => {
    expect(latestSettledAttemptWasSandboxRecoveryUnavailable([{ ok: false }, settledRefusal])).toBe(true);
    expect(latestSettledAttemptWasSandboxRecoveryUnavailable([{ ...settledRefusal, userStopped: true }])).toBe(false);
    expect(latestSettledAttemptWasSandboxRecoveryUnavailable([{ ok: true, endedAt: 3 }, settledRefusal])).toBe(false);
    expect(latestSettledAttemptWasSandboxRecoveryUnavailable(null)).toBe(false);
  });
});

describe('E4 · an 18-second setup failure never teaches the ETA', () => {
  it('a failed build is excluded even inside the sane duration window; a finished one of the same length teaches', () => {
    expect(isTeachableBuild({ startedAt: 1_000, endedAt: 19_000, ok: false })).toBe(false);
    expect(isTeachableBuild({ startedAt: 1_000, endedAt: 19_000, ok: true })).toBe(true);
  });
});

describe('E5 · the order this report shows is unchanged on main (residual, queued as Q-2705)', () => {
  it('the large-app planner still runs before the build clock and workspace setup', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    const planner = route.indexOf("code: 'MEGA_ROADMAP_ACTIVE'");
    const clock = route.indexOf('const buildStartedAt = Date.now();');
    expect(planner).toBeGreaterThan(0);
    expect(clock).toBeGreaterThan(planner);
    expect(route.indexOf("text: 'Setting up your workspace…'")).toBeGreaterThan(clock);
  });
});
