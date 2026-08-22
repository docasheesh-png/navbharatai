import { describe, it, expect } from 'vitest';
import {
  previewDiagnoseReason,
  previewWasVerified,
  previewServeNarration,
  PREVIEW_UNVERIFIED_PROBLEM,
} from '../src/server/AgentV3/ImportPreview';

/**
 * A FAILED MEASUREMENT IS NOT A FINDING.
 *
 * ADMIN SCREENSHOT 2026-08-22, an Express build. The Diagnose banner said:
 *
 *   "Dev server is up on port 3000, but it isn't serving the app's pages yet: the preview could not
 *    be reached to verify it. This is common for a full-stack app whose client routes aren't served
 *    (only its API) — the boot log below shows the cause."
 *
 * The first clause was honest and the rest was invented. We had verified nothing, so "isn't serving
 * the app's pages" was not something we knew. The full-stack API-only line explains a real 404, not a
 * capture timeout. And the boot log did NOT show the cause: the app's failure was `express-session`
 * throwing "secret option required for sessions", which happens per REQUEST — the boot log is silent
 * by construction, which is exactly why `halfBootCause` returned null and the guess ran.
 *
 * The true cause was already on the same screen, three messages up, where the build path had reported
 * it correctly: "the server returned an error instead of the app: secret option required for
 * sessions". Two surfaces disagreeing about one app, and the one with the confident explanation was
 * the wrong one. That is the failure this file locks shut.
 */

describe('previewWasVerified — did we actually see the app?', () => {
  it('is false when the only thing we know is that the check failed', () => {
    expect(previewWasVerified([PREVIEW_UNVERIFIED_PROBLEM])).toBe(false);
  });

  it('is true for a real observation about the app', () => {
    expect(previewWasVerified(['the server returned an error instead of the app: secret option required for sessions'])).toBe(true);
    expect(previewWasVerified(['the server returned 404 / "Cannot GET"'])).toBe(true);
  });

  it('is true when a real problem accompanies the failed capture — that problem IS evidence', () => {
    expect(previewWasVerified([PREVIEW_UNVERIFIED_PROBLEM, 'the server returned 404 / "Cannot GET"'])).toBe(true);
  });

  it('treats an empty list as nothing to explain, leaving the verdict to `rendered`', () => {
    expect(previewWasVerified([])).toBe(true);
    expect(previewWasVerified([''])).toBe(true);
  });
});

describe('previewDiagnoseReason — the exact banner from the report', () => {
  const base = { port: 3000, hasUrl: true, rendered: false, bootCause: null as string | null };

  it('THE REGRESSION: an unreachable check no longer claims the app is not serving its pages', () => {
    const text = previewDiagnoseReason({ ...base, problems: [PREVIEW_UNVERIFIED_PROBLEM] });
    expect(text).not.toContain("isn't serving the app's pages");
    expect(text).not.toContain('client routes');
    expect(text).not.toContain('boot log below shows the cause');
    // What it must say instead: that this is not a verdict, and where the answer actually is.
    expect(text).toContain('not a verdict about your app');
    expect(text).toContain('Preview tab');
  });

  it('the full-stack hint survives for the ONE failure it actually explains', () => {
    const text = previewDiagnoseReason({ ...base, problems: ['the server returned 404 / "Cannot GET" — the dev server is not serving the app at this path'] });
    expect(text).toContain("client routes aren't served");
  });

  it('and is NOT attached to a failure it does not explain', () => {
    // A session-secret error is not a routing problem; blaming routing sends the user to the wrong file.
    const text = previewDiagnoseReason({ ...base, problems: ['the server returned an error instead of the app: secret option required for sessions'] });
    expect(text).toContain('secret option required for sessions');
    expect(text).not.toContain('client routes');
  });

  it('a NAMED boot cause outranks everything — it is proof, not a guess', () => {
    const text = previewDiagnoseReason({ ...base, problems: [PREVIEW_UNVERIFIED_PROBLEM], bootCause: 'Your app started but could not reach its database' });
    expect(text).toBe('Your app started but could not reach its database');
  });

  it('still reports success and the unresolved-URL case unchanged', () => {
    expect(previewDiagnoseReason({ ...base, rendered: true, problems: [] })).toContain('preview restored');
    expect(previewDiagnoseReason({ ...base, hasUrl: false, problems: [] })).toContain('public URL could not be resolved');
  });
});

describe('previewServeNarration — the build path follows the same rule', () => {
  it('does not diagnose an app it could not open', () => {
    const v = previewServeNarration({ rendered: false, problems: [PREVIEW_UNVERIFIED_PROBLEM], port: 5000, needsDb: true });
    expect(v.ok).toBe(false);
    expect(v.text).toContain('not a verdict about your app');
    // `needsDb` used to be enough to attach the full-stack explanation on its own.
    expect(v.text).not.toContain("only its API");
  });

  it('keeps naming a real observed problem', () => {
    const v = previewServeNarration({ rendered: false, problems: ['the server returned 404 / "Cannot GET"'], port: 5000, needsDb: true });
    expect(v.text).toContain('Cannot GET');
    expect(v.text).toContain('only its API');
  });

  it('still celebrates a genuinely rendered preview', () => {
    expect(previewServeNarration({ rendered: true, problems: [], port: 5173, needsDb: false }).ok).toBe(true);
  });
});
