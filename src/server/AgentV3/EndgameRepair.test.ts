import { describe, it, expect, vi } from 'vitest';
import {
  parseTscErrors,
  removeUnusedImports,
  endgameDeterministicPass,
  offendingFileSubset,
  endgameRepairEnabled,
  runEndgameRepair,
  errorTrendConfig,
  shouldTriggerMidBuildRepair,
  stepResumeBudget,
} from './EndgameRepair';

// Real output shapes from the QuizArena build report (2026-07-17) — the build that died at the
// 80-step cap grinding exactly these classes one per 4-5 step round-trip.
const QUIZARENA_TSC = [
  `src/App.tsx(329,59): error TS2345: Argument of type '30' is not assignable to parameter of type 'RestDuration'.`,
  `src/utils/date.ts(2,10): error TS2866: Import 'Set' conflicts with global value used in this file, so must be declared with a type-only import when 'isolatedModules' is enabled.`,
  `src/utils/quizGenerator.ts(1,10): error TS2305: Module '"../types"' has no exported member 'ImportResult'.`,
  `src/components/QuizList.tsx(4,15): error TS6133: 'FormEvent' is declared but its value is never read.`,
].join('\n');

describe('parseTscErrors', () => {
  it('parses the real QuizArena error lines into structured errors', () => {
    const errs = parseTscErrors(QUIZARENA_TSC);
    expect(errs).toHaveLength(4);
    expect(errs[0]).toEqual({ file: 'src/App.tsx', line: 329, col: 59, code: 'TS2345', message: expect.stringContaining('RestDuration') });
    expect(errs[3].code).toBe('TS6133');
  });

  it('returns [] for clean/empty/noise output', () => {
    expect(parseTscErrors('')).toEqual([]);
    expect(parseTscErrors('npm warn deprecated tsc@2.0.4\nAll good')).toEqual([]);
  });
});

describe('removeUnusedImports — the deterministic TS6133 layer (imports only)', () => {
  it('removes one unused named specifier, keeping its siblings', () => {
    const files = { 'src/a.tsx': `import { useState, FormEvent, useMemo } from 'react';\nexport const A = () => useState(useMemo(() => 1, []));` };
    const errs = parseTscErrors(`src/a.tsx(1,20): error TS6133: 'FormEvent' is declared but its value is never read.`);
    const { files: out, removed } = removeUnusedImports(files, errs);
    expect(out['src/a.tsx']).toContain(`import { useState, useMemo } from 'react';`);
    expect(removed).toHaveLength(1);
  });

  it('drops the whole line when the last named specifier goes, and handles a default import', () => {
    const files = {
      'src/b.ts': `import { Zap } from 'lucide-react';\nexport const b = 1;`,
      'src/c.ts': `import React from 'react';\nexport const c = 1;`,
    };
    const errs = [
      ...parseTscErrors(`src/b.ts(1,10): error TS6133: 'Zap' is declared but its value is never read.`),
      ...parseTscErrors(`src/c.ts(1,8): error TS6133: 'React' is declared but its value is never read.`),
    ];
    const { files: out } = removeUnusedImports(files, errs);
    expect(out['src/b.ts']).not.toContain('lucide-react');
    expect(out['src/b.ts']).toContain('export const b = 1;');
    expect(out['src/c.ts']).not.toContain(`import React`);
  });

  it('NEVER touches a non-import line (an unused local variable stays for the LLM layer)', () => {
    const files = { 'src/d.ts': `export function d() {\n  const unusedVar = 42;\n  return 1;\n}` };
    const errs = parseTscErrors(`src/d.ts(2,9): error TS6133: 'unusedVar' is declared but its value is never read.`);
    const { files: out, removed } = removeUnusedImports(files, errs);
    expect(out['src/d.ts']).toBe(files['src/d.ts']);
    expect(removed).toHaveLength(0);
  });
});

describe('endgameDeterministicPass — unused imports + the proven reconcilers over the full map', () => {
  it('fixes the QuizArena broken-export class: re-points a named import to its real owner', async () => {
    const files = {
      'src/types/index.ts': `export interface Quiz { id: string }`,
      'src/utils/importExport.ts': `export interface ImportResult { ok: boolean }`,
      'src/utils/quizGenerator.ts': `import { ImportResult } from '../types';\nexport const gen = (): ImportResult => ({ ok: true });`,
    };
    const errs = parseTscErrors(`src/utils/quizGenerator.ts(1,10): error TS2305: Module '"../types"' has no exported member 'ImportResult'.`);
    const res = await endgameDeterministicPass(files, errs);
    expect(res.files['src/utils/quizGenerator.ts']).toContain('./importExport'); // re-pointed (quote style is the reconciler's)
    expect(res.changedPaths).toContain('src/utils/quizGenerator.ts');
    expect(res.fixes.some((f) => f.includes('ImportResult'))).toBe(true);
  });
});

describe('offendingFileSubset', () => {
  it('returns only files named in errors, deduped and bounded', () => {
    const files = { 'src/a.ts': 'a', 'src/b.ts': 'b', 'src/c.ts': 'c' };
    const errs = [
      ...parseTscErrors(`src/a.ts(1,1): error TS1: x.`),
      ...parseTscErrors(`src/a.ts(2,1): error TS2: y.`),
      ...parseTscErrors(`src/b.ts(1,1): error TS3: z.`),
    ];
    expect(offendingFileSubset(files, errs).map((f) => f.path)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(offendingFileSubset(files, errs, 1).map((f) => f.path)).toEqual(['src/a.ts']);
  });
});

describe('endgameRepairEnabled', () => {
  it('is ON by default; only "off" disables', () => {
    expect(endgameRepairEnabled({} as NodeJS.ProcessEnv)).toBe(true);
    expect(endgameRepairEnabled({ AGENTV3_ENDGAME_REPAIR: 'off' } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(endgameRepairEnabled({ AGENTV3_ENDGAME_REPAIR: 'on' } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe('runEndgameRepair — the two-layer orchestration', () => {
  const filesWithUnused = {
    'src/a.tsx': `import { useState, FormEvent } from 'react';\nexport const A = () => useState(1);`,
  };

  it('already-clean tsc → attempted with nothing to do (no reads, no LLM)', async () => {
    const llm = vi.fn();
    const v = await runEndgameRepair({
      runTsc: async () => '',
      readFiles: async () => { throw new Error('must not read'); },
      writeFile: async () => {},
      llmRepair: llm,
    });
    expect(v).toMatchObject({ attempted: true, clean: true, errorsBefore: 0 });
    expect(llm).not.toHaveBeenCalled();
  });

  it('deterministic-only win: unused import removed, tsc goes clean, LLM never called', async () => {
    const llm = vi.fn();
    const writes: string[] = [];
    let tscRuns = 0;
    const v = await runEndgameRepair({
      runTsc: async () => (++tscRuns === 1 ? `src/a.tsx(1,20): error TS6133: 'FormEvent' is declared but its value is never read.` : ''),
      readFiles: async () => ({ ...filesWithUnused }),
      writeFile: async (p) => { writes.push(p); },
      llmRepair: llm,
    });
    expect(v.clean).toBe(true);
    expect(v.errorsBefore).toBe(1);
    expect(v.errorsAfterDeterministic).toBe(0);
    expect(v.deterministicFixes).toHaveLength(1);
    expect(writes).toEqual(['src/a.tsx']);
    expect(llm).not.toHaveBeenCalled();
  });

  it('residue goes to ONE batch LLM call; its files are written and tsc re-verified', async () => {
    // tsc runs twice: once at entry, once after the LLM write (the deterministic pass changes
    // nothing here, so its re-run is skipped — an efficiency the sequence below relies on).
    const outputs = [
      `src/App.tsx(329,59): error TS2345: Argument of type '30' is not assignable to parameter of type 'RestDuration'.`,
      '',
    ];
    const llm = vi.fn(async () => [{ path: 'src/App.tsx', content: 'export const fixed = true; // full corrected file' }]);
    const writes: Array<{ p: string; c: string }> = [];
    const v = await runEndgameRepair({
      runTsc: async () => outputs.shift() ?? '',
      readFiles: async () => ({ 'src/App.tsx': 'export const broken = 30;' }),
      writeFile: async (p, c) => { writes.push({ p, c }); },
      llmRepair: llm,
    });
    expect(llm).toHaveBeenCalledTimes(1);
    expect(v.llmFilesWritten).toBe(1);
    expect(v.clean).toBe(true);
    expect(writes.some((w) => w.p === 'src/App.tsx' && w.c.includes('fixed'))).toBe(true);
  });

  it('BLANK-OVERWRITE GUARD — an LLM husk can never destroy a real file', async () => {
    const real = `export function big() {\n${'  // real code\n'.repeat(20)}}`;
    const llm = vi.fn(async () => [{ path: 'src/big.ts', content: ' ' }]);
    const writes: string[] = [];
    const v = await runEndgameRepair({
      runTsc: async () => `src/big.ts(1,1): error TS2345: some error.`,
      readFiles: async () => ({ 'src/big.ts': real }),
      writeFile: async (p) => { writes.push(p); },
      llmRepair: llm,
    });
    expect(v.llmFilesWritten).toBe(0);
    expect(writes).toHaveLength(0); // no deterministic change either — nothing written at all
  });

  it('CONVERGENCE GUARD — a repair that INCREASES the error count is rolled back (CrewHub 59→67)', async () => {
    // Entry tsc: 1 error. The LLM "repair" rewrites the file but the re-run shows 2 errors (worse).
    // The guard must restore the pre-repair content, keep errorsAfter at the pre-repair count, report
    // llmFilesWritten 0 (net-zero delivery) and set llmReverted.
    const original = 'export const broken = 30; // original content, one error';
    const outputs = [
      `src/App.tsx(1,1): error TS2345: original single error.`,
      `src/App.tsx(1,1): error TS2345: still broken.\nsrc/App.tsx(2,1): error TS2739: NEW error the repair introduced.`,
    ];
    const llm = vi.fn(async () => [{ path: 'src/App.tsx', content: 'export const worse = true; // repair that makes it worse' }]);
    const writes: Array<{ p: string; c: string }> = [];
    const v = await runEndgameRepair({
      runTsc: async () => outputs.shift() ?? '',
      readFiles: async () => ({ 'src/App.tsx': original }),
      writeFile: async (p, c) => { writes.push({ p, c }); },
      llmRepair: llm,
    });
    // The LAST write to the file must be the ROLLBACK to the original content.
    const appWrites = writes.filter((w) => w.p === 'src/App.tsx');
    expect(appWrites[appWrites.length - 1].c).toBe(original);
    expect(v.llmReverted).toBe(true);
    expect(v.llmFilesWritten).toBe(0);
    expect(v.errorsAfter).toBe(1); // the better, pre-repair state — never the worse one
    expect(v.clean).toBe(false);
  });

  it('a repair that HELPS is kept — no rollback, no llmReverted flag', async () => {
    const outputs = [
      `src/a.ts(1,1): error TS2345: e1.\nsrc/a.ts(2,1): error TS2345: e2.`,
      `src/a.ts(1,1): error TS2345: only one left.`, // improved 2 → 1 (still not clean)
    ];
    const llm = vi.fn(async () => [{ path: 'src/a.ts', content: 'export const better = 1; // improved' }]);
    const v = await runEndgameRepair({
      runTsc: async () => outputs.shift() ?? '',
      readFiles: async () => ({ 'src/a.ts': 'export const x = 1;' }),
      writeFile: async () => {},
      llmRepair: llm,
    });
    expect(v.llmReverted).toBeUndefined();
    expect(v.llmFilesWritten).toBe(1);
    expect(v.errorsAfter).toBe(1);
  });

  it('an I/O throw returns the honest no-attempt verdict (endgame never worsens a build)', async () => {
    const v = await runEndgameRepair({
      runTsc: async () => { throw new Error('sandbox gone'); },
      readFiles: async () => ({}),
      writeFile: async () => {},
    });
    expect(v.attempted).toBe(false);
  });

  it('without an llmRepair the deterministic residue is reported honestly (not clean)', async () => {
    const v = await runEndgameRepair({
      runTsc: async () => `src/x.ts(1,1): error TS2345: real logic error.`,
      readFiles: async () => ({ 'src/x.ts': 'export const x = 1;' }),
      writeFile: async () => {},
    });
    expect(v.attempted).toBe(true);
    expect(v.clean).toBe(false);
    expect(v.errorsAfter).toBe(1);
  });
});

describe('Slice 2 — error-trend checkpoint (grind detection)', () => {
  it('config: ON by default, interval 25, floor 5, off switch works', () => {
    expect(errorTrendConfig({} as NodeJS.ProcessEnv)).toEqual({ enabled: true, interval: 25 });
    expect(errorTrendConfig({ AGENTV3_ERRTREND_CHECKPOINT: 'off' } as unknown as NodeJS.ProcessEnv).enabled).toBe(false);
    expect(errorTrendConfig({ AGENTV3_ERRTREND_INTERVAL: '40' } as unknown as NodeJS.ProcessEnv).interval).toBe(40);
    expect(errorTrendConfig({ AGENTV3_ERRTREND_INTERVAL: '1' } as unknown as NodeJS.ProcessEnv).interval).toBe(25);
  });

  it('fires ONLY on two consecutive non-decreasing non-zero counts', () => {
    expect(shouldTriggerMidBuildRepair([])).toBe(false);
    expect(shouldTriggerMidBuildRepair([8])).toBe(false); // one peek is never enough
    expect(shouldTriggerMidBuildRepair([8, 3])).toBe(false); // converging — let it work
    expect(shouldTriggerMidBuildRepair([8, 8])).toBe(true); // flat — grinding
    expect(shouldTriggerMidBuildRepair([3, 7])).toBe(true); // rising — worse than grinding
    expect(shouldTriggerMidBuildRepair([5, 0])).toBe(false); // clean — nothing to do
    expect(shouldTriggerMidBuildRepair([0, 0])).toBe(false);
  });
});

describe('Slice 3 — stepResumeBudget', () => {
  it('default 1; off/0 disables; capped at 3 so a misconfig can never loop forever', () => {
    expect(stepResumeBudget({} as NodeJS.ProcessEnv)).toBe(1);
    expect(stepResumeBudget({ AGENTV3_STEP_RESUME: 'off' } as unknown as NodeJS.ProcessEnv)).toBe(0);
    expect(stepResumeBudget({ AGENTV3_STEP_RESUME: '0' } as unknown as NodeJS.ProcessEnv)).toBe(0);
    expect(stepResumeBudget({ AGENTV3_STEP_RESUME: '2' } as unknown as NodeJS.ProcessEnv)).toBe(2);
    expect(stepResumeBudget({ AGENTV3_STEP_RESUME: '99' } as unknown as NodeJS.ProcessEnv)).toBe(3);
  });
});
