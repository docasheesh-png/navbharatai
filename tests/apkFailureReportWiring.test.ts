import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * REGRESSION LOCK for the 2026-09-14 feature (admin, verbatim: "jab bhi koi user, navbharatai par 'APK'
 * banwaye. aur apk bane nahi, fail ho jaye. to puri, failed apk ki detailed build report … admin panel
 * me automatically send ho jaye" + "admin panel me 'apk report' ka alag page bana do, header me").
 *
 * TWO things this locks:
 *   1. The server automatically writes a detailed admin report the FIRST time it observes a store
 *      build (a user's own GitHub Actions Android/iOS build) fail — no user action, no "Report" button.
 *   2. A SEPARATE admin nav page/tab exists for it (not folded into the existing AgentV3 "Build Reports"
 *      inbox, which is a different pipeline with a different failure shape).
 *
 * String-content assertions, not fixed-offset slices — a large single-file component like
 * AdminDashboard.tsx reflows on every unrelated edit.
 */
const read = (rel: string): string => readFileSync(join(__dirname, '..', rel), 'utf8');
const mobileShip = read('src/server/routes/mobileShip.ts');
const adminRoutes = read('src/server/routes/admin.ts');
const dashboard = read('src/components/AdminDashboard.tsx');

describe('mobileShip.ts: a failed store build reports itself to the admin automatically', () => {
  it('the /runs poll fires the report ONLY on a failure conclusion, gated on a verified identity', () => {
    const at = mobileShip.indexOf("app.get('/api/mobile-ship/runs'");
    expect(at, 'the /runs route is gone').toBeGreaterThan(-1);
    const callAt = mobileShip.indexOf('recordApkFailureReport(', at);
    expect(callAt, 'the automatic report call is gone from /runs').toBeGreaterThan(at);
    const block = mobileShip.slice(at, callAt);
    expect(block).toContain("concl === 'failure'");
    expect(block).toContain('identity?.uid');
  });

  it('reuses the SAME report builder the user\'s own downloadable report uses — never a second story', () => {
    const reportRouteAt = mobileShip.indexOf("app.get('/api/mobile-ship/report'");
    const reporterFnAt = mobileShip.indexOf('async function recordApkFailureReport');
    expect(reportRouteAt).toBeGreaterThan(-1);
    expect(reporterFnAt).toBeGreaterThan(-1);
    // Both regions must call buildMobileBuildReport — the ONE classifier + composer.
    const reportRouteBlock = mobileShip.slice(reportRouteAt, mobileShip.indexOf('app.get', reportRouteAt + 10));
    const reporterFnBlock = mobileShip.slice(reporterFnAt, mobileShip.indexOf('async function failedJobLog', reporterFnAt));
    expect(reportRouteBlock).toContain('buildMobileBuildReport(');
    expect(reporterFnBlock).toContain('buildMobileBuildReport(');
  });

  it('is best-effort — a failure recording the report must never break the response the user is waiting on', () => {
    const fnAt = mobileShip.indexOf('async function recordApkFailureReport');
    const fnBlock = mobileShip.slice(fnAt, mobileShip.indexOf('async function failedJobLog', fnAt));
    expect(fnBlock).toContain('catch');
    expect(fnBlock).toContain('saveApkFailureReport(');
  });

  it('imports the store from the dedicated module, not a re-implementation inline', () => {
    expect(mobileShip).toContain("from '../lib/AdminApkReportStore'");
    expect(mobileShip).toContain('saveApkFailureReport');
  });
});

describe('admin.ts: the APK Reports inbox has its own admin-only routes', () => {
  it('registers list, detail, mark, delete and clear — all behind verifyAdminToken', () => {
    for (const route of [
      "app.get('/api/admin/apk-reports'",
      "app.get('/api/admin/apk-reports/:id'",
      "app.post('/api/admin/apk-reports/:id/mark'",
      "app.delete('/api/admin/apk-reports/:id'",
      "app.post('/api/admin/apk-reports/clear'",
    ]) {
      const at = adminRoutes.indexOf(route);
      expect(at, `${route} is missing`).toBeGreaterThan(-1);
      // Each registration line must carry the admin gate — a route with no gate would be a public leak
      // of every user's build failures (repo names, log excerpts) to an unauthenticated caller.
      const line = adminRoutes.slice(at, adminRoutes.indexOf('\n', at));
      expect(line).toContain('verifyAdminToken');
    }
  });

  it('the clear-all route is guarded by an explicit confirm, like its sibling inbox', () => {
    const at = adminRoutes.indexOf("app.post('/api/admin/apk-reports/clear'");
    const block = adminRoutes.slice(at, adminRoutes.indexOf('});', at));
    expect(block).toContain('confirm');
  });
});

describe('AdminDashboard.tsx: APK Reports is its OWN nav page, separate from Build Reports', () => {
  it('is a distinct tab id, listed in the header nav', () => {
    expect(dashboard).toContain("id: 'apkreports', label: 'APK Reports'");
    // Must be a genuinely separate id from the AgentV3 inbox, not an alias / filter of it.
    expect(dashboard).toContain("id: 'reports',   label: 'Build Reports'");
  });

  it('fetches its own endpoint when the tab is opened', () => {
    expect(dashboard).toContain("if (activeTab === 'apkreports') fetchApkReports()");
    expect(dashboard).toContain("fetch('/api/admin/apk-reports'");
  });

  it('renders its own block, keyed to the new tab id', () => {
    expect(dashboard).toContain("activeTab === 'apkreports' &&");
  });
});
