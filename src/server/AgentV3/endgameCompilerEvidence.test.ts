import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { parseTscErrors, runEndgameRepair } from './EndgameRepair';
import { countTscErrors, tscVerdict } from './TscGate';

const fileError = 'src/a.ts(1,1): error TS2345: Argument has the wrong type.';
const secondError = 'src/a.ts(2,1): error TS2345: Another argument has the wrong type.';
const projectError = "error TS5023: Unknown compiler option '--invalid-option'.";
const refusal = 'This is not the tsc command you are looking for';
const untrustedOutputs = [
  ['unknown npm failure', 'npm error code ERESOLVE\nnpm error dependency resolution failed'],
  ['unknown module failure', "Cannot find module 'typescript'"],
  ['compiler not run', 'NBAI_TSC_UNAVAILABLE: compiler missing'],
  ['compiler imposter refusal', refusal],
  ['project-level diagnostic', projectError],
  ['file and project-level diagnostics', `${fileError}\n${projectError}`],
] as const;

// Injected I/O is a real mutable workspace model: assert both the verdict and the bytes that land.
// No provider or sandbox is called; the model repair callback below is a local deterministic stub.
function workspace(initial: string, outputs: string[], repair?: string) {
  const disk: Record<string, string> = { 'src/a.ts': initial };
  const runTsc = vi.fn(async () => {
    const next = outputs.shift();
    if (next === undefined) throw new Error('Unexpected extra compiler call');
    return next;
  });
  const readFiles = vi.fn(async () => ({ ...disk }));
  const writeFile = vi.fn(async (path: string, content: string) => { disk[path] = content; });
  const llmRepair = vi.fn(async () => repair === undefined ? [] : [{ path: 'src/a.ts', content: repair }]);
  return { disk, io: { runTsc, readFiles, writeFile, llmRepair } };
}

const unusedSource = "import { First, Second } from 'external-package';\nexport const value = 1;";
const unusedErrors = [
  "src/a.ts(1,10): error TS6133: 'First' is declared but its value is never read.",
  "src/a.ts(1,17): error TS6133: 'Second' is declared but its value is never read.",
].join('\n');

describe('endgame requires a complete compiler verdict before trusting error counts', () => {
  it.each(untrustedOutputs)('does not begin repairs or claim clean on initial %s', async (_name, output) => {
    const { io } = workspace('export const value = 1;', [output]);
    const verdict = await runEndgameRepair(io);
    expect(verdict).toMatchObject({ attempted: false, clean: false, tscUnverified: true });
    expect(io.runTsc).toHaveBeenCalledTimes(1);
    expect(io.readFiles).not.toHaveBeenCalled();
    expect(io.writeFile).not.toHaveBeenCalled();
    expect(io.llmRepair).not.toHaveBeenCalled();
  });

  it.each(untrustedOutputs)('rolls back deterministic writes on %s instead of claiming clean or improvement', async (_name, output) => {
    const { disk, io } = workspace(unusedSource, [unusedErrors, output]);
    const verdict = await runEndgameRepair(io);
    expect(verdict).toMatchObject({ attempted: true, clean: false, tscUnverified: true,
      errorsBefore: 2, errorsAfterDeterministic: 2, errorsAfter: 2, deterministicFixes: [], llmFilesWritten: 0 });
    expect(io.writeFile).toHaveBeenCalledTimes(2);
    expect(io.writeFile.mock.calls[0][1]).not.toBe(unusedSource);
    expect(io.writeFile.mock.calls[1]).toEqual(['src/a.ts', unusedSource]);
    expect(disk['src/a.ts']).toBe(unusedSource);
    expect(io.llmRepair).not.toHaveBeenCalled();
  });

  it.each(untrustedOutputs)('rolls back batch repair writes on %s instead of claiming clean or improvement', async (_name, output) => {
    const original = 'export const value = 1;';
    const repaired = 'export const value = 2;';
    const { disk, io } = workspace(original, [`${fileError}\n${secondError}`, output], repaired);
    const verdict = await runEndgameRepair(io);
    expect(verdict).toMatchObject({ attempted: true, clean: false, tscUnverified: true,
      errorsBefore: 2, errorsAfterDeterministic: 2, errorsAfter: 2, llmFilesWritten: 0 });
    expect(io.llmRepair).toHaveBeenCalledTimes(1);
    expect(io.writeFile.mock.calls).toEqual([['src/a.ts', repaired], ['src/a.ts', original]]);
    expect(disk['src/a.ts']).toBe(original);
  });

  it('preserves genuinely blank initial success without reading or writing files', async () => {
    const { io } = workspace('export const value = 1;', ['']);
    expect(await runEndgameRepair(io)).toMatchObject({ attempted: true, clean: true, errorsBefore: 0, errorsAfter: 0 });
    expect(io.readFiles).not.toHaveBeenCalled();
    expect(io.writeFile).not.toHaveBeenCalled();
    expect(io.llmRepair).not.toHaveBeenCalled();
  });

  it('retains verified deterministic bytes and counts when a later batch check is unknown', async () => {
    const { disk, io } = workspace(unusedSource,
      [`${unusedErrors}\n${fileError}`, fileError, 'npm error failed to run the compiler'],
      'export const value = 2;');
    const verdict = await runEndgameRepair(io);
    expect(verdict).toMatchObject({ attempted: true, clean: false, tscUnverified: true,
      errorsBefore: 3, errorsAfterDeterministic: 1, errorsAfter: 1, llmFilesWritten: 0 });
    expect(verdict.deterministicFixes).toHaveLength(2);
    expect(io.writeFile).toHaveBeenCalledTimes(3);
    const deterministicContent = io.writeFile.mock.calls[0][1];
    expect(deterministicContent).not.toBe(unusedSource);
    expect(io.writeFile.mock.calls[1]).toEqual(['src/a.ts', 'export const value = 2;']);
    expect(io.writeFile.mock.calls[2]).toEqual(['src/a.ts', deterministicContent]);
    expect(disk['src/a.ts']).toBe(deterministicContent);
    expect(io.runTsc).toHaveBeenCalledTimes(3);
  });

  it('keeps deterministic writes after genuinely blank success', async () => {
    const { disk, io } = workspace(unusedSource, [unusedErrors, '']);
    const verdict = await runEndgameRepair(io);
    expect(verdict).toMatchObject({ clean: true, errorsBefore: 2, errorsAfter: 0 });
    expect(verdict.tscUnverified).toBeUndefined();
    expect(io.writeFile).toHaveBeenCalledTimes(1);
    expect(disk['src/a.ts']).not.toBe(unusedSource);
    expect(io.llmRepair).not.toHaveBeenCalled();
  });

  it.each([
    ['blank success', '', 0],
    ['fully parsed improvement', fileError, 1],
    ['real diagnostic plus refusal', `${refusal}\n${fileError}`, 1],
  ] as const)(
    'keeps batch repair writes after %s', async (_name, output, count) => {
      const repaired = 'export const value = 2;';
      const { disk, io } = workspace('export const value = 1;', [`${fileError}\n${secondError}`, output], repaired);
      const verdict = await runEndgameRepair(io);
      expect(verdict).toMatchObject({ clean: count === 0, errorsBefore: 2, errorsAfter: count, llmFilesWritten: 1 });
      expect(verdict.tscUnverified).toBeUndefined();
      expect(io.writeFile).toHaveBeenCalledTimes(1);
      expect(disk['src/a.ts']).toBe(repaired);
    },
  );

  it('retains a real initial diagnostic even alongside a compiler refusal', async () => {
    const { io } = workspace('export const value = 1;', [`${refusal}\n${fileError}`]);
    const verdict = await runEndgameRepair(io);
    expect(verdict).toMatchObject({ attempted: true, clean: false, errorsBefore: 1, errorsAfter: 1 });
    expect(verdict.tscUnverified).toBeUndefined();
    expect(io.readFiles).toHaveBeenCalledTimes(1);
    expect(io.writeFile).not.toHaveBeenCalled();
  });

  it('proves a real compiler project-level failure is not a parsed zero-error result', async () => {
    const require = createRequire(import.meta.url);
    const result = spawnSync(process.execPath, [require.resolve('typescript/lib/tsc.js'), '--invalid-option', '--pretty', 'false'], { encoding: 'utf8' });
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    const output = result.stdout + result.stderr;
    expect(output).toContain('error TS5023:');
    expect(tscVerdict(output)).toBe('failed');
    expect(countTscErrors(output)).toBe(1);
    expect(parseTscErrors(output)).toEqual([]);
    const { io } = workspace('export const value = 1;', [output]);
    expect(await runEndgameRepair(io)).toMatchObject({ attempted: false, clean: false, tscUnverified: true });
    expect(io.writeFile).not.toHaveBeenCalled();
  });
});
