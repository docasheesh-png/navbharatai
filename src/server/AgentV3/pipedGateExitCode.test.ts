import { describe, it, expect } from 'vitest';
import { isPipedGateCommand, pipedGateExitCodeWarning } from './pipedGateExitCode';

// The verbatim command and output from build 56ee622f, where the agent believed typecheck passed.
const REAL_CMD = './node_modules/.bin/tsc --noEmit 2>&1 | head -30';
const REAL_OUT = [
  "src/App.tsx(307,44): error TS2322: Type '{ children: string; onClick: () => void; tone: string; }' is not assignable",
  "  Property 'tone' does not exist on type '{ children: ReactNode; }'.",
  "src/ErrorBoundary.tsx(17,39): error TS2339: Property 'setState' does not exist on type 'ErrorBoundary'.",
  "src/ModerationScreen.tsx(40,18): error TS2322: Type '\"warning\"' is not assignable to type '\"neutral\"'.",
].join('\n');

describe('isPipedGateCommand', () => {
  it('recognises the exact shape that lied', () => {
    expect(isPipedGateCommand(REAL_CMD)).toBe(true);
  });

  it('covers the other gate tools people pipe', () => {
    for (const c of [
      'npx tsc --noEmit | tail -20',
      'npm run typecheck | head',
      'npx eslint . | head -50',
      'npx vitest run | tail -5',
      'npx jest | grep -i fail',
      'yarn build | tail -3',
    ]) expect(isPipedGateCommand(c)).toBe(true);
  });

  it('is silent without a pipe, and does not confuse `||` with a pipeline', () => {
    expect(isPipedGateCommand('npx tsc --noEmit')).toBe(false);
    expect(isPipedGateCommand('npx tsc --noEmit || echo failed')).toBe(false);
    expect(isPipedGateCommand('')).toBe(false);
  });

  it('is silent for a non-gate command that happens to pipe', () => {
    expect(isPipedGateCommand('ls -la | head')).toBe(false);
    expect(isPipedGateCommand('cat package.json | head -5')).toBe(false);
  });
});

describe('pipedGateExitCodeWarning — the pipe ate the exit code', () => {
  it('catches the real regression: exit 0 with 10 TypeScript errors in the output', () => {
    const w = pipedGateExitCodeWarning(REAL_CMD, 0, REAL_OUT);
    expect(w).not.toBeNull();
    expect(w).toMatch(/DID NOT ACTUALLY PASS/);
    expect(w).toMatch(/exit status of its last command/);
    expect(w).toContain('error TS2322');       // quotes the real first error
    expect(w).toMatch(/WITHOUT a pipe/);        // tells the agent how to get a trustworthy verdict
  });

  it('stays silent when the command already told the truth (non-zero exit)', () => {
    expect(pipedGateExitCodeWarning(REAL_CMD, 1, REAL_OUT)).toBeNull();
  });

  it('stays silent on a genuinely clean run — no false alarm', () => {
    expect(pipedGateExitCodeWarning(REAL_CMD, 0, '')).toBeNull();
    expect(pipedGateExitCodeWarning(REAL_CMD, 0, 'Found 0 errors.')).toBeNull();
    expect(pipedGateExitCodeWarning('npx vitest run | tail -5', 0, 'Tests  120 passed (120)')).toBeNull();
  });

  it('does not trip on output that merely says the word "error"', () => {
    expect(pipedGateExitCodeWarning('npx vitest run | tail', 0, '✓ renders the error state banner')).toBeNull();
    expect(pipedGateExitCodeWarning('npx tsc --noEmit | head', 0, 'compiling src/errorHandler.ts')).toBeNull();
  });

  it('catches a failing test run that exits 0 through a pipe', () => {
    expect(pipedGateExitCodeWarning('npx vitest run | tail -5', 0, 'Tests  3 failed | 117 passed')).not.toBeNull();
    expect(pipedGateExitCodeWarning('npx eslint . | head -40', 0, '\n  12 problems (4 errors, 8 warnings)')).not.toBeNull();
  });

  it('stays silent for a non-gate command, however ugly its output', () => {
    expect(pipedGateExitCodeWarning('cat log.txt | head', 0, 'src/App.tsx(1,1): error TS1005: x')).toBeNull();
  });
});
