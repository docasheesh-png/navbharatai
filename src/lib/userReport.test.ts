import { describe, it, expect } from 'vitest';
import { validateReport, reportHeadline, MESSAGE_MAX, SCREENSHOT_MAX_CHARS } from './userReport';
import {
  feedShake, initialShakeState, magnitude, shakeEnabled,
  SHAKE_FORCE, SHAKE_REVERSALS, SHAKE_WINDOW_MS, SHAKE_COOLDOWN_MS, SHAKE_PREF_KEY,
} from './reportShake';

describe('validateReport — the same rules on both sides', () => {
  it('accepts a short, real complaint', () => {
    const r = validateReport({ message: 'The download button does nothing', targetKind: 'bug' });
    expect(r.ok).toBe(true);
  });

  it('asks for words rather than storing an empty report', () => {
    expect(validateReport({ message: '   ' })).toMatchObject({ ok: false });
    expect(validateReport({ message: 'hi' })).toMatchObject({ ok: false });
  });

  it('refuses a message longer than the store can hold', () => {
    expect(validateReport({ message: 'x'.repeat(MESSAGE_MAX + 1) })).toMatchObject({ ok: false });
  });

  it('a report ABOUT something must say what', () => {
    // Otherwise the admin gets "this app is bad" with no app attached.
    expect(validateReport({ message: 'this app steals data', targetKind: 'app' })).toMatchObject({ ok: false });
    expect(validateReport({ message: 'this app steals data', targetKind: 'app', targetId: 'web_1' })).toMatchObject({ ok: true });
  });

  it('a plain bug needs no target', () => {
    expect(validateReport({ message: 'Settings opens blank', targetKind: 'bug' })).toMatchObject({ ok: true });
  });

  it('refuses a target kind it does not know', () => {
    expect(validateReport({ message: 'something', targetKind: 'admin' })).toMatchObject({ ok: false });
  });

  it('takes a real image and refuses anything else', () => {
    expect(validateReport({ message: 'look at this', screenshot: 'data:image/jpeg;base64,abc' })).toMatchObject({ ok: true });
    expect(validateReport({ message: 'look at this', screenshot: 'https://example.com/x.png' })).toMatchObject({ ok: false });
  });

  it('refuses a screenshot too big to store — with a reason, not a silent drop', () => {
    const huge = 'data:image/jpeg;base64,' + 'x'.repeat(SCREENSHOT_MAX_CHARS);
    const r = validateReport({ message: 'look at this', screenshot: huge });
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toMatch(/too large/i);
  });
});

describe('reportHeadline', () => {
  it('says what kind of report it is and quotes the user, never inventing', () => {
    expect(reportHeadline({ target: { kind: 'app' }, message: 'crashes on open' })).toBe('App · crashes on open');
    expect(reportHeadline({ target: { kind: 'user' }, message: 'abusive' })).toBe('User · abusive');
    expect(reportHeadline({ target: { kind: 'bug' }, message: 'blank page' })).toBe('Problem · blank page');
  });

  it('truncates visibly rather than cutting a sentence off silently', () => {
    expect(reportHeadline({ target: { kind: 'bug' }, message: 'y'.repeat(200) })).toMatch(/…$/);
  });
});

// ── Shake ────────────────────────────────────────────────────────────────────
// A phone in a pocket shakes all day. These are the rules that separate "someone is asking for help"
// from "someone is walking", and they are the reason this is not a threshold check.

const still = { x: 1, y: 2, z: 9.8 }; // a phone sitting on a table (gravity)
const hard = (dir: number) => ({ x: 30 * dir, y: 2, z: 2 });

describe('feedShake — deliberate shakes only', () => {
  it('ignores a phone being carried around', () => {
    let s = initialShakeState();
    for (let i = 0; i < 40; i++) {
      const out = feedShake(s, { ...still, at: i * 50 });
      s = out.state;
      expect(out.shook).toBe(false);
    }
  });

  it('ignores one hard movement — a bump is not a shake', () => {
    const out = feedShake(initialShakeState(), { ...hard(1), at: 0 });
    expect(out.shook).toBe(false);
  });

  it('ignores repeated pushes in the SAME direction', () => {
    // Being jolted along one axis (a bus, a bike) never reverses; a shake always does.
    let s = initialShakeState();
    let fired = false;
    for (let i = 0; i < 10; i++) {
      const out = feedShake(s, { ...hard(1), at: i * 100 });
      s = out.state;
      fired = fired || out.shook;
    }
    expect(fired).toBe(false);
  });

  it('fires on real back-and-forth reversals inside the window', () => {
    let s = initialShakeState();
    let fired = false;
    for (let i = 0; i < SHAKE_REVERSALS; i++) {
      const out = feedShake(s, { ...hard(i % 2 === 0 ? 1 : -1), at: i * 150 });
      s = out.state;
      fired = fired || out.shook;
    }
    expect(fired).toBe(true);
  });

  it('does not fire when the same reversals are spread out over a long journey', () => {
    let s = initialShakeState();
    let fired = false;
    for (let i = 0; i < 6; i++) {
      const out = feedShake(s, { ...hard(i % 2 === 0 ? 1 : -1), at: i * (SHAKE_WINDOW_MS + 500) });
      s = out.state;
      fired = fired || out.shook;
    }
    expect(fired).toBe(false);
  });

  it('will not fire twice while the hand is still moving', () => {
    // Without this the user gets a second sheet on top of the first.
    let s = initialShakeState();
    const shake = (from: number) => {
      let fired = false;
      for (let i = 0; i < SHAKE_REVERSALS; i++) {
        const out = feedShake(s, { ...hard(i % 2 === 0 ? 1 : -1), at: from + i * 150 });
        s = out.state;
        fired = fired || out.shook;
      }
      return fired;
    };
    expect(shake(0)).toBe(true);
    expect(shake(500)).toBe(false);                        // still inside the cooldown
    expect(shake(SHAKE_COOLDOWN_MS + 2000)).toBe(true);    // and it works again afterwards
  });

  it('measures force including gravity, so the threshold is above ordinary handling', () => {
    expect(magnitude(still)).toBeLessThan(SHAKE_FORCE);
    expect(magnitude(hard(1))).toBeGreaterThan(SHAKE_FORCE);
  });
});

describe('shakeEnabled — a convenience you cannot turn off is a nuisance', () => {
  it('is on unless the user turned it off', () => {
    expect(shakeEnabled(() => null)).toBe(true);
    expect(shakeEnabled(() => 'on')).toBe(true);
    expect(shakeEnabled((k) => (k === SHAKE_PREF_KEY ? 'off' : null))).toBe(false);
  });

  it('survives storage being unavailable', () => {
    expect(shakeEnabled(() => { throw new Error('private mode'); })).toBe(true);
  });
});

// ── The wiring, which is where the OLD report button failed ──────────────────
// The store's app-report wrote to Firestore and nothing ever read it. Every function in that path
// worked perfectly on its own; the system was still useless. So these check the JOIN, not the parts.
import { readFileSync } from 'fs';
import { join } from 'path';

const codeOnly = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const src = (p: string) => codeOnly(readFileSync(join(process.cwd(), p), 'utf8'));

describe('a report can be written AND read', () => {
  const routes = src('src/server/routes/reports.ts');

  it('the submit route and the admin read routes ship in the same file', () => {
    // Not decoration: the previous system had the write with no reader, and nothing made that visible.
    expect(routes).toContain("'/api/report'");
    expect(routes).toContain("'/api/admin/reports'");
    expect(routes).toContain("/api/admin/reports/:id");
  });

  it('the admin routes are behind the REAL admin gate', () => {
    const adminLines = routes.split('\n').filter((l) => l.includes("'/api/admin/reports"));
    expect(adminLines.length).toBeGreaterThan(0);
    for (const line of adminLines) expect(line).toContain('requireAdmin');
  });

  it('the accused is resolved on the SERVER, never taken from the sender', () => {
    // Otherwise anyone could aim a pile of complaints at a competitor.
    expect(routes).toContain('getWebApp(parsed.targetId)');
    expect(routes).toContain('ownerUid = found.uid');
  });

  it('the route is registered, or none of it exists at runtime', () => {
    // Read RAW, not comment-stripped: server.ts contains a `/*` inside a string somewhere above, so a
    // naive stripper swallows a large region of the file with it. `registerReportRoutes(app)` cannot
    // occur in prose anyway, so stripping buys nothing here and costs correctness.
    expect(readFileSync(join(process.cwd(), 'server.ts'), 'utf8')).toContain('registerReportRoutes(app)');
  });

  it('the admin dashboard has its own page for these, separate from build reports', () => {
    const panel = src('src/components/AdminDashboard.tsx');
    expect(panel).toContain("'userreports'");
    expect(panel).toContain('/api/admin/reports');
    // Both people named, and the action available where the complaint is read.
    expect(panel).toContain('openReport.reporter');
    expect(panel).toContain('openReport.reported');
    expect(panel).toContain('handleBan(');
  });

  it('the user can reach it without knowing a secret gesture', () => {
    // Shake alone would be unreachable on iOS and undiscoverable everywhere.
    expect(src('src/components/panels/SidebarNav.tsx')).toContain('onReportProblem');
    expect(src('src/App.tsx')).toContain('<ReportSheet');
    expect(src('src/App.tsx')).toContain('useShakeToReport');
  });

  it('a failed send is shown to the user, not swallowed', () => {
    const sheet = src('src/components/ReportSheet.tsx');
    expect(sheet).toContain('setNote(data?.error');
  });
});
