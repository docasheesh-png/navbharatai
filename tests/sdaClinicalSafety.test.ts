import { describe, it, expect } from 'vitest';
import { newSdaCaseId } from '../src/lib/sdaCaseId';
import { isAuditReplyClean } from '../src/server/lib/clinical/auditGate';

describe('newSdaCaseId — per-case isolation primitive', () => {
  it('returns a non-empty id', () => {
    expect(newSdaCaseId().length).toBeGreaterThan(0);
  });
  it('never collides across many calls (rotation always yields a NEW server key)', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 2000; i++) ids.add(newSdaCaseId());
    expect(ids.size).toBe(2000); // if it ever returned a constant, cases would still contaminate
  });
});

describe('isAuditReplyClean — Doctor AI second-opinion safety gate', () => {
  it('treats an EXACT OK/OK./OK! (any case, trimmed) as clean → note dropped', () => {
    for (const t of ['OK', 'ok', 'OK.', 'OK!', '  ok.  ', 'Ok']) {
      expect(isAuditReplyClean(t)).toBe(true);
    }
  });

  it('an empty audit reply is clean (nothing to surface)', () => {
    expect(isAuditReplyClean('')).toBe(true);
    expect(isAuditReplyClean('   ')).toBe(true);
  });

  it('REGRESSION: a warning that STARTS WITH "OK" is NOT clean → the danger note is surfaced', () => {
    // The old /^ok\b/i test silently dropped these real safety warnings.
    expect(isAuditReplyClean('OK, but the paracetamol dose 100 mg/kg is a 10x overdose — reduce to 15 mg/kg.')).toBe(false);
    expect(isAuditReplyClean('OK however the patient is hypotensive; escalate now.')).toBe(false);
    expect(isAuditReplyClean('OK - missing red flag: SpO2 88%')).toBe(false);
    expect(isAuditReplyClean('The dosage is dangerous.')).toBe(false);
  });
});
