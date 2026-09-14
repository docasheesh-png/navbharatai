import { describe, it, expect } from 'vitest';
import {
  apkReportId, saveApkFailureReport, listApkReports, getApkReport, markApkReportFixed,
  deleteApkReport, deleteAllApkReports, APK_REPORTS_DEFAULT_LIMIT,
} from './AdminApkReportStore';

// Regression lock for the 2026-09-14 feature (admin: "apk bane nahi, fail ho jaye, to puri detailed
// build report admin panel me automatically send ho jaye"). This is a SEPARATE inbox from
// AdminBuildReportStore.ts on purpose — see this file's own header comment.

describe('apkReportId — one row per FAILED RUN, not per app', () => {
  it('is deterministic for the same owner/repo/runId — the idempotency guard', () => {
    expect(apkReportId('acme', 'calculator', '123')).toBe(apkReportId('acme', 'calculator', '123'));
  });

  it('separates different repos, owners and runs', () => {
    const base = apkReportId('acme', 'calculator', '123');
    expect(apkReportId('acme', 'notes', '123')).not.toBe(base);
    expect(apkReportId('other', 'calculator', '123')).not.toBe(base);
    // A DIFFERENT run of the same app must get its OWN report — a fixed-then-broken-again rebuild is a
    // genuinely new failure, not the same row silently overwritten.
    expect(apkReportId('acme', 'calculator', '456')).not.toBe(base);
  });

  it('cannot be broken by a hostile owner or repo name (becomes a Firestore document id)', () => {
    const id = apkReportId('a/../b', 'r e p o#1', '1');
    expect(id).not.toContain('/');
    expect(id).toMatch(/^[A-Za-z0-9._-]+$/);
  });

  it('never throws on junk input', () => {
    expect(() => apkReportId('', '', '')).not.toThrow();
    expect(() => apkReportId(undefined as never, undefined as never, undefined as never)).not.toThrow();
  });
});

const validReport = () => ({
  userId: 'u1', email: 'u1@example.com', owner: 'acme', repo: 'calculator', workflow: 'android-apk.yml',
  building: 'Installable Android app (.apk)', runId: '123', runUrl: 'https://github.com/acme/calculator/actions/runs/123',
  startedAt: null, completedAt: null, durationSeconds: null, steps: [],
  failure: { whatStopped: 'Compiling your Android app', stage: 'android', why: 'Gradle failed.', navbharatCanFixItself: false, detail: null, logExcerpt: [] },
});

describe('the store is inert in tests and refuses incomplete work', () => {
  // getDb() returns null under VITEST, so these exercise the guards rather than Firestore.
  it('saves nothing without the fields that make a row findable', async () => {
    expect(await saveApkFailureReport({ ...validReport(), userId: '' })).toBe(false);
    expect(await saveApkFailureReport({ ...validReport(), owner: '' })).toBe(false);
    expect(await saveApkFailureReport({ ...validReport(), repo: '' })).toBe(false);
    expect(await saveApkFailureReport({ ...validReport(), runId: '' })).toBe(false);
  });

  it('never throws — a failure here must not break the build status the user is waiting on', async () => {
    await expect(saveApkFailureReport(validReport())).resolves.toBe(false);
    await expect(listApkReports()).resolves.toEqual([]);
    await expect(getApkReport('id')).resolves.toBeNull();
    await expect(markApkReportFixed('id', true)).resolves.toBe(false);
    await expect(deleteApkReport('id')).resolves.toBe(false);
    await expect(deleteAllApkReports()).resolves.toBe(0);
  });

  it('refuses a get/mark/delete with no id, so nothing is ever unscoped', async () => {
    expect(await getApkReport('')).toBeNull();
    expect(await markApkReportFixed('', true)).toBe(false);
    expect(await deleteApkReport('')).toBe(false);
  });

  it('bounds a listing, so the inbox does not return everything at once', () => {
    expect(APK_REPORTS_DEFAULT_LIMIT).toBeGreaterThan(0);
    expect(APK_REPORTS_DEFAULT_LIMIT).toBeLessThanOrEqual(500);
  });
});
