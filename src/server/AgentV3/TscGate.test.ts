import { describe, it, expect } from 'vitest';
import {
  hasTscErrors, looksLikeTscHelpOutput, looksLikeTypecheckCommand, typecheckEvidenceFromCommands,
} from './TscGate';

describe('hasTscErrors', () => {
  it('detects a real compile error', () => {
    expect(hasTscErrors('src/App.tsx(17,9): error TS2339: Property x does not exist.')).toBe(true);
    expect(hasTscErrors('src/hooks/useCart.ts:4:3 - error TS2345: Argument of type ...')).toBe(true);
  });

  it('clean output is not a failure', () => {
    expect(hasTscErrors('')).toBe(false);
    expect(hasTscErrors('deps present\n')).toBe(false);
    expect(hasTscErrors('Files:  120\nLines: 4000\n')).toBe(false);
  });

  it('null / undefined output is not a failure', () => {
    expect(hasTscErrors(null)).toBe(false);
    expect(hasTscErrors(undefined)).toBe(false);
  });

  it('a warning (no "error TSxxxx") is not a failure', () => {
    expect(hasTscErrors("warning: 'foo' is declared but never used")).toBe(false);
    expect(hasTscErrors('npm warn deprecated some-pkg@1.0.0')).toBe(false);
  });

  it('detects an error anywhere in a long, noisy log', () => {
    const log = ['added 240 packages', 'building...', 'src/x.ts(2,2): error TS1005: ";" expected.', 'done'].join('\n');
    expect(hasTscErrors(log)).toBe(true);
  });
});

describe('looksLikeTscHelpOutput — a config-less tsc that never actually ran (false "clean" pass)', () => {
  it('detects the tsc help/usage page (printed when there is no tsconfig + no inputs)', () => {
    const help = [
      'tsc: The TypeScript Compiler - Version 5.5.3',
      '',
      'COMMON COMMANDS',
      '',
      '  tsc',
      '  Compiles the current project (tsconfig.json in the working directory.)',
    ].join('\n');
    expect(looksLikeTscHelpOutput(help)).toBe(true);
    expect(looksLikeTscHelpOutput('Version 5.5.3\nSyntax:   tsc [options] [file...]')).toBe(true);
  });

  it('a REAL type-error log or a clean run is NOT the help page', () => {
    expect(looksLikeTscHelpOutput('src/App.tsx(17,9): error TS2339: Property x does not exist.')).toBe(false);
    expect(looksLikeTscHelpOutput('')).toBe(false);
    expect(looksLikeTscHelpOutput(null)).toBe(false);
    expect(looksLikeTscHelpOutput('added 240 packages\nbuilt in 3s')).toBe(false);
  });
});

describe('looksLikeTypecheckCommand', () => {
  it('a stand-alone --noEmit run, however it is invoked, counts', () => {
    expect(looksLikeTypecheckCommand('./node_modules/.bin/tsc --noEmit 2>&1 | head -40')).toBe(true);
    expect(looksLikeTypecheckCommand('npx tsc --noEmit')).toBe(true);
    expect(looksLikeTypecheckCommand('tsc -p tsconfig.json --noEmit 2>&1 | tail -200 || true')).toBe(true);
  });

  it('a build script that emits (no --noEmit) does not count — it is a different claim', () => {
    expect(looksLikeTypecheckCommand('tsc -p tsconfig.build.json && vite build')).toBe(false);
    expect(looksLikeTypecheckCommand('npm run build')).toBe(false);
  });

  it('null / undefined / unrelated commands are false', () => {
    expect(looksLikeTypecheckCommand(null)).toBe(false);
    expect(looksLikeTypecheckCommand(undefined)).toBe(false);
    expect(looksLikeTypecheckCommand('npm run dev')).toBe(false);
  });
});

describe('typecheckEvidenceFromCommands — the release-gate fallback (production report, 2026-09-16)', () => {
  it('🔴 THE EXACT REGRESSION: a clean agent-run `tsc --noEmit | head -40` reads as passed', () => {
    // Verbatim shape from the report: piped through `head`, so the recorded exit code (0) is head's,
    // not tsc's — this function must read the OUTPUT, not the exit code, to be trustworthy at all.
    const commands = [
      { command: './node_modules/.bin/tsc --noEmit 2>&1 | head -40', stdout: '', stderr: '' },
    ];
    expect(typecheckEvidenceFromCommands(commands)).toBe('passed');
  });

  it('a real compile error in the output reads as failed, regardless of exit code', () => {
    const commands = [
      { command: 'npx tsc --noEmit', stdout: 'src/App.tsx(4,2): error TS2304: Cannot find name X.', stderr: '' },
    ];
    expect(typecheckEvidenceFromCommands(commands)).toBe('failed');
  });

  it('the LATEST typecheck wins — the agent fixed it between two runs', () => {
    const commands = [
      { command: 'npx tsc --noEmit', stdout: 'error TS2304: Cannot find name X.', stderr: '' },
      { command: 'some_other_command --flag', stdout: 'unrelated', stderr: '' },
      { command: 'npx tsc --noEmit', stdout: '', stderr: '' },
    ];
    expect(typecheckEvidenceFromCommands(commands)).toBe('passed');
  });

  it('a tsc HELP page (no real project) is skipped — never counted as a clean pass', () => {
    const commands = [
      { command: 'tsc --noEmit', stdout: 'tsc: The TypeScript Compiler - Version 5.5.3\nCOMMON COMMANDS', stderr: '' },
    ];
    expect(typecheckEvidenceFromCommands(commands)).toBeUndefined();
  });

  it('no typecheck-shaped command anywhere → undefined, never invents a pass', () => {
    const commands = [
      { command: 'npm install', stdout: 'added 240 packages', stderr: '' },
      { command: 'npm run build', stdout: 'built in 3s', stderr: '' },
    ];
    expect(typecheckEvidenceFromCommands(commands)).toBeUndefined();
  });

  it('an empty command list is undefined, not a crash', () => {
    expect(typecheckEvidenceFromCommands([])).toBeUndefined();
  });
});
