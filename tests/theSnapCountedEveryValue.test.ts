/**
 * Q-515 (autopsy 39e982bd, 2026-10-04). The report read `SPACING_SNAPPED` "6 spacing value(s) … were
 * snapped" beside `DESIGN_CONSISTENCY` "27 spacing values are off the 4px grid" in the same file, and the
 * autopsy concluded the snapper had left 21 behind. Reproduced: the snap had moved all 27. "6" was the
 * number of DISTINCT `from → to` pairs — `changes` is de-duplicated for display, and the note summed it.
 *
 * 🔁 THIS HAD COME BACK. Autopsy e3b0ce25 saw "4 off the grid" beside "2 snapped" and fixed the staleness
 * of the DESIGN line (it now re-judges after the snap) — but the "2" was this same undercount, and nobody
 * reproduced it. The class: a report count taken from a de-duplicated display list.
 *
 * And the second half: WRITE_TIME_QUALITY is measured before the snap, so its "noted and not fixed" stayed
 * the last word on a file the snap had cleaned. It now gets a line that says what is true of the app.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spacingSnapPatches, spacingSnapNote, snapSpacingInSource } from '../src/server/AgentV3/spacingSnap';
import { lintBuiltApp } from '../src/server/AgentV3/buildQualityLint';

// 27 off-grid values made of 6 distinct values — the shape of the report's src/theme.css.
const VALUES = [6, 10, 14, 6, 10, 14, 6, 10, 14, 18, 22, 26, 6, 10, 14, 18, 22, 26, 6, 10, 14, 18, 22, 26, 6, 10, 14];
const CSS = VALUES.map((v, i) => `.c${i} { padding: ${v}px; }`).join('\n') + '\n.ok { margin: 8px 16px; }\n';

describe('the snap note counts every value it moved', () => {
  it('27 off the grid before, 0 after, and the note says 27', () => {
    const files = { 'src/theme.css': CSS };
    expect(lintBuiltApp(files)!.design.violations[0]!.message).toMatch(/^27 spacing values are off/);
    const patches = spacingSnapPatches(files, ['src/theme.css']);
    expect(patches).toHaveLength(1);
    expect(patches[0]!.snapped).toBe(27);
    expect(patches[0]!.changes).toHaveLength(6);
    expect(lintBuiltApp({ 'src/theme.css': patches[0]!.content })!.design.violations).toEqual([]);
    const note = spacingSnapNote(patches);
    expect(note).toMatch(/^27 spacing value\(s\) in 1 file\(s\)/);
    expect(note).toContain('6 distinct move(s)');
  });

  it('a value written twice is counted twice', () => {
    expect(snapSpacingInSource('.a { padding: 6px 6px; }')?.snapped).toBe(2);
  });
});

// Re-anchored (autopsy 9c612cdb, 2026-10-12). The restatement line ("After the spacing snap: X is no
// longer flagged") existed because WRITE_TIME_QUALITY was measured BEFORE the snap. The snap now runs
// before the lint, so the one WRITE_TIME_QUALITY line is measured on the snapped app and needs no
// correction — the contract (the line says what is true of the app as shipped) holds by order.
describe('the write-time line is measured after the snap', () => {
  it('🔒 the snap runs before the WRITE_TIME_QUALITY measurement', () => {
    const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    const snap = route.indexOf("await snapSpacing({ ...integrityFiles, ...Object.fromEntries(writtenFiles) }, 'before-lint');");
    const wtq = route.indexOf("code: 'WRITE_TIME_QUALITY', message: wq");
    expect(snap).toBeGreaterThan(-1);
    expect(wtq).toBeGreaterThan(snap);
    expect(route).not.toContain('After the spacing snap: ${nowClear.join');
  });
});
