// Autopsy a2b9c802 (2026-09-30) — open item closed: every write-time typecheck in the build report read
// `$ tsc … → exit ?`. The command is piped through `head`, so the shell's exit code is `head`'s, and it is
// recorded as `null` on purpose. The report therefore could not say whether a compile was clean or had
// forty errors. The same investigation found the sibling: two readers of "was tsc clean?" disagreed —
// project memory refused a failed install, while the release gate's evidence counted it as a PASS.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  tscVerdict, tscOutputProvesClean, typecheckEvidenceFromCommands, commandOutcomeText,
} from '../src/server/AgentV3/TscGate';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';

const TSC = "npx tsc --noEmit --incremental --tsBuildInfoFile /tmp/agentv3.tsbuildinfo 2>&1 | head -120";
const ERRORS = "src/App.tsx(3,10): error TS2305: Module './types' has no exported member 'add'.\n"
  + "src/App.tsx(4,10): error TS2305: Module './types' has no exported member 'sub'.";

describe('one reader of a tsc output', () => {
  it('names the four outcomes', () => {
    expect(tscVerdict('')).toBe('passed');
    expect(tscVerdict(ERRORS)).toBe('failed');
    expect(tscVerdict('Version 5.4.5\nSyntax:   tsc [options] [file...]\nExamples: tsc hello.ts')).toBe('not-run');
    expect(tscVerdict("npm ERR! code ENOENT\nError: Cannot find module 'typescript'")).toBe('unknown');
  });

  it('project memory and the release gate now agree about a failed install', () => {
    const install = 'npm ERR! code ERESOLVE\nnpm ERR! ERESOLVE unable to resolve dependency tree';
    expect(tscVerdict(install)).toBe('unknown');
    expect(tscOutputProvesClean(install)).toBe(false);
    // Before: `hasTscErrors(install) ? 'failed' : 'passed'` → 'passed'. A typecheck that never ran
    // was evidence of a clean compile.
    expect(typecheckEvidenceFromCommands([{ command: TSC, stdout: install }])).toBeUndefined();
  });

  it('the release gate still reads real verdicts, latest first', () => {
    expect(typecheckEvidenceFromCommands([{ command: TSC, stdout: ERRORS }, { command: TSC, stdout: '' }])).toBe('passed');
    expect(typecheckEvidenceFromCommands([{ command: TSC, stdout: '' }, { command: TSC, stdout: ERRORS }])).toBe('failed');
  });

  it('memory keeps its old answers', () => {
    expect(tscOutputProvesClean('')).toBe(true);
    expect(tscOutputProvesClean(ERRORS)).toBe(false);
    expect(tscOutputProvesClean('bash: tsc: command not found')).toBe(false);
  });
});

describe('the report line says what the compiler said', () => {
  it('a piped typecheck with no exit code reports its verdict and where it came from', () => {
    expect(commandOutcomeText({ command: TSC, exitCode: null, stdout: '' })).toMatch(/^clean \(read from the output/);
    expect(commandOutcomeText({ command: TSC, exitCode: null, stdout: ERRORS })).toMatch(/^2 type errors \(read from the output/);
    expect(commandOutcomeText({ command: TSC, exitCode: null, stdout: ERRORS.split('\n')[0] })).toMatch(/^1 type error \(/);
  });

  it('a command WITH an exit code is unchanged, and any other command with none still says it does not know', () => {
    expect(commandOutcomeText({ command: TSC, exitCode: 0, stdout: ERRORS })).toBe('exit 0');
    expect(commandOutcomeText({ command: 'npm run build', exitCode: 1 })).toBe('exit 1');
    expect(commandOutcomeText({ command: 'ls -la', exitCode: null })).toBe('exit ?');
  });

  it('the recorded line carries it, and the code and severity do not move', () => {
    const d = new BuildDiagnostics();
    d.recordCommand({ command: TSC, exitCode: null, stdout: ERRORS, durationMs: 1200 });
    const line = d.report().issues.find((i: { code: string }) => i.code === 'SANDBOX_CMD');
    expect(line?.message).toMatch(/→ 2 type errors \(read from the output; the pipe hides tsc's own exit code\) \(1s\)$/);
    expect(line?.severity).toBe('info');
  });

  it('source guard: the report line is built by the shared helper, not a local `?? \'?\'`', () => {
    const src = readFileSync(join(__dirname, '../src/server/AgentV3/BuildDiagnostics.ts'), 'utf8');
    expect(src).toContain('→ ${commandOutcomeText(rec)}${durTxt}');
    expect(src).not.toContain("exit ${rec.exitCode ?? '?'}");
  });
});
