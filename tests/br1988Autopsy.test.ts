/**
 * BR1988: a user-stopped build that never finished writing its stylesheet was still
 * reported as CSS_CLASSES_UNDEFINED — a leftover warning of the app, opened in the
 * issue queue. The mismatch is real only for a finished app (Universal Remote).
 *
 * Fixtures are independently written and synthetic. They do not copy a customer's
 * request, class names, file list, identifiers, or event timestamps.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BuildDiagnostics } from '../src/server/AgentV3/BuildDiagnostics';
import {
  cssClassesUndefinedIsAppFinding,
  cssClassesUndefinedRecord,
  cssConsistencyError,
  findUndefinedClasses,
} from '../src/server/AgentV3/CssConsistency';
import { foldBuildFindings, queueableFindings, EMPTY_QUEUE } from '../src/server/AgentV3/changeEngine/issueQueue';

/** Scaffold CSS exists, but it does not define the screen classes — the integrity pass reads the whole project. */
const scaffoldCss = ':root { font-family: sans-serif; } body { margin: 0; }';

/** A mid-generation tree: screens exist, the stylesheet has only the scaffold rules. */
const unfinishedScreens: Record<string, string> = {
  'src/index.css': scaffoldCss,
  'src/components/OrderForm.tsx': `
    export function OrderForm() {
      return (
        <form className="order-form">
          <section className="form-block">
            <div className="rows-wrap">
              <header className="rows-heading">Lines</header>
              <ul className="rows-list" />
            </div>
          </section>
          <aside className="order-sums">
            <div className="sums-line"><span className="sum-figure">0</span></div>
          </aside>
        </form>
      );
    }
  `,
};

const styledScreens: Record<string, string> = {
  ...unfinishedScreens,
  'src/index.css': `
    .order-form { display: block; }
    .form-block { margin: 0; }
    .rows-wrap { display: flex; }
    .rows-heading { font-weight: 600; }
    .rows-list { list-style: none; }
    .order-sums { text-align: right; }
    .sums-line { display: flex; justify-content: space-between; }
    .sum-figure { font-weight: 700; }
  `,
};

describe('BR1988 · missing styles on a stopped, unfinished build are not an app defect', () => {
  it('the unfinished tree is a real mismatch, the same threshold as a finished app', () => {
    expect(findUndefinedClasses(unfinishedScreens).length).toBeGreaterThanOrEqual(3);
    expect(cssConsistencyError(unfinishedScreens)).toMatch(/NOT defined in any CSS file/);
    expect(cssConsistencyError(styledScreens)).toBeNull();
  });

  it('a user Stop before the app was judged finished is recorded as info, not a leftover warning', () => {
    const rec = cssClassesUndefinedRecord(unfinishedScreens, { aborted: true, appJudgedFinished: false });
    expect(rec).not.toBeNull();
    expect(rec!.severity).toBe('info');
    expect(rec!.autoResolved).toBe(true);
    expect(rec!.message).toMatch(/stopped before the app was judged finished/i);
    expect(rec!.message).not.toMatch(/screens render unstyled/);
    expect(cssClassesUndefinedIsAppFinding({ aborted: true, appJudgedFinished: false })).toBe(false);
  });

  it('that info line is not left open and does not enter the issue queue', () => {
    const rec = cssClassesUndefinedRecord(unfinishedScreens, { aborted: true, appJudgedFinished: false })!;
    const d = new BuildDiagnostics({ now: () => 1_000 });
    d.record({ phase: 'build', severity: rec.severity, code: 'CSS_CLASSES_UNDEFINED', message: rec.message, autoResolved: rec.autoResolved });
    const report = d.report();
    expect(report.counts.unresolved).toBe(0);
    expect(report.counts.leftOpen).toBe(0);
    const queued = queueableFindings(report.issues);
    expect(queued.filter((f) => f.code === 'CSS_CLASSES_UNDEFINED')).toEqual([]);
    const folded = foldBuildFindings(EMPTY_QUEUE, { findings: queued, changeId: 'chg-stop', now: 2_000, checksRan: false });
    expect(folded.opened).toEqual([]);
  });

  it('a finished app with the same missing styles is still a user-facing warning and is queued', () => {
    const rec = cssClassesUndefinedRecord(unfinishedScreens, { aborted: false, appJudgedFinished: true });
    expect(rec).toEqual({
      severity: 'warning',
      autoResolved: false,
      message: expect.stringMatching(/screens render unstyled/),
    });
    expect(cssClassesUndefinedIsAppFinding({ aborted: false, appJudgedFinished: true })).toBe(true);
    const d = new BuildDiagnostics({ now: () => 1_000 });
    d.record({ phase: 'build', severity: rec!.severity, code: 'CSS_CLASSES_UNDEFINED', ...{ message: rec!.message, autoResolved: rec!.autoResolved } });
    const report = d.report();
    expect(report.counts.unresolved).toBeGreaterThanOrEqual(1);
    const queued = queueableFindings(report.issues);
    expect(queued).toEqual([expect.objectContaining({ code: 'CSS_CLASSES_UNDEFINED', severity: 'warning' })]);
    const folded = foldBuildFindings(EMPTY_QUEUE, { findings: queued, changeId: 'chg-done', now: 2_000, checksRan: true });
    expect(folded.opened).toHaveLength(1);
    expect(folded.opened[0]!.code).toBe('CSS_CLASSES_UNDEFINED');
  });

  it('Stop after the app was judged finished still flags the mismatch (Universal Remote neighbour)', () => {
    const rec = cssClassesUndefinedRecord(unfinishedScreens, { aborted: true, appJudgedFinished: true });
    expect(rec?.severity).toBe('warning');
    expect(rec?.autoResolved).toBe(false);
    expect(cssClassesUndefinedIsAppFinding({ aborted: true, appJudgedFinished: true })).toBe(true);
  });

  it('an unfinished Stop on a styled tree is silent, as is a two-class miss (threshold neighbour)', () => {
    expect(cssClassesUndefinedRecord(styledScreens, { aborted: true, appJudgedFinished: false })).toBeNull();
    const two = {
      'src/A.tsx': '<div className="only-one plus-two" />',
    };
    expect(findUndefinedClasses(two).length).toBeLessThan(3);
    expect(cssClassesUndefinedRecord(two, { aborted: false, appJudgedFinished: true })).toBeNull();
    expect(cssClassesUndefinedRecord(two, { aborted: true, appJudgedFinished: false })).toBeNull();
  });

  it('a failed build that was not stopped still flags the mismatch (main neighbour)', () => {
    const rec = cssClassesUndefinedRecord(unfinishedScreens, { aborted: false, appJudgedFinished: false });
    expect(rec?.severity).toBe('warning');
    expect(rec?.autoResolved).toBe(false);
  });
});

describe('BR1988 · the integrity pass uses the stopped-unfinished guard', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
  const css = readFileSync('src/server/AgentV3/CssConsistency.ts', 'utf8');

  it('the route records CSS_CLASSES_UNDEFINED through cssClassesUndefinedRecord, with abort and readyAt', () => {
    expect(route).toMatch(/cssClassesUndefinedRecord\(projectForCss,\s*\{\s*aborted:\s*abort\.signal\.aborted === true,\s*appJudgedFinished:\s*result\.readyAt != null/);
    expect(route).toMatch(/code: 'CSS_CLASSES_UNDEFINED'/);
    expect(route).toMatch(/cssFinding\.autoResolved \? \{ message: cssFinding\.message, autoResolved: true \} : obs\(cssFinding\.message\)/);
  });

  it('the heal gate is unchanged: only a successful, not-aborted build may repair', () => {
    expect(route).toMatch(/const cssRepair = !!cssErr && cssHealEnabled\(\) && result\.ok && expectsArtifacts && !abort\.signal\.aborted/);
  });

  it('reversion: dropping the abort+unfinished guard makes a stopped unfinished tree a warning again', () => {
    expect(css).toContain('opts.aborted === true && opts.appJudgedFinished !== true');
    const broken = (opts: { aborted: boolean; appJudgedFinished: boolean }) => true; // old behaviour: always an app finding
    expect(broken({ aborted: true, appJudgedFinished: false })).toBe(true);
    expect(cssClassesUndefinedIsAppFinding({ aborted: true, appJudgedFinished: false })).toBe(false);
  });
});
