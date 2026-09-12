import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  validateReport, reportHeadline, isProblemKind, problemKindLabel, problemKindAsk, PROBLEM_KINDS,
} from '../src/lib/userReport';
import { readContext } from '../src/server/routes/reports';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/**
 * THE REPORT THAT COULD NOT BE ACTED ON.
 *
 * Admin 2026-09-12, holding a real one: "App is not responsive and sometimes it does not work in
 * Mobile phones. Some content goes outside the mobile." — *"problem hi samajh nahi aa rahi fix kya
 * karu?"* Everything asserted here exists so that sentence can never arrive bare again.
 */

describe('the reporter says what KIND of problem it is, in one tap', () => {
  it('every kind has a label and its own follow-up question', () => {
    for (const k of PROBLEM_KINDS) {
      expect(k.label.length).toBeGreaterThan(3);
      expect(problemKindAsk(k.id)).toBe(k.ask);
      // The generic question is the fallback, so a kind that reuses it is a kind that adds nothing.
      expect(k.ask).toBeTruthy();
    }
    expect(new Set(PROBLEM_KINDS.map((k) => k.id)).size).toBe(PROBLEM_KINDS.length);
  });

  it('an unknown kind is never shown as a raw id, and never guessed', () => {
    expect(problemKindLabel('nonsense')).toBe('');
    expect(problemKindLabel(undefined)).toBe('');
    expect(isProblemKind('layout')).toBe(true);
    expect(isProblemKind('LAYOUT')).toBe(false);
  });

  it('the headline leads with the reporter\'s own word for it', () => {
    expect(reportHeadline({ target: { kind: 'bug' }, problemKind: 'slow', message: 'stuck at 40%' }))
      .toBe('Slow, stuck or frozen · stuck at 40%');
  });

  it('without a kind the headline is exactly what it always was', () => {
    expect(reportHeadline({ target: { kind: 'bug' }, message: 'blank page' })).toBe('Problem · blank page');
  });
});

describe('🔒 the kind is OPTIONAL on the server, and that is deliberate', () => {
  it('a report with no kind is still accepted', () => {
    // The Android app is BUNDLED — an installed build runs the frontend it shipped with until the
    // user takes a new one from Play. Requiring the kind here would turn the one channel a stuck
    // user has into a dead button on every older install, for the sake of a tidier record.
    expect(validateReport({ message: 'the build screen is stuck' })).toMatchObject({ ok: true });
  });

  it('an unknown kind is dropped, never a refusal and never stored as typed', () => {
    const r = validateReport({ message: 'the build screen is stuck', problemKind: 'whatever' });
    expect(r).toMatchObject({ ok: true });
    expect((r as { problemKind?: string }).problemKind).toBeUndefined();
  });

  it('a known kind survives', () => {
    expect(validateReport({ message: 'goes off the screen', problemKind: 'layout' }))
      .toMatchObject({ ok: true, problemKind: 'layout' });
  });
});

describe('the server bounds everything the client sent about itself', () => {
  it('keeps the facts that make a layout complaint fixable', () => {
    expect(readContext({
      view: 'home', platform: 'android', viewport: '390x844', dpr: 3,
      online: true, connection: '4g', language: 'hi-IN', build: '2026-09-12T10:00:00.000Z',
      appBuild: '91', overflowScanned: true,
      overflow: [{ element: 'table.prices', overflowPx: 41 }],
      errors: ['TypeError: x is not a function'],
    })).toMatchObject({
      view: 'home', platform: 'android', viewport: '390x844', dpr: 3, online: true,
      connection: '4g', language: 'hi-IN', appBuild: '91', overflowScanned: true,
      overflow: [{ element: 'table.prices', overflowPx: 41 }],
      errors: ['TypeError: x is not a function'],
    });
  });

  it('⚠️ caps the arrays — an unbounded list would make the report FAIL TO SAVE, not merely look untidy', () => {
    // Firestore documents stop at 1 MiB. A client sending a thousand findings would not be a
    // validation curiosity; it would be a silent dead end for a real problem report.
    const ctx = readContext({
      overflow: Array.from({ length: 500 }, (_, i) => ({ element: `div${i}`, overflowPx: i + 2 })),
      errors: Array.from({ length: 500 }, (_, i) => `err ${i}`),
    });
    expect(ctx.overflow!.length).toBeLessThanOrEqual(5);
    expect(ctx.errors!.length).toBeLessThanOrEqual(8);
  });

  it('truncates long strings rather than rejecting the report', () => {
    const ctx = readContext({ userAgent: 'u'.repeat(5000), errors: ['e'.repeat(5000)] });
    expect(ctx.userAgent!.length).toBe(300);
    expect(ctx.errors![0].length).toBe(200);
  });

  it('drops a malformed finding instead of storing junk', () => {
    const ctx = readContext({ overflow: [{ element: 'ok.row', overflowPx: 12 }, { overflowPx: 9 }, 'nope', null] });
    expect(ctx.overflow).toEqual([{ element: 'ok.row', overflowPx: 12 }]);
  });

  it('🔒 a scan that never ran stays UNDEFINED — it must not become a clean result', () => {
    expect(readContext({}).overflowScanned).toBeUndefined();
    expect(readContext({ overflowScanned: false }).overflowScanned).toBe(false);
    expect(readContext({ overflowScanned: 'yes' }).overflowScanned).toBeUndefined();
  });

  it('a nonsense device pixel ratio is dropped, not stored', () => {
    expect(readContext({ dpr: 'three' }).dpr).toBeUndefined();
    expect(readContext({ dpr: -4 }).dpr).toBeUndefined();
    expect(readContext({ dpr: 99999 }).dpr).toBeUndefined();
    expect(readContext({ dpr: 2.75 }).dpr).toBe(2.75);
  });

  it('garbage in place of the whole context is an empty context, never a throw', () => {
    expect(() => readContext('nope')).not.toThrow();
    expect(() => readContext(null)).not.toThrow();
  });
});

describe('the wiring — a fact collected and not shown is a fact not collected', () => {
  const sheet = read('src/components/ReportSheet.tsx');
  const admin = read('src/components/AdminDashboard.tsx');
  const main = read('src/main.tsx');

  it('the sheet sends the kind, the measurements and the errors', () => {
    expect(sheet).toContain('problemKind: kind');
    expect(sheet).toContain('collectDiagnostics(window)');
    expect(sheet).toContain('recentErrors()');
    expect(sheet).toContain('nativeAppBuild()');
    expect(sheet).toContain('__BUILD_TIME__');
  });

  it('Send stays disabled until the kind is chosen — the tap is what makes the rest legible', () => {
    expect(sheet).toContain('disabled={busy || !kind || message.trim().length < 5}');
  });

  it('🔒 the sheet no longer promises that nothing else is collected', () => {
    // It used to say exactly that, and the moment the snapshot was attached the promise became
    // false. A stale promise is worse than no promise.
    expect(sheet).not.toContain('Nothing\n              else is collected');
    expect(sheet).not.toMatch(/Nothing\s+else is collected/);
    expect(sheet).toMatch(/your screen\s+size/);
    expect(sheet).toMatch(/error\s+messages/);
  });

  it('the admin screen actually renders the measurement and the errors', () => {
    expect(admin).toContain('describeOverflow(');
    expect(admin).toContain('problemKindLabel(');
    expect(admin).toContain('Errors the browser recorded just before');
    expect(admin).toMatch(/c\.viewport/);
  });

  it('the error buffer is installed at boot, where the boot failures are', () => {
    expect(main).toContain('installErrorCapture(window)');
  });

  it('the policy discloses the snapshot, because the app now takes one', () => {
    const policy = read('src/content/legal/privacyPolicy.ts');
    expect(policy).toMatch(/Report a problem/);
    expect(policy).toMatch(/only when you press Send/i);
  });
});
