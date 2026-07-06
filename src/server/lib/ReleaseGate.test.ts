import { describe, it, expect } from 'vitest';
import { evaluateReleaseGate, normalizeGateConfig, OPEN_GATE, type ReleaseGateConfig } from './ReleaseGate';

const NOW = 1_800_000_000_000;

describe('evaluateReleaseGate', () => {
  it('allows deploy with no config (opt-in, defaults open)', () => {
    expect(evaluateReleaseGate(null, NOW).allowed).toBe(true);
    expect(evaluateReleaseGate(OPEN_GATE, NOW).allowed).toBe(true);
  });

  it('blocks during an active freeze and surfaces the reason', () => {
    const d = evaluateReleaseGate({ frozen: true, approvalRequired: false, freezeReason: 'prod incident' }, NOW);
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain('prod incident');
  });

  it('honors freeze auto-expiry', () => {
    const cfg: ReleaseGateConfig = { frozen: true, approvalRequired: false, freezeUntilMs: NOW - 1 };
    expect(evaluateReleaseGate(cfg, NOW).allowed).toBe(true); // expired
    expect(evaluateReleaseGate({ ...cfg, freezeUntilMs: NOW + 1000 }, NOW).allowed).toBe(false); // still active
  });

  it('requires the candidate SHA to match the approved SHA', () => {
    const cfg: ReleaseGateConfig = { frozen: false, approvalRequired: true, approvedSha: 'abc123def456' };
    expect(evaluateReleaseGate(cfg, NOW, 'abc123def456').allowed).toBe(true);
    expect(evaluateReleaseGate(cfg, NOW, 'abc123').allowed).toBe(true); // prefix match (short vs full)
    expect(evaluateReleaseGate(cfg, NOW, 'deadbeef').allowed).toBe(false);
  });

  it('blocks when approval is required but nothing is approved yet', () => {
    const d = evaluateReleaseGate({ frozen: false, approvalRequired: true }, NOW, 'abc123');
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/no commit has been approved/i);
  });

  it('freeze takes precedence over an otherwise-approved commit', () => {
    const cfg: ReleaseGateConfig = { frozen: true, approvalRequired: true, approvedSha: 'abc' };
    expect(evaluateReleaseGate(cfg, NOW, 'abc').allowed).toBe(false);
  });
});

describe('normalizeGateConfig', () => {
  it('coerces an untrusted object to a safe config', () => {
    const c = normalizeGateConfig({ frozen: 'yes', approvalRequired: true, approvedSha: '  abc  ', freezeUntilMs: 'x', junk: 1 });
    expect(c.frozen).toBe(false); // only boolean true counts
    expect(c.approvalRequired).toBe(true);
    expect(c.approvedSha).toBe('abc');
    expect(c.freezeUntilMs).toBeUndefined();
  });
  it('defaults to a fully-open gate', () => {
    expect(normalizeGateConfig(undefined)).toEqual({ frozen: false, approvalRequired: false });
  });
});
