import { describe, it, expect } from 'vitest';
import { evaluateAudit, isAuditErrorResponse } from '../scripts/auditGate.mjs';

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

describe('isAuditErrorResponse (2026-07-26 — the legacy /audits/quick endpoint retirement)', () => {
  it('detects the real npm-registry error shape (400, no vulnerabilities key)', () => {
    const errBody = {
      message: '400 Bad Request - POST https://registry.npmjs.org/-/npm/v1/security/audits/quick - Bad Request',
      statusCode: 400,
      body: { statusCode: 400, error: 'Bad Request', message: 'Invalid package tree, run  npm install  to rebuild your package-lock.json' },
      error: { summary: '', detail: '' },
    };
    expect(isAuditErrorResponse(errBody)).toBe(true);
  });

  it('does NOT flag a genuine empty-audit report (has vulnerabilities key, even if empty)', () => {
    expect(isAuditErrorResponse({})).toBe(false);
    expect(isAuditErrorResponse({ vulnerabilities: {} })).toBe(false);
    expect(isAuditErrorResponse({ vulnerabilities: { lodash: { severity: 'moderate' } } })).toBe(false);
  });

  it('does NOT flag a real report that happens to carry an unrelated numeric field', () => {
    expect(isAuditErrorResponse({ vulnerabilities: {}, statusCode: 500, error: {} })).toBe(false);
  });

  it('does NOT flag a response with a statusCode but no error object (just noise, not an error)', () => {
    expect(isAuditErrorResponse({ statusCode: 400 })).toBe(false);
  });

  it('is safe against null/non-object input', () => {
    expect(isAuditErrorResponse(null)).toBe(false);
    expect(isAuditErrorResponse(undefined)).toBe(false);
    expect(isAuditErrorResponse('not an object')).toBe(false);
  });

  it('a real report is never mistaken for an error EVEN if npm ever adds its own statusCode-shaped noise', () => {
    // Defense-in-depth: the presence of `vulnerabilities` always wins, no matter what else is present.
    const weird = { vulnerabilities: { pkg: { severity: 'high' } }, statusCode: 400, error: { oops: true } };
    expect(isAuditErrorResponse(weird)).toBe(false);
  });
});
