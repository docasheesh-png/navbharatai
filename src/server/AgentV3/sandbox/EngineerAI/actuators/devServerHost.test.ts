import { describe, it, expect } from 'vitest';
import { ensureHostBinding, buildPreKillPortCommand, buildPortWaitCommand, pinDevServerPort, detectDevPort, stripDevServerBackgrounding, buildDepsStaleCheckCommand, isLongRunningCommand } from './devServerHost';

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
  it('targets exactly the given port across every mechanism', () => {
    const cmd = buildPreKillPortCommand(5173);
    expect(cmd).toContain('fuser -k 5173/tcp');
    expect(cmd).toContain('lsof -ti tcp:5173');
    expect(cmd).toContain('sport = :5173');
    expect(buildPreKillPortCommand(3000)).toContain('fuser -k 3000/tcp');
  });

  it('tries multiple tools so a missing fuser/lsof still frees the port', () => {
    const cmd = buildPreKillPortCommand(5173);
    // fuser (psmisc) may be absent in the E2B image — lsof and ss are the fallbacks.
    expect(cmd).toContain('lsof');
    expect(cmd).toContain('ss -lptnH');
  });

  it('never fails the step (trailing `true`, all errors swallowed)', () => {
    const cmd = buildPreKillPortCommand(8000);
    expect(cmd.trim().endsWith('true')).toBe(true);
    expect(cmd).toContain('2>/dev/null');
  });

  it('does NOT use the old Vite-blind `node.*:{port}` pattern (it never matched a real vite process)', () => {
    expect(buildPreKillPortCommand(5173)).not.toContain('node.*:5173');
  });
});

describe('pinDevServerPort', () => {
  it('pins a vite command to a fixed port with --strictPort (no silent 5173→5174 drift)', () => {
    expect(pinDevServerPort('vite --host 0.0.0.0', 5173)).toBe('vite --host 0.0.0.0 --port 5173 --strictPort');
    expect(pinDevServerPort('npm run dev -- --host 0.0.0.0', 5173)).toBe('npm run dev -- --host 0.0.0.0 --port 5173 --strictPort');
  });

  it('pins a next command with -p', () => {
    expect(pinDevServerPort('next dev -H 0.0.0.0', 3000)).toBe('next dev -H 0.0.0.0 -p 3000');
  });

  it('respects an already-pinned port', () => {
    expect(pinDevServerPort('vite --port 4000', 5173)).toBe('vite --port 4000');
    expect(pinDevServerPort('next dev -p 3001', 3000)).toBe('next dev -p 3001');
  });

  it('leaves a non-vite/next command untouched (rely on runtime detection)', () => {
    expect(pinDevServerPort('python -m http.server 8000', 8000)).toBe('python -m http.server 8000');
    expect(pinDevServerPort('', 5173)).toBe('');
  });
});

describe('detectDevPort', () => {
  it('reads the real port from a vite banner', () => {
    expect(detectDevPort('  ➜  Local:   http://localhost:5174/', 5173)).toBe(5174);
    expect(detectDevPort('VITE ready\n  ➜  Local:   http://localhost:5173/', 5173)).toBe(5173);
  });

  it('reads the real port from a next / generic banner', () => {
    expect(detectDevPort('- Local:        http://localhost:3001', 3000)).toBe(3001);
    expect(detectDevPort('The server is running on port 5174.', 5173)).toBe(5174);
    expect(detectDevPort('listening on 0.0.0.0:4321', 8000)).toBe(4321);
  });

  it('falls back when no port is present in the output', () => {
    expect(detectDevPort('starting…', 5173)).toBe(5173);
    expect(detectDevPort('', 3000)).toBe(3000);
  });
});

describe('isLongRunningCommand', () => {
  it('detects bare/npx/node Vite invocations (the ones that hit the 300s timeout in the report)', () => {
    expect(isLongRunningCommand('npx vite --host 0.0.0.0 --port 5173')).toBe(true);
    expect(isLongRunningCommand('vite --host 0.0.0.0')).toBe(true);
    expect(isLongRunningCommand('node node_modules/vite/bin/vite.js --host 0.0.0.0 --port 5173')).toBe(true);
    expect(isLongRunningCommand('npx vite preview')).toBe(true);
  });

  it('does NOT treat `vite build` (compiles then exits) as long-running', () => {
    expect(isLongRunningCommand('npx vite build')).toBe(false);
    expect(isLongRunningCommand('vite build --mode production')).toBe(false);
    expect(isLongRunningCommand('npm run build')).toBe(false);
  });

  it('still detects the dev-server forms it already knew', () => {
    expect(isLongRunningCommand('npm run dev')).toBe(true);
    expect(isLongRunningCommand('npm run dev -- --host 0.0.0.0')).toBe(true);
    expect(isLongRunningCommand('next dev -H 0.0.0.0')).toBe(true);
    expect(isLongRunningCommand('bash dev.sh')).toBe(true);
    expect(isLongRunningCommand('uvicorn main:app')).toBe(true);
  });

  it('treats one-shot fetches and ordinary commands as NOT long-running', () => {
    expect(isLongRunningCommand('curl -s http://localhost:5173/serve')).toBe(false);
    expect(isLongRunningCommand('npm install')).toBe(false);
    expect(isLongRunningCommand('npx tsc --noEmit')).toBe(false);
    expect(isLongRunningCommand('')).toBe(false);
  });
});

describe('stripDevServerBackgrounding', () => {
  it('strips a trailing `&` so vite is not orphaned + reaped by E2B (the "Killed" loop)', () => {
    // Every launch in the failing build report ended in `&` and printed "Killed" after "ready".
    expect(stripDevServerBackgrounding('npm run dev -- --host 0.0.0.0 --port 5173 &> /tmp/vite.log &'))
      .toBe('npm run dev -- --host 0.0.0.0 --port 5173');
    expect(stripDevServerBackgrounding('npx vite --host 0.0.0.0 --port 5173 > /tmp/vite2.log 2>&1 &'))
      .toBe('npx vite --host 0.0.0.0 --port 5173');
    expect(stripDevServerBackgrounding('node node_modules/vite/bin/vite.js --host 0.0.0.0 --port 5173 > /tmp/vdev.log 2>&1 &'))
      .toBe('node node_modules/vite/bin/vite.js --host 0.0.0.0 --port 5173');
  });

  it('drops a leading `nohup` (pointless under E2B background, muddies process tracking)', () => {
    expect(stripDevServerBackgrounding('nohup npm run dev > /tmp/vite_out.log 2>&1 &'))
      .toBe('npm run dev');
    expect(stripDevServerBackgrounding('nohup npm run dev')).toBe('npm run dev');
  });

  it('leaves a normal foreground command byte-for-byte unchanged', () => {
    expect(stripDevServerBackgrounding('npm run dev')).toBe('npm run dev');
    expect(stripDevServerBackgrounding('npm run dev -- --host 0.0.0.0')).toBe('npm run dev -- --host 0.0.0.0');
    expect(stripDevServerBackgrounding('')).toBe('');
  });

  it('does NOT mistake `&&` for backgrounding', () => {
    expect(stripDevServerBackgrounding('npm ci && npm run dev')).toBe('npm ci && npm run dev');
  });
});

describe('buildDepsStaleCheckCommand', () => {
  it('prints STALE when node_modules is missing or package.json is newer (declared-but-not-installed deps)', () => {
    const cmd = buildDepsStaleCheckCommand();
    expect(cmd).toContain('[ ! -d node_modules ]');
    expect(cmd).toContain('[ package.json -nt node_modules ]');
    expect(cmd).toContain('echo STALE');
    expect(cmd.trim().endsWith('true')).toBe(true); // clean tree exits 0, never fails the step
  });
});

describe('buildPortWaitCommand', () => {
  it('polls the given port with a tool-agnostic, IPv4-forced check and exits early on PORT_UP', () => {
    const cmd = buildPortWaitCommand(5173, 25);
    // Forces IPv4 (127.0.0.1, not localhost) and tries nc → curl → /dev/tcp so a missing tool or an
    // IPv6 `localhost` mismatch can no longer read a healthy dev server as DOWN.
    expect(cmd).toContain('127.0.0.1');
    expect(cmd).not.toContain('nc -z localhost');
    expect(cmd).toContain('nc -z 127.0.0.1 5173');
    expect(cmd).toContain('curl -s -o /dev/null');
    expect(cmd).toContain('/dev/tcp/127.0.0.1/5173');
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
