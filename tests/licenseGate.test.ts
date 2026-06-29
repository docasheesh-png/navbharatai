import { describe, it, expect } from 'vitest';
import { classifyLicense, evaluateLicenses, readLicenseField } from '../scripts/licenseGate.mjs';

describe('license gate (P-SEC.6)', () => {
  describe('classifyLicense', () => {
    it('classifies permissive licenses', () => {
      for (const l of ['MIT', 'ISC', 'Apache-2.0', 'BSD-3-Clause', 'BSD-2-Clause', '0BSD', 'BlueOak-1.0.0', 'Unlicense']) {
        expect(classifyLicense(l)).toBe('permissive');
      }
    });
    it('classifies strong copyleft (GPL/AGPL)', () => {
      expect(classifyLicense('GPL-3.0')).toBe('strong-copyleft');
      expect(classifyLicense('GPL-3.0-or-later')).toBe('strong-copyleft');
      expect(classifyLicense('AGPL-3.0')).toBe('strong-copyleft');
    });
    it('classifies weak/file-level copyleft (MPL/LGPL/EPL)', () => {
      expect(classifyLicense('MPL-2.0')).toBe('weak-copyleft');
      expect(classifyLicense('LGPL-3.0')).toBe('weak-copyleft');
      expect(classifyLicense('EPL-2.0')).toBe('weak-copyleft');
    });
    it('a dual "OR" license takes the MOST permissive option', () => {
      expect(classifyLicense('(MIT OR GPL-3.0-or-later)')).toBe('permissive'); // jszip case
      expect(classifyLicense('MPL-2.0 OR Apache-2.0')).toBe('permissive');      // dompurify case
      expect(classifyLicense('(GPL-3.0 OR LGPL-3.0)')).toBe('weak-copyleft');   // best is weak
    });
    it('an "AND" license takes the MOST restrictive option', () => {
      expect(classifyLicense('(Apache-2.0 AND GPL-3.0)')).toBe('strong-copyleft');
      expect(classifyLicense('(MIT AND BSD-3-Clause)')).toBe('permissive');
    });
    it('classifies unknown/custom as unknown', () => {
      expect(classifyLicense('SEE LICENSE IN LICENSE')).toBe('unknown');
      expect(classifyLicense('')).toBe('unknown');
      expect(classifyLicense(undefined as any)).toBe('unknown');
    });
  });

  describe('readLicenseField', () => {
    it('reads string, object, and array license shapes', () => {
      expect(readLicenseField({ license: 'MIT' })).toBe('MIT');
      expect(readLicenseField({ license: { type: 'ISC' } })).toBe('ISC');
      expect(readLicenseField({ licenses: [{ type: 'Apache-2.0' }] })).toBe('Apache-2.0');
      expect(readLicenseField({})).toBe('unknown');
    });
  });

  describe('evaluateLicenses', () => {
    it('passes a permissive-only tree', () => {
      const r = evaluateLicenses([{ name: 'a', version: '1', license: 'MIT' }, { name: 'b', version: '1', license: 'Apache-2.0' }], new Set());
      expect(r.ok).toBe(true);
      expect(r.blocking).toHaveLength(0);
    });
    it('BLOCKS an un-allowlisted strong-copyleft dep', () => {
      const r = evaluateLicenses([{ name: 'gpllib', version: '2', license: 'GPL-3.0' }], new Set());
      expect(r.ok).toBe(false);
      expect(r.blocking[0].name).toBe('gpllib');
    });
    it('ALLOWS a strong-copyleft dep that is allowlisted', () => {
      const r = evaluateLicenses([{ name: 'gpllib', version: '2', license: 'AGPL-3.0' }], new Set(['gpllib']));
      expect(r.ok).toBe(true);
    });
    it('does NOT block weak copyleft or dual-permissive', () => {
      const r = evaluateLicenses([
        { name: 'mpl', version: '1', license: 'MPL-2.0' },
        { name: 'jszip', version: '1', license: '(MIT OR GPL-3.0-or-later)' },
      ], new Set());
      expect(r.ok).toBe(true);
      expect(r.weak.map((w) => w.name)).toContain('mpl');
    });
    it('reports unknown licenses as warnings, not blocking', () => {
      const r = evaluateLicenses([{ name: 'mystery', version: '1', license: 'UNKNOWN' }], new Set());
      expect(r.ok).toBe(true);
      expect(r.unknown.map((u) => u.name)).toContain('mystery');
    });
  });
});
