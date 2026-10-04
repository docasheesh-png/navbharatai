// THE PLATFORM'S OWN COMMANDS ARE NEVER READ AS DEV-SERVER LAUNCHES (class behind Q-390, autopsy Sur Taal).
//
// #3491 put the warm-cache path `/home/user/.warm/vite-react/node_modules` into the typecheck's primer, and
// `isLongRunningCommand` matched `vite` inside that PATH: every write-time typecheck was rewritten as a
// background dev-server launch (bash syntax error, log pollution, false restarts). The instance was fixed
// by judging paths on their basenames (#3506). This census is the class lock: every command builder the
// platform runs is judged here, and a NEW builder in these modules fails until it is classified.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as D from '../src/server/AgentV3/sandbox/EngineerAI/actuators/devServerHost';
import * as T from '../src/server/AgentV3/tscCommand';
import * as W from '../src/server/AgentV3/writeTimeTypecheck';
import { buildPortSweepCommand } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/portSweep';
import { buildServicesProbeCommand } from '../src/server/AgentV3/portsPanel';
import { buildListFilesCommand } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator';

const { isLongRunningCommand } = D;

/** Commands the platform runs and waits for. Each must never be read as a launch. */
const NOT_LAUNCHES: Record<string, () => string> = {
  TSC_ENSURE: () => T.TSC_ENSURE,
  PRIME_NODE_MODULES: () => T.PRIME_NODE_MODULES,
  robustTscCommand: () => T.robustTscCommand(),
  recipeInstallCommand: () => T.recipeInstallCommand([{ name: 'vite', version: '^5', dev: true }]),
  writeTypecheckCommand: () => W.writeTypecheckCommand(),
  writeTypecheckWarmupCommand: () => W.writeTypecheckWarmupCommand(),
  buildDepsStaleCheckCommand: () => D.buildDepsStaleCheckCommand(),
  buildBuildInstallCommand: () => D.buildBuildInstallCommand(),
  buildPreKillPortCommand: () => D.buildPreKillPortCommand(5173),
  buildPrebundleStaleCheckCommand: () => D.buildPrebundleStaleCheckCommand(),
  buildHttpLivenessCommand: () => D.buildHttpLivenessCommand(5173),
  buildPortWaitCommand: () => D.buildPortWaitCommand(5173, 10),
  buildStillStartingWaitCommand: () => D.buildStillStartingWaitCommand(1, 5173, 10),
  buildPortSweepCommand: () => buildPortSweepCommand([5173, 3000]),
  buildServicesProbeCommand: () => buildServicesProbeCommand(),
  buildListFilesCommand: () => buildListFilesCommand('/home/user/vite-app'),
};

/** Builders whose command IS a long-running server, with the reason. */
const LAUNCHES: Record<string, string> = {
  devServerWatchdogCommand: 'restarts the dev server it is given — a launch by design',
};

/** Builders that are not commands the platform runs as-is (predicates, or a caller-chosen launch). */
const NOT_COMMANDS = new Set([
  'isLongRunningCommand', 'isNodeServerCommand', 'pipesOrChainsToAnotherCommand',
]);

const SOURCES = [
  'src/server/AgentV3/tscCommand.ts',
  'src/server/AgentV3/writeTimeTypecheck.ts',
  'src/server/AgentV3/sandbox/EngineerAI/actuators/devServerHost.ts',
  'src/server/AgentV3/sandbox/EngineerAI/actuators/portSweep.ts',
  'src/server/AgentV3/portsPanel.ts',
];

describe('our own commands are never read as dev-server launches', () => {
  for (const [name, build] of Object.entries(NOT_LAUNCHES)) {
    it(`${name} is not a launch`, () => expect(isLongRunningCommand(build())).toBe(false));
  }
  it('the watchdog is a launch, as designed', () => {
    expect(isLongRunningCommand(D.devServerWatchdogCommand({ port: 5173, runCommand: 'npx vite --host', cwd: '/home/user/workspace', maxRevivals: 3 } as any))).toBe(true);
  });
  it('a path that merely contains a framework name is not a launch', () => {
    for (const dir of ['/home/user/.warm/vite-react', '/srv/next-app', '/x/nuxt-site', '/x/webpack-demo', '/x/astro-blog']) {
      for (const c of [`cp -a ${dir}/node_modules node_modules`, `ls ${dir}`, `cat ${dir}/package.json`, `test -d ${dir} && echo ok`]) {
        expect(isLongRunningCommand(c), c).toBe(false);
      }
    }
  });
  it('a word inside a hyphenated name is not that command', () => {
    for (const c of ['cd my-dev-app && ls', 'ls /x/vite-react', 'vite-node script.ts', 'cat my-vite-app/package.json']) {
      expect(isLongRunningCommand(c), c).toBe(false);
    }
  });
  it('real launches are still launches, flags and hyphenated servers included', () => {
    for (const c of ['node node_modules/vite/bin/vite.js --host 0.0.0.0', './node_modules/.bin/vite', 'node_modules/.bin/next dev', '/home/user/.venv/bin/uvicorn main:app',
      'npx webpack-dev-server', 'tsc --watch', 'npx tailwindcss -i in.css -o out.css --watch', 'npx vue-cli-service serve', 'npm run dev', 'npx vite']) {
      expect(isLongRunningCommand(c), c).toBe(true);
    }
  });
});

describe('census: every exported command builder in these modules is classified', () => {
  it('a new builder fails until it is listed', () => {
    const exported = SOURCES.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/^export (?:function (\w*Command)\(|const ([A-Z_]*(?:ENSURE|PRIME_NODE_MODULES|COMMAND)) =)/gm)]
      .map((m) => m[1] ?? m[2]));
    const known = new Set([...Object.keys(NOT_LAUNCHES), ...Object.keys(LAUNCHES), ...NOT_COMMANDS]);
    expect(exported.filter((n) => !known.has(n))).toEqual([]);
    expect(exported.length).toBeGreaterThanOrEqual(15);
  });
  it('the warm-cache path has one definition', () => {
    const actuator = readFileSync('src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts', 'utf8');
    expect(actuator).not.toMatch(/['"`]\/home\/user\/\.warm\/vite-react/);
    expect(actuator).toContain('WARM_NODE_MODULES');
  });
});
