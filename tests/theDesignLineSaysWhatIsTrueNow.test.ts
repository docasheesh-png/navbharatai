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

describe('the finding is re-judged after the snap', () => {
  it('the snap re-runs the same lint and replaces the stale line', () => {
    const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    const at = route.indexOf("code: 'SPACING_SNAPPED', message: spacingSnapNote(landed)");
    expect(at).toBeGreaterThan(-1);
    const after = route.slice(at, at + 1500);
    expect(after).toContain('lintBuiltApp(integrityFiles)');
    expect(after).toContain("resolveOnRecheck('DESIGN_CONSISTENCY')");
  });
});
