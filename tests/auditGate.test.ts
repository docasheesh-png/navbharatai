import { describe, it, expect } from 'vitest';
import { evaluateAudit } from '../scripts/auditGate.mjs';

function audit(vulns: Record<string, { severity: string }>) {
  return { vulnerabilities: vulns, metadata: { vulnerabilities: { high: 0, critical: 0 } } };
}

describe('audit-gate (P-TQA.7)', () => {
  it('passes when there are no high/critical vulns', () => {
    const r = evaluateAudit(audit({ lodash: { severity: 'moderate' }, ms: { severity: 'low' } }), new Set());
    expect(r.ok).toBe(true);
    expect(r.blocking).toHaveLength(0);
  });

  it('BLOCKS a new high vuln that is not allowlisted', () => {
    const r = evaluateAudit(audit({ evilpkg: { severity: 'high' } }), new Set());
    expect(r.ok).toBe(false);
    expect(r.blocking).toEqual([{ name: 'evilpkg', severity: 'high' }]);
  });

  it('BLOCKS a critical vuln', () => {
    const r = evaluateAudit(audit({ boom: { severity: 'critical' } }), new Set());
    expect(r.ok).toBe(false);
    expect(r.blocking[0]).toEqual({ name: 'boom', severity: 'critical' });
  });

  it('ALLOWS a high/critical vuln that IS allowlisted (pre-triaged)', () => {
    const r = evaluateAudit(audit({ vitest: { severity: 'critical' }, vite: { severity: 'high' } }), new Set(['vitest', 'vite']));
    expect(r.ok).toBe(true);
    expect(r.blocking).toHaveLength(0);
    expect(r.allowed.map((a) => a.name).sort()).toEqual(['vite', 'vitest']);
  });

  it('blocks a NEW high even when others are allowlisted', () => {
    const r = evaluateAudit(audit({ vitest: { severity: 'critical' }, newbad: { severity: 'high' } }), new Set(['vitest']));
    expect(r.ok).toBe(false);
    expect(r.blocking).toEqual([{ name: 'newbad', severity: 'high' }]);
    expect(r.allowed.map((a) => a.name)).toEqual(['vitest']);
  });

  it('never blocks on moderate/low even if not allowlisted', () => {
    const r = evaluateAudit(audit({ a: { severity: 'moderate' }, b: { severity: 'low' }, c: { severity: 'info' } }), new Set());
    expect(r.ok).toBe(true);
  });

  it('handles empty/missing audit output safely', () => {
    expect(evaluateAudit({}, new Set()).ok).toBe(true);
    expect(evaluateAudit({ vulnerabilities: {} }, new Set()).ok).toBe(true);
  });
});
