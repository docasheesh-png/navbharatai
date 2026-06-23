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
