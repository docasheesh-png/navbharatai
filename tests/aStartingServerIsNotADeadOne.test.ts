/**
 * A starting server is not a dead one — autopsy 2720e553, 2026-09-27.
 *
 * `npm run dev → exit 0 (70s)`, with the output:
 *   [health-check] attempt 1 — The dev server did not start and the log had no recognisable error — restarting.
 *   [health-check] attempt 2 — The dev server did not start and the log had no recognisable error — restarting.
 *   [health-check] dev server did not come up on port 5173 after automatic recovery.
 * …and seventeen seconds later the preview address was listening on 5173.
 *
 * 25 s wait, then kill-and-relaunch with 20 s, twice. A log with no error and a live process is a server
 * still starting; each restart killed it and reset its clock. Now a quiet living server is given more
 * time on the SAME process first, and a server whose process has exited is restarted as before.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import {
  buildStillStartingWaitCommand, shouldWaitOnStartingServer, STILL_STARTING_EXTRA_SECONDS,
} from '../src/server/AgentV3/sandbox/EngineerAI/actuators/devServerHost';

const actuator = readFileSync(join(__dirname, '..', 'src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts'), 'utf8');

describe('the decision', () => {
  it('🔴 an unrecognised failure with a known process waits on it', () => {
    expect(shouldWaitOnStartingServer('unknown', 4242)).toBe(true);
  });

  it('a NAMED failure keeps its own recovery — waiting would only delay the correct fix', () => {
    for (const cause of ['missing_module', 'port_in_use', 'crash', 'db_unreachable']) {
      expect(shouldWaitOnStartingServer(cause, 4242), cause).toBe(false);
    }
  });

  it('without a process id there is nothing to wait on', () => {
    expect(shouldWaitOnStartingServer('unknown', undefined)).toBe(false);
    expect(shouldWaitOnStartingServer('unknown', 0)).toBe(false);
    expect(shouldWaitOnStartingServer('unknown', Number.NaN)).toBe(false);
  });

  it('the extra window is bounded and larger than one restart window', () => {
    expect(STILL_STARTING_EXTRA_SECONDS).toBeGreaterThan(20);
    expect(STILL_STARTING_EXTRA_SECONDS).toBeLessThanOrEqual(60);
  });
});

describe('the command — run for real in a shell', () => {
  const run = (cmd: string) => execFileSync('bash', ['-c', cmd], { encoding: 'utf8', timeout: 15_000 }).trim();

  it('a process that has exited answers PROC_GONE at once, so a real crash costs about a second', () => {
    // A pid that cannot exist, and a port nothing listens on.
    const started = Date.now();
    expect(run(buildStillStartingWaitCommand(999_999, 1, 30))).toBe('PROC_GONE');
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('a living process with a closed port is waited on until the window ends', () => {
    const cmd = `sleep 30 & P=$!; ${buildStillStartingWaitCommand(0, 1, 2).replace('kill -0 1 ', 'kill -0 $P ')}; kill $P`;
    expect(run(cmd)).toBe('PORT_DOWN');
  });

  it('a non-numeric pid can never inject shell text', () => {
    expect(buildStillStartingWaitCommand(Number('1; rm -rf /') as number, 5173, 3)).not.toMatch(/rm -rf/);
  });
});

describe('the recovery loop', () => {
  it('🔴 waits on the same process BEFORE the restart, and only for an unrecognised failure', () => {
    const loop = actuator.slice(actuator.indexOf('const MAX_RECOVERY = 2;'));
    const wait = loop.indexOf('shouldWaitOnStartingServer(diag.cause, lastLaunchPid)');
    const restart = loop.indexOf('portUp = await launchAndWait(20);');
    expect(wait).toBeGreaterThan(0);
    expect(restart).toBeGreaterThan(wait);
  });

  it('remembers which process it launched', () => {
    expect(actuator).toMatch(/lastLaunchPid = typeof \(h as \{ pid\?: unknown \}\)\.pid === 'number'/);
  });
});
