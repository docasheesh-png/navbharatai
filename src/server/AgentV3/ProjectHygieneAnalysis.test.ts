import { describe, it, expect } from 'vitest';
import { analyzeProjectHygiene, projectHygieneSummary } from './ProjectHygieneAnalysis';

describe('analyzeProjectHygiene', () => {
  it('is not assessable for a non-JS/TS project', () => {
    const r = analyzeProjectHygiene(['main.py', 'requirements.txt'], false);
    expect(r.assessed).toBe(false);
    expect(r.findings).toHaveLength(0);
  });

  it('reports no issues for a well-set-up TS project', () => {
    const r = analyzeProjectHygiene(
      ['src/App.tsx', '.gitignore', 'tsconfig.json', 'package.json', 'package-lock.json'],
      true,
    );
    expect(r.assessed).toBe(true);
    expect(r.findings).toHaveLength(0);
  });

  it('flags a missing .gitignore as medium', () => {
    const r = analyzeProjectHygiene(['src/App.tsx', 'tsconfig.json', 'package.json', 'package-lock.json'], true);
    expect(r.findings.some((f) => f.level === 'medium' && /\.gitignore/.test(f.message))).toBe(true);
  });

  it('flags TypeScript with no tsconfig.json', () => {
    const r = analyzeProjectHygiene(['src/App.tsx', '.gitignore', 'package.json', 'package-lock.json'], true);
    expect(r.findings.some((f) => /tsconfig\.json/.test(f.message))).toBe(true);
  });

  it('flags a missing lockfile as low', () => {
    const r = analyzeProjectHygiene(['src/App.tsx', '.gitignore', 'tsconfig.json', 'package.json'], true);
    expect(r.findings.some((f) => f.level === 'low' && /lockfile/.test(f.message))).toBe(true);
  });

  it('accepts any supported lockfile', () => {
    const r = analyzeProjectHygiene(['src/a.ts', '.gitignore', 'tsconfig.json', 'package.json', 'pnpm-lock.yaml'], true);
    expect(r.findings.some((f) => /lockfile/.test(f.message))).toBe(false);
  });

  it('matches hygiene files regardless of directory prefix in the path', () => {
    const r = analyzeProjectHygiene(['repo/src/App.tsx', 'repo/.gitignore', 'repo/tsconfig.json', 'repo/package.json', 'repo/yarn.lock'], true);
    expect(r.findings).toHaveLength(0);
  });

  const wellSetUp = ['src/App.tsx', '.gitignore', 'tsconfig.json', 'package.json', 'package-lock.json'];

  it('flags a .gitignore that exists but does not cover node_modules', () => {
    const r = analyzeProjectHygiene(wellSetUp, true, 'dist/\n.env\n*.log');
    expect(r.findings.some((f) => f.level === 'medium' && /does not ignore node_modules/.test(f.message))).toBe(true);
  });

  it('does NOT flag node_modules when the .gitignore covers it (various forms)', () => {
    for (const body of ['node_modules', 'node_modules/', '/node_modules', '**/node_modules', 'dist/\n# deps\nnode_modules/\n']) {
      const r = analyzeProjectHygiene(wellSetUp, true, body);
      expect(r.findings.some((f) => /node_modules/.test(f.message))).toBe(false);
    }
  });

  it('treats a node_modules sub-path entry as NOT covering the whole directory', () => {
    const r = analyzeProjectHygiene(wellSetUp, true, 'node_modules/.cache');
    expect(r.findings.some((f) => /does not ignore node_modules/.test(f.message))).toBe(true);
  });

  it('skips the node_modules coverage check when gitignore content is not provided', () => {
    const r = analyzeProjectHygiene(wellSetUp, true);
    expect(r.findings.some((f) => /node_modules/.test(f.message))).toBe(false);
  });

  it('does not double-report: missing .gitignore takes priority over coverage', () => {
    const r = analyzeProjectHygiene(['src/App.tsx', 'tsconfig.json', 'package.json', 'package-lock.json'], true, null);
    const gitignoreFindings = r.findings.filter((f) => /\.gitignore/.test(f.message) || /node_modules/.test(f.message));
    expect(gitignoreFindings).toHaveLength(1);
    expect(gitignoreFindings[0].message).toMatch(/No \.gitignore/);
  });
});

describe('projectHygieneSummary', () => {
  it('renders the not-assessable line', () => {
    expect(projectHygieneSummary(analyzeProjectHygiene(['main.py'], false))).toContain('not a JS/TS project');
  });
  it('renders a pass line when clean', () => {
    const r = analyzeProjectHygiene(['a.ts', '.gitignore', 'tsconfig.json', 'package.json', 'yarn.lock'], true);
    expect(projectHygieneSummary(r)).toContain('✓');
  });
  it('lists missing files', () => {
    const out = projectHygieneSummary(analyzeProjectHygiene(['a.ts', 'package.json'], true));
    expect(out).toContain('⚠');
    expect(out).toContain('missing');
  });
});
