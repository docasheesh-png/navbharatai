import { describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { tscModeFromArgs, explicitTscCommandMode, buildScriptChecksTypes } from '../src/server/AgentV3/tscCommandMode';
import { buildScriptTypecheckVerdict, commandOutcomeText, tscCommandVerdict, tscVerdict, typecheckEvidenceFromCommands } from '../src/server/AgentV3/TscGate';
import { pipedGateExitCodeWarning } from '../src/server/AgentV3/pipedGateExitCode';
import { robustTscCommand } from '../src/server/AgentV3/tscCommand';
import { writeTypecheckCommand } from '../src/server/AgentV3/writeTimeTypecheck';
import { BuildDiagnostics, clipCommand } from '../src/server/AgentV3/BuildDiagnostics';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { getWorkspaceMemory } from '../src/server/AgentV3/WorkspaceMemory';

// Synthetic command/output records only. No report command is executed and no fixture contacts a provider.
const ERROR = 'src/example.ts(1,7): error TS2322: Type number is not assignable to type string.';
const build = (script: string) => ({ command: 'npm run build', exitCode: 0, stdout: `> ${script}\nVersion 5.8.3\n✓ built in 1.2s` });
const NONCHECKING = ['--version', '-v', '-VERSION', '--help', '-h', '-?', '--all', '--init', '--showConfig', '--listFilesOnly', '--noCheck'];

describe('compiler argv modes, using TypeScript precedence rather than a flag substring', () => {
  it.each(NONCHECKING)('%s is not a typecheck', (flag) => {
    expect(tscModeFromArgs([flag])).toBe('not-checking');
    expect(tscModeFromArgs(['--noEmit', flag])).toBe('not-checking');
  });
  it.each(['--dry', '-d', '--clean', '--help', '-h', '-?', '--noCheck'])('build %s is not a typecheck', (flag) => {
    expect(tscModeFromArgs(['-b', flag])).toBe('not-checking');
  });
  it.each([
    [], ['--noEmit'], ['-d'], ['--declaration'], ['-b'], ['-b', '-v'], ['-BUILD', '--V'],
    ['--version', 'false'], ['--version', 'null'], ['--version', '--version', 'false'],
    ['-v', '--VERSION', 'false'], ['--listFilesOnly', 'false'], ['--showConfig', 'false'],
    ['--noCheck', 'false'], ['--noCheck', 'null'], ['--help', 'false'], ['--all', 'false'],
    ['-b', '--dry', 'false'], ['-b', '--clean', 'null'], ['-p', '--version'],
    ['-b', '--noCheck', 'false'], ['-b', '--noCheck', 'null'], ['-b', '--noCheck', '--noCheck', 'false'],
  ].map((args) => ({ args })))('preserves a checking argv: $args', ({ args }) => {
    expect(tscModeFromArgs(args)).toBe('checking');
  });
  it('uses the last boolean value, and does not silently move -b to the first argument', () => {
    expect(tscModeFromArgs(['--version', 'false', '--version'])).toBe('not-checking');
    expect(tscModeFromArgs(['--noCheck', 'false', '--noCheck'])).toBe('not-checking');
    expect(tscModeFromArgs(['-b', '--noCheck', 'false', '--noCheck'])).toBe('not-checking');
    expect(tscModeFromArgs(['-v', '-b'])).toBe('unknown');
    expect(tscModeFromArgs(['--unsupported-option'])).toBe('unknown');
    expect(tscModeFromArgs(['--watch'])).toBe('unknown');
  });
  it('never opens response files in either parser, even when a token is an option value', () => {
    const read = vi.spyOn(ts.sys, 'readFile').mockImplementation(() => { throw new Error('Unexpected filesystem read'); });
    try {
      for (const args of [['@args.txt'], ['-b', '@args.txt'], ['--noEmit', '@args.txt'], ['-p', '@args.txt']]) {
        expect(tscModeFromArgs(args)).toBe('unknown');
      }
      expect(tscModeFromArgs(['-p', 'literal config.json'])).toBe('checking');
      expect(tscModeFromArgs(['-b', 'literal config.json'])).toBe('checking');
      expect(read).not.toHaveBeenCalled();
    } finally { read.mockRestore(); }
  });
});

describe('a completed bundle does not turn a successful nonchecking process into checking', () => {
  it.each([...NONCHECKING, '-b --dry', '-b -d', '-b --clean', '-b --noCheck'])('refuses build credit for %s', (flags) => {
    const rec = build(`tsc ${flags} && vite build`);
    expect(buildScriptTypecheckVerdict(rec)).toBeUndefined();
    expect(typecheckEvidenceFromCommands([rec])).toBeUndefined();
  });
  it.each([
    'tsc && vite build', 'tsc -b -v && vite build', 'tsc -d && vite build',
    'tsc --version false && vite build', 'tsc --version --version null && vite build',
    'tsc --noCheck false && vite build', 'tsc -b --noCheck false && vite build',
    'tsc -p "folder with spaces/tsconfig.json" && vite build',
    'tsc -p "--version" && vite build', 'tsc -p "folder && name/tsconfig.json" && vite build',
    'tsc -p \'folder ; name/tsconfig.json\' && vite build',
    'CI=1 tsc && vite build', 'env CI=1 tsc && vite build', 'cross-env CI=1 tsc && vite build',
    'npx --no-install tsc && vite build',
    'npx --yes tsc && vite build', './node_modules/.bin/tsc && vite build',
    'tsc --version && tsc --noEmit && vite build', 'tsc && tsc --version && vite build',
  ])('preserves a genuine checking build: %s', (script) => {
    expect(buildScriptChecksTypes(script)).toBe(true);
    expect(buildScriptTypecheckVerdict(build(script))).toBe('passed');
  });
  it.each([
    'echo "tsc" && vite build', 'echo "tsc && vite build"', '"CI=1" tsc && vite build',
    'npx -- --no-install tsc && vite build', 'tsc @args.txt && vite build',
    'tsc "$FLAGS" && vite build', 'tsc $(cat args) && vite build',
    'tsc --noEmit | head -40 && vite build', 'tsc || true && vite build',
    'tsc; vite build', 'tsc & vite build', 'tsc -p "unfinished && vite build',
    'tsc && vite build;', 'tsc &&', 'tsc &&& vite build',
    'if true && tsc && vite build', 'while true && tsc && vite build',
    'exec tsc && vite build', 'vite build && exec tsc --noCheck && tsc && vite build',
    'vite build && exec true && tsc && vite build',
    'vite build && ! tsc --noCheck && tsc && vite build',
    'vite build && false && tsc && vite build',
    'cd "my app" && npm install && tsc -p tsconfig.build.json && vite build',
  ])('abstains from an unsupported or non-executing build: %s', (script) => {
    expect(buildScriptChecksTypes(script)).toBe(false);
    expect(buildScriptTypecheckVerdict(build(script))).toBeUndefined();
    expect(buildScriptTypecheckVerdict({ ...build(script), exitCode: null })).toBeUndefined();
  });
  it('does not replace real diagnostics or a previous failed typecheck with a probe', () => {
    const rec = build('tsc --version && vite build');
    expect(buildScriptTypecheckVerdict({ ...rec, stdout: `${rec.stdout}\n${ERROR}` })).toBe('failed');
    expect(typecheckEvidenceFromCommands([{ command: 'tsc --noEmit', stdout: ERROR }, rec])).toBe('failed');
    expect(buildScriptTypecheckVerdict({ ...build('tsc && vite build'), exitCode: 2 })).toBeUndefined();
    expect(buildScriptTypecheckVerdict({ ...build('tsc && vite build'), exitCode: null })).toBe('passed');
    // A refused build must not be promoted by the broad standalone fallback on the same record.
    expect(typecheckEvidenceFromCommands([{ ...rec, command: 'npm run build && tsc --noEmit --version' }])).toBeUndefined();
  });
});

describe('same-root standalone readers share the explicit mode veto', () => {
  it('keeps build-mode noCheck from clearing standalone evidence or memory', () => {
    const command = 'tsc -b --noEmit --noCheck 2>&1 | tail -40';
    expect(tscCommandVerdict(command, '')).toBe('not-run');
    expect(typecheckEvidenceFromCommands([{ command, stdout: '', exitCode: null }])).toBeUndefined();
    expect(commandOutcomeText({ command, stdout: '', exitCode: 0 })).toContain('did not run a typecheck');
    expect(pipedGateExitCodeWarning(command, 0, '')).toContain('DID NOT RUN A TYPECHECK');
    expect(tscCommandVerdict(command, ERROR)).toBe('failed');
  });
  it.each(NONCHECKING)('does not claim a clean standalone %s run, even with no output', (flag) => {
    const command = `npx tsc --noEmit ${flag} 2>&1 | head -50`;
    const rec = { command, stdout: '', exitCode: null };
    expect(tscCommandVerdict(command, '')).toBe('not-run');
    expect(typecheckEvidenceFromCommands([rec])).toBeUndefined();
    expect(typecheckEvidenceFromCommands([{ command: 'tsc --noEmit', stdout: ERROR }, rec])).toBe('failed');
    expect(commandOutcomeText(rec)).toContain('did not run a typecheck');
    expect(commandOutcomeText({ ...rec, exitCode: 0 })).toContain('did not run a typecheck');
    expect(pipedGateExitCodeWarning(command, 0, '')).toContain('DID NOT RUN A TYPECHECK');
    expect(pipedGateExitCodeWarning(command, 0, '')).not.toContain('fix the errors');
    expect(tscCommandVerdict(command, ERROR)).toBe('failed');
  });
  it.each(['tsc --noEmit @args.txt', 'tsc --noEmit "$FLAGS"', 'tsc --noEmit -p "unfinished', 'tsc --noEmit --unknown-flag'])('abstains from recognised but unknown argv: %s', (command) => {
    expect(tscCommandVerdict(command, '')).toBe('unknown');
    expect(typecheckEvidenceFromCommands([{ command, stdout: '' }])).toBeUndefined();
    expect(commandOutcomeText({ command, stdout: '', exitCode: null })).toContain('no verdict');
    expect(tscCommandVerdict(command, ERROR)).toBe('failed');
  });
  it('preserves ordinary, canonical, clipped and write-time wrappers without claiming universal shell parsing', () => {
    for (const command of [
      'tsc --noEmit', 'tsc --noEmit --noCheck false', 'npx tsc --noEmit 2>&1 | head -120',
      'tsc -p "my config.json" --noEmit 2>&1 | tail -200 || true',
      'npm install && ./node_modules/.bin/tsc --noEmit 2>&1 | tail -40',
      robustTscCommand(), robustTscCommand('--noEmit', '2>&1 | head -80'),
      clipCommand(robustTscCommand('--noEmit', '2>&1 | head -120')),
      writeTypecheckCommand(), clipCommand(writeTypecheckCommand()),
    ]) {
      expect(tscCommandVerdict(command, ''), command).toBe('passed');
      const d = new BuildDiagnostics();
      d.recordCommand({ command, stdout: '', exitCode: null });
      expect(d.typecheckEvidenceFromAgentCommands(), command).toBe('passed');
    }
    // Opaque legacy wrappers are not reclassified by a new, incomplete shell parser.
    expect(explicitTscCommandMode('custom-wrapper sh -c "tsc --noEmit"')).toBeUndefined();
    expect(tscVerdict('Version 5.8.3')).toBe('passed'); // The output-only API is unchanged.
  });
  it('does not lose the veto when the canonical ensure wrapper is clipped', () => {
    for (const args of ['--noEmit --noCheck', '--noEmit --noCheck -p "folder; node_modules/.bin/tsc config.json"']) {
      for (const command of [robustTscCommand(args, '2>&1 | head -80'), clipCommand(robustTscCommand(args, '2>&1 | head -80'))]) {
        expect(tscCommandVerdict(command, ''), command).toBe('not-run');
        expect(typecheckEvidenceFromCommands([{ command, stdout: '' }])).toBeUndefined();
      }
    }
  });
  it('never credits a compiler after exec replaced the shell', () => {
    const command = 'exec tsc --noEmit --noCheck && tsc --noEmit';
    expect(explicitTscCommandMode(command)).toBe('not-checking');
    expect(typecheckEvidenceFromCommands([{ command, stdout: '' }])).toBeUndefined();
    expect(tscCommandVerdict('exec tsc --noEmit', '')).toBe('passed');
    expect(explicitTscCommandMode('tsc --noEmit --noCheck && exec true && tsc --noEmit')).toBe('not-checking');
    expect(explicitTscCommandMode('exec tsc --noEmit --noCheck | head && tsc --noEmit')).toBe('unknown');
    expect(explicitTscCommandMode('tsc --noEmit --noCheck && exec && tsc --noEmit')).toBe('checking');
    expect(explicitTscCommandMode('tsc --noEmit --noCheck && exec -- && tsc --noEmit')).toBe('checking');
  });
});

class SyntheticActuator implements ActuatorPort {
  out = { exitCode: 0, stdout: '', stderr: '' };
  async readFile(): Promise<string> { throw new Error('ENOENT'); }
  async writeFile(): Promise<void> { /* synthetic */ }
  async listFiles(): Promise<string[]> { return []; }
  async runCommand() { return this.out; }
  async getPortUrl(_workspace: string, port: number) { return `https://synthetic-${port}.example.invalid`; }
}

it('the shell memory writer cannot clear errors or mark clean after a silent nonchecking run', async () => {
  const actuator = new SyntheticActuator(), stream = new AgentEventStream();
  const id = 'synthetic-nonchecking-modes';
  const dispatcher = new ToolDispatcher(actuator, id, new WorkspaceState(stream), stream);
  const memory = getWorkspaceMemory(id);
  const clean = vi.spyOn(memory, 'markTscClean');
  const run = (command: string) => dispatcher.dispatch({ id: command, name: 'bash', input: { command } }, 'architect');
  actuator.out.stdout = ERROR;
  await run('tsc --noEmit');
  expect(dispatcher.lastKnownTypeErrors()).toBe(1);
  actuator.out.stdout = '';
  for (const args of ['--noEmit --noCheck', '--noEmit --version', '--noEmit --listFilesOnly', '--noEmit --showConfig', '-b --noEmit --noCheck']) {
    await run(`tsc ${args} 2>&1 | head -50`);
    expect(dispatcher.lastKnownTypeErrors()).toBe(1);
    expect(clean).not.toHaveBeenCalled();
  }
  await run('tsc --noEmit --noCheck false');
  expect(dispatcher.lastKnownTypeErrors()).toBe(0);
  expect(clean).toHaveBeenCalledTimes(1);
  clean.mockRestore();
});
