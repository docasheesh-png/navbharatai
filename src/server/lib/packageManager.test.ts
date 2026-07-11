import { describe, it, expect } from 'vitest';
import { detectPackageManager, pmRun, pmExec, pmInstall } from './packageManager';

describe('detectPackageManager', () => {
  it('defaults to npm (package-lock.json or nothing declared)', () => {
    expect(detectPackageManager(['package.json', 'package-lock.json'])).toBe('npm');
    expect(detectPackageManager(['package.json'])).toBe('npm');
    expect(detectPackageManager([])).toBe('npm');
  });

  it('detects pnpm / yarn / bun from the lockfile', () => {
    expect(detectPackageManager(['pnpm-lock.yaml'])).toBe('pnpm');
    expect(detectPackageManager(['yarn.lock'])).toBe('yarn');
    expect(detectPackageManager(['bun.lockb'])).toBe('bun');
    expect(detectPackageManager(['bun.lock'])).toBe('bun');
  });

  it('the explicit packageManager field wins over the lockfile', () => {
    const pkg = JSON.stringify({ packageManager: 'pnpm@9.1.0' });
    // A stray package-lock.json is present but the pin says pnpm — trust the pin.
    expect(detectPackageManager(['package-lock.json'], pkg)).toBe('pnpm');
    expect(detectPackageManager([], JSON.stringify({ packageManager: 'yarn@4.2.2' }))).toBe('yarn');
    expect(detectPackageManager([], JSON.stringify({ packageManager: 'bun@1.1.0' }))).toBe('bun');
  });

  it('follows bun → pnpm → yarn precedence when multiple lockfiles coexist', () => {
    expect(detectPackageManager(['pnpm-lock.yaml', 'yarn.lock', 'package-lock.json'])).toBe('pnpm');
    expect(detectPackageManager(['yarn.lock', 'package-lock.json'])).toBe('yarn');
  });

  it('a malformed package.json falls back to lockfile detection (never throws)', () => {
    expect(detectPackageManager(['pnpm-lock.yaml'], '{ not json')).toBe('pnpm');
  });

  it('matches a nested lockfile basename', () => {
    expect(detectPackageManager(['apps/web/pnpm-lock.yaml'])).toBe('pnpm');
  });
});

describe('pmRun / pmExec / pmInstall', () => {
  it('pmRun uses the idiomatic form per manager', () => {
    expect(pmRun('npm', 'test')).toBe('npm run test');
    expect(pmRun('pnpm', 'test')).toBe('pnpm run test');
    expect(pmRun('bun', 'test')).toBe('bun run test');
    expect(pmRun('yarn', 'test')).toBe('yarn test'); // yarn omits "run"
  });

  it('pmExec picks the right local-binary runner', () => {
    expect(pmExec('npm')).toBe('npx');
    expect(pmExec('pnpm')).toBe('pnpm exec');
    expect(pmExec('yarn')).toBe('yarn');
    expect(pmExec('bun')).toBe('bunx');
  });

  it('pmInstall installs from the lockfile per manager', () => {
    expect(pmInstall('npm')).toBe('npm install');
    expect(pmInstall('pnpm')).toBe('pnpm install');
    expect(pmInstall('yarn')).toBe('yarn install');
    expect(pmInstall('bun')).toBe('bun install');
  });
});
