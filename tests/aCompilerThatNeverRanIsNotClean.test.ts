// Autopsy 12c642ed (2026-09-30, "simple daily habit tracker", Weak). The write-time typecheck ran four
// times; every run printed `node_modules/.bin/tsc: No such file or directory` — the compiler was never
// installed — and the report said "4 run(s), 4 clean". The install's own error went to /dev/null, and
// the architect's `./node_modules/.bin/tsc --noEmit | head -40` was logged as `exit 0`.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { tscVerdict, commandOutcomeText, looksLikeMissingTscBinary } from '../src/server/AgentV3/TscGate';
import { TSC_ENSURE, TSC_UNAVAILABLE_MARKER, TSC_ENSURE_LOG } from '../src/server/AgentV3/tscCommand';
import { writeTypecheckSummary, emptyWriteTypecheckStats } from '../src/server/AgentV3/writeTimeTypecheck';

const MISSING = '/bin/bash: line 1: node_modules/.bin/tsc: No such file or directory\n';

describe('the verdict', () => {
  it('the report\'s own output is "not-run", never "passed"', () => {
    expect(tscVerdict(MISSING)).toBe('not-run');
  });
  it('our ensure step\'s marker is read as a compiler that never ran', () => {
    const out = `${TSC_UNAVAILABLE_MARKER}: the TypeScript compiler could not be installed, so nothing was checked. npm said:\nnpm error 404\n`;
    expect(looksLikeMissingTscBinary(out)).toBe(true);
    expect(tscVerdict(out)).toBe('not-run');
  });
  it('an empty output is still the genuinely clean case', () => {
    expect(tscVerdict('')).toBe('passed');
  });
});

describe('the report line', () => {
  const cmd = './node_modules/.bin/tsc --noEmit 2>&1 | head -40';
  it('🔴 exit 0 from a pipe is never shown alone when the compiler did not run', () => {
    const t = commandOutcomeText({ command: cmd, exitCode: 0, stdout: MISSING });
    expect(t).toMatch(/^exit 0, but the compiler did not run/);
  });
  it('exit 0 from a pipe over real errors says so', () => {
    const t = commandOutcomeText({ command: cmd, exitCode: 0, stdout: "src/App.tsx(3,1): error TS2304: Cannot find name 'x'.\n" });
    expect(t).toBe('exit 0 from the pipe, but 1 type error in the output');
  });
  it('a clean compile keeps its plain exit code', () => {
    expect(commandOutcomeText({ command: cmd, exitCode: 0, stdout: '' })).toBe('exit 0');
  });
  it('a command that is not a typecheck is untouched', () => {
    expect(commandOutcomeText({ command: 'ls', exitCode: 0, stdout: MISSING })).toBe('exit 0');
  });
});

describe('the write-time summary', () => {
  it('🔴 four runs that never compiled are not "4 clean"', () => {
    const s = { ...emptyWriteTypecheckStats(), runs: 4, cleanRuns: 0, notRunRuns: 4, elapsedMs: 39_000 };
    const line = writeTypecheckSummary(s, true);
    expect(line).toContain('4 run(s), 0 clean, 4 where the compiler never ran');
    expect(line).not.toMatch(/4 clean/);
  });
  it('a build whose runs all compiled reads as before', () => {
    const s = { ...emptyWriteTypecheckStats(), runs: 2, cleanRuns: 2, elapsedMs: 4_000 };
    expect(writeTypecheckSummary(s, true)).toMatch(/^Write-time typecheck: 2 run\(s\), 2 clean, 0 error/);
  });
});

describe('the dispatcher counts by verdict, not by error count', () => {
  const src = readFileSync(join(__dirname, '../src/server/AgentV3/ToolDispatcher.ts'), 'utf8');
  it('a never-ran run is counted and returns before the clean count', () => {
    const neverRan = src.indexOf("neverRan = verdict === 'not-run' || verdict === 'unknown';");
    const counted = src.indexOf('s.notRunRuns += 1;');
    const clean = src.indexOf('if (errors.length === 0) s.cleanRuns += 1;');
    expect(neverRan).toBeGreaterThan(-1);
    expect(counted).toBeGreaterThan(neverRan);
    expect(clean).toBeGreaterThan(counted);
  });
});

describe('the ensure step keeps npm\'s reason', () => {
  it('writes the install output to a log instead of /dev/null', () => {
    expect(TSC_ENSURE).not.toContain('/dev/null');
    expect(TSC_ENSURE).toContain(`>>${TSC_ENSURE_LOG} 2>&1`);
  });
  it('retries with --legacy-peer-deps ONLY for a peer-resolution failure', () => {
    expect(TSC_ENSURE).toContain("grep -qiE 'ERESOLVE|peer dep'");
    expect(TSC_ENSURE).not.toMatch(/\|\| npm install[^(]*--legacy-peer-deps/);
  });
  it('says so in words, with npm\'s last lines, when there is still no compiler', () => {
    expect(TSC_ENSURE).toContain(`echo "${TSC_UNAVAILABLE_MARKER}:`);
    expect(TSC_ENSURE).toContain(`tail -n 6 ${TSC_ENSURE_LOG}`);
  });
});
