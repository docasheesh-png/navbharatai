/**
 * THE APK REPORTS INBOX CAN BE TAKEN OFF THE SCREEN (admin 2026-09-15: "apk build report download ka
 * option hi nahi banaya aapne?").
 *
 * WHAT WAS ACTUALLY MISSING, and why it is a class rather than one button. The admin panel has THREE
 * report inboxes. Build Reports and User Reports have had Download and Copy since they shipped — both
 * funnel through the one `saveJsonFile` helper. APK Reports, added later as a third page, had neither:
 * it could be read and nothing else, with the failing step's log in a `max-h-64` scrolling box. So the
 * only way to hand a cause to anyone was to retype it, and the admin's own capture of the page came
 * back with the log excerpt cut off — which is exactly what prompted this.
 *
 * These assertions are the guard: a report screen that cannot export what it shows is half a screen.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { apkReportFilename, apkReportsArchiveFilename } from '../src/lib/apkReportFile';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
/**
 * Comments explain the old behaviour on purpose; matching prose would pass on the explanation.
 *
 * ⚠️ A BLOCK COMMENT IS ONLY STRIPPED WHEN IT OPENS ITS OWN LINE, and that is not fussiness: this
 * file contains `accept="image/*"`, whose `/*` opened a comment the naive version then closed 140
 * lines later — silently deleting the JSX these assertions are about, so two of them failed against
 * code that was already correct. JSX comments go first, for the same reason.
 */
const codeOnly = (s: string) => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, '')
  .replace(/^\s*\/\/.*$/gm, '');

const dash = codeOnly(read('../src/components/AdminDashboard.tsx'));

describe('the filename survives whatever a user called their repository', () => {
  it('names the owner, the repo and the run so two downloads never collide', () => {
    expect(apkReportFilename({ owner: 'jilikabegum454-aj', repo: 'app-30-files-2026-09-15', runId: '17742' }))
      .toBe('apk-build-report-jilikabegum454-aj-app-30-files-2026-09-15-17742.json');
  });

  it('strips anything a browser would refuse — a slash must never become a path', () => {
    const name = apkReportFilename({ owner: 'a/b', repo: 'x y"z', runId: '1' });
    expect(name).toBe('apk-build-report-a-b-x-y-z-1.json');
    expect(name).not.toContain('/');
  });

  it('falls back to the report id, then to a bare name — a download is never blocked', () => {
    expect(apkReportFilename({ owner: '///', repo: '...', id: 'abc_1' })).toBe('apk-build-report-abc_1.json');
    expect(apkReportFilename(null)).toBe('apk-build-report.json');
    expect(apkReportFilename({})).toBe('apk-build-report.json');
  });

  it('never ends on a dot or a dash, and bounds each part', () => {
    const name = apkReportFilename({ owner: 'x'.repeat(200), repo: 'repo.', runId: '-7-' });
    expect(name.startsWith('apk-build-report-')).toBe(true);
    expect(name.endsWith('.json')).toBe(true);
    expect(name).toContain('-repo-7.json');
    expect(name.length).toBeLessThan(120);
  });

  it('dates the whole-inbox export, and an unusable date does not throw', () => {
    expect(apkReportsArchiveFilename(new Date(2026, 8, 15))).toBe('apk-build-reports-2026-09-15.json');
    expect(apkReportsArchiveFilename(new Date('nonsense'))).toMatch(/^apk-build-reports-\d{4}-\d{2}-\d{2}\.json$/);
  });
});

describe('the APK Reports page really exports what it shows', () => {
  it('has a per-report Download and Copy in the open report', () => {
    expect(dash).toContain('const downloadApkReport =');
    expect(dash).toContain('const copyApkReport =');
    expect(dash).toContain('onClick={() => downloadApkReport(openApkReport)}');
    expect(dash).toContain('onClick={() => copyApkReport(openApkReport)}');
  });

  it('has a whole-inbox Download all beside Clear all', () => {
    expect(dash).toContain('const downloadAllApkReports =');
    expect(dash).toContain('onClick={downloadAllApkReports}');
    expect(dash).toContain('Download all');
  });

  /**
   * ONE saver, every button. A second hand-rolled Blob/anchor would be the place a download quietly
   * stops revoking its object URL, or stops reporting its own failure — the same reasoning that put
   * every ledger write behind one appender.
   */
  it('funnels through the shared saveJsonFile / copyJson helpers, not a second implementation', () => {
    const window = dash.slice(dash.indexOf('const downloadApkReport ='), dash.indexOf('const downloadAllApkReports =') + 600);
    expect(window).toContain('saveJsonFile(JSON.stringify(rec, null, 2)');
    expect(window).toContain('copyJson(JSON.stringify(rec, null, 2)');
    expect(window).toContain('saveJsonFile(JSON.stringify(apkReports, null, 2)');
    expect(window).not.toContain('new Blob');
    expect(window).not.toContain('createObjectURL');
  });

  /** An empty inbox, or a report still loading/errored, says so instead of writing an empty file. */
  it('refuses honestly rather than downloading nothing', () => {
    expect(dash).toContain("toast('Nothing to download — the inbox is empty.')");
    expect(dash).toContain('rec.loading || rec.error');
  });

  /**
   * The excerpt is the LAST 120 lines of the failed step (reportLogExcerpt), which is why the admin's
   * screen capture looked cut off. The heading now says how many lines are there and where the rest
   * is, so "truncated" is a fact on the page rather than something to guess at.
   */
  it('says how long the log excerpt is and where the full log lives', () => {
    expect(dash).toContain('{openApkReport.failure.logExcerpt.length} lines');
    expect(dash).toContain('the complete log is on GitHub');
    expect(dash).toContain('Open the full run on GitHub');
  });

  /**
   * AND WHO OWNS THAT RUN. mobileShip takes `owner`/`repo` from the USER's connected GitHub account,
   * so the build ran in THEIR repository, not ours — an admin following that link hits a 404 whenever
   * it is private. Presenting it as "the full log" without saying so sends the one person who has to
   * fix the failure to a dead end; the download is what actually reaches them.
   */
  it('does not present the user\'s own repository as somewhere the admin can certainly look', () => {
    expect(dash).toContain("That run lives in the user's own GitHub account");
    expect(dash).toContain('Everything below is stored here');
  });
});
