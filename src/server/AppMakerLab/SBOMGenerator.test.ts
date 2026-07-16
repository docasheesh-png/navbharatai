import { describe, it, expect } from 'vitest';
import { analyzeAppDependencies, licenseAdvisorySummary, classifyLicense } from './SBOMGenerator';

const lockWith = (pkgs: Record<string, { version: string; license?: string }>) => ({
  name: 'app', version: '1.0.0',
  packages: Object.fromEntries(Object.entries(pkgs).map(([name, v]) => [`node_modules/${name}`, v])),
});

describe('classifyLicense', () => {
  it('ranks GPL/AGPL strong, LGPL/MPL weak, MIT permissive, junk unknown', () => {
    expect(classifyLicense('AGPL-3.0')).toBe('strong-copyleft');
    expect(classifyLicense('GPL-3.0-only')).toBe('strong-copyleft');
    expect(classifyLicense('LGPL-2.1')).toBe('weak-copyleft');
    expect(classifyLicense('MPL-2.0')).toBe('weak-copyleft');
    expect(classifyLicense('MIT')).toBe('permissive');
    expect(classifyLicense(null)).toBe('unknown');
  });
});

describe('licenseAdvisorySummary (PPIPE-gates)', () => {
  it('flags strong-copyleft (GPL/AGPL) deps with a review warning', () => {
    const r = analyzeAppDependencies(lockWith({
      react: { version: '18.0.0', license: 'MIT' },
      'copyleft-lib': { version: '2.1.0', license: 'GPL-3.0' },
    }));
    const s = licenseAdvisorySummary(r);
    expect(s).toContain('1 strong-copyleft');
    expect(s).toContain('copyleft-lib@2.1.0');
    expect(s).toContain('review before shipping');
  });

  it('lists weak-copyleft (LGPL/MPL) deps for awareness', () => {
    const r = analyzeAppDependencies(lockWith({ 'weak-lib': { version: '1.0.0', license: 'MPL-2.0' } }));
    const s = licenseAdvisorySummary(r);
    expect(s).toContain('1 weak-copyleft');
    expect(s).toContain('weak-lib (MPL-2.0)');
    expect(s).not.toContain('strong-copyleft');
  });

  it('confirms "no copyleft risk" for an all-permissive app', () => {
    const r = analyzeAppDependencies(lockWith({
      react: { version: '18.0.0', license: 'MIT' },
      lodash: { version: '4.17.21', license: 'MIT' },
    }));
    expect(licenseAdvisorySummary(r)).toContain('no copyleft-license risk across 2 dependency component(s)');
  });

  it('is neutral (empty) when there is no lockfile / no components', () => {
    expect(licenseAdvisorySummary(analyzeAppDependencies({}))).toBe('');
    expect(licenseAdvisorySummary(analyzeAppDependencies(null))).toBe('');
  });
});
