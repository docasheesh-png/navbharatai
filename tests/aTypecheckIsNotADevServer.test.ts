/**
 * AUTOPSY 1eaa5f5a / e3b0ce25 (2026-10-04): A FOLDER NAMED "vite-react" MADE EVERY TYPECHECK A DEV SERVER.
 *
 * The typecheck primer (#3491) copies `/home/user/.warm/vite-react/node_modules`, and the dev-server
 * keyword rule read `vite` inside that PATH as a program. So every write-time typecheck and warm-up was
 * sent down the managed boot: prefixed `BROWSER=none` in front of `if` (a bash syntax error), the
 * running dev server on the port killed first, the check timed out at 30 s, and the preview went down.
 *
 * The class (a word inside DATA read as a command) has cost builds three times: `/dev/null`,
 * `--save-dev`, and now a directory name. The rule now judges each path by its last part only, and this
 * census runs every command the PLATFORM builds itself through the classifier — a new builder that trips
 * it fails here, not on a user's preview.
 */
import { describe, expect, it } from 'vitest';
import { isLongRunningCommand } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/devServerHost';
import * as host from '../src/server/AgentV3/sandbox/EngineerAI/actuators/devServerHost';
import { PRIME_NODE_MODULES, TSC_ENSURE, robustTscCommand, recipeInstallCommand } from '../src/server/AgentV3/tscCommand';
import { writeTypecheckCommand, writeTypecheckWarmupCommand } from '../src/server/AgentV3/writeTimeTypecheck';
import { prodBuildCommand } from '../src/server/AgentV3/prodBuildGate';
import { buildPortSweepCommand } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/portSweep';
import { buildServicesProbeCommand } from '../src/server/AgentV3/portsPanel';

const PLATFORM_COMMANDS: Array<[string, string]> = [
  ['write-time typecheck warm-up', writeTypecheckWarmupCommand()],
  ['write-time typecheck', writeTypecheckCommand()],
  ['node_modules primer', `${PRIME_NODE_MODULES}true`],
  ['compiler ensure', TSC_ENSURE],
  ['typecheck', robustTscCommand()],
  ['typecheck, piped', robustTscCommand('--noEmit', '2>&1 | head -80')],
  ['recipe install', recipeInstallCommand([{ name: 'zod', version: '^3.23.0', dev: false }, { name: 'vitest', version: '^2.0.0', dev: true }])],
  ['production build', prodBuildCommand()],
  ['deps-stale check', host.buildDepsStaleCheckCommand()],
  ['build install', host.buildBuildInstallCommand()],
  ['port sweep', buildPortSweepCommand([5173, 3000])],
  ['services probe', buildServicesProbeCommand()],
];

describe('no command the platform builds for itself is a dev-server launch', () => {
  for (const [name, command] of PLATFORM_COMMANDS) {
    it(name, () => {
      expect(command.length).toBeGreaterThan(0);
      expect(isLongRunningCommand(command)).toBe(false);
    });
  }
});

describe('a path is judged by its last part only', () => {
  it('a directory whose name contains a server word is not a launch', () => {
    expect(isLongRunningCommand('cp -a /home/user/.warm/vite-react/node_modules /tmp/x')).toBe(false);
    expect(isLongRunningCommand('[ -d /srv/dev-tools/watch-list/cache ] && echo ok')).toBe(false);
  });

  it('real launches stay launches, including a launch written as a path', () => {
    for (const launch of [
      'npm run dev',
      'npx vite',
      'npx vite --host 0.0.0.0 --port 5173',
      './node_modules/.bin/vite',
      'node ./node_modules/vite/bin/vite.js --port 5173',
      'bash ./dev.sh',
      'tsx watch server/index.ts',
      'cd /home/user/app && npm run dev',
      '(cd server && npm run dev)',
    ]) expect(isLongRunningCommand(launch), launch).toBe(true);
  });

  it('a build stays a build', () => {
    expect(isLongRunningCommand('npx vite build')).toBe(false);
    expect(isLongRunningCommand('./node_modules/.bin/vite build')).toBe(false);
  });
});
