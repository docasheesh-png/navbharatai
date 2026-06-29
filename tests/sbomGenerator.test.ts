import { describe, it, expect } from 'vitest';
import {
  buildSbom, classifyLicense, detectCopyleft, analyzeAppDependencies,
} from '../src/server/AppMakerLab/SBOMGenerator';

/**
 * P-BRE.10 — SBOM + license validation for generated apps.
 */
const SAMPLE_LOCK = {
  name: 'my-app',
  version: '1.0.0',
  packages: {
    '': { name: 'my-app', version: '1.0.0' }, // root — must be skipped
    'node_modules/react': { version: '18.2.0', license: 'MIT' },
    'node_modules/left-pad': { version: '1.3.0', license: 'WTFPL' },
    'node_modules/some-gpl-lib': { version: '2.0.0', license: 'GPL-3.0' },
    'node_modules/some-lgpl-lib': { version: '1.0.0', license: 'LGPL-3.0' },
    'node_modules/dual-lib': { version: '1.0.0', license: 'MIT OR GPL-3.0' },
  },
};

describe('SBOMGenerator — buildSbom', () => {
  it('produces a CycloneDX 1.5 SBOM', () => {
    const sbom = buildSbom(SAMPLE_LOCK, '2026-01-01T00:00:00.000Z');
    expect(sbom.bomFormat).toBe('CycloneDX');
    expect(sbom.specVersion).toBe('1.5');
    expect(sbom.metadata.timestamp).toBe('2026-01-01T00:00:00.000Z');
    expect(sbom.metadata.component.name).toBe('my-app');
  });

  it('excludes the root project and lists every dependency once', () => {
    const sbom = buildSbom(SAMPLE_LOCK);
    const names = sbom.components.map((c) => c.name);
    expect(names).not.toContain('my-app');
    expect(names).toContain('react');
    expect(names).toContain('some-gpl-lib');
    expect(sbom.components.length).toBe(5);
  });

  it('emits a valid purl and license for each component', () => {
    const sbom = buildSbom(SAMPLE_LOCK);
    const react = sbom.components.find((c) => c.name === 'react')!;
    expect(react.purl).toBe('pkg:npm/react@18.2.0');
    expect(react.licenses?.[0].license.id).toBe('MIT');
  });

  it('handles an empty / malformed lock without throwing', () => {
    expect(buildSbom(null).components).toEqual([]);
    expect(buildSbom({}).components).toEqual([]);
  });
});

describe('SBOMGenerator — classifyLicense', () => {
  it('classifies permissive, strong, weak, unknown', () => {
    expect(classifyLicense('MIT')).toBe('permissive');
    expect(classifyLicense('Apache-2.0')).toBe('permissive');
    expect(classifyLicense('GPL-3.0')).toBe('strong-copyleft');
    expect(classifyLicense('AGPL-3.0')).toBe('strong-copyleft');
    expect(classifyLicense('LGPL-3.0')).toBe('weak-copyleft');
    expect(classifyLicense('MPL-2.0')).toBe('weak-copyleft');
    expect(classifyLicense('SEE LICENSE IN FILE')).toBe('unknown');
    expect(classifyLicense(undefined)).toBe('unknown');
  });

  it('takes the most-permissive operand of an OR expression', () => {
    expect(classifyLicense('MIT OR GPL-3.0')).toBe('permissive');
  });

  it('does not mis-split the -or-later suffix', () => {
    expect(classifyLicense('GPL-3.0-or-later')).toBe('strong-copyleft');
  });
});

describe('SBOMGenerator — detectCopyleft', () => {
  it('flags strong (GPL) and weak (LGPL) copyleft, ignores permissive + dual', () => {
    const sbom = buildSbom(SAMPLE_LOCK);
    const { strong, weak } = detectCopyleft(sbom);
    expect(strong.map((f) => f.name)).toEqual(['some-gpl-lib']); // GPL only; dual MIT-OR-GPL is permissive
    expect(weak.map((f) => f.name)).toEqual(['some-lgpl-lib']);
  });
});

describe('SBOMGenerator — analyzeAppDependencies', () => {
  it('returns SBOM + copyleft + risk flag in one call', () => {
    const r = analyzeAppDependencies(SAMPLE_LOCK);
    expect(r.componentCount).toBe(5);
    expect(r.hasCopyleftRisk).toBe(true); // because some-gpl-lib is GPL
    expect(r.copyleft.strong.length).toBe(1);
  });

  it('reports no copyleft risk for an all-permissive app', () => {
    const clean = { name: 'x', version: '1.0.0', packages: { '': {}, 'node_modules/react': { version: '18.2.0', license: 'MIT' } } };
    const r = analyzeAppDependencies(clean);
    expect(r.hasCopyleftRisk).toBe(false);
    expect(r.copyleft.strong).toEqual([]);
  });
});
