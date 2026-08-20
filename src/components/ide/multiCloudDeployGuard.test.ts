import { describe, it, expect } from 'vitest';
import { isPlaceholderHtml } from '../../lib/workspaceSource';

/**
 * REGRESSION (admin 2026-08-20, from the question "yeh kaam kar bhi raha hai ya nahi?").
 *
 * Cloudeploy's two real deploy paths guarded with `!generatedCode`. In v5.0 that value sits at the
 * "Waiting for magic…" PLACEHOLDER — a TRUTHY string — so the guard never fired: pressing Deploy
 * uploaded the placeholder page to a real live URL and reported "✅ Deployed successfully". A genuine
 * URL serving "Waiting for magic…" is the worst kind of fake success.
 *
 * These tests pin the DECISION (publish vs refuse) on the exact strings the app really produces, so
 * the guard cannot silently regress to a falsy check again.
 */

// The two near-identical copies that live in WorkspaceContext.tsx and App.tsx's boot state.
const PLACEHOLDER = '<!DOCTYPE html><html><body style="background:#0d1117;color:#8b949e;display:flex;'
  + 'justify-content:center;align-items:center;height:100vh;font-family:sans-serif;margin:0">'
  + '<div><h2 style="color:white">Waiting for magic...</h2><p>Ask Navbharat to build something!</p></div></body></html>';

/** The decision Cloudeploy makes before calling /api/pwa/save or /api/pro/deploy. */
const wouldPublish = (generatedCode: string | undefined | null): boolean => !isPlaceholderHtml(generatedCode);

describe('Cloudeploy publish guard — never put a placeholder on a real URL', () => {
  it('THE BUG: the v5.0 placeholder is TRUTHY, so `!generatedCode` let it through — it must be refused', () => {
    expect(Boolean(PLACEHOLDER)).toBe(true);        // why the old guard failed
    expect(wouldPublish(PLACEHOLDER)).toBe(false);  // the fix
  });

  it('a genuinely empty or whitespace channel is still refused', () => {
    expect(wouldPublish('')).toBe(false);
    expect(wouldPublish('   ')).toBe(false);
    expect(wouldPublish(undefined)).toBe(false);
    expect(wouldPublish(null)).toBe(false);
  });

  it('a REAL single-page app (or a loaded template) still publishes — the fix must not block the working case', () => {
    expect(wouldPublish('<!DOCTYPE html><html><body><h1>My Shop</h1></body></html>')).toBe(true);
  });

  it('an app that merely MENTIONS the placeholder words is not mistaken for one', () => {
    // Both marker phrases are required together, so an app whose own copy says "waiting" is safe.
    expect(wouldPublish('<html><body><p>Waiting for magic to happen in our salon</p></body></html>')).toBe(true);
  });
});
