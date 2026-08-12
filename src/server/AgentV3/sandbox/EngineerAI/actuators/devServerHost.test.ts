import { describe, it, expect } from 'vitest';
import { ensureHostBinding, buildPreKillPortCommand, buildPortWaitCommand, pinDevServerPort, detectDevPort, shouldReprobeBoundPort, shouldSkipDevServerLaunch, stripDevServerBackgrounding, buildDepsStaleCheckCommand, buildBuildInstallCommand, isLongRunningCommand, disableDevServerAutoOpen, redirectDevServerOutput, resolvePmScript, detectDevFramework, isNodeServerCommand, pipesOrChainsToAnotherCommand, backgroundedServerSmokeCheckMs, DEV_SERVER_LOG_PATH , buildHttpLivenessCommand, devServerWatchdogCommand, parseDevServerWatchdogLog, DEV_SERVER_WATCHDOG_MARKER, DEV_SERVER_WATCHDOG_LOG } from './devServerHost';

describe('isNodeServerCommand (Mitrify node-express import fix 2026-07-24)', () => {
  it('detects a direct Node server launcher (tsx/ts-node/node/nodemon on a server entry)', () => {
    expect(isNodeServerCommand('tsx server/index.ts')).toBe(true);
    expect(isNodeServerCommand('NODE_ENV=development tsx server/index.ts')).toBe(true);
    expect(isNodeServerCommand('node dist/server.js')).toBe(true);
    expect(isNodeServerCommand('nodemon app.js')).toBe(true);
    expect(isNodeServerCommand('ts-node src/main.ts')).toBe(true);
    expect(isNodeServerCommand('node backend/api.js')).toBe(true);
  });
  it('does NOT match a bundler/dev-CLI (those are owned by the framework branches)', () => {
    expect(isNodeServerCommand('vite')).toBe(false);
    expect(isNodeServerCommand('node node_modules/vite/bin/vite.js')).toBe(false);
    expect(isNodeServerCommand('next dev')).toBe(false);
    expect(isNodeServerCommand('astro dev')).toBe(false);
    expect(isNodeServerCommand('npm run dev')).toBe(false); // pm-run, not a bare node server
    expect(isNodeServerCommand('')).toBe(false);
  });
});

describe('piped/chained dev commands never get flags appended (report 7773b4b0 — "head: cannot open \'--host\'")', () => {
  it('a `npm run dev | head` inspection command is left UNTOUCHED by both helpers', () => {
    const cmd = 'npm run dev 2>&1 | head -50';
    expect(ensureHostBinding(cmd)).toBe(cmd);
    expect(pinDevServerPort(ensureHostBinding(cmd), 3000)).toBe(cmd);
  });
  it('chained commands (&&, ;, ||) are also left untouched', () => {
    expect(ensureHostBinding('npm run dev && echo done')).toBe('npm run dev && echo done');
    expect(pinDevServerPort('npm run dev ; ls', 3000)).toBe('npm run dev ; ls');
    expect(pinDevServerPort('npm run dev || echo fail', 3000)).toBe('npm run dev || echo fail');
  });
  it('a CLEAN dev command (with only a 2>&1 redirect, no pipe/chain) is still flagged normally', () => {
    // 2>&1 is not a chain — the managed preview must still get --host/--port.
    expect(ensureHostBinding('vite')).toBe('vite --host 0.0.0.0');
    expect(pinDevServerPort('vite', 5173)).toBe('vite --port 5173 --strictPort');
    expect(pipesOrChainsToAnotherCommand('npm run dev 2>&1')).toBe(false);
    expect(pipesOrChainsToAnotherCommand('npm run dev 2>&1 | head')).toBe(true);
  });
});

describe('node-server preview: PORT + HOST are injected so the health-check watches the right port (Mitrify)', () => {
  it('ensureHostBinding prefixes HOST=0.0.0.0 for a bare node server (reachable on the public preview)', () => {
    expect(ensureHostBinding('tsx server/index.ts')).toBe('HOST=0.0.0.0 tsx server/index.ts');
    // already binds a host → untouched
    expect(ensureHostBinding('HOST=0.0.0.0 tsx server/index.ts')).toBe('HOST=0.0.0.0 tsx server/index.ts');
  });
  it('pinDevServerPort prefixes PORT=<port> for a bare node server', () => {
    expect(pinDevServerPort('tsx server/index.ts', 3000)).toBe('PORT=3000 tsx server/index.ts');
    // composed with ensureHostBinding (the real call site order)
    expect(pinDevServerPort(ensureHostBinding('tsx server/index.ts'), 3000))
      .toBe('PORT=3000 HOST=0.0.0.0 tsx server/index.ts');
    // an explicit PORT= or --port is respected (never double-injected)
    expect(pinDevServerPort('PORT=5000 tsx server/index.ts', 3000)).toBe('PORT=5000 tsx server/index.ts');
  });
});

describe('disableDevServerAutoOpen (v5.0 actuator) — stop xdg-open ENOENT crashing the preview', () => {
  it('prepends BROWSER=none so Vite/CRA skip the browser auto-open spawn', () => {
    expect(disableDevServerAutoOpen('npm run dev -- --host 0.0.0.0 --port 5173')).toBe('BROWSER=none npm run dev -- --host 0.0.0.0 --port 5173');
    expect(disableDevServerAutoOpen('vite --host 0.0.0.0')).toBe('BROWSER=none vite --host 0.0.0.0');
  });
  it('is idempotent — never double-prefixes when BROWSER is already set', () => {
    expect(disableDevServerAutoOpen('BROWSER=none vite')).toBe('BROWSER=none vite');
    expect(disableDevServerAutoOpen('BROWSER=chrome npm run dev')).toBe('BROWSER=chrome npm run dev');
  });
  it('leaves an empty command untouched', () => {
    expect(disableDevServerAutoOpen('')).toBe('');
  });
});

describe('redirectDevServerOutput — stop the dev server SIGPIPE-killing itself after disconnect', () => {
  it('wraps the command in a subshell redirecting stdout+stderr to the log file', () => {
    expect(redirectDevServerOutput('npx vite --host 0.0.0.0 --port 5173')).toBe(
      `( npx vite --host 0.0.0.0 --port 5173 ) > ${DEV_SERVER_LOG_PATH} 2>&1`,
    );
  });
  it('captures an env-prefixed / piped command whole (the report case: BROWSER=none … | cat)', () => {
    expect(redirectDevServerOutput('BROWSER=none npx vite --host 0.0.0.0 | cat')).toBe(
      `( BROWSER=none npx vite --host 0.0.0.0 | cat ) > ${DEV_SERVER_LOG_PATH} 2>&1`,
    );
  });
  it('is idempotent — never double-redirects to the same log', () => {
    const once = redirectDevServerOutput('npm run dev');
    expect(redirectDevServerOutput(once)).toBe(once);
  });
  it('supports a custom log path and leaves an empty command untouched', () => {
    expect(redirectDevServerOutput('vite', '/tmp/x.log')).toBe('( vite ) > /tmp/x.log 2>&1');
    expect(redirectDevServerOutput('')).toBe('');
  });
});

describe('ensureHostBinding (v5.0 actuator)', () => {
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

describe('detectDevFramework — identify the tool from a concrete command', () => {
  it('recognizes each supported framework', () => {
    expect(detectDevFramework('vite')).toBe('vite');
    expect(detectDevFramework('node node_modules/vite/bin/vite.js')).toBe('vite');
    expect(detectDevFramework('next dev')).toBe('next');
    expect(detectDevFramework('astro dev')).toBe('astro');
    expect(detectDevFramework('nuxt dev')).toBe('nuxt');
    expect(detectDevFramework('nuxi dev')).toBe('nuxt');
    expect(detectDevFramework('ng serve')).toBe('angular');
    expect(detectDevFramework('react-scripts start')).toBe('cra');
  });
  it('returns undefined for an unrecognized or empty command (caller keeps the Vite default)', () => {
    expect(detectDevFramework('npm run dev')).toBeUndefined();
    expect(detectDevFramework('python -m http.server')).toBeUndefined();
    expect(detectDevFramework('')).toBeUndefined();
  });
});

describe('resolvePmScript — map `npm run dev` to its real underlying tool', () => {
  it('resolves a pm-run script to its body from package.json scripts', () => {
    expect(resolvePmScript('npm run dev', { dev: 'astro dev' })).toBe('astro dev');
    expect(resolvePmScript('pnpm dev', { dev: 'vite' })).toBe('vite');
    expect(resolvePmScript('yarn serve', { serve: 'ng serve' })).toBe('ng serve');
    expect(resolvePmScript('bun run dev', { dev: 'next dev' })).toBe('next dev');
    expect(resolvePmScript('npm start', { start: 'react-scripts start' })).toBe('react-scripts start');
  });
  it('carries through explicit args passed after `--` so port detection still sees them', () => {
    expect(resolvePmScript('npm run dev -- --port 8080', { dev: 'vite' })).toBe('vite --port 8080');
  });
  it('returns the command unchanged when it is not a pm-run, the script is missing, or no scripts given', () => {
    expect(resolvePmScript('vite --host', { dev: 'vite' })).toBe('vite --host');
    expect(resolvePmScript('npm run dev', { build: 'vite build' })).toBe('npm run dev');
    expect(resolvePmScript('npm run dev', null)).toBe('npm run dev');
    expect(resolvePmScript('', { dev: 'vite' })).toBe('');
  });
});

describe('ensureHostBinding — framework-aware host flag', () => {
  it('is BYTE-IDENTICAL to the historical Vite behaviour when no framework is given', () => {
    expect(ensureHostBinding('npm run dev')).toBe('npm run dev -- --host 0.0.0.0');
    expect(ensureHostBinding('npm run dev', 'vite')).toBe('npm run dev -- --host 0.0.0.0');
  });
  it('uses `-H` (not the Vite `--host`) for a Next.js pm-run script', () => {
    // `next dev` errors on an unknown `--host` flag — passing it left the preview down.
    expect(ensureHostBinding('npm run dev', 'next')).toBe('npm run dev -- -H 0.0.0.0');
  });
  it('keeps --host for astro/nuxt/angular (they accept it)', () => {
    expect(ensureHostBinding('npm run dev', 'astro')).toBe('npm run dev -- --host 0.0.0.0');
    expect(ensureHostBinding('npm run dev', 'nuxt')).toBe('npm run dev -- --host 0.0.0.0');
    expect(ensureHostBinding('yarn dev', 'angular')).toBe('yarn dev -- --host 0.0.0.0');
  });
  it('leaves a CRA pm-run script untouched (react-scripts reads HOST= from the env, not a flag)', () => {
    expect(ensureHostBinding('npm run dev', 'cra')).toBe('npm run dev');
  });
});

describe('pinDevServerPort — framework-aware port pinning (no Vite-only --strictPort on other tools)', () => {
  it('is BYTE-IDENTICAL to the historical Vite behaviour when no framework is given', () => {
    expect(pinDevServerPort('npm run dev -- --host 0.0.0.0', 5173)).toBe('npm run dev -- --host 0.0.0.0 --port 5173 --strictPort');
    expect(pinDevServerPort('npm run dev -- --host 0.0.0.0', 5173, 'vite')).toBe('npm run dev -- --host 0.0.0.0 --port 5173 --strictPort');
  });
  it('pins a Next.js pm-run script with -p (never --strictPort)', () => {
    expect(pinDevServerPort('npm run dev -- -H 0.0.0.0', 3000, 'next')).toBe('npm run dev -- -H 0.0.0.0 -p 3000');
  });
  it('pins astro/nuxt/angular with a plain --port and DROPS the Vite-only --strictPort (which crashes them)', () => {
    expect(pinDevServerPort('npm run dev -- --host 0.0.0.0', 4321, 'astro')).toBe('npm run dev -- --host 0.0.0.0 --port 4321');
    expect(pinDevServerPort('npm run dev -- --host 0.0.0.0', 3000, 'nuxt')).toBe('npm run dev -- --host 0.0.0.0 --port 3000');
    expect(pinDevServerPort('yarn dev -- --host 0.0.0.0', 4200, 'angular')).toBe('yarn dev -- --host 0.0.0.0 --port 4200');
    expect(pinDevServerPort('npm run dev -- --host 0.0.0.0', 4321, 'astro')).not.toContain('--strictPort');
  });
  it('leaves a CRA pm-run script untouched (react-scripts takes neither --port nor --strictPort)', () => {
    expect(pinDevServerPort('npm run dev', 3000, 'cra')).toBe('npm run dev');
  });
  it('still respects an already-pinned port regardless of framework', () => {
    expect(pinDevServerPort('npm run dev -- --port 4000', 5173, 'astro')).toBe('npm run dev -- --port 4000');
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

  // MITRIFY AUTOPSY 2026-08-05. The recovery freed only the port the health check WATCHES (3000) while
  // the app's real bind failed on 5000 — so the orphan holding 5000 survived every attempt and
  // "automatic recovery is exhausted" was guaranteed before the first restart even ran.
  it('frees EVERY given port, so the watched port and the truly-occupied one are both cleared', () => {
    const cmd = buildPreKillPortCommand([3000, 5000]);
    for (const p of [3000, 5000]) {
      expect(cmd).toContain(`fuser -k ${p}/tcp`);
      expect(cmd).toContain(`lsof -ti tcp:${p}`);
      expect(cmd).toContain(`sport = :${p}`);
    }
    expect(cmd.trim().endsWith('true')).toBe(true);
  });

  it('a single number behaves exactly as before (no caller had to change)', () => {
    expect(buildPreKillPortCommand([5173])).toBe(buildPreKillPortCommand(5173));
  });

  it('de-duplicates and drops nonsense ports rather than emitting a broken kill', () => {
    expect(buildPreKillPortCommand([3000, 3000])).toBe(buildPreKillPortCommand(3000));
    expect(buildPreKillPortCommand([0, -1, 70000, NaN])).toBe('true');
    expect(buildPreKillPortCommand([])).toBe('true');
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

describe('shouldReprobeBoundPort — re-verify a drifted port even when the assumed port read DOWN', () => {
  it('re-probes when the server bound a DIFFERENT port than assumed (the false-DOWN root case)', () => {
    // The regression: assumed 5173 polled DOWN, but the server actually bound 5174 and is healthy.
    // The old `portUp && …` guard skipped this re-probe, so the health line said DOWN forever.
    expect(shouldReprobeBoundPort(5173, 5174)).toBe(true);
    expect(shouldReprobeBoundPort(3000, 5173)).toBe(true);
  });
  it('does NOT re-probe when the bound port matches the assumed port (no drift, no wasted poll)', () => {
    expect(shouldReprobeBoundPort(5173, 5173)).toBe(false);
    expect(shouldReprobeBoundPort(3000, 3000)).toBe(false);
  });
  it('does NOT re-probe on a bogus bound port (detectDevPort fallback / parse noise)', () => {
    expect(shouldReprobeBoundPort(5173, 0)).toBe(false);
    expect(shouldReprobeBoundPort(5173, -1)).toBe(false);
    expect(shouldReprobeBoundPort(5173, NaN)).toBe(false);
    expect(shouldReprobeBoundPort(5173, 5173.5)).toBe(false);
  });
});

describe('backgroundedServerSmokeCheckMs (deep-test App #7/#8/#9 — the 300s server-hang)', () => {
  it('caps the exact failing smoke-check (npm run server & sleep; curl) instead of blocking 300s', () => {
    // App #9's real command that hit `deadline_exceeded` (300s) TWICE.
    expect(backgroundedServerSmokeCheckMs('npm run server 2>&1 &\nsleep 5\ncurl -s http://localhost:3001/health')).toBe(45_000);
    expect(backgroundedServerSmokeCheckMs('npm start & sleep 3; curl localhost:3000')).toBe(45_000);
    expect(backgroundedServerSmokeCheckMs('node server/index.js & sleep 2 && curl localhost:8080/health')).toBe(45_000);
    expect(backgroundedServerSmokeCheckMs('tsx watch server/index.ts & sleep 4; curl localhost:3001')).toBe(45_000);
  });

  it('respects a custom cap', () => {
    expect(backgroundedServerSmokeCheckMs('npm run server & sleep 5; curl x', 20_000)).toBe(20_000);
  });

  it('does NOT cap ordinary commands (never shortens a legit build/install/foreground server)', () => {
    expect(backgroundedServerSmokeCheckMs('npm install')).toBeNull();
    expect(backgroundedServerSmokeCheckMs('npm run build')).toBeNull();
    expect(backgroundedServerSmokeCheckMs('npm run dev')).toBeNull();            // foreground; long-running path owns it
    expect(backgroundedServerSmokeCheckMs('npm run server')).toBeNull();          // no backgrounding → not this pattern
    expect(backgroundedServerSmokeCheckMs('npm run build && npm run server')).toBeNull(); // `&&` is not backgrounding
    expect(backgroundedServerSmokeCheckMs('npx prisma migrate dev --name init')).toBeNull();
    expect(backgroundedServerSmokeCheckMs('rm -rf node_modules && npm install')).toBeNull();
  });

  it('does NOT cap a bare trailing-& dev server (that is the long-running background path, not this)', () => {
    // A trailing `&` with nothing after it is handled by stripDevServerBackgrounding + the bg launch.
    expect(backgroundedServerSmokeCheckMs('npm run server &')).toBeNull();
    expect(backgroundedServerSmokeCheckMs('npm run dev &')).toBeNull();
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

  it('detects `npm/pnpm/yarn run preview` (the vite-preview wrapper that hit the 300s timeout in the report)', () => {
    // Real build report: `$ npm run preview -- --host 0.0.0.0 --port 4173 → 300s deadline_exceeded`
    // ran TWICE — 10 min wasted — because it was NOT recognized as long-running and blocked in the
    // foreground for the full command timeout. It must be backgrounded like any other dev/preview server.
    expect(isLongRunningCommand('npm run preview')).toBe(true);
    expect(isLongRunningCommand('npm run preview -- --host 0.0.0.0 --port 4173')).toBe(true);
    expect(isLongRunningCommand('pnpm run preview')).toBe(true);
    expect(isLongRunningCommand('yarn run preview')).toBe(true);
  });

  it('treats one-shot fetches and ordinary commands as NOT long-running', () => {
    expect(isLongRunningCommand('curl -s http://localhost:5173/serve')).toBe(false);
    expect(isLongRunningCommand('npm install')).toBe(false);
    expect(isLongRunningCommand('npx tsc --noEmit')).toBe(false);
    expect(isLongRunningCommand('')).toBe(false);
  });

  it('does NOT treat pkill/ps/grep/head as long-running just because they reference "vite" as a filter (real build-report regression)', () => {
    // Confirmed from a real failing build report: these were misrouted into the background-dev-
    // server-start path, which force-killed the port then tried to "launch" the command with
    // --host/--port/--strictPort appended — pkill/grep/head reject those as unrecognized options
    // ("pkill: unrecognized option '--host'"), so the agent's own kill/inspect commands silently
    // failed and it looped restarting a server it could never actually verify or stop.
    expect(isLongRunningCommand('pkill -f "vite"')).toBe(false);
    expect(isLongRunningCommand('pkill -f "vite.*5173" || true')).toBe(false);
    expect(isLongRunningCommand('ps aux | grep vite')).toBe(false);
    expect(isLongRunningCommand('ps aux | grep -E "vite|node" | grep -v grep | head -10')).toBe(false);
    expect(isLongRunningCommand('netstat -tlnp 2>&1 | grep 5173 || echo "Port 5173 not in use"')).toBe(false);
  });

  it('STILL detects a compound command that kills the old server then starts a new one (real regression from the pkill/ps/grep fix above)', () => {
    // The FIX above (excluding a whole command starting with pkill/ps/grep/…) had its own regression:
    // a real build report showed the agent chaining "kill stale process; restart it" as ONE command —
    // `pkill -f "vite" 2>/dev/null; sleep 1; npm run dev 2>&1 &`. Excluding the WHOLE command here (it
    // starts with pkill) skipped ensureHostBinding/stripDevServerBackgrounding for the REAL npm-run-dev
    // segment at the end, so the agent's own trailing `&` was never stripped and the dev server got
    // orphaned + reaped — the exact "Killed right after ready" bug, just reached via a different path.
    // Each chained segment must be judged on its own: a one-shot prefix segment's own "vite" mention
    // still doesn't count, but a LATER segment that genuinely starts a dev server still must.
    expect(isLongRunningCommand('pkill -f "vite" 2>/dev/null; sleep 1; npm run dev 2>&1 &')).toBe(true);
    expect(isLongRunningCommand('pkill -f "vite"; npx vite --host 0.0.0.0')).toBe(true);
    expect(isLongRunningCommand('ps aux | grep vite && npm run dev')).toBe(true);
  });
});

/**
 * ADMIN REPORT 2026-08-12 — the dukaan stock app. The user's preview was a **Closed Port Error** on a
 * build that had just told them, in their own language, "App live hai".
 *
 * The chain, from the report's own transcript:
 *   1. The agent ran `npm run server` (the backend, `tsx watch server/index.ts` under the hood).
 *   2. `isLongRunningCommand` said FALSE — `serve\b` does not match "server", and the script body is
 *      invisible here: at classification time we see only the script NAME.
 *   3. So it took the FOREGROUND path, blocked for the whole command timeout, and returned
 *      `deadline_exceeded` — **while the process it started stayed alive**.
 *   4. The build, told the command had failed, ran it again — into its own orphan:
 *          Error: listen EADDRINUSE: address already in use :::3000
 *   5. The backend died. The app runs server+client under `concurrently`, so the CLIENT died with it.
 *      Port 5173 went dead, and that dead port is what the user was handed.
 *
 * This is a CLASSIFICATION bug, not a crash — every recovery mechanism the engine owns (pre-kill,
 * port fast-path, keepalive watchdog) lives on the background path and none of them was reachable.
 * Fixing the classification is the upstream half (50/50 law): the collision stops being something to
 * recover from and becomes something that cannot occur.
 */
describe('the backend is a long-running server too (dukaan stock app, 2026-08-12)', () => {
  it('the exact command from the report is long-running', () => {
    expect(isLongRunningCommand('npm run server')).toBe(true);
  });

  it('…and its siblings, whatever a scaffold happened to name the script', () => {
    for (const c of [
      'npm run server', 'pnpm run api', 'yarn run backend',
      'npm run dev:server', 'npm run dev:api', 'npm run start:server', 'npm run devserver',
    ]) {
      expect(isLongRunningCommand(c), c).toBe(true);
    }
  });

  it('detects the TOOLS those scripts run, when invoked directly', () => {
    // `npm run server` resolves to one of these; the agent also types them by hand.
    expect(isLongRunningCommand('tsx watch server/index.ts')).toBe(true);
    expect(isLongRunningCommand('nodemon server/index.js')).toBe(true);
    expect(isLongRunningCommand('ts-node-dev --respawn src/main.ts')).toBe(true);
  });

  it('a ONE-SHOT script whose name merely starts with "server" is NOT long-running', () => {
    /**
     * THE PRECISION LINE, and the reason the patterns are anchored on the script name with `(?!:)`
     * rather than a loose `server` substring. Routing a build/typecheck into the background path would
     * make it return the moment a port is up — i.e. report a compile it never waited for. A false
     * positive here is a fake success, which is worse than the bug being fixed.
     */
    for (const c of [
      'npm run server:build', 'npm run build:server', 'npm run server:test',
      'npm run api:types', 'npm run backend:migrate', 'npm run build', 'npm install',
    ]) {
      expect(isLongRunningCommand(c), c).toBe(false);
    }
  });

  it('inspecting the backend is still not starting it', () => {
    // The ONE_SHOT_PREFIX rule above must keep applying to the new patterns.
    expect(isLongRunningCommand('pkill -f "npm run server"')).toBe(false);
    expect(isLongRunningCommand('ps aux | grep "npm run server"')).toBe(false);
    // …but a kill-then-restart chain still starts one, exactly as for the client.
    expect(isLongRunningCommand('pkill -f node; sleep 1; npm run server')).toBe(true);
  });
});

describe('the backend reaches the public preview on the port it actually binds', () => {
  /**
   * Classification alone would be a half fix: the background path must also aim at the RIGHT port and
   * the RIGHT host, or the pre-kill frees a port nobody is holding and the health check watches a port
   * nobody is serving. Both decisions are made from the RESOLVED script, because `npm run server`
   * carries neither signal.
   */
  const RESOLVED = 'tsx watch server/index.ts';

  it('the port is pinned from the resolved script, so the pre-kill and the health check agree with the app', () => {
    expect(pinDevServerPort('npm run server', 3000, undefined, RESOLVED)).toBe('PORT=3000 npm run server');
  });

  it('the HOST is forced from the resolved script too — the drifted sibling of report 26a8e81c', () => {
    /**
     * `pinDevServerPort` was taught to look THROUGH the pm script; `ensureHostBinding`, one function
     * above it in the same file, was not. So an Express app that binds `localhost` by default came up
     * healthy on the sandbox's own probe and returned nothing on the PUBLIC preview URL — a blank page
     * on a working app, from the identical "we tested the wrong string" defect.
     */
    expect(ensureHostBinding('npm run server', undefined, RESOLVED)).toBe('HOST=0.0.0.0 npm run server');
  });

  it('composes into a single valid command, the way the actuator calls it', () => {
    expect(pinDevServerPort(ensureHostBinding('npm run server', undefined, RESOLVED), 3000, undefined, RESOLVED))
      .toBe('PORT=3000 HOST=0.0.0.0 npm run server');
  });

  it('an explicit host or port the caller already set is still respected', () => {
    expect(ensureHostBinding('HOST=127.0.0.1 npm run server', undefined, RESOLVED)).toBe('HOST=127.0.0.1 npm run server');
    expect(pinDevServerPort('PORT=8080 npm run server', 3000, undefined, RESOLVED)).toBe('PORT=8080 npm run server');
  });

  it('omitting the resolved script behaves exactly as before — every existing caller is unchanged', () => {
    expect(ensureHostBinding('npm run dev')).toBe('npm run dev -- --host 0.0.0.0');
    expect(ensureHostBinding('npm run server')).toBe('npm run server');
    expect(ensureHostBinding('vite', 'vite')).toBe('vite --host 0.0.0.0');
  });

  it('a FRONTEND script is not turned into a node server by a stray resolved string', () => {
    // The resolved script decides, and `vite` is not a node server — no HOST= prefix, the Vite flag.
    expect(ensureHostBinding('npm run dev', 'vite', 'vite')).toBe('npm run dev -- --host 0.0.0.0');
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

  it('also STALEs a present-but-INCOMPLETE node_modules via a resolve probe (the caniuse-lite fix)', () => {
    const cmd = buildDepsStaleCheckCommand();
    // Every declared dep must resolve — catches a pre-baked/pruned image tree that mtime reads as "fresh".
    expect(cmd).toContain("require.resolve(k+'/package.json')");
    // For the babel React plugin, its browserslist→caniuse-lite DATA chain (the exact missing module in
    // "[plugin:vite:react-babel] Cannot find module 'caniuse-lite/dist/unpacker/agents'") must resolve too.
    expect(cmd).toContain("require.resolve('caniuse-lite/dist/unpacker/agents')");
    expect(cmd).toContain("d['@vitejs/plugin-react']");
    // A probe failure must reinstall (echo STALE), and the healthy path must never fail the step.
    expect(cmd).toContain('echo STALE');
    expect(cmd.trim().endsWith('true')).toBe(true);
  });
});

describe('buildBuildInstallCommand', () => {
  it('ALWAYS runs a real npm install — never the "deps present" skip that missed transitive deps', () => {
    const cmd = buildBuildInstallCommand();
    expect(cmd).toContain('npm install');
    // No skip/short-circuit: a just-written package.json must have its FULL tree installed.
    expect(cmd).not.toContain('deps present');
    expect(cmd).not.toContain('node_modules ]');
    expect(cmd).not.toMatch(/\bif\b/);
  });
  it('retries with --legacy-peer-deps on an ERESOLVE failure (EventHive dev-server-death defense)', () => {
    const cmd = buildBuildInstallCommand();
    // A strict install first, then a `||` fallback that adds --legacy-peer-deps so a peer conflict
    // (which the agent recovers from manually) can't silently stop the dev server from booting.
    expect(cmd).toContain('||');
    expect(cmd).toContain('--legacy-peer-deps');
    // The strict install still leads — no behaviour change on a clean install.
    expect(cmd.indexOf('npm install')).toBeLessThan(cmd.indexOf('--legacy-peer-deps'));
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

describe('shouldSkipDevServerLaunch (E6 — reuse an already-healthy dev server)', () => {
  it('skips ONLY when the port is already UP and deps are NOT stale', () => {
    expect(shouldSkipDevServerLaunch(true, false)).toBe(true);
  });
  it('does NOT skip when the port is down (must launch)', () => {
    expect(shouldSkipDevServerLaunch(false, false)).toBe(false);
  });
  it('does NOT skip when deps changed (a new package.json needs reinstall + restart, HMR cannot)', () => {
    expect(shouldSkipDevServerLaunch(true, true)).toBe(false);
  });
  it('does NOT skip when both are bad', () => {
    expect(shouldSkipDevServerLaunch(false, true)).toBe(false);
  });
});

describe('buildHttpLivenessCommand (Fix 42) — a REAL HTTP check, not just TCP-open', () => {
  it('curls the port and emits HTTP_OK / HTTP_DOWN', () => {
    const cmd = buildHttpLivenessCommand(5173);
    expect(cmd).toContain('curl');
    expect(cmd).toContain('http://127.0.0.1:5173');
    expect(cmd).toContain('HTTP_OK');
    expect(cmd).toContain('HTTP_DOWN');
  });
});

describe('detectDevPort — a connection ERROR must never answer "which port is the server on?"', () => {
  // The exact log from the mitrify autopsy (buildId ca5a4ca8, 2026-08-04). The app announced port 5000;
  // the old detector returned 5432 from the ECONNREFUSED dump, so the health check probed a Postgres
  // port, found nothing, and reported a WORKING app as "did not come up on port 5432".
  const mitrifyLog = [
    '5:06:31 AM [express] serving on port 5000',
    'UNHANDLED REJECTION — server kept alive: AggregateError [ECONNREFUSED]: ',
    '    at /home/user/workspace/node_modules/pg-pool/index.js:45:11',
    '    at async ensureSchema (/home/user/workspace/server/ensureSchema.ts:15:18)',
    "  code: 'ECONNREFUSED',",
    '    Error: connect ECONNREFUSED ::1:5432',
    '    Error: connect ECONNREFUSED 127.0.0.1:5432',
    '      errno: -111,',
    "      syscall: 'connect',",
    "      address: '127.0.0.1',",
    '      port: 5432',
  ].join('\n');

  it('reports the port the app really announced, not the database it failed to reach', () => {
    expect(detectDevPort(mitrifyLog, 3000)).toBe(5000);
  });

  it('recognises the common listening phrasings', () => {
    expect(detectDevPort('[express] serving on port 4000', 3000)).toBe(4000);
    expect(detectDevPort('Server running on port 8080', 3000)).toBe(8080);
    expect(detectDevPort('Server is listening on http://localhost:7000', 3000)).toBe(7000);
    expect(detectDevPort('  ➜  Local:   http://localhost:5174/', 3000)).toBe(5174);
    expect(detectDevPort('listening on 0.0.0.0:9100', 3000)).toBe(9100);
  });

  it('a real announcement BEATS a loose "port: N" that appears earlier in the log', () => {
    const log = 'config { port: 9999 }\n[express] serving on port 5000';
    expect(detectDevPort(log, 3000)).toBe(5000);
  });

  it('never adopts a datastore port from a weak signal', () => {
    for (const p of [5432, 3306, 27017, 6379]) {
      expect(detectDevPort(`connecting to db at 127.0.0.1:${p}`, 3000)).toBe(3000);
    }
    // …unless it IS the port we asked for — the caller knows better than the log does.
    expect(detectDevPort('connecting to 127.0.0.1:5432', 5432)).toBe(5432);
  });

  it('ignores stack frames and error-object dumps entirely', () => {
    expect(detectDevPort('    at Server.listen (net.js:1234:5)', 3000)).toBe(3000);
    expect(detectDevPort("Error: connect ETIMEDOUT 10.0.0.1:8125", 3000)).toBe(3000);
    expect(detectDevPort('could not connect to localhost:4444', 3000)).toBe(3000);
  });

  it('still falls back cleanly with no usable signal', () => {
    expect(detectDevPort('', 3000)).toBe(3000);
    expect(detectDevPort('nothing useful here', 3000)).toBe(3000);
  });

  it('a plain address with no announcement is still accepted (non-infra port)', () => {
    expect(detectDevPort('open http://localhost:5173/ in your browser', 3000)).toBe(5173);
  });
});

// REPRODUCED DEFECT (mitrify autopsy 2026-08-04, build cb03bdde → "Cannot GET /customer/home").
//
// detectDevPort scraped a port out of a Node EADDRINUSE CRASH DUMP. `isErrorLine` filtered every other
// field of that dump (errno / syscall / address) but not `port:`, so the weak `/port[:\s]+(\d{2,5})/`
// pattern matched `  port: 5000` — a port we FAILED to bind — and reported it as the port we were
// serving on. Verified by running it: detectDevPort(<EADDRINUSE-only log>, 3000) returned 5000.
//
// Why that is user-visible and not cosmetic: the adopted port gets re-probed, the probe finds the
// ORPHANED earlier process still holding it, the verdict is upgraded to "up", and a 404ing corpse is
// published as the live preview URL — which is exactly the "Cannot GET" the user sees.
describe('detectDevPort — a crash dump is not an announcement', () => {
  const EADDRINUSE_LOG = [
    '> rest-express@1.0.0 dev',
    '> NODE_ENV=development tsx server/index.ts',
    '',
    'Error: listen EADDRINUSE: address already in use 0.0.0.0:5000',
    '    at Server.setupListenHandle [as _listen2] (node:net:1898:16)',
    "  code: 'EADDRINUSE',",
    '  errno: -98,',
    "  syscall: 'listen',",
    "  address: '0.0.0.0',",
    '  port: 5000',
    '}',
  ].join('\n');

  it('never adopts the port out of an EADDRINUSE failure', () => {
    // The exact regression: this returned 5000 before the fix.
    expect(detectDevPort(EADDRINUSE_LOG, 3000)).toBe(3000);
  });

  it('ignores a bare `port:` field line, which only ever appears inside an error dump', () => {
    expect(detectDevPort('  port: 4321\n', 3000)).toBe(3000);
  });

  it('still reads a REAL announcement that happens to say "port"', () => {
    // The narrow filter must not cost us the signal it looks like: this is the normal success line.
    expect(detectDevPort('[express] serving on port 5000', 3000)).toBe(5000);
    expect(detectDevPort('Server listening on port 4000', 3000)).toBe(4000);
  });

  it('still reads Vite\'s Local: line', () => {
    expect(detectDevPort('  ➜  Local:   http://localhost:5173/', 3000)).toBe(5173);
  });

  it('a log with a real announcement AND a later EADDRINUSE still refuses the port', () => {
    // The log is TRUNCATED on relaunch, so in practice only the failure survives — but if both are
    // present the launch still ended in a collision, and the safe answer is what the caller asked for.
    expect(detectDevPort(`serving on port 5000\n${EADDRINUSE_LOG}`, 3000)).toBe(3000);
  });
});

/**
 * Looking THROUGH `npm run dev` (report 26a8e81c, 2026-08-06).
 *
 * The caller already resolved the package.json script, but the pin decision was tested against the
 * RAW `npm run dev` — where no `tsx`/`node` appears — so Mitrify's `tsx server/index.ts` fell through
 * to the Vite assumption and got `--port 3000 --strictPort`, flags it silently ignores. The app bound
 * its own 5000, the health check watched 3000, declared "did not start", and restarted twice; the
 * still-running first server then made the retry die with:
 *
 *   UNCAUGHT EXCEPTION: Error: listen EADDRINUSE: address already in use 0.0.0.0:5000
 *
 * One wrong string, and ~109s of the build went to a server we could not see.
 */
describe('pinDevServerPort sees through a package-manager script', () => {
  it('injects PORT= when the RESOLVED script is a Node server', () => {
    expect(pinDevServerPort('npm run dev', 3000, undefined, 'NODE_ENV=development tsx server/index.ts'))
      .toBe('PORT=3000 npm run dev');
  });

  it('no longer hands Vite flags to a command that ignores them', () => {
    const out = pinDevServerPort('npm run dev', 3000, undefined, 'tsx server/index.ts');
    expect(out).not.toContain('--strictPort');
    expect(out).not.toContain('--port');
  });

  it('still pins a real Vite script the Vite way', () => {
    // The resolved script decides; a genuine Vite app must keep --strictPort.
    expect(pinDevServerPort('npm run dev', 5173, 'vite', 'vite'))
      .toBe('npm run dev --port 5173 --strictPort');
  });

  it('keeps the historical assumption when nothing resolved', () => {
    // No resolved script (no package.json / parse error) → unchanged behaviour, not a new guess.
    expect(pinDevServerPort('npm run dev', 5173)).toBe('npm run dev --port 5173 --strictPort');
  });

  it('a direct node server still works without the resolved argument', () => {
    expect(pinDevServerPort('tsx server/index.ts', 3000)).toBe('PORT=3000 tsx server/index.ts');
  });

  it('never double-injects PORT=', () => {
    expect(pinDevServerPort('PORT=8080 npm run dev', 3000, undefined, 'tsx server/index.ts'))
      .toBe('PORT=8080 npm run dev');
  });
});

/**
 * THE DEV-SERVER KEEPALIVE — the sibling of the Postgres watchdog, and the same root cause.
 *
 * Shiv Medical Store build report (2026-08-10): the dev server started fine and was GONE ~4 minutes
 * later — `curl` exit 7, `ps aux | grep vite` empty. Recovery reported twice that "the dev server did
 * not start and the log had no recognisable error", then "Automatic recovery is exhausted", while a
 * MANUAL `npm run dev` worked instantly every time.
 *
 * The classifier found no error because there was none: the sandbox had reaped the process. This
 * codebase already knew that happens — postgresWatchdogCommand exists for exactly it — but only
 * Postgres was protected.
 */
describe('devServerWatchdogCommand', () => {
  const cmd = () => devServerWatchdogCommand({ port: 5173, runCommand: 'npm run dev -- --host 0.0.0.0', cwd: '/home/user/workspace' });

  it('cannot stack a second watchdog', () => {
    // Every dev-server start arms it; without the guard a long build ends up with a dozen loops.
    expect(cmd()).toContain(`if ! pgrep -f ${DEV_SERVER_WATCHDOG_MARKER}`);
  });

  it('detaches, or it dies with the command that armed it', () => {
    expect(cmd()).toContain('nohup setsid sh -c');
  });

  it('BOUNDS the revivals — an unbounded loop would hide a real code error forever', () => {
    // Restarting a server that dies of a syntax error is the "retry loop around code that
    // deterministically fails" the engineering rules forbid.
    const c = devServerWatchdogCommand({ port: 5173, runCommand: 'npm run dev', cwd: '/w', maxRevivals: 3 });
    expect(c).toContain('n=0');
    expect(c).toContain('while [ $n -lt 3 ]');
    expect(c).toContain('GAVE_UP after 3 revivals');
  });

  it('uses the SAME liveness check as the readiness probe, or the two fight each other', () => {
    // A watchdog with its own idea of "up" would restart a server the build already considers ready.
    const probe = buildPortWaitCommand(5173, 5);
    for (const part of ['nc -z 127.0.0.1 5173', 'curl -s -o /dev/null --max-time 2 http://127.0.0.1:5173', '/dev/tcp/127.0.0.1/5173']) {
      expect(probe, `probe lost ${part}`).toContain(part);
      expect(cmd(), `watchdog lost ${part}`).toContain(part);
    }
  });

  it('records each revival, so a REAPED server is distinguishable from a crashing one', () => {
    expect(cmd()).toContain(DEV_SERVER_WATCHDOG_LOG);
    expect(cmd()).toContain('REVIVED');
  });

  it('restarts in the workspace, appending to the dev log the classifier reads', () => {
    expect(cmd()).toContain('cd /home/user/workspace &&');
    expect(cmd()).toContain(DEV_SERVER_LOG_PATH);
  });

  it('survives a dev command containing quotes', () => {
    const c = devServerWatchdogCommand({ port: 3000, runCommand: `sh -c 'npm start'`, cwd: '/w' });
    // Unescaped, the inner quote would terminate the watchdog body and produce a broken shell command.
    expect(c).toContain("'\\''npm start'\\''");
    // And the body must still be one well-formed single-quoted shell string.
    expect(c).not.toContain("'''");
  });

  it('clamps nonsense inputs instead of emitting a broken loop', () => {
    const c = devServerWatchdogCommand({ port: 0, runCommand: 'x', cwd: '/w', maxRevivals: 0, intervalSeconds: 0 });
    expect(c).toContain('127.0.0.1:1');       // port clamped to >= 1
    expect(c).toContain('while [ $n -lt 1 ]'); // at least one revival
    expect(c).toContain('sleep 5');            // a 0s interval would be a busy loop
  });

  it('EMITS VALID SHELL — the only check that actually proves the quoting works', () => {
    // A shell command builder can pass every string assertion above and still emit something `sh`
    // refuses to parse, in which case the watchdog silently never arms and the dev server dies exactly
    // as before. `sh -n` parses without executing, so this is both safe and conclusive.
    const { execFileSync } = require('child_process') as typeof import('child_process');
    for (const runCommand of [
      'npm run dev -- --host 0.0.0.0 --port 5173',
      "sh -c 'npm run dev'",              // embedded single quotes — the hard case
      'PORT=3000 npx next dev',
      'npm run dev && echo "started"',    // embedded double quotes
    ]) {
      const script = devServerWatchdogCommand({ port: 5173, runCommand, cwd: '/home/user/workspace' });
      expect(() => execFileSync('sh', ['-n'], { input: script }), runCommand).not.toThrow();
    }
  });

  it('parses its own tally', () => {
    expect(parseDevServerWatchdogLog('REVIVED 1 10:00:00\nREVIVED 2 10:00:20\n')).toEqual({ revivals: 2, gaveUp: false });
    expect(parseDevServerWatchdogLog('REVIVED 1 x\nGAVE_UP after 5 revivals\n')).toEqual({ revivals: 1, gaveUp: true });
    expect(parseDevServerWatchdogLog('')).toEqual({ revivals: 0, gaveUp: false });
  });
});

/**
 * THE FIRST HALF OF THE FIX (admin build transcript, 2026-08-12).
 *
 * Restarting a dead dev server well is the second half. The first half is not needing to — and the
 * keepalive that exists for exactly that was armed only after a FRESH launch. The fast path that
 * ADOPTS an already-running server returned "already healthy … reused it" and armed nothing, so a
 * server we inherited had no watchdog at all. It died mid-build, the preview went to the host's
 * closed-port page, and the platform spent an LLM repair pass concluding "the app itself is fine; it
 * just needed the dev server restarted." Three times, in one build.
 */
describe('every path that yields a live dev server arms the keepalive', () => {
  const actuator = require('fs').readFileSync(
    require('path').join(__dirname, 'E2BActuator.ts'), 'utf8',
  ) as string;
  const code = actuator.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('arming lives in ONE helper — two call sites cannot arm differently, or one not at all', () => {
    expect(code).toContain('const armKeepalive =');
    expect((code.match(/await armKeepalive\(/g) || []).length).toBe(2);
  });

  it('the ADOPTED-server path arms it — this is the one that was missing', () => {
    const at = code.indexOf('already healthy on port');
    expect(at).toBeGreaterThan(-1);
    // The arm must happen BEFORE the early return, or it never happens at all.
    const before = code.slice(Math.max(0, at - 400), at);
    expect(before).toContain('await armKeepalive(boundPort)');
  });

  it('the fresh-launch path still arms it', () => {
    expect(code).toContain('if (up) await armKeepalive(port);');
  });

  it('no path constructs the watchdog command by hand any more', () => {
    // A second hand-rolled call site is how the first one drifted out of the fast path.
    expect((code.match(/devServerWatchdogCommand\(\{/g) || []).length).toBe(1);
  });
});
