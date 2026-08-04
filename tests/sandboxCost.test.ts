import { describe, it, expect } from 'vitest';
import { sandboxCost, describeSandboxCost, sandboxUsdPerHour } from '../src/server/AgentV3/sandboxCost';
import { userFacingReport, type BuildDiagnosticsReport } from '../src/server/AgentV3/BuildDiagnostics';

// Every v5 build runs a real cloud VM billed by WALL-CLOCK — a completely different cost shape from the
// token spend the report already tracked. A build that used almost no tokens but held a VM for forty
// minutes cost real money, and nothing in the product could show it: "why is the E2B bill this size?"
// had no answer. These tests are mostly about the two ways this could mislead — a made-up number, and
// our own infrastructure cost leaking onto a user's screen.

describe('what a build owed for its VM', () => {
  it('prices the measured time at the configured hourly rate', () => {
    const c = sandboxCost(3600, { E2B_USD_PER_HOUR: '0.20' });
    expect(c?.seconds).toBe(3600);
    expect(c?.usd).toBeCloseTo(0.2, 6);
  });

  it('is retunable from Cloud Run — the real rate depends on the plan and the template', () => {
    expect(sandboxUsdPerHour({ E2B_USD_PER_HOUR: '0.35' })).toBe(0.35);
    expect(sandboxUsdPerHour({})).toBe(0.10);
    expect(sandboxUsdPerHour({ E2B_USD_PER_HOUR: 'cheap' })).toBe(0.10); // rubbish keeps the default
  });

  it('always says the figure is an estimate', () => {
    // We cannot read our spend back from E2B, so this is a configured rate applied to a measured
    // duration. A number an admin might act on must not pretend to be an invoice.
    expect(sandboxCost(600, {})?.estimated).toBe(true);
  });
});

describe('rather than report a number we made up', () => {
  it('reports nothing when the duration is missing or nonsense', () => {
    for (const bad of [null, undefined, 0, -30, NaN, Infinity, 'ages']) {
      expect(sandboxCost(bad as unknown as number, {})).toBeNull();
    }
  });

  it('treats an absurd span as a broken clock, not a bill', () => {
    // No build legitimately holds a VM for a day. A wrong BIG number in a cost report is worse than an
    // honest silence — it is the one an admin would act on.
    expect(sandboxCost(86_401, {})).toBeNull();
    expect(sandboxCost(86_000, {})).not.toBeNull();
  });

  it('says "not measured" in the report line, not "$0.00"', () => {
    expect(describeSandboxCost(null)).toContain('not measured');
    expect(describeSandboxCost(null)).not.toContain('$');
  });
});

describe('the line an admin actually reads', () => {
  it('shows the time and the estimated cost', () => {
    const line = describeSandboxCost(sandboxCost(1800, { E2B_USD_PER_HOUR: '0.10' }));
    expect(line).toContain('30.0 min');
    expect(line).toContain('estimated');
  });

  it('calls out the part that was pure idle — the actionable half', () => {
    // A VM that outlived its build is a reaper/idle problem, not a model problem. Naming the split is
    // what turns the number into a decision.
    const line = describeSandboxCost(sandboxCost(1800, {}), 300); // 30 min held, 5 min building
    expect(line).toContain('25.0 min of it after the build finished');
  });

  it('says nothing about idle when the VM did not outlive the build', () => {
    expect(describeSandboxCost(sandboxCost(300, {}), 300)).not.toContain('after the build finished');
    expect(describeSandboxCost(sandboxCost(300, {}), 0)).not.toContain('after the build finished');
  });
});

describe('it is OUR cost, never the user’s', () => {
  it('is stripped from the user-facing report by construction', () => {
    // The user is charged by the real-cost + markup model; our VM spend is not a line item they should
    // ever see (White-Label Law §3). userFacingReport is an allow-list, so this holds without anyone
    // remembering to exclude it — the test states the guarantee.
    const report = {
      schema: 1, startedAt: 1, counts: { errors: 0, warnings: 0, autoResolved: 0, unresolved: 0 },
      issues: [], problems: [],
      sandboxCost: { seconds: 1800, usd: 0.05, estimated: true },
    } as unknown as BuildDiagnosticsReport;
    expect(userFacingReport(report).sandboxCost).toBeUndefined();
  });
});
