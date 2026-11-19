import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createFinishingPassGuard, FinishingPassDeferredError, generationTimeoutNote, retainedRepairRecords, retainFinishingFileRepairs } from '../src/server/AgentV3/finishingPassesAtCap';
import { writeUnlessFrozen } from '../src/server/routes/agentv3';

describe('cdffbb71: a deferred spacing repair cannot change only the saved copy', () => {
  it.each(['design-consistency-heal', 'ambient-shim-cleanup'])('keeps sandbox and saved bytes equal when %s is refused', async (pass) => {
    const original = '.colour-grid { gap: 10px; }';
    const patch = '.colour-grid { gap: 8px; }';
    const sandbox = new Map([['src/app/game.component.ts', original]]);
    const saved = new Map(sandbox);
    const notes: string[] = [];
    const guard = createFinishingPassGuard({ result: () => ({ timedOut: true }), aborted: () => false,
      remainingMs: () => 175_649, record: (note) => notes.push(note.code) });
    const wrote = await writeUnlessFrozen(() => guard.writeOrThrow(pass, async () => {
      sandbox.set('src/app/game.component.ts', patch);
    }));
    if (wrote) saved.set('src/app/game.component.ts', patch);
    expect(wrote).toBe(false);
    expect(saved).toEqual(sandbox);
    expect(saved.get('src/app/game.component.ts')).toBe(original);
    expect(notes).toEqual(['FINISHING_PASSES_HELD_AT_CAP']);
  });

  it('keeps the existing durable repair behavior for a transport failure', async () => {
    expect(await writeUnlessFrozen(async () => { throw new Error('sandbox paused'); })).toBe(true);
    expect(await writeUnlessFrozen(async () => { throw new FinishingPassDeferredError('design-consistency-heal'); })).toBe(false);
  });

  it('reports only accepted files when a repair is wholly or partially deferred', async () => {
    for (const initialRemaining of [110_000, 121_000]) {
      let remaining = initialRemaining;
      const saved = new Map<string, string>();
      const records = [{ file: 'src/first.ts', line: 1 }, { file: 'src/first.ts', line: 2 }, { file: 'src/second.ts', line: 3 }];
      const guard = createFinishingPassGuard({ result: () => ({}), aborted: () => false,
        remainingMs: () => remaining, record: () => {} });
      const retainedPaths = await retainFinishingFileRepairs(
        { 'src/unchanged.ts': 'original' },
        { 'src/first.ts': 'repaired', 'src/second.ts': 'repaired', 'src/unchanged.ts': 'original' },
        () => writeUnlessFrozen(() => guard.writeOrThrow('credential-log-redact', async () => { remaining = 110_000; })),
        (path, content) => { saved.set(path, content); },
      );
      expect(retainedRepairRecords(records, retainedPaths)).toEqual(initialRemaining > 120_000 ? records.slice(0, 2) : []);
      expect([...saved.keys()]).toEqual([...retainedPaths]);
    }
  });

  it('refuses the optional integrity runner after generation ends even with total time remaining', async () => {
    const runner = vi.fn(async () => ({ ok: true }));
    const guard = createFinishingPassGuard({ result: () => ({ timedOut: true }), aborted: () => false,
      remainingMs: () => 150_000, record: () => {} });
    expect(await guard.repair('integrity-repair', runner)).toBeNull();
    expect(runner).not.toHaveBeenCalled();
  });

  it('describes the observed generation cutoff without claiming the total deadline was reached', () => {
    expect(generationTimeoutNote(1_353_031, true)).toContain('1353s elapsed');
    expect(generationTimeoutNote(1_353_031, true)).toContain('can precede the total build deadline');
    expect(generationTimeoutNote(1_353_031, false)).toContain('before producing application files');
    expect(generationTimeoutNote(1_353_031, true)).not.toMatch(/25-minute|wall-clock cap/);
  });

  it('the live optional repair uses the guard budget and cannot overwrite timeout provenance', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    const start = route.indexOf("if (shouldRunIntegrityHeal(");
    const end = route.indexOf('// PER-PAGE DESIGN COVERAGE', start);
    const block = route.slice(start, end);
    expect(block).toContain("finishingGuard.allow('integrity-repair')");
    expect(block).toContain("finishingGuard.repairOrThrow('integrity-repair', (maxBuildMs, signal)");
    expect(block).toContain('...baseRunnerOpts,\n                  maxBuildMs,\n                  signal,');
    expect(block).not.toMatch(/result\s*=\s*\{\s*\.\.\.healed/);
    expect(block).not.toContain('The app is built and compiles');
    const preview = route.slice(route.indexOf('const compileHealRunner ='), route.indexOf('// POST-BUILD RULES-OF-HOOKS'));
    expect(preview).not.toMatch(/result\s*=\s*\{\s*\.\.\.healed/);
  });

  it('every deterministic finishing write checks admission before retaining or reporting content', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    const calls = route.split('\n').filter((line) => line.includes('writeUnlessFrozen(() =>'));
    expect(calls.length).toBeGreaterThanOrEqual(12);
    expect(calls.filter((line) => !line.includes('finishingGuard.writeOrThrow('))).toEqual([]);
    for (const code of ['INTEGRITY_CSS_WIRED', 'ENV_LOADING_WIRED']) {
      const line = route.indexOf(`code: '${code}'`);
      const start = route.lastIndexOf('if (await writeUnlessFrozen(', line);
      expect(start).toBeGreaterThan(0);
      expect(route.slice(start, line)).not.toMatch(/\n\s*}\s*\n/);
    }
    expect(route).toContain('retainedRepairRecords(redacted.redactions, retainedPaths)');
    expect(route).toContain('retainedRepairRecords(repaired.repairs, retainedPaths)');
    expect(route).not.toContain('message: scriptRepairSummary(repaired.repairs)');
    expect(route).not.toContain('message: `Redacted ${redacted.redactions.length}');
  });
});
