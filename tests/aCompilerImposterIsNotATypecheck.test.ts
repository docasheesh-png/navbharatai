import { describe, expect, it } from 'vitest';
import {
  buildScriptTypecheckVerdict, commandOutcomeText, looksLikeTscHelpOutput, tscNeverRan, tscOutputProvesClean,
  tscVerdict, typecheckEvidenceFromCommands,
} from '../src/server/AgentV3/TscGate';
import { pipedGateExitCodeWarning } from '../src/server/AgentV3/pipedGateExitCode';

// Synthetic CLI output only. An unrelated package owning the `tsc` executable can
// print a refusal instead of compiling, even when a pipe reports exit zero.
const REFUSAL = 'This is not the tsc command you are looking for';
const IMPOSTER = `${REFUSAL}\n\nTo get access to the TypeScript compiler, tsc, from the command line either:\n- Use npm install typescript first\n`;
const COLOURED_IMPOSTER = `npm warn deprecated tsc@9.9.9: unsupported package\n\u001b[41m\u001b[37m   ${REFUSAL}   \u001b[0m\n${IMPOSTER.split('\n').slice(1).join('\n')}`;
const HELP = 'Version 5.9.3\ntsc: The TypeScript Compiler - Version 5.9.3\n\nCOMMON COMMANDS\n  tsc\n  Compiles the current project (tsconfig.json in the working directory.)';
const MISSING = '/bin/bash: line 1: node_modules/.bin/tsc: No such file or directory';
const ERROR = 'src/Example.tsx(3,7): error TS2322: Type number is not assignable to type string.';

describe('a non-compiling tsc invocation never becomes clean evidence', () => {
  it.each([IMPOSTER, COLOURED_IMPOSTER, HELP, MISSING])('shares the not-run verdict across every reader: %s', (stdout) => {
    expect(tscNeverRan(stdout)).toBe(true);
    expect(tscVerdict(stdout)).toBe('not-run');
    expect(tscOutputProvesClean(stdout)).toBe(false);
    for (const exitCode of [0, 1, -1, null]) {
      const command = { command: 'npx tsc --noEmit 2>&1 | head -50', stdout, stderr: '', exitCode };
      expect(typecheckEvidenceFromCommands([command])).toBeUndefined();
      expect(commandOutcomeText(command)).toContain('compiler did not run');
    }
  });

  it('does not replace actual failed evidence with a later imposter refusal', () => {
    const command = 'npx tsc --noEmit';
    expect(typecheckEvidenceFromCommands([
      { command, stdout: ERROR, exitCode: 2 },
      { command, stdout: COLOURED_IMPOSTER, exitCode: 0 },
    ])).toBe('failed');
    expect(typecheckEvidenceFromCommands([
      { command, stdout: IMPOSTER, exitCode: 1 },
      { command, stdout: ERROR, exitCode: 2 },
    ])).toBe('failed');
  });

  it('gives a piped non-compilation a not-run notice, never an app-error verdict', () => {
    for (const output of [IMPOSTER, COLOURED_IMPOSTER, HELP, MISSING]) {
      const note = pipedGateExitCodeWarning('npx tsc --noEmit 2>&1 | head -50', 0, output);
      expect(note).toContain('COMPILER DID NOT RUN');
      expect(note).toContain('DID NOT ACTUALLY PASS');
      expect(note).toContain('not evidence that the app passed or failed');
      expect(note).not.toContain('fix the errors');
    }
  });

  it('keeps genuine compiler errors as failures, even when they quote the refusal', () => {
    const quoted = `src/Example.tsx(3,7): error TS2322: Type '${REFUSAL}' is not assignable to type 'ready'.`;
    expect(looksLikeTscHelpOutput(quoted)).toBe(false);
    expect(tscVerdict(quoted)).toBe('failed');
    const note = pipedGateExitCodeWarning('tsc --noEmit | head -50', 0, quoted);
    expect(note).toContain('THIS COMMAND DID NOT ACTUALLY PASS');
    expect(note).not.toContain('COMPILER DID NOT RUN');
    expect(tscVerdict(`${IMPOSTER}\n${ERROR}`)).toBe('failed');
  });

  it('keeps direct never-ran readers aligned when real diagnostics accompany a refusal', () => {
    for (const noCompile of [IMPOSTER, COLOURED_IMPOSTER, HELP, MISSING]) {
      for (const output of [`${noCompile}\n${ERROR}`, `${ERROR}\n${noCompile}`]) {
        expect(tscNeverRan(output)).toBe(false);
        expect(tscVerdict(output)).toBe('failed');
        expect(tscOutputProvesClean(output)).toBe(false);
        expect(typecheckEvidenceFromCommands([{ command: 'tsc --noEmit', stdout: output, exitCode: 0 }])).toBe('failed');
        expect(pipedGateExitCodeWarning('tsc --noEmit | head -50', 0, output)).not.toContain('COMPILER DID NOT RUN');
      }
    }
  });

  it('does not promote a build-script echo plus bundle marker over a non-compiling verdict', () => {
    for (const noCompile of [IMPOSTER, COLOURED_IMPOSTER, HELP, MISSING, "npm ERR! Cannot find module 'typescript'"]) {
      for (const exitCode of [0, null]) {
        const build = { command: 'npm run build | head -50', exitCode, stdout: `> tsc && vite build\n${noCompile}\n✓ built in 1.2s` };
        expect(buildScriptTypecheckVerdict(build)).toBeUndefined();
        expect(typecheckEvidenceFromCommands([build])).toBeUndefined();
        expect(typecheckEvidenceFromCommands([{ command: 'tsc --noEmit', stdout: ERROR }, build])).toBe('failed');
      }
    }
  });

  it('preserves real build-script success and failure without relying on the bundle marker alone', () => {
    const build = { command: 'pnpm run build', exitCode: 0, stdout: '> tsc -p tsconfig.build.json && vite build\n✓ built in 1.2s' };
    expect(buildScriptTypecheckVerdict(build)).toBe('passed');
    expect(typecheckEvidenceFromCommands([build])).toBe('passed');
    expect(buildScriptTypecheckVerdict({ ...build, exitCode: 2 })).toBeUndefined();
    for (const stdout of [`> tsc && vite build\n${ERROR}`, `> tsc && vite build\n${IMPOSTER}\n${ERROR}\n✓ built in 1.2s`]) {
      expect(buildScriptTypecheckVerdict({ ...build, stdout })).toBe('failed');
      expect(typecheckEvidenceFromCommands([{ ...build, stdout }])).toBe('failed');
    }
  });

  it('continues to treat compiler-owned missing libraries as not-run, not app failures', () => {
    const output = "error TS6053: File '/project/node_modules/typescript/lib/lib.dom.d.ts' not found.";
    expect(tscNeverRan(output)).toBe(true);
    expect(tscVerdict(output)).toBe('not-run');
    expect(buildScriptTypecheckVerdict({ command: 'npm run build', exitCode: 0, stdout: `> tsc && vite build\n${output}\n✓ built in 1.2s` })).toBeUndefined();
  });

  it('retains project-level diagnostics even without a source-file location', () => {
    const output = `${IMPOSTER}\nerror TS5023: Unknown compiler option '--unsupported'.`;
    expect(tscNeverRan(output)).toBe(false);
    expect(tscVerdict(output)).toBe('failed');
    expect(tscOutputProvesClean(output)).toBe(false);
    expect(typecheckEvidenceFromCommands([{ command: 'tsc --noEmit', stdout: output, exitCode: 0 }])).toBe('failed');
    expect(buildScriptTypecheckVerdict({ command: 'npm run build', exitCode: 0, stdout: `> tsc && vite build\n${output}\n✓ built in 1.2s` })).toBe('failed');
  });

  it('does not turn passing output, package warnings or version probes into refusals', () => {
    for (const output of ['', 'Files: 12\nLines: 500\n', 'npm warn deprecated tsc@9.9.9: unsupported package', 'Version 5.9.3']) {
      expect(looksLikeTscHelpOutput(output)).toBe(false);
      expect(tscVerdict(output)).toBe('passed');
      expect(pipedGateExitCodeWarning('tsc --noEmit | head -50', 0, output)).toBeNull();
    }
    expect(typecheckEvidenceFromCommands([{ command: 'tsc --version', stdout: 'Version 5.9.3', exitCode: 0 }])).toBeUndefined();
    expect(typecheckEvidenceFromCommands([{ command: 'tsc --noEmit', stdout: '', exitCode: 0 }])).toBe('passed');
    expect(pipedGateExitCodeWarning('cat output.log | head -50', 0, IMPOSTER)).toBeNull();
    expect(pipedGateExitCodeWarning('vitest run | head -50', 0, IMPOSTER)).toBeNull();
    expect(pipedGateExitCodeWarning('tsc --noEmit', 0, IMPOSTER)).toBeNull();
    expect(pipedGateExitCodeWarning('tsc --noEmit | head -50', 1, IMPOSTER)).toBeNull();
  });
});
