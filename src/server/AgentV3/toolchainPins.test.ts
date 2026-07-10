import { describe, it, expect } from 'vitest';
import { analyzeToolchain } from './toolchainPins';

// D11: toolchain pin detection + internal-consistency. Pure.

describe('analyzeToolchain', () => {
  it('collects declared versions across Node/Python/Java/Go', () => {
    const r = analyzeToolchain({
      '.nvmrc': '20.11.0\n',
      'package.json': JSON.stringify({ engines: { node: '>=20' } }),
      '.python-version': '3.11.4',
      'pom.xml': '<project><properties><java.version>17</java.version></properties></project>',
      'go.mod': 'module x\n\ngo 1.22\n',
    });
    expect(r.declarations.find(d => d.language === 'node' && d.source === '.nvmrc')!.key).toBe('20');
    expect(r.declarations.find(d => d.language === 'python')!.key).toBe('3.11');
    expect(r.declarations.find(d => d.language === 'java')!.key).toBe('17');
    expect(r.declarations.find(d => d.language === 'go')!.key).toBe('1.22');
    expect(r.inconsistencies).toEqual([]);
  });

  it('flags an internal inconsistency when two Node sources disagree', () => {
    const r = analyzeToolchain({
      '.nvmrc': '18',
      'package.json': JSON.stringify({ engines: { node: '>=20' } }),
    });
    expect(r.inconsistencies.length).toBe(1);
    expect(r.inconsistencies[0]).toContain('node');
  });

  it('does not flag when Node sources agree (v18 vs 18.17.0 → same major)', () => {
    const r = analyzeToolchain({ '.nvmrc': 'v18', '.node-version': '18.17.0' });
    expect(r.inconsistencies).toEqual([]);
  });

  it('reads Java from maven.compiler when java.version is absent', () => {
    const r = analyzeToolchain({ 'pom.xml': '<maven.compiler.release>21</maven.compiler.release>' });
    expect(r.declarations.find(d => d.language === 'java')!.key).toBe('21');
  });

  it('reports honestly when nothing is pinned', () => {
    const r = analyzeToolchain({ 'index.html': '<html></html>' });
    expect(r.declarations).toEqual([]);
    expect(r.summary).toContain('No toolchain pins');
  });

  it('parses Python requires-python from pyproject.toml', () => {
    const r = analyzeToolchain({ 'pyproject.toml': '[project]\nrequires-python = ">=3.10"\n' });
    expect(r.declarations.find(d => d.language === 'python')!.key).toBe('3.10');
  });
});
