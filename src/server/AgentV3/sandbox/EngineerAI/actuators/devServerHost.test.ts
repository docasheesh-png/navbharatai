import { describe, it, expect } from 'vitest';
import { ensureHostBinding, buildPreKillPortCommand, buildPortWaitCommand } from './devServerHost';

describe('ensureHostBinding (v3.0 actuator)', () => {
  it('appends --host to a vite package-manager dev script', () => {
    expect(ensureHostBinding('npm run dev')).toBe('npm run dev -- --host 0.0.0.0');
    expect(ensureHostBinding('pnpm run dev')).toBe('pnpm run dev -- --host 0.0.0.0');
    expect(ensureHostBinding('yarn dev')).toBe('yarn dev -- --host 0.0.0.0');
  });

  it('appends --host to a bare vite command', () => {
    expect(ensureHostBinding('vite')).toBe('vite --host 0.0.0.0');
    expect(ensureHostBinding('npx vite')).toBe('npx vite --host 0.0.0.0');
  });

  it('uses -H for next dev', () => {
    expect(ensureHostBinding('next dev')).toBe('next dev -H 0.0.0.0');
    expect(ensureHostBinding('npx next dev')).toBe('npx next dev -H 0.0.0.0');
  });

  it('leaves a command that already binds a host untouched', () => {
    expect(ensureHostBinding('npm run dev -- --host 0.0.0.0')).toBe('npm run dev -- --host 0.0.0.0');
    expect(ensureHostBinding('vite --host')).toBe('vite --host');
    expect(ensureHostBinding('next dev -H 0.0.0.0')).toBe('next dev -H 0.0.0.0');
    expect(ensureHostBinding('HOST=0.0.0.0 npm start')).toBe('HOST=0.0.0.0 npm start');
  });

  it('does NOT touch an ambiguous `start` script (CRA needs HOST=, not --host)', () => {
    expect(ensureHostBinding('npm start')).toBe('npm start');
  });

  it('leaves a non-dev-server command untouched', () => {
    expect(ensureHostBinding('npm install')).toBe('npm install');
    expect(ensureHostBinding('npm run build')).toBe('npm run build');
    expect(ensureHostBinding('')).toBe('');
  });
});

describe('buildPreKillPortCommand', () => {
  it('targets exactly the given port with fuser', () => {
    expect(buildPreKillPortCommand(5173)).toContain('fuser -k 5173/tcp');
    expect(buildPreKillPortCommand(3000)).toContain('fuser -k 3000/tcp');
  });

  it('never fails the step (trailing `true`, all errors swallowed)', () => {
    const cmd = buildPreKillPortCommand(8000);
    expect(cmd.trim().endsWith('true')).toBe(true);
    expect(cmd).toContain('2>/dev/null');
  });

  it('does not pkill unrelated node processes (scopes to the port)', () => {
    // Must not be a blanket `pkill node` — that would kill the agent's own tooling.
    expect(buildPreKillPortCommand(5173)).toContain('pkill -f "node.*:5173"');
    expect(buildPreKillPortCommand(5173)).not.toMatch(/pkill\s+-f\s+"node"\s/);
  });
});

describe('buildPortWaitCommand', () => {
  it('polls the given port and exits early on PORT_UP', () => {
    const cmd = buildPortWaitCommand(5173, 25);
    expect(cmd).toContain('nc -z localhost 5173');
    expect(cmd).toContain('echo PORT_UP; exit 0');
    expect(cmd).toContain('echo PORT_DOWN');
  });

  it('runs exactly maxSeconds 1-second iterations', () => {
    expect(buildPortWaitCommand(3000, 25)).toContain('seq 1 25');
    expect(buildPortWaitCommand(3000, 20)).toContain('seq 1 20');
    expect(buildPortWaitCommand(3000, 25)).toContain('sleep 1');
  });

  it('clamps a non-positive budget to at least one iteration (never an instant DOWN)', () => {
    expect(buildPortWaitCommand(3000, 0)).toContain('seq 1 1');
    expect(buildPortWaitCommand(3000, -5)).toContain('seq 1 1');
  });

  it('floors a fractional budget to whole iterations', () => {
    expect(buildPortWaitCommand(3000, 25.9)).toContain('seq 1 25');
  });
});
