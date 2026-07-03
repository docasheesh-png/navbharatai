import { describe, it, expect } from 'vitest';
import { hasTscErrors, looksLikeTscHelpOutput } from './TscGate';

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
