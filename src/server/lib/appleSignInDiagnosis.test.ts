// Tests for the Apple sign-in diagnosis — the module that exists so "apple login abhi bhi nahi ho raha"
// becomes one answer instead of another evening of guessing (admin 2026-08-21).

import { describe, it, expect } from 'vitest';
import { diagnoseAppleSignIn, looksLikeHtml } from './appleSignInDiagnosis';

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
