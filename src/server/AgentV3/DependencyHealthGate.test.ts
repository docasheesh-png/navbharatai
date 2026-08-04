import { describe, it, expect } from 'vitest';
import { dependencyHealthVerdict } from './DependencyHealthGate';

describe('dependencyHealthVerdict — build-end advisory composition', () => {
  it('is clean (no summary) when there are no CVEs and no copyleft deps', () => {
    const v = dependencyHealthVerdict({ vulnFindings: 0, vulnSummary: '', copyleftStrong: 0, licenseSummary: '' });
    expect(v.hasFindings).toBe(false);
    expect(v.summary).toBe('');
  });

  it('ignores a vuln summary when the finding count is zero (unavailable scan reports clean)', () => {
    const v = dependencyHealthVerdict({
      vulnFindings: 0,
      vulnSummary: 'scan unavailable — OSV unreachable',
      copyleftStrong: 0,
      licenseSummary: '',
    });
    expect(v.hasFindings).toBe(false);
    expect(v.summary).toBe('');
  });

  it('surfaces CVE findings only', () => {
    const v = dependencyHealthVerdict({
      vulnFindings: 2,
      vulnSummary: '2 vulnerable dependencies: lodash@4.17.4 (CVE-2019-10744), minimist@0.0.8',
      copyleftStrong: 0,
      licenseSummary: '',
    });
    expect(v.hasFindings).toBe(true);
    expect(v.summary).toContain('advisory — does not block');
    expect(v.summary).toContain('2 vulnerable dep(s)');
    expect(v.summary).toContain('CVE-2019-10744');
    expect(v.summary).not.toContain('copyleft');
  });

  it('surfaces copyleft findings only', () => {
    const v = dependencyHealthVerdict({
      vulnFindings: 0,
      vulnSummary: '',
      copyleftStrong: 1,
      licenseSummary: 'Strong copyleft: some-gpl-lib (GPL-3.0)',
    });
    expect(v.hasFindings).toBe(true);
    expect(v.summary).toContain('1 strong-copyleft dep(s)');
    expect(v.summary).toContain('GPL-3.0');
    expect(v.summary).not.toContain('vulnerable dep(s)');
  });

  it('surfaces BOTH signals, header first then each block', () => {
    const v = dependencyHealthVerdict({
      vulnFindings: 3,
      vulnSummary: 'CVE block text',
      copyleftStrong: 2,
      licenseSummary: 'license block text',
    });
    expect(v.hasFindings).toBe(true);
    expect(v.summary).toContain('3 vulnerable dep(s), 2 strong-copyleft dep(s)');
    // header precedes both bodies; CVE body precedes license body
    expect(v.summary.indexOf('advisory')).toBeLessThan(v.summary.indexOf('CVE block text'));
    expect(v.summary.indexOf('CVE block text')).toBeLessThan(v.summary.indexOf('license block text'));
  });

  it('does not surface a block whose summary text is blank even if the count is positive (defensive)', () => {
    const v = dependencyHealthVerdict({
      vulnFindings: 5,
      vulnSummary: '   ',
      copyleftStrong: 0,
      licenseSummary: '',
    });
    expect(v.hasFindings).toBe(false);
    expect(v.summary).toBe('');
  });
});
