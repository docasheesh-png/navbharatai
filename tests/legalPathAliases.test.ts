// The Play Console's stored Privacy Policy URL is `/privacy-policy`, not `/privacy` — and a URL that
// already lives in someone else's console cannot be corrected by a commit. These tests pin the two
// properties that make the old link genuinely work rather than merely look alive:
//
//   1. every alias redirects to a path this server actually renders, and
//   2. every path the legal route module owns is deferred by the SPA catch-all.
//
// (2) is the one that fails silently in production: a path missing from the fallback list is answered
// with index.html and a 200 — a working link to a human, an empty page to a crawler that does not run
// JavaScript, which is exactly the audience Play and Meta check these URLs with.

import { describe, it, expect } from 'vitest';
import {
  PUBLIC_LEGAL_ROUTES,
  DELETE_ACCOUNT_PATH,
  LEGAL_PATH_ALIASES,
  ALL_PUBLIC_LEGAL_PATHS,
} from '../src/server/lib/legalPaths';
import { spaFallbackShouldDefer } from '../src/server/lib/spaFallback';

const renderedPaths = new Set<string>([...Object.keys(PUBLIC_LEGAL_ROUTES), DELETE_ACCOUNT_PATH]);

describe('public legal path aliases', () => {
  it('the URL stored in the Play Console resolves to the privacy policy', () => {
    expect(LEGAL_PATH_ALIASES['/privacy-policy']).toBe('/privacy');
  });

  it('every alias points at a path that is actually rendered', () => {
    for (const [alias, canonical] of Object.entries(LEGAL_PATH_ALIASES)) {
      expect(renderedPaths.has(canonical), `${alias} → ${canonical} is not a rendered page`).toBe(true);
    }
  });

  it('no alias shadows a rendered page (that would redirect a document to itself)', () => {
    for (const alias of Object.keys(LEGAL_PATH_ALIASES)) {
      expect(renderedPaths.has(alias), `${alias} is both an alias and a page`).toBe(false);
    }
  });

  it('the SPA catch-all defers EVERY legal path, aliases included', () => {
    for (const p of ALL_PUBLIC_LEGAL_PATHS) {
      expect(spaFallbackShouldDefer(p), `${p} would be swallowed by the SPA catch-all`).toBe(true);
    }
  });

  it('a trailing slash still defers — reviewers paste URLs both ways', () => {
    expect(spaFallbackShouldDefer('/privacy-policy/')).toBe(true);
  });

  it('ordinary client routes are still served the SPA', () => {
    for (const p of ['/', '/admin', '/store', '/privacy-policy-generator']) {
      expect(spaFallbackShouldDefer(p)).toBe(false);
    }
  });
});
