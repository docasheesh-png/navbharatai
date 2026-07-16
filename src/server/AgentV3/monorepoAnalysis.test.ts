import { describe, it, expect } from 'vitest';
import { detectMonorepo, monorepoSummary, routePackageCommand } from './monorepoAnalysis';

describe('detectMonorepo', () => {
  it('detects a Turborepo (turbo.json) with package.json workspaces', () => {
    const paths = ['turbo.json', 'package.json', 'apps/web/package.json', 'apps/api/package.json'];
    const contents = { 'package.json': JSON.stringify({ workspaces: ['apps/*'] }) };
    const info = detectMonorepo(paths, contents);
    expect(info.isMonorepo).toBe(true);
    expect(info.tool).toBe('turborepo');
    expect(info.packageDirs).toEqual(['apps/api', 'apps/web']);
  });

  it('detects Nx (nx.json)', () => {
    const info = detectMonorepo(['nx.json', 'package.json'], { 'package.json': JSON.stringify({ workspaces: ['packages/*'] }) });
    expect(info.tool).toBe('nx');
  });

  it('detects pnpm-workspaces from pnpm-workspace.yaml globs', () => {
    const yaml = 'packages:\n  - "packages/*"\n  - "apps/*"\n';
    const paths = ['pnpm-workspace.yaml', 'package.json', 'packages/ui/package.json', 'apps/site/package.json'];
    const info = detectMonorepo(paths, { 'pnpm-workspace.yaml': yaml });
    expect(info.tool).toBe('pnpm-workspaces');
    expect(info.workspaceGlobs).toEqual(['packages/*', 'apps/*']);
    expect(info.packageDirs).toEqual(['apps/site', 'packages/ui']);
  });

  it('detects yarn/npm workspaces from a root package.json workspaces array', () => {
    const info = detectMonorepo(['package.json', 'packages/a/package.json'], { 'package.json': JSON.stringify({ workspaces: ['packages/*'] }) });
    expect(info.tool).toBe('yarn-npm-workspaces');
    expect(info.packageDirs).toEqual(['packages/a']);
  });

  it('supports the workspaces:{packages:[]} object form and globstar', () => {
    const info = detectMonorepo(
      ['package.json', 'lerna.json', 'libs/x/package.json', 'libs/nested/y/package.json'],
      { 'package.json': JSON.stringify({ workspaces: { packages: ['libs/**'] } }) },
    );
    expect(info.tool).toBe('lerna'); // lerna.json beats bare workspaces
    expect(info.packageDirs).toEqual(['libs/nested/y', 'libs/x']);
  });

  it('a plain single-package repo is NOT a monorepo (no false positive)', () => {
    const info = detectMonorepo(['package.json', 'src/App.tsx'], { 'package.json': JSON.stringify({ name: 'app' }) });
    expect(info.isMonorepo).toBe(false);
    expect(info.tool).toBeNull();
    expect(monorepoSummary(info)).toBe('');
  });

  it('nested lockfiles alone do not imply a monorepo, and malformed json is tolerated', () => {
    expect(detectMonorepo(['package.json', 'sub/package-lock.json'], { 'package.json': '{bad json' }).isMonorepo).toBe(false);
    expect(detectMonorepo([], {}).isMonorepo).toBe(false);
  });

  it('ignores node_modules package.json files when resolving package dirs', () => {
    const info = detectMonorepo(
      ['turbo.json', 'package.json', 'apps/web/package.json', 'node_modules/apps/dep/package.json'],
      { 'package.json': JSON.stringify({ workspaces: ['apps/*'] }) },
    );
    expect(info.packageDirs).toEqual(['apps/web']);
  });
});

describe('routePackageCommand', () => {
  it('routes through the task runner per tool + manager', () => {
    const turbo = detectMonorepo(['turbo.json', 'package.json'], { 'package.json': '{"workspaces":["apps/*"]}' });
    expect(routePackageCommand(turbo, 'pnpm', 'apps/web', 'build')).toBe('pnpm exec turbo run build --filter=./apps/web');
    const nx = detectMonorepo(['nx.json', 'package.json'], { 'package.json': '{"workspaces":["apps/*"]}' });
    expect(routePackageCommand(nx, 'npm', 'apps/web', 'test')).toBe('npx nx run web:test');
    const pnpmWs = detectMonorepo(['pnpm-workspace.yaml'], { 'pnpm-workspace.yaml': 'packages:\n  - "pkgs/*"\n' });
    expect(routePackageCommand(pnpmWs, 'pnpm', 'pkgs/ui', 'build')).toBe('pnpm --filter ./pkgs/ui build');
  });
});

describe('monorepoSummary', () => {
  it('names the tool + package count and the correct scoped invocation', () => {
    const info = detectMonorepo(['turbo.json', 'package.json', 'apps/web/package.json'], { 'package.json': '{"workspaces":["apps/*"]}' });
    const s = monorepoSummary(info, 'pnpm');
    expect(s).toContain('Turborepo monorepo');
    expect(s).toContain('1 workspace package');
    expect(s).toContain('turbo run build --filter=./apps/web');
  });
});
