/**
 * A STALE HANDLE IS NOT AN OUTAGE (autopsy a9f8d186, 2026-09-30).
 *
 * Setup's first operation hit a sandbox E2B had already let go ("The sandbox was not found: This error
 * is likely due to sandbox timeout…"). The route set `sandboxUnavailable` and never looked again. The
 * same build then ran npm in that sandbox, started the dev server, and watched the app render in a
 * real browser — and still ended "The build could not run — the sandbox was unavailable", ok:false,
 * release gate RED on "1 build-breaking blocker", free.
 *
 * The class: a fact measured once at setup is read as the verdict of the whole build. Three locks:
 * setup recovers from a dead handle like every other operation; the verdict is re-judged on what ran;
 * a sandbox-phase issue is never an app finding.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { E2BActuator } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator';
import { sandboxServedTheBuild, sandboxWasUnavailable } from '../src/server/AgentV3/sandboxAvailability';
import { isAppFinding, BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

const REPORT_ERROR = 'The sandbox was not found: This error is likely due to sandbox timeout. You can modify the sandbox timeout by passing \'timeoutMs\' when starting the sandbox or calling \'.setTimeout\' on the sandbox with the desired timeout.';

function healthySandbox(written: string[]) {
  let dirMade = false;
  return {
    files: {
      exists: async () => dirMade,
      makeDir: async () => { dirMade = true; },
      writeFiles: async (files: Array<{ path: string }>) => { written.push(...files.map((f) => f.path)); },
    },
  };
}
const corpse = { files: { exists: async () => { throw new Error(REPORT_ERROR); } } };

function actuatorServing(sequence: unknown[]): { act: E2BActuator; calls: () => number } {
  const act = new E2BActuator('test-key');
  const a = act as unknown as Record<string, unknown>;
  let n = 0;
  a.getSandbox = async () => sequence[Math.min(n++, sequence.length - 1)];
  a._kickoffPlaywright = () => { /* no browser install in a unit test */ };
  return { act, calls: () => n };
}

describe('setup recovers from a dead handle', () => {
  it('🔴 the report case: the cached corpse is dropped and setup completes on the next machine', async () => {
    const written: string[] = [];
    const { act, calls } = actuatorServing([corpse, healthySandbox(written)]);
    await expect(act.ensureWorkspace('ws-a9f8', 'vite-react')).resolves.toBeUndefined();
    expect(calls()).toBe(2);
    expect(written.some((p) => p.endsWith('src/App.tsx'))).toBe(true);
  });

  it('a failure that is not a dead sandbox is not retried', async () => {
    const odd = { files: { exists: async () => { throw new Error('permission denied'); } } };
    const { act, calls } = actuatorServing([odd, healthySandbox([])]);
    await expect(act.ensureWorkspace('ws-odd')).rejects.toThrow('permission denied');
    expect(calls()).toBe(1);
  });

  it('it retries ONCE: a sandbox that is really gone still fails honestly', async () => {
    const { act, calls } = actuatorServing([corpse, corpse, corpse]);
    await expect(act.ensureWorkspace('ws-gone')).rejects.toThrow('not found');
    expect(calls()).toBe(2);
  });
});

describe('the verdict is judged on what ran, not on the setup attempt', () => {
  it('🔴 the report case: npm ran (exit 0) and the app rendered ⇒ not unavailable', () => {
    const evidence = { commands: [{ exitCode: null }, { exitCode: 1 }, { exitCode: 0 }], appRendered: true };
    expect(sandboxServedTheBuild(evidence)).toBe(true);
    expect(sandboxWasUnavailable(true, evidence)).toBe(false);
  });

  it('a command that failed with a real exit code still ran there', () => {
    expect(sandboxWasUnavailable(true, { commands: [{ exitCode: 2 }] })).toBe(false);
  });

  it('exit -1 (never ran) and an uncaptured code are NOT evidence', () => {
    expect(sandboxWasUnavailable(true, { commands: [{ exitCode: -1 }, { exitCode: null }, {}] })).toBe(true);
    expect(sandboxWasUnavailable(true, { commands: [] })).toBe(true);
    expect(sandboxWasUnavailable(true, {})).toBe(true);
  });

  it('a setup that succeeded is never unavailable', () => {
    expect(sandboxWasUnavailable(false, {})).toBe(false);
  });

  it('WIRING: the route re-judges the flag before any verdict reads it', () => {
    const src = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    const rejudge = src.indexOf('if (!sandboxWasUnavailable(true, servedEvidence))');
    expect(rejudge).toBeGreaterThan(0);
    expect(rejudge).toBeLessThan(src.indexOf('const verifiedNoChange = verifiedNoChangeSummary({'));
    expect(rejudge).toBeLessThan(src.indexOf('const emptyFail = emptyBuildFailureSummary('));
    expect(rejudge).toBeLessThan(src.indexOf('!sandboxUnavailable &&\n        !costCeilingFired'));
    expect(src).toContain("buildDiag.resolveOnRecheck('SANDBOX_UNAVAILABLE')");
  });
});

describe('a sandbox that could not be set up is never a finding about the app', () => {
  it('the setup error and its outcome are excluded, by phase and by code', () => {
    expect(isAppFinding({ phase: 'sandbox', code: 'SANDBOX_UNAVAILABLE' })).toBe(false);
    expect(isAppFinding({ phase: 'sandbox', code: 'ANY_FUTURE_SANDBOX_CODE' })).toBe(false);
    expect(isAppFinding({ phase: 'build', code: 'OUTCOME_SANDBOX_UNAVAILABLE' })).toBe(false);
    expect(isAppFinding({ phase: 'build', code: 'TYPECHECK_FAILED' })).toBe(true);
  });

  it('the release gate count does not include it', () => {
    const d = new BuildDiagnostics();
    d.record({ phase: 'sandbox', severity: 'error', code: 'SANDBOX_UNAVAILABLE', autoResolved: false, message: 'x' });
    expect(d.shippingIssueCount('error')).toBe(0);
  });
});
