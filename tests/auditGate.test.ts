import { describe, it, expect } from 'vitest';
import { evaluateAudit, isAuditErrorResponse, loadAllowlist, blockingAdvisoryIds } from '../scripts/auditGate.mjs';
import { readFileSync } from 'node:fs';

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

// Q-619 (forensic audit 2026-10-04): the allowlist accepted a PACKAGE, so once axios was triaged for one
// advisory, seven later HIGH advisories in axios passed with nobody looking. An entry now accepts only the
// advisory ids it names.
describe('audit-gate accepts ADVISORIES, not packages (Q-619)', () => {
  const adv = (id: string, severity: string) => ({ url: `https://github.com/advisories/${id}`, severity, source: 1 });
  const axiosWith = (...ids: string[]) => ({ axios: { severity: 'high', via: ids.map((id) => adv(id, 'high')) } });
  const allow = new Map([['axios', new Set(['GHSA-aaaa-bbbb-cccc'])]]);

  it('the triaged advisory passes', () => {
    expect(evaluateAudit(audit(axiosWith('GHSA-aaaa-bbbb-cccc') as never), allow).ok).toBe(true);
  });

  it('a NEW high advisory in an allowlisted package blocks, naming the advisory', () => {
    const r = evaluateAudit(audit(axiosWith('GHSA-aaaa-bbbb-cccc', 'GHSA-dddd-eeee-ffff') as never), allow);
    expect(r.ok).toBe(false);
    expect(r.blocking).toEqual([{ name: 'axios', severity: 'high', advisories: ['GHSA-dddd-eeee-ffff'] }]);
  });

  it('a moderate advisory beside the triaged high one does not block', () => {
    const a = { axios: { severity: 'high', via: [adv('GHSA-aaaa-bbbb-cccc', 'high'), adv('GHSA-mmmm-mmmm-mmmm', 'moderate')] } };
    expect(evaluateAudit(audit(a as never), allow).ok).toBe(true);
  });

  it('a package vulnerable only THROUGH another is judged on that other package', () => {
    const a = { chokidar: { severity: 'high', via: ['braces'] }, braces: { severity: 'high', via: [adv('GHSA-vfj7-8cjw-p6xm', 'high')] } };
    const ok = new Map([['chokidar', new Set<string>()], ['braces', new Set(['GHSA-vfj7-8cjw-p6xm'])]]);
    expect(evaluateAudit(audit(a as never), ok).ok).toBe(true);
    const notTriaged = new Map([['chokidar', new Set<string>()], ['braces', new Set<string>()]]);
    expect(evaluateAudit(audit(a as never), notTriaged).blocking).toEqual([{ name: 'braces', severity: 'high', advisories: ['GHSA-vfj7-8cjw-p6xm'] }]);
  });

  it('reads the advisory id from the URL, deduplicated and sorted', () => {
    expect(blockingAdvisoryIds({ via: [adv('GHSA-zzzz-zzzz-zzzz', 'critical'), adv('GHSA-aaaa-aaaa-aaaa', 'high'), adv('GHSA-aaaa-aaaa-aaaa', 'high'), 'other'] }))
      .toEqual(['GHSA-aaaa-aaaa-aaaa', 'GHSA-zzzz-zzzz-zzzz']);
  });

  it('the committed allowlist names the advisory ids it triaged, and every reason is real text', () => {
    const map = loadAllowlist();
    expect(map instanceof Map).toBe(true);
    const data = JSON.parse(readFileSync('.audit-allowlist.json', 'utf8'));
    for (const e of data.allow) {
      expect(Array.isArray(e.advisories), e.package).toBe(true);
      for (const id of e.advisories) expect(id).toMatch(/^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/);
      expect(String(e.reason).length).toBeGreaterThan(30);
    }
  });
});
