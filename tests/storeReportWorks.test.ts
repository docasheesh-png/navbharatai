import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Admin 2026-08-27: "app mart me jab game chala nahi to maine report kiya — report hua hi nahi.
// button se popup to khul gaya, text type bhi ho gaya, par send button kam nahi kar raha."
//
// The sentence was true twice over, and the second one is the worse defect.
const ROOT = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

describe('the Send button must never fail in silence', () => {
  const player = read('src/components/ide/WebAppPlayer.tsx');

  it('a refusal is SHOWN — it used to be `if (res.ok)` with no else at all', () => {
    // Every answer the server can give — 401, 400, 404, 502 — arrived as literally nothing on screen,
    // which is indistinguishable from a dead button.
    expect(player).toContain('setReportError');
    expect(player).toContain('data?.error ||');
    expect(player).toMatch(/error \$\{res\.status\}/);
  });

  it('a network failure is shown too, instead of a comment saying the user could retry', () => {
    expect(player).toContain('Could not reach the server');
    expect(player).toContain('AbortError');
  });

  it('the error is rendered where the user is looking, and marked as an alert', () => {
    expect(player).toContain('{reportError}');
    expect(player).toContain("role=\"alert\"");
  });

  it('the button says what it is doing and cannot be double-fired', () => {
    expect(player).toContain('reportBusy');
    expect(player).toContain("'Sending…'");
  });
});

describe('a signed-out viewer may report — they are the ones who meet a bad app', () => {
  const route = read('src/server/routes/navStore.ts');
  const report = route.slice(route.indexOf("app.post('/api/nav-store/web/app/:id/report'"), route.indexOf("app.get('/api/nav-store/web/admin/reports'"));

  it('does not refuse an anonymous reporter', () => {
    // App Mart's promise is "others run your app instantly in their browser" — no account. Requiring
    // one to report excluded exactly the people reporting exists for, and stopped no abuser: anyone
    // can make an account. The ceiling is the rate limit.
    expect(report).not.toContain('Sign in to report');
    expect(report).not.toMatch(/if \(!me\?\.uid\) return res\.status\(401\)/);
    expect(report).toContain("me?.uid || 'anon'");
  });

  it('is rate limited, which is the real protection', () => {
    expect(route).toContain("name: 'store-report'");
    expect(report).toContain('reportLimiter');
  });

  it('still refuses an empty reason and a missing app', () => {
    expect(report).toContain('reason.length < 5');
    expect(report).toContain("res.status(404)");
  });
});

describe('THE REAL DEFECT: a report nobody could ever read', () => {
  const store = read('src/server/lib/navStoreWeb.ts');
  const route = read('src/server/routes/navStore.ts');
  const ui = read('src/components/ide/NavAppStore.tsx');

  it('reports can be listed — before this, they were written and read by nothing', () => {
    // reportWebApp wrote to a Firestore subcollection since the store shipped. No route, no screen,
    // no alert ever read it. "Report sent — a person will look at it" was a promise the code could
    // not keep: there was no way for a person to look. That is a feature that looks done and is not.
    expect(store).toContain('export async function listWebAppReports');
    expect(route).toContain("app.get('/api/nav-store/web/admin/reports'");
  });

  it('the list is admin-only', () => {
    const at = route.indexOf("app.get('/api/nav-store/web/admin/reports'");
    expect(route.slice(at, at + 400)).toContain('isStoreAdmin');
  });

  it('a human actually sees them, with the app and a way to act', () => {
    expect(ui).toContain("'/api/nav-store/web/admin/reports'");
    expect(ui).toContain('Reported by viewers');
    expect(ui).toContain('Remove this app');
  });

  it('an anonymous report is labelled as such rather than dressed up', () => {
    // A reviewer should weigh it; hiding the difference would be its own small dishonesty.
    expect(ui).toContain('from a signed-out viewer');
  });
});
