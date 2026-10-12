/**
 * AUTOPSY e3b0ce25 (2026-10-04): "4 spacing values are off the 4px grid … 4 spacing values are off the
 * 4px grid", beside "2 spacing value(s) … were snapped". Two defects in one line: the message was printed
 * twice, and it described the app BEFORE the deterministic snap that ran a second later, so nobody could
 * tell what was left. Each finding is now printed once, and the line is re-judged after the snap.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { designLintSummary } from '../src/server/AgentV3/buildQualityLint';

describe('each design finding is printed once', () => {
  it('a spacing finding appears once in the line', () => {
    const line = designLintSummary({
      fileCount: 9,
      truncated: false,
      design: { score: 98, grade: 'A', violations: [{ type: 'spacing', message: '4 spacing values are off the 4px grid — snap to multiples of 4px for rhythm.' }] },
      a11y: { score: 100, grade: 'A', violations: [] },
      offenders: {},
    } as never);
    expect(line.match(/4 spacing values are off/g)?.length).toBe(1);
    expect(line).toMatch(/^Design consistency 98\/100 \(A\) across 9 file\(s\)\./);
  });
});

// Re-anchored (autopsy 9c612cdb, 2026-10-12). e3b0ce25 fixed the stale line with a re-check AFTER the snap,
// and that re-check wrote a line only when values remained — so a clean result (the 100/100 the app
// shipped with) was computed and never recorded, and the stale pre-snap warning was what the report kept.
// The contract is unchanged — the design line describes the app as it ships — and is now met by ORDER:
// the snap runs before the lint, and the lint records its verdict either way.
describe('the design line describes the app after the snap', () => {
  const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');

  it('the snap runs before the lint that records DESIGN_CONSISTENCY', () => {
    const snap = route.indexOf("await snapSpacing({ ...integrityFiles, ...Object.fromEntries(writtenFiles) }, 'before-lint');");
    const lint = route.indexOf('const quality = hasUserApp ? lintBuiltApp(integrityFiles) : null;');
    expect(snap).toBeGreaterThan(-1);
    expect(lint).toBeGreaterThan(snap);
    // Whatever the call looks like: the FIRST snap in the route precedes the FIRST whole-app design lint.
    const firstSnap = route.indexOf('await snapSpacing(');
    const firstLint = route.indexOf('lintBuiltApp(integrityFiles)');
    expect(firstSnap).toBeGreaterThan(-1);
    expect(firstSnap).toBeLessThan(firstLint);
  });

  it('a clean verdict is recorded too, so the shipped score is never missing', () => {
    expect(route).toContain("buildDiag.record({ phase: 'build', severity: 'info', code: 'DESIGN_CONSISTENCY', message: designLintSummary(quality), autoResolved: true });");
  });

  it('the design repair is followed by a snap and a restatement of what is true now', () => {
    const repair = route.indexOf("await restoreKitRules({ ...integrityFiles, ...Object.fromEntries(writtenFiles) }, 'after-repair');");
    const snapAfter = route.indexOf("await snapSpacing({ ...integrityFiles, ...Object.fromEntries(writtenFiles) }, 'after-repair');");
    expect(repair).toBeGreaterThan(-1);
    expect(snapAfter).toBeGreaterThan(repair);
    expect(route.slice(snapAfter, snapAfter + 1500)).toContain('After the design repair: ${designLintSummary(afterRepair)}');
  });
});
