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

  it('reads the Java toolchain from a Gradle build.gradle (JavaLanguageVersion.of)', () => {
    const r = analyzeToolchain({
      'build.gradle': 'java {\n  toolchain {\n    languageVersion = JavaLanguageVersion.of(17)\n  }\n}\n',
    });
    const java = r.declarations.find(d => d.language === 'java')!;
    expect(java.key).toBe('17');
    expect(java.source).toBe('build.gradle toolchain');
  });

  it('reads sourceCompatibility = JavaVersion.VERSION_17 from a Kotlin build.gradle.kts', () => {
    const r = analyzeToolchain({
      'build.gradle.kts': 'java {\n  sourceCompatibility = JavaVersion.VERSION_17\n}\n',
    });
    expect(r.declarations.find(d => d.language === 'java')!.key).toBe('17');
  });

  it('normalizes legacy Java 1.8 to major 8 (Gradle and Maven agree, no false inconsistency)', () => {
    const r = analyzeToolchain({
      'build.gradle': "sourceCompatibility = '1.8'\n",
      'pom.xml': '<project><properties><java.version>1.8</java.version></properties></project>',
    });
    const keys = r.declarations.filter(d => d.language === 'java').map(d => d.key);
    expect(keys).toEqual(['8', '8']);
    expect(r.inconsistencies).toEqual([]);
  });

  it('flags a Java inconsistency when Gradle (17) and Maven (11) disagree', () => {
    const r = analyzeToolchain({
      'build.gradle': 'java { toolchain { languageVersion = JavaLanguageVersion.of(17) } }',
      'pom.xml': '<project><properties><java.version>11</java.version></properties></project>',
    });
    expect(r.inconsistencies.length).toBe(1);
    expect(r.inconsistencies[0]).toContain('java');
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
