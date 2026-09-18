/**
 * AUTOPSY e706e068 (School ERP) — the residue nobody claimed: a finding nobody could act on.
 *
 * That build's report carried, as permanent unresolved warnings:
 *   ACCESSIBILITY      "45/100 (D) … 14 form field(s) with no label … 7 button/link with no accessible name"
 *   DESIGN_CONSISTENCY "50/100 (D) … 58 distinct colours … 14 spacing values off the 4px grid"
 * across a 31-file app — naming **no file and no line**. Neither the user nor any repair pass could
 * act on one of them.
 *
 * 🔑 THE SAME REPORT PROVES IT WAS NOT INEVITABLE: `DESIGN_PAGE_INCONSISTENT` named its files
 * ("worst: src/pages/Attendance.tsx"). Two quality linters in one document, one actionable and one
 * not — because `lintBuiltApp` JOINS every file into one string before linting, so by the time a
 * violation exists the file it came from has been thrown away.
 */
import { describe, it, expect } from 'vitest';
import {
  lintBuiltApp, a11yLintSummary, designLintSummary, offenderNote, OFFENDERS_PER_TYPE,
} from '../src/server/AgentV3/buildQualityLint';

/** An ERP-shaped app with the report's own two a11y defects spread unevenly across pages. */
const ERP: Record<string, string> = {
  'src/pages/Students.tsx': `export default function S(){return(<form>
    <input type="text" placeholder="Student name"/><input type="text" placeholder="Roll"/>
    <input type="date"/><input type="text"/><button><Trash2/></button></form>)}`,
  'src/pages/Teachers.tsx': `export default function T(){return(<form>
    <input type="text" placeholder="Teacher"/><input type="text"/><button><Pencil/></button></form>)}`,
  'src/pages/Fees.tsx': `export default function F(){return(<div><input type="number"/><img src="/r.png"/></div>)}`,
  'src/App.tsx': `export default function A(){return <div><h1>School ERP</h1></div>}`,
};

describe('an accessibility finding names the files it is about', () => {
  const r = lintBuiltApp(ERP)!;

  it('THE REPORTED SENTENCE now carries the files, worst first', () => {
    const s = a11yLintSummary(r);
    expect(s).toMatch(/WCAG 1\.3\.1: 7 form field\(s\) with no label/);
    expect(s).toContain('Worst: src/pages/Students.tsx (4), src/pages/Teachers.tsx (2), src/pages/Fees.tsx (1).');
    // The other two rules are attributed too, each to its own file.
    expect(s).toMatch(/WCAG 4\.1\.2:[^W]*Worst: src\/pages\/Students\.tsx \(1\), src\/pages\/Teachers\.tsx \(1\)\./);
    expect(s).toMatch(/WCAG 1\.1\.1:[^W]*Worst: src\/pages\/Fees\.tsx \(1\)\./);
    // A clean file is never named.
    expect(r.offenders['input-label'].map((o) => o.path)).not.toContain('src/App.tsx');
  });

  it('for a COUNTING rule the per-file numbers add up to the headline total', () => {
    const total = r.a11y.violations.find((v) => v.type === 'input-label')!.count;
    expect(r.offenders['input-label'].reduce((n, o) => n + o.count, 0)).toBe(total);
    expect(total).toBe(7);
  });

  it('🔒 THE SCORE IS UNCHANGED — attribution only locates, it never re-judges', () => {
    // Same selection, same joined text: the headline number is what it always was.
    expect(r.fileCount).toBe(4);
    expect(r.a11y.score).toBe(48);
    expect(r.a11y.grade).toBe('D');
    // And an app with nothing to report gains no noise.
    const clean = lintBuiltApp({ 'src/App.tsx': '<div><h1>hi</h1></div>' })!;
    expect(a11yLintSummary(clean)).not.toMatch(/Worst:/);
  });

  it('is bounded — a defect in fifty files names three, not fifty', () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 50; i++) many[`src/pages/P${i}.tsx`] = `<form><input type="text"/></form>`;
    const big = lintBuiltApp(many)!;
    expect(big.offenders['input-label'].length).toBe(OFFENDERS_PER_TYPE);
    expect(OFFENDERS_PER_TYPE).toBe(3);
  });
});

describe('a DISTINCTNESS rule is attributed honestly — "worst", never a share of the total', () => {
  it('names the file with the most one-off colours without claiming the counts sum', () => {
    const app = {
      // 14 distinct one-off colours here, 2 there: distinct-across-the-app is not a sum of the two.
      'src/pages/Loud.tsx': `<div style={{color:'${['#a11111', '#b22222', '#c33333', '#d44444', '#e55555', '#f66666', '#177777', '#288888', '#399999', '#4aaaaa', '#5bbbbb', '#6ccccc', '#7ddddd', '#8eeeee'].join("'}}/><div style={{color:'")}'}}/>`,
      'src/pages/Quiet.tsx': `<div style={{color:'#a11111'}}/><div style={{color:'#999000'}}/>`,
    };
    const r = lintBuiltApp(app)!;
    const colour = r.design.violations.find((v) => v.type === 'color-count');
    expect(colour, 'the app must actually trip the colour rule for this case to mean anything').toBeTruthy();
    const note = offenderNote(r, 'color-count');
    expect(note).toContain('src/pages/Loud.tsx');
    // The app-wide DISTINCT total is not the sum of the per-file distinct counts — and nothing in the
    // sentence says it is. "Worst" is true of every rule; a share of the total would not be.
    const summed = r.offenders['color-count'].reduce((n, o) => n + o.count, 0);
    expect(summed).not.toBe(colour!.count);
    expect(designLintSummary(r)).toContain(note.trim());
  });
});

describe('it can never be the reason a finished build is reported as broken', () => {
  it('nothing lintable still returns null, exactly as before', () => {
    expect(lintBuiltApp({ 'README.md': 'hi', 'data.json': '{}' })).toBeNull();
    expect(lintBuiltApp({})).toBeNull();
  });

  it('a result with no offenders map degrades to the old sentence instead of throwing', () => {
    const r = lintBuiltApp(ERP)!;
    const stripped = { ...r, offenders: undefined } as unknown as typeof r;
    expect(() => a11yLintSummary(stripped)).not.toThrow();
    expect(offenderNote(stripped, 'input-label')).toBe('');
    expect(a11yLintSummary(stripped)).not.toMatch(/Worst:/);
  });
});
