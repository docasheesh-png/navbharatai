import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  normalizeAuthoredPath,
  authoredPathSet,
  splitByAuthorship,
  preExistingCodeObservation,
} from '../src/server/AgentV3/buildAuthorship';
import { assessReadiness, MIN_READY_SCORE, type ExtraFinding } from '../src/server/AgentV3/Readiness';
import type { ArchitectureReport } from '../src/server/AgentV3/ArchitectureAnalysis';

/**
 * 🔴 THE EXACT REPORT (build e4ebcb5f, 2026-09-17).
 *
 * Prompt: "Fix this error and continue building the app: network error", against a 516-file GitHub
 * project. The turn read six files, ran a clean `tsc --noEmit`, started the dev server, published a
 * preview and screenshotted it — and wrote NOTHING ("♻️ Incremental: 518/518 file(s) unchanged
 * (0 changed, 0 new)"). `PROD_BUILD_OK`, `RENDER_RESCUE` ("the live preview renders cleanly —
 * real-browser verified"), `GREEN_GUARD_SAVE`.
 *
 * Then: `READINESS_BLOCKER: 3 fake/incomplete code issue(s)` → `RELEASE_GATE: RED — 1
 * build-breaking blocker(s)` → `OUTCOME_RELEASE_GATE_RED` flipped the verdict back to NOT ok,
 * undoing the render rescue 27 seconds later → "working app or free" → ₹0.
 *
 * Every one of those three placeholders was in the user's own pre-existing repository.
 */
const arch = (): ArchitectureReport => ({
  unresolvedImports: [],
  nodeBuiltinsInFrontend: [],
  cycles: [],
  layeringViolations: [],
  orphanComponents: [],
} as unknown as ArchitectureReport);

const fake = (file: string) => ({ file, line: 1, kind: 'placeholder', severity: 'high' as const, snippet: 'TODO' });

describe('a readiness blocker must be about code THIS BUILD wrote', () => {
  it('🔴 the zero-write edit: three placeholders in untouched files no longer block', () => {
    const issues = [fake('src/components/ChatWindow.tsx'), fake('src/services/ai.ts'), fake('src/App.tsx')];
    const authored = authoredPathSet([]); // the real report: 0 changed, 0 new

    const split = splitByAuthorship(issues, authored);
    expect(split.ours).toHaveLength(0);
    expect(split.preExisting).toHaveLength(3);

    // …and the gate that reads it stays READY, so the verdict is never flipped and the build is billed.
    const extra: ExtraFinding[] = [
      { severity: 'observation', label: preExistingCodeObservation('3 fake/incomplete code issue(s) in 3 file(s) this build did not touch') },
    ];
    const verdict = assessReadiness(arch(), [], extra);
    expect(verdict.ready).toBe(true);
    expect(verdict.blockers).toEqual([]);
    expect(verdict.score).toBe(100); // an observation costs NOTHING — see the ExtraFinding doc comment
    // Nothing is hidden: it is still reported, worded as the observation it is.
    expect(verdict.warnings.join(' ')).toContain('observation about your existing code');
  });

  it('a FRESH build is unchanged — every file is ours, so every placeholder still blocks', () => {
    const issues = [fake('src/App.tsx'), fake('src/components/Todo.tsx')];
    const authored = authoredPathSet(['src/App.tsx', 'src/components/Todo.tsx', 'src/main.tsx']);

    const split = splitByAuthorship(issues, authored);
    expect(split.ours).toHaveLength(2);
    expect(split.preExisting).toHaveLength(0);

    const verdict = assessReadiness(arch(), [], [{ severity: 'high', label: '2 fake/incomplete code issue(s)' }]);
    expect(verdict.ready).toBe(false);
    expect(verdict.blockers[0]).toContain('fake/incomplete');
  });

  it('a MIXED edit blocks on the file we wrote and not on the one we did not', () => {
    const issues = [fake('src/NewFeature.tsx'), fake('src/legacy/Old.tsx')];
    const split = splitByAuthorship(issues, authoredPathSet(['src/NewFeature.tsx']));
    expect(split.ours.map((i) => i.file)).toEqual(['src/NewFeature.tsx']);
    expect(split.preExisting.map((i) => i.file)).toEqual(['src/legacy/Old.tsx']);
  });

  it('🔒 an UNSET authored set means today-before-this-change: everything is ours', () => {
    // The safe direction. A caller that never said what it wrote must not silently disarm the gate.
    const issues = [fake('src/a.tsx'), fake('src/b.tsx')];
    const split = splitByAuthorship(issues, undefined);
    expect(split.ours).toHaveLength(2);
    expect(split.preExisting).toHaveLength(0);
  });

  it('🔒 …and an EMPTY set is a DIFFERENT statement from an unset one', () => {
    // "I tracked the writes and there were none" — the zombie-turn case — must not read as "unknown".
    expect(splitByAuthorship([fake('src/a.tsx')], new Set()).preExisting).toHaveLength(1);
  });

  it('a finding with no file at all stays ours (it cannot be attributed away)', () => {
    const split = splitByAuthorship([{ file: '' }, { file: undefined }], authoredPathSet(['src/a.tsx']));
    expect(split.ours).toHaveLength(2);
    expect(split.preExisting).toHaveLength(0);
  });

  it('matches the same file however either side spells it', () => {
    expect(normalizeAuthoredPath('./src/App.tsx')).toBe('src/App.tsx');
    expect(normalizeAuthoredPath('/src/App.tsx')).toBe('src/App.tsx');
    expect(normalizeAuthoredPath('src\\components\\A.tsx')).toBe('src/components/A.tsx');
    expect(normalizeAuthoredPath('src//a.tsx')).toBe('src/a.tsx');
    expect(splitByAuthorship([fake('src/App.tsx')], authoredPathSet(['./src/App.tsx'])).ours).toHaveLength(1);
  });

  it('does NOT fold case — a different file must never clear a real finding', () => {
    // The sandbox is Linux. `src/app.tsx` and `src/App.tsx` are two files, and treating them as one
    // would silently excuse a placeholder in code we really did write.
    expect(splitByAuthorship([fake('src/App.tsx')], authoredPathSet(['src/app.tsx'])).preExisting).toHaveLength(1);
  });

  it('never throws on junk', () => {
    expect(() => splitByAuthorship(null, undefined)).not.toThrow();
    expect(() => authoredPathSet(null)).not.toThrow();
    expect(normalizeAuthoredPath(undefined)).toBe('');
  });
});

/**
 * ⚠️ THE SECOND DOOR INTO THE SAME FAILURE. Every penalty in `assessReadiness` comes off ONE
 * 100-point budget, and a score below `MIN_READY_SCORE` becomes a blocker by itself. So if a
 * pre-existing-code note were priced at even `low` (2 points), a large imported repo with enough
 * history would be condemned for that history anyway — the blocker simply renaming itself
 * "readiness score N/100 is below the bar".
 */
describe('an observation is priced at zero, and is never blamed for a low score', () => {
  it('fifty observations still cost nothing', () => {
    const extra: ExtraFinding[] = Array.from({ length: 50 }, (_, i) => ({
      severity: 'observation' as const,
      label: preExistingCodeObservation(`finding ${i}`),
    }));
    const verdict = assessReadiness(arch(), [], extra);
    expect(verdict.score).toBe(100);
    expect(verdict.ready).toBe(true);
  });

  it('the score-floor blocker cites only what actually cost score', () => {
    const extra: ExtraFinding[] = [
      { severity: 'observation', label: preExistingCodeObservation('old placeholders in your repo') },
      ...Array.from({ length: 8 }, (_, i) => ({ severity: 'medium' as const, label: `real quality defect ${i}` })),
    ];
    const verdict = assessReadiness(arch(), [], extra);
    expect(verdict.score).toBeLessThan(MIN_READY_SCORE);
    expect(verdict.blockers).toHaveLength(1);
    // The blocker explains itself with a priced finding, never with the free one.
    expect(verdict.blockers[0]).toContain('real quality defect');
    expect(verdict.blockers[0]).not.toContain('observation about your existing code');
  });
});

/**
 * 🔒 REVERSION GUARD. The behavioural tests above run against the pure helpers; these assert the
 * WIRING, which is the half that silently rots. Both were verified to fail when the corresponding
 * line is deleted.
 */
describe('the wiring — proven by reversion', () => {
  const ROUTE = readFileSync(fileURLToPath(new URL('../src/server/routes/agentv3.ts', import.meta.url)), 'utf8');
  const DISPATCH = readFileSync(fileURLToPath(new URL('../src/server/AgentV3/ToolDispatcher.ts', import.meta.url)), 'utf8');

  it('the route arms the dispatcher from its OWN writtenFiles, as a thunk', () => {
    // A VALUE here would capture an empty map (the gate asks at the end of the build), and a
    // dispatcher-local tally would miss every sub-agent write — the hole fixed in PR #2988.
    expect(ROUTE).toContain('dispatcher.setAuthoredFiles(() => writtenFiles.keys());');
  });

  it('the readiness gate splits authenticity findings by authorship before counting blockers', () => {
    expect(DISPATCH).toContain('const authorship = splitByAuthorship(issues, authoredSet);');
    expect(DISPATCH).toContain("const authHigh = authorship.ours.filter((i) => i.severity === 'high').length;");
    // …and the ones we did not write are still REPORTED, never dropped.
    expect(DISPATCH).toContain('preExistingCodeObservation(');
  });
});
