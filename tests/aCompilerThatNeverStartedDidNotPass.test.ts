import { describe, it, expect } from 'vitest';
import {
  looksLikeMissingTscBinary,
  tscNeverRan,
  typecheckEvidenceFromCommands,
} from '../src/server/AgentV3/TscGate';
import { pipedGateExitCodeWarning } from '../src/server/AgentV3/pipedGateExitCode';

/**
 * Admin report, build f2ff962f (2026-09-12). Before `npm install` the agent ran
 *   ./node_modules/.bin/tsc --noEmit 2>&1 | head -40
 * and bash answered that the compiler did not exist. The pipe reported exit 0, the output held no
 * `error TS`, and every reader scored it as a CLEAN typecheck — a pass for a compiler that never ran.
 */
const CMD = './node_modules/.bin/tsc --noEmit 2>&1 | head -40';
const BASH_MISSING = '/bin/bash: line 1: ./node_modules/.bin/tsc: No such file or directory\n';

describe('a compiler that never started did not pass', () => {
  it('recognises every shell phrasing of a missing tsc', () => {
    expect(looksLikeMissingTscBinary(BASH_MISSING)).toBe(true);
    expect(looksLikeMissingTscBinary('sh: 1: tsc: not found')).toBe(true);
    expect(looksLikeMissingTscBinary('bash: tsc: command not found')).toBe(true);
    expect(looksLikeMissingTscBinary('npm error could not determine executable to run')).toBe(true);
  });

  it('never mistakes a real compile result for a missing binary', () => {
    expect(looksLikeMissingTscBinary('')).toBe(false);
    expect(looksLikeMissingTscBinary("src/App.tsx(3,1): error TS2307: Cannot find module './x' or its corresponding type declarations.")).toBe(false);
    expect(looksLikeMissingTscBinary('Found 0 errors.')).toBe(false);
    expect(tscNeverRan('')).toBe(false);
  });

  it('🔴 the report itself: the missing-binary run is not evidence, the later real run is', () => {
    // The exact order from the report: missing binary first, npm install, then a clean real run.
    expect(typecheckEvidenceFromCommands([{ command: CMD, stdout: BASH_MISSING }])).toBeUndefined();
    expect(typecheckEvidenceFromCommands([
      { command: CMD, stdout: BASH_MISSING },
      { command: 'npm install 2>&1 | tail -15', stdout: 'added 200 packages' },
      { command: CMD, stdout: '' },
    ])).toBe('passed');
    // …and a missing binary AFTER a real failure must not erase that failure.
    expect(typecheckEvidenceFromCommands([
      { command: CMD, stdout: 'src/App.tsx(1,1): error TS2322: bad' },
      { command: CMD, stdout: BASH_MISSING },
    ])).toBe('failed');
  });

  it('the piped exit 0 is called out to the agent in bash phrasing too', () => {
    expect(pipedGateExitCodeWarning(CMD, 0, BASH_MISSING)).toMatch(/DID NOT ACTUALLY PASS/);
    // A clean real run stays silent.
    expect(pipedGateExitCodeWarning(CMD, 0, '')).toBeNull();
  });
});
