/**
 * The wiring, pinned — because every part of this fails silently.
 *
 * Drop the render and nothing errors: the app just stops telling anyone it is in testing. Drop the
 * `onReport` and the button becomes decoration. Let the label drift from the sidebar's and the
 * notice starts naming a menu entry that does not exist by that name. None of it breaks a build.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TESTING_NOTICE_COPY } from '../src/lib/testingNotice';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
/** Strip comments: a doc block that MENTIONS a call must not satisfy an assertion about the call. */
const codeOnly = (src: string) =>
  src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const app = codeOnly(read('src/App.tsx'));
const notice = codeOnly(read('src/components/TestingNotice.tsx'));
const sidebar = read('src/components/panels/SidebarNav.tsx');
const css = read('src/index.css');

describe('it is actually rendered, and only where it should be', () => {
  it('the decision comes from the tested helper, not a hand-rolled condition in the view', () => {
    expect(app).toMatch(/shouldShowTestingNotice\(\{\s*activeView,\s*alreadyShown:\s*!testingNoticeOpen\s*\}\)/);
  });

  it('the "already shown" seed is read ONCE, in the initialiser', () => {
    // A re-render must never resurrect a notice the user just dismissed.
    expect(app).toMatch(/useState\(\(\)\s*=>\s*!testingNoticeAlreadyShown\(\)\)/);
  });
});

describe('the button opens the REAL report sheet', () => {
  it('App wires onReport to the same state the sidebar and the shake gesture open', () => {
    // ⚠️ THE HANDLER GAINED A LINE, AND THE ASSERTION HAD TO STOP BEING A TRANSCRIPT (2026-09-17).
    // It matched the handler's exact body, so adding `setReportMode('choose')` — which opens the
    // sheet on its new chooser rather than wherever it was left — failed a test that has no opinion
    // about which screen it opens on. What it PROTECTS is unchanged and is asserted below: this
    // button opens the same `reportOpen` state the sidebar and the shake gesture use, not a second
    // sheet of its own. The mode is checked too, so the notice cannot silently land somewhere else.
    expect(app).toMatch(/onReport=\{\(\)\s*=>\s*\{[^}]*setReportOpen\(true\)/);
    expect(app).toMatch(/onReport=\{\(\)\s*=>\s*\{\s*setReportMode\('choose'\)/);
    // …and that state is the one ReportSheet actually reads.
    expect(app).toMatch(/<ReportSheet open=\{reportOpen\}/);
  });

  it('the notice calls it, and closes itself when it does', () => {
    expect(notice).toMatch(/onClick=\{\(\)\s*=>\s*\{\s*close\(\);\s*onReport\(\);\s*\}\}/);
  });
});

describe('🔒 SESSION storage, asserted against the real default', () => {
  // The unit tests inject a fake store, so they prove the LOGIC and cannot see which store the code
  // actually reaches for. Swapping sessionStorage for localStorage passed every one of them while
  // silently changing the feature to "shown once per device, ever" — the exact bug that would make
  // the admin's "whenever the user opens the app" false. Caught by reading the source, which is the
  // only place that fact exists.
  const mod = codeOnly(read('src/lib/testingNotice.ts'));

  it('reaches for sessionStorage, never localStorage', () => {
    expect(mod).toMatch(/typeof sessionStorage !== 'undefined' \? sessionStorage : null/);
    expect(mod).not.toMatch(/\blocalStorage\b/);
  });
});

describe('🔒 the label names a menu entry that really exists', () => {
  it('matches the sidebar’s own visible text', () => {
    // The notice tells the user where to go. If these two ever drift, it is sending them somewhere
    // by a name nothing in the app carries.
    expect(sidebar).toContain(`>${TESTING_NOTICE_COPY.action}<`);
  });
});

describe('accessibility and motion', () => {
  it('announces politely as status, never as an alert', () => {
    expect(notice).toMatch(/role="status"/);
    expect(notice).toMatch(/aria-live="polite"/);
  });

  it('the dismiss control is labelled for a screen reader', () => {
    expect(notice).toMatch(/aria-label=\{TESTING_NOTICE_COPY\.dismiss\}/);
  });

  it('🔒 the countdown PAUSES on hover, focus and touch', () => {
    // Three seconds is the ask; a message that asks the reader to act must not vanish mid-sentence,
    // and a button must not disappear from under a finger.
    for (const h of ['onMouseEnter={hold}', 'onMouseLeave={release}', 'onFocus={hold}', 'onBlur={release}', 'onTouchStart={hold}', 'onTouchEnd={release}'])
      expect(notice, h).toContain(h);
  });

  it('🔒 motion is CSS, so Reduce Animations switches it off by construction', () => {
    // index.css already clamps every animation under .nb-reduce-motion. Using a CSS animation means
    // the accessibility setting cannot be forgotten by a prop nobody passed.
    expect(notice).toMatch(/nb-testing-notice-(in|out)/);
    expect(css).toContain('.nb-testing-notice-in');
    expect(css).toContain('.nb-testing-notice-out');
    expect(css).toMatch(/\.nb-reduce-motion \*[\s\S]{0,200}animation-duration: 0\.01ms !important/);
  });
});
