/**
 * Tests for WorkspaceLauncher — pure deterministic methods:
 * detectPackageManager() checks for lock files, installDependencies() is a pure
 * function, and getStartCommand() reads package.json and applies port flags.
 * Uses temp directories so no project files are created.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { WorkspaceLauncher } from '../src/server/PreviewRunner/WorkspaceLauncher';

let tmpDir: string;

function write(rel: string, content: string) {
  const full = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function pkg(scripts: Record<string, string>, deps: Record<string, string> = {}) {
  return JSON.stringify({ scripts, dependencies: deps });
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const launcher = new WorkspaceLauncher();

// ── detectPackageManager ─────────────────────────────────────────────────────

describe('WorkspaceLauncher.detectPackageManager', () => {
  it('returns "npm" when no lock file exists', async () => {
    const dir = fs.mkdtempSync(path.join(tmpDir, 'npm-'));
    expect(await launcher.detectPackageManager(dir)).toBe('npm');
  });

  it('returns "pnpm" when pnpm-lock.yaml is present', async () => {
    const dir = fs.mkdtempSync(path.join(tmpDir, 'pnpm-'));
    fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');
    expect(await launcher.detectPackageManager(dir)).toBe('pnpm');
  });

  it('returns "yarn" when yarn.lock is present (no pnpm-lock.yaml)', async () => {
    const dir = fs.mkdtempSync(path.join(tmpDir, 'yarn-'));
    fs.writeFileSync(path.join(dir, 'yarn.lock'), '');
    expect(await launcher.detectPackageManager(dir)).toBe('yarn');
  });

  it('prefers pnpm over yarn when both lock files exist', async () => {
    const dir = fs.mkdtempSync(path.join(tmpDir, 'both-'));
    fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');
    fs.writeFileSync(path.join(dir, 'yarn.lock'), '');
    expect(await launcher.detectPackageManager(dir)).toBe('pnpm');
  });
});

// ── installDependencies ───────────────────────────────────────────────────────

describe('WorkspaceLauncher.installDependencies', () => {
  it('returns [packageManager, ["install"]]', () => {
    const [cmd, args] = launcher.installDependencies('/any/path', 'npm');
    expect(cmd).toBe('npm');
    expect(args).toEqual(['install']);
  });

  it('works with pnpm as package manager', () => {
    const [cmd] = launcher.installDependencies('/any/path', 'pnpm');
    expect(cmd).toBe('pnpm');
  });
});

// ── getStartCommand ───────────────────────────────────────────────────────────

describe('WorkspaceLauncher.getStartCommand', () => {
  it('uses "dev" script when available', () => {
    const dir = fs.mkdtempSync(path.join(tmpDir, 'dev-'));
    fs.writeFileSync(path.join(dir, 'package.json'), pkg({ dev: 'vite', start: 'node server' }));
    const [, args] = launcher.getStartCommand(dir, 'npm');
    expect(args).toContain('dev');
  });

  it('falls back to "start" when there is no "dev" script', () => {
    const dir = fs.mkdtempSync(path.join(tmpDir, 'start-'));
    fs.writeFileSync(path.join(dir, 'package.json'), pkg({ start: 'node server' }));
    const [, args] = launcher.getStartCommand(dir, 'npm');
    expect(args).toContain('start');
  });

  it('falls back to "preview" when no "dev" or "start" scripts exist', () => {
    const dir = fs.mkdtempSync(path.join(tmpDir, 'preview-'));
    fs.writeFileSync(path.join(dir, 'package.json'), pkg({ preview: 'vite preview' }));
    const [, args] = launcher.getStartCommand(dir, 'npm');
    expect(args).toContain('preview');
  });

  it('appends Vite port flags when vite is a dependency', () => {
    const dir = fs.mkdtempSync(path.join(tmpDir, 'vite-'));
    fs.writeFileSync(path.join(dir, 'package.json'), pkg({ dev: 'vite' }, { vite: '^5.0.0' }));
    const [, args] = launcher.getStartCommand(dir, 'npm', 3001);
    expect(args).toContain('--port');
    expect(args).toContain('3001');
    expect(args).toContain('--host');
    expect(args).toContain('0.0.0.0');
  });

  it('appends Next.js port flags when next is a dependency', () => {
    const dir = fs.mkdtempSync(path.join(tmpDir, 'next-'));
    fs.writeFileSync(path.join(dir, 'package.json'), pkg({ dev: 'next dev' }, { next: '^14.0.0' }));
    const [, args] = launcher.getStartCommand(dir, 'npm', 3002);
    expect(args).toContain('-p');
    expect(args).toContain('3002');
    expect(args).toContain('-H');
    expect(args).toContain('0.0.0.0');
  });

  it('does not append port flags when no port is given', () => {
    const dir = fs.mkdtempSync(path.join(tmpDir, 'noport-'));
    fs.writeFileSync(path.join(dir, 'package.json'), pkg({ dev: 'vite' }, { vite: '^5.0.0' }));
    const [, args] = launcher.getStartCommand(dir, 'npm');
    expect(args).not.toContain('--port');
  });

  it('returns package manager as the command', () => {
    const dir = fs.mkdtempSync(path.join(tmpDir, 'cmd-'));
    fs.writeFileSync(path.join(dir, 'package.json'), pkg({ dev: 'vite' }));
    const [cmd] = launcher.getStartCommand(dir, 'pnpm', 3000);
    expect(cmd).toBe('pnpm');
  });
});
