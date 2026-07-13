import { describe, it, expect } from 'vitest';
import { analyzeLockfiles, lockfileSummary, detectPackageManager, packageManagerSummary } from './lockfileAnalysis';

describe('analyzeLockfiles', () => {
  it('flags two different managers in the same directory (npm + yarn at root)', () => {
    const issues = analyzeLockfiles(['package.json', 'package-lock.json', 'yarn.lock', 'src/App.tsx']);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe('multiple-lockfiles');
    expect(issues[0].severity).toBe('medium');
    expect(issues[0].detail).toContain('the project root');
    expect(issues[0].detail).toContain('(npm)');
    expect(issues[0].detail).toContain('(yarn)');
  });

  it('does NOT flag a single lockfile', () => {
    expect(analyzeLockfiles(['package.json', 'pnpm-lock.yaml', 'src/App.tsx'])).toEqual([]);
  });

  it('does NOT flag two npm filenames (same manager — package-lock + npm-shrinkwrap)', () => {
    expect(analyzeLockfiles(['package-lock.json', 'npm-shrinkwrap.json'])).toEqual([]);
  });

  it('does NOT flag per-package lockfiles in DIFFERENT directories (legit monorepo)', () => {
    expect(analyzeLockfiles([
      'apps/web/package-lock.json',
      'apps/api/yarn.lock',
    ])).toEqual([]);
  });

  it('flags a conflict in a subdirectory and names the directory', () => {
    const issues = analyzeLockfiles(['packages/ui/pnpm-lock.yaml', 'packages/ui/bun.lockb']);
    expect(issues).toHaveLength(1);
    expect(issues[0].detail).toContain("'packages/ui/'");
    expect(issues[0].detail).toContain('(pnpm)');
    expect(issues[0].detail).toContain('(bun)');
  });

  it('reports one issue PER conflicting directory', () => {
    const issues = analyzeLockfiles([
      'package-lock.json', 'yarn.lock',            // root conflict
      'sub/pnpm-lock.yaml', 'sub/bun.lock',        // sub conflict
      'clean/pnpm-lock.yaml',                       // fine
    ]);
    expect(issues).toHaveLength(2);
  });

  it('ignores non-lockfiles and tolerates malformed entries', () => {
    // @ts-expect-error — deliberately malformed
    expect(analyzeLockfiles(['README.md', 'src/lock.ts', null, 123])).toEqual([]);
  });

  it('returns [] for empty / nullish input', () => {
    expect(analyzeLockfiles([])).toEqual([]);
    // @ts-expect-error — nullish
    expect(analyzeLockfiles(null)).toEqual([]);
  });
});

describe('lockfileSummary', () => {
  it('reports the clean line when there is no conflict', () => {
    expect(lockfileSummary([])).toContain('No conflicting package-manager lockfiles');
  });

  it('lists the conflicting directories', () => {
    const out = lockfileSummary(analyzeLockfiles(['package-lock.json', 'yarn.lock']));
    expect(out).toContain('1 directory(ies) with conflicting lockfiles');
    expect(out).toContain('[medium]');
  });
});

describe('detectPackageManager', () => {
  it('detects pnpm from a root pnpm-lock.yaml with its commands', () => {
    const pm = detectPackageManager(['package.json', 'pnpm-lock.yaml', 'src/App.tsx']);
    expect(pm).toEqual({ manager: 'pnpm', lockfile: 'pnpm-lock.yaml', installCmd: 'pnpm install', runCmd: 'pnpm run' });
  });

  it('detects yarn and bun', () => {
    expect(detectPackageManager(['yarn.lock'])?.manager).toBe('yarn');
    expect(detectPackageManager(['bun.lockb'])?.manager).toBe('bun');
  });

  it('detects npm and reports its commands', () => {
    expect(detectPackageManager(['package-lock.json'])).toEqual({
      manager: 'npm', lockfile: 'package-lock.json', installCmd: 'npm install', runCmd: 'npm run',
    });
  });

  it('returns null when the root is ambiguous (multiple managers → left to the conflict check)', () => {
    expect(detectPackageManager(['package-lock.json', 'yarn.lock'])).toBeNull();
  });

  it('returns null when there is no root lockfile (a nested lockfile does not define the build)', () => {
    expect(detectPackageManager(['apps/web/pnpm-lock.yaml', 'package.json'])).toBeNull();
  });

  it('returns null for empty / nullish input', () => {
    expect(detectPackageManager([])).toBeNull();
    // @ts-expect-error — nullish
    expect(detectPackageManager(null)).toBeNull();
  });
});

describe('packageManagerSummary', () => {
  it('advises the non-npm manager and its commands', () => {
    const out = packageManagerSummary(detectPackageManager(['pnpm-lock.yaml']));
    expect(out).toContain('pnpm');
    expect(out).toContain('pnpm install');
    expect(out).toContain('NOT npm');
  });

  it('is SILENT for npm (the default) and for no detection', () => {
    expect(packageManagerSummary(detectPackageManager(['package-lock.json']))).toBe('');
    expect(packageManagerSummary(null)).toBe('');
  });
});
