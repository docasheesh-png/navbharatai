// ONE BROWSER DAEMON PER SANDBOX (failedbr #2495/#2496, 2026-11-22).
//
// Both reports: "earlier high-water mark of 3.69 GB of 3.71 GB (99%)". Part of that is page cache (said honestly now —
// sandboxSessions.ts), and part was a real leak: `_ensureBrowserDaemon` caches its daemon per SERVER PROCESS, but the
// sandbox outlives it (paused, resumed, reached from another Cloud Run instance) and the action retry drops the cache
// after one failed action. Each time a second `daemon.js` started; its Chromium could not bind the CDP port the first
// one held, never answered, and never exited — one whole headless browser per occurrence, for the sandbox's life.
// 🧬 THE CLASS: a long-lived sandbox process started without asking whether one is already running. Locked here: the
// precheck runs before every launch, reuses a live daemon, and kills stale ones without killing itself.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { browserDaemonPrecheckCommand, browserDaemonAlive } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('the precheck', () => {
  it('reuses a daemon that answers on the CDP port, and only on an explicit marker', () => {
    expect(browserDaemonPrecheckCommand()).toMatch(/^if curl -s --max-time 3 http:\/\/localhost:9222\/json\/version \| grep -q webSocketDebuggerUrl; then echo NBAI_DAEMON_ALIVE;/);
    expect(browserDaemonAlive('NBAI_DAEMON_ALIVE\n')).toBe(true);
    expect(browserDaemonAlive('NBAI_DAEMON_START\n')).toBe(false);
    expect(browserDaemonAlive('')).toBe(false);
    expect(browserDaemonAlive(undefined)).toBe(false);
  });

  it('kills stale daemons and port-holding browsers, never its own shell (real processes)', async () => {
    let hasPkill = true;
    try { execFileSync('sh', ['-c', 'command -v pkill && command -v curl && command -v bash'], { stdio: 'ignore' }); } catch { hasPkill = false; }
    if (!hasPkill) return; // a host without pkill/curl cannot run this; the source guard below still holds
    // A stand-in for a stale Chromium: a process whose command line carries the CDP port flag.
    const stale = spawn('bash', ['-c', 'exec -a "chrome-stub --remote-debugging-port=9222" sleep 30'], { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 300));
    const exited = new Promise<boolean>((resolve) => { stale.on('exit', () => resolve(true)); setTimeout(() => resolve(false), 3_000); });
    // Port 9222 answers nothing here, so the precheck takes the kill branch.
    const out = execFileSync('sh', ['-c', browserDaemonPrecheckCommand()], { encoding: 'utf8' });
    expect(out.trim().split('\n').pop()).toBe('NBAI_DAEMON_START'); // the shell survived its own pkill
    expect(await exited).toBe(true);
  });
});

describe('the launch path asks first', () => {
  it('the precheck runs before daemon.js is started, and a live daemon returns without starting another', () => {
    const src = read('src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts');
    const fn = src.slice(src.indexOf('private async _ensureBrowserDaemon('), src.indexOf('this._browserDaemon.set(workspaceId, promise);'));
    const pre = fn.indexOf('browserDaemonPrecheckCommand()');
    const launch = fn.indexOf('node ${TOOLS_DIR}/daemon.js');
    expect(pre).toBeGreaterThan(0);
    expect(launch).toBeGreaterThan(pre);
    expect(fn).toMatch(/if \(browserDaemonAlive\(pre\.stdout\)\) return true;/);
  });

  it('every place that starts daemon.js goes through that one function', () => {
    const src = read('src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts');
    expect(src.match(/node \$\{TOOLS_DIR\}\/daemon\.js/g)).toHaveLength(1);
  });
});
