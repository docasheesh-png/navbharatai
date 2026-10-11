// A FAILURE THE USER CAUSED IS SHOWN TO THE USER (2026-10-11, Q-794).
//
// App.tsx's `addLog` writes to a developer log that NO screen draws (`useDevLogs` — its `logs` reach no
// component). The Q-600 sweep found `pushStatus`, set to 'error' when "Confirm & Push to GitHub" failed
// and read by nothing: the button stopped spinning and nothing said the push had not happened. Hunting
// the class — a failure of something the user pressed, reported only to that invisible log — found five
// more in the same file: a GitHub connect that failed, a GitHub sign-in ticket that could not be redeemed,
// a sign-in link that was refused, a repository import that failed, and one that found nothing to import.
// And beside them a worse sibling: a FIREBASE_AUTH_ERROR handler that no server ever sends, with no
// origin check, which opened a full-screen dialog in the SENDER's words — reachable only by a foreign page.
//
// The census fails when a new `addLog(..., 'error' | 'warn')` in App.tsx has no visible counterpart near
// it; the few background ones (nothing the user pressed) are listed with their reason.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const app = readFileSync('src/App.tsx', 'utf8');
const lines = app.split('\n');

/** Failures of things the user did NOT just press — nothing to tell them, or told another way. */
const BACKGROUND: Record<string, string> = {
  "'GitHub: Failed to retrieve account data.": 'the startup refresh of an already-connected account; the Git screen shows its own state',
  '`Sandbox error:': "the preview iframe's own runtime errors; the preview's harness shows them",
  "'Admin: Access Denied.'": 'setAdminError on the line above shows the reason on the admin login',
};

describe('the census: no silent failure in App.tsx', () => {
  it('🔒 every error/warn log line has a visible counterpart within six lines, or is a listed background one', () => {
    const silent: string[] = [];
    lines.forEach((line, i) => {
      if (!/addLog\([^;]*,\s*'(error|warn)'\)/.test(line)) return;
      if (Object.keys(BACKGROUND).some((k) => line.includes(k))) return;
      const near = lines.slice(Math.max(0, i - 6), i + 7).join('\n');
      if (/addToast\(|set\w*Error\(|setShowAuth\(true\)/.test(near)) return;
      silent.push(`${i + 1}: ${line.trim()}`);
    });
    expect(silent).toEqual([]);
  });

  it('the background list still matches real lines (a stale entry would hide a new silent failure)', () => {
    for (const key of Object.keys(BACKGROUND)) expect(app, key).toContain(key);
  });
});

describe('each failure that was silent now says so', () => {
  it('🔒 Confirm & Push to GitHub: a failed push is a toast, and the edit stays pending to retry', () => {
    const fn = app.slice(app.indexOf('const handleGHConfirmPush = async'), app.indexOf('const handleGHConfirmPush = async') + 2400);
    const fail = fn.slice(fn.indexOf('} catch (e: any) {'));
    expect(fail).toContain("addToast(`Push to GitHub failed: ${e?.message || 'unknown error'}`, 'error');");
    expect(fail.slice(0, fail.indexOf('} finally {'))).not.toContain('setPendingGHEdit(null)');
  });

  it('GitHub connect and import failures are toasts', () => {
    expect(app).toContain("addToast('GitHub connection failed — please try connecting again.', 'error');");
    expect(app).toContain("addToast('GitHub sign-in could not be completed. Please try connecting again.', 'error');");
    expect(app).toMatch(/addToast\('A GitHub sign-in link was ignored[^']*', 'warning'\);/);
    expect(app).toContain("addToast(`GitHub import failed: ${err?.message || 'unknown error'}`, 'error');");
    expect(app).toMatch(/addToast\('Nothing to import[^']*', 'warning'\);/);
  });

  it('🔒 the GitHub error message is honoured only from our own callback page, and its text is never echoed', () => {
    const branch = app.slice(app.indexOf("e.data.type === 'GITHUB_AUTH_ERROR'"), app.indexOf("e.data.type === 'GITHUB_AUTH_ERROR'") + 600);
    expect(branch).toContain('if (e.origin !== window.location.origin) return;');
    expect(branch.indexOf('if (e.origin !== window.location.origin) return;')).toBeLessThan(branch.indexOf('addToast('));
    expect(branch).not.toMatch(/addToast\([^)]*e\.data/);
  });

  it('🔒 no client code answers FIREBASE_AUTH_ERROR — nothing sends it, so only a foreign page could', () => {
    const code = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).not.toContain("'FIREBASE_AUTH_ERROR'");
  });
});
