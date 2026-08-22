// Tests for the Apple sign-in diagnosis — the module that exists so "apple login abhi bhi nahi ho raha"
// becomes one answer instead of another evening of guessing (admin 2026-08-21).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { diagnoseAppleSignIn, looksLikeHtml, firebaseAppleConfigNextStep } from './appleSignInDiagnosis';
import { APPLE_SERVICE_ID } from '../../components/socialSignInPolicy';

const FILE = 'abc123-apple-association-token';
const ok = (body: string) => ({ status: 200, body, contentType: 'text/plain' });

describe('diagnoseAppleSignIn — five failures that look identical from a browser', () => {
  it('nothing configured is named FIRST, because every other verdict would guess about a missing file', () => {
    const d = diagnoseAppleSignIn({ served: null, source: null, selfFetch: ok(FILE) });
    expect(d.verdict).toBe('not-configured');
    expect(d.nextStep).toContain('APPLE_DOMAIN_ASSOCIATION');
  });

  it('an empty/whitespace value counts as not configured — not as a file', () => {
    expect(diagnoseAppleSignIn({ served: '   ', source: 'env', selfFetch: null }).verdict).toBe('not-configured');
  });

  it('a non-200 on our own public URL means something ANSWERS BEFORE us', () => {
    const d = diagnoseAppleSignIn({ served: FILE, source: 'env', selfFetch: { status: 404, body: '', contentType: '' } });
    expect(d.verdict).toBe('intercepted');
    expect(d.message).toContain('404');
  });

  it('THE SILENT ONE: a 200 that returns the SITE instead of the file', () => {
    // A catch-all rewrite to index.html answers 200 with HTML. Apple reads that as a mismatched file,
    // so the portal says the domain could not be verified and nothing anywhere reports an error.
    const d = diagnoseAppleSignIn({ served: FILE, source: 'env', selfFetch: ok('<!DOCTYPE html><html><head>…') });
    expect(d.verdict).toBe('intercepted');
    expect(d.nextStep).toContain('/.well-known/');
  });

  it('a 200 with a DIFFERENT body is a stale deploy or a cache, not a missing file', () => {
    const d = diagnoseAppleSignIn({ served: FILE, source: 'env', selfFetch: ok('an-older-token') });
    expect(d.verdict).toBe('stale');
  });

  it('an exact match says the problem is APPLE-side — the sentence that stops the wrong search', () => {
    const d = diagnoseAppleSignIn({ served: FILE, source: 'env', selfFetch: ok(`  ${FILE}  `) });
    expect(d.verdict).toBe('ours-is-correct');
    expect(d.nextStep).toContain('Verify');
    expect(d.nextStep).toContain('https://navbharatai.com/__/auth/handler');
  });

  it('BEING UNABLE TO ASK is its own verdict, never reported as a failure', () => {
    // Confident wrongness here sends someone to fix a thing that was never broken.
    const noCheck = diagnoseAppleSignIn({ served: FILE, source: 'env', selfFetch: null });
    expect(noCheck.verdict).toBe('unverifiable');
    const failed = diagnoseAppleSignIn({
      served: FILE, source: 'env', selfFetch: { status: null, body: '', contentType: '', error: 'ETIMEDOUT' },
    });
    expect(failed.verdict).toBe('unverifiable');
    expect(failed.nextStep).toContain('ETIMEDOUT');
  });

  it('every verdict carries a message, and only the finished one has no next step for us', () => {
    for (const d of [
      diagnoseAppleSignIn({ served: null, source: null, selfFetch: null }),
      diagnoseAppleSignIn({ served: FILE, source: 'env', selfFetch: ok('x') }),
      diagnoseAppleSignIn({ served: FILE, source: 'env', selfFetch: ok(FILE) }),
    ]) {
      expect(d.message.length).toBeGreaterThan(20);
      expect(d.nextStep).toBeTruthy();
    }
  });
});

/**
 * THE SIBLING (2026-08-22). The client-side message for `auth/invalid-credential` used to send an admin
 * to Apple's portal; this file's strongest verdict sent them to press Apple's **Verify** button. Both
 * are wrong for that one code, and this one sounded MORE authoritative because it had just run a live
 * check — so fixing only the client would have left the admin's two sources of advice disagreeing, with
 * the wrong one winning.
 */
describe('the observed browser code narrows the final answer, and only that answer', () => {
  it('a code that PROVES Apple returned sends the admin to Firebase, not back to Apple', () => {
    const d = diagnoseAppleSignIn({
      served: FILE, source: 'env', selfFetch: ok(FILE), observedCode: 'auth/invalid-credential',
    });
    expect(d.verdict).toBe('ours-is-correct');
    // The four values that can still be wrong…
    expect(d.nextStep).toContain('Services ID');
    expect(d.nextStep).toContain('Team ID');
    expect(d.nextStep).toContain('Key ID');
    expect(d.nextStep).toContain('.p8');
    // …and NOT the Verify button, which this code proves already worked.
    expect(d.nextStep).not.toContain('press Verify');
  });

  it('the Services ID comes from the ONE constant the same endpoint reports', () => {
    // A second hardcoded copy could disagree with the value printed a few lines below it in the very
    // same JSON response, which is worse than having no advice at all.
    expect(firebaseAppleConfigNextStep(APPLE_SERVICE_ID)).toContain(APPLE_SERVICE_ID);
  });

  it('no code, or an unrelated one, leaves the answer exactly as it was', () => {
    const before = diagnoseAppleSignIn({ served: FILE, source: 'env', selfFetch: ok(FILE) });
    for (const observedCode of [null, undefined, '', '   ', 'auth/popup-closed-by-user', 'auth/network-request-failed']) {
      expect(diagnoseAppleSignIn({ served: FILE, source: 'env', selfFetch: ok(FILE), observedCode }))
        .toEqual(before);
    }
  });

  it('it can NEVER clean up a verdict that is genuinely our fault', () => {
    // The narrowing sits after every our-side check on purpose. A code arriving alongside a real
    // interception must not talk anyone out of the interception.
    const intercepted = diagnoseAppleSignIn({
      served: FILE, source: 'env', selfFetch: ok('<!doctype html>'), observedCode: 'auth/invalid-credential',
    });
    expect(intercepted.verdict).toBe('intercepted');
    const missing = diagnoseAppleSignIn({ served: null, source: null, selfFetch: null, observedCode: 'auth/invalid-credential' });
    expect(missing.verdict).toBe('not-configured');
  });

  it('the admin route passes the code through, bounded', () => {
    const admin = readFileSync(join(process.cwd(), 'src/server/routes/admin.ts'), 'utf8');
    expect(admin).toContain('diagnoseAppleSignIn({ served, source, selfFetch, observedCode })');
    expect(admin).toContain('.slice(0, 64)');
  });
});

/**
 * AND IT IS REACHABLE. The endpoint shipped on 2026-08-21 with NO user interface, so the only way to
 * read the one check that can say "stop looking at our code" was to curl it with an admin token. For
 * an admin who does not use a terminal that is indistinguishable from never having built it — which is
 * the second absolute rule, not a nicety.
 */
describe('the check has a real way in', () => {
  const dash = readFileSync(join(process.cwd(), 'src/components/AdminDashboard.tsx'), 'utf8');

  it('a button calls the endpoint, and the optional code rides along', () => {
    expect(dash).toContain('/api/admin/apple-signin');
    expect(dash).toContain('Apple sign-in');
    expect(dash).toContain('encodeURIComponent(code)');
    // Empty box ⇒ no query string at all, so the answer is the plain one rather than `?code=`.
    expect(dash).toContain("const q = code ? `?code=${encodeURIComponent(code)}` : '';");
  });

  it('an unexpected payload shows an honest failure, not an empty card', () => {
    // Keying the card off `verdict` — the one field every answer carries — means a changed shape reads
    // as "could not check" instead of rendering a blank card that looks like a clean result.
    expect(dash).toContain('setAppleDiag(d?.verdict ? d : null)');
  });

  it('the verdict colours are full class names, never interpolated', () => {
    // Tailwind scans source text, so `text-${tone}-400` is simply never generated and the element ends
    // up unstyled while the code reads as correct.
    expect(dash).not.toMatch(/text-\$\{tone\}/);
    expect(dash).toContain("const icon = ok ? 'text-emerald-400' : unknown ? 'text-amber-400' : 'text-red-400';");
  });

  it('every AI in the app can find it, per the AppKnowledgeBase rule', () => {
    const kb = readFileSync(join(process.cwd(), 'src/server/AppContext/AppKnowledgeBase.ts'), 'utf8');
    expect(kb).toContain("id: 'admin-apple-signin-check'");
    // The words the admin would actually type, in both languages they use.
    expect(kb).toContain('apple login nahi ho raha');
    expect(kb).toContain('auth/invalid-credential');
  });
});

describe('looksLikeHtml — the interception tell', () => {
  it('catches the shapes a catch-all rewrite actually returns', () => {
    for (const b of ['<!DOCTYPE html>', '<html lang="en">', '  <!doctype HTML>', 'x<head><script src="/a.js">']) {
      expect(looksLikeHtml(b), b).toBe(true);
    }
  });

  it('does not mistake Apple’s own token file for a web page', () => {
    expect(looksLikeHtml(FILE)).toBe(false);
    expect(looksLikeHtml('')).toBe(false);
    // Apple's file is opaque text; nothing in it should trip an HTML test.
    expect(looksLikeHtml('6E1F2A0B-1234-5678-9ABC-DEF012345678')).toBe(false);
  });
});
