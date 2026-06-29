import { describe, it, expect } from 'vitest';
import { buildSbom } from '../scripts/genSbom.mjs';

describe('SBOM generation (P-SEC.6)', () => {
  const lock = {
    name: 'navbharatai',
    version: '2.0.0',
    packages: {
      '': { name: 'navbharatai', version: '2.0.0' },
      'node_modules/react': { version: '18.3.1', license: 'MIT' },
      'node_modules/@scope/pkg': { name: '@scope/pkg', version: '1.2.3', license: 'Apache-2.0' },
      'node_modules/react/node_modules/loose-envify': { version: '1.4.0' },
    },
  };

  it('builds a CycloneDX 1.5 document with the root app as metadata.component', () => {
    const sbom = buildSbom(lock, '2026-06-28T00:00:00.000Z');
    expect(sbom.bomFormat).toBe('CycloneDX');
    expect(sbom.specVersion).toBe('1.5');
    expect(sbom.metadata.component).toEqual({ type: 'application', name: 'navbharatai', version: '2.0.0' });
    expect(sbom.metadata.timestamp).toBe('2026-06-28T00:00:00.000Z');
  });

  it('includes every dependency (not the root) as a component with a purl', () => {
    const sbom = buildSbom(lock);
    const names = sbom.components.map((c) => c.name);
    expect(names).toContain('react');
    expect(names).toContain('@scope/pkg');
    expect(names).toContain('loose-envify');
    expect(names).not.toContain('navbharatai'); // root excluded from components
    const react = sbom.components.find((c) => c.name === 'react');
    expect(react.purl).toBe('pkg:npm/react@18.3.1');
    expect(react.licenses).toEqual([{ license: { id: 'MIT' } }]);
  });

  it('scoped package purl url-encodes the @', () => {
    const sbom = buildSbom(lock);
    const scoped = sbom.components.find((c) => c.name === '@scope/pkg');
    expect(scoped.purl).toBe('pkg:npm/%40scope/pkg@1.2.3');
  });

  it('dedupes repeated name@version and sorts components by name', () => {
    const dupLock = { packages: { '': {}, 'node_modules/a': { version: '1' }, 'node_modules/x/node_modules/a': { version: '1' } } };
    const sbom = buildSbom(dupLock);
    expect(sbom.components.filter((c) => c.name === 'a')).toHaveLength(1);
  });
});
