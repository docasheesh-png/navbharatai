// A REFUND POLICY THAT LIVES INSIDE THE TERMS HAS NO ADDRESS (2026-09-20).
//
// The rules were already written and already published — Terms of Service Section 4. What did not
// exist was a URL whose PAGE IS THE REFUND POLICY, and that is what the payment aggregator's
// onboarding asked for: "Refund Policy — Enter Website Policy Page URL". "It is halfway down our
// Terms" is not something a reviewer, a form, or a crawler can accept.
//
// These tests lock the properties that make the page genuinely usable as that address, each one a
// way the feature could look present and be broken:
//
//   1. the URL is SERVER-RENDERED, not swallowed by the SPA catch-all (the silent failure the
//      /privacy and /terms routes were built to prevent: 200 + index.html is a working link to a
//      human and an empty page to a non-JS checker — which is exactly the audience here);
//   2. the near-miss spellings a form or a customer types resolve to it;
//   3. it is REACHABLE from the Terms, because an untiled document nobody links to is a document
//      nobody finds;
//   4. it does not CONTRADICT the Terms — two published documents disagreeing about refunds is
//      worse than one document nobody can address.

import { describe, it, expect } from 'vitest';
import { PUBLIC_LEGAL_ROUTES, LEGAL_PATH_ALIASES, ALL_PUBLIC_LEGAL_PATHS } from '../src/server/lib/legalPaths';
import { spaFallbackShouldDefer } from '../src/server/lib/spaFallback';
import { LEGAL_DOCS, legalDocById } from '../src/content/legal';
import { LEGAL_META } from '../src/content/legal/meta';

describe('the refund policy has an address of its own', () => {
  it('/refund is a real server-rendered page, not the SPA shell', () => {
    expect(PUBLIC_LEGAL_ROUTES['/refund']).toBe('legal_refund');
    // THE ONE THAT FAILS SILENTLY IN PRODUCTION. A path missing from the fallback list is answered
    // with index.html and a 200 — alive to a human, empty to the checker this page exists for.
    expect(spaFallbackShouldDefer('/refund')).toBe(true);
    expect(ALL_PUBLIC_LEGAL_PATHS).toContain('/refund');
  });

  it('the spellings a form or a customer actually types all land on it', () => {
    for (const alias of ['/refund-policy', '/refunds', '/cancellation-policy', '/return-policy']) {
      expect(LEGAL_PATH_ALIASES[alias], `${alias} is not an alias`).toBe('/refund');
      expect(spaFallbackShouldDefer(alias), `${alias} would be swallowed by the SPA catch-all`).toBe(true);
    }
  });

  it('the document behind that URL actually exists and is a document, not a stub', () => {
    const doc = legalDocById('legal_refund');
    expect(doc).toBeTruthy();
    expect(doc!.title).toMatch(/Refund/i);
    expect(doc!.body.length).toBeGreaterThan(4000);
  });
});

describe('it is findable, and it agrees with the Terms', () => {
  const terms = LEGAL_DOCS.find((d) => d.id === 'legal_terms')!.body;
  const refund = LEGAL_DOCS.find((d) => d.id === 'legal_refund')!.body;

  it('the Terms link to it — an untiled document nobody links to is a document nobody finds', () => {
    // It carries no Settings tile by design (see meta.ts), so the link IS its route in from the app.
    expect(LEGAL_META.find((m) => m.id === 'legal_refund')!.settingsTile).toBe(false);
    expect(terms).toContain('(/refund)');
  });

  it('and it links back, so a reader can always reach the contract it restates', () => {
    expect(refund).toContain('(/terms)');
    expect(refund).toContain('(/grievance)');
  });

  it('🔒 THE WINDOW IS ONE NUMBER IN TWO DOCUMENTS — change it in both or not at all', () => {
    // A refund policy that says 7 days while the Terms say something else is not a smaller problem
    // than having no refund policy; it is a bigger one, because both are published.
    const window = /\*\*7 days\*\*|within \*\*7 days\*\*|within 7 days/;
    expect(refund).toMatch(window);
    expect(terms).toMatch(window);
  });

  it('the Terms point at the section refunds are really in (they said Section 5; refunds are in 4)', () => {
    // Found while writing this page: a published legal document sending a reader to the wrong
    // section, on the exact subject they were looking for. Section 5 is app ownership.
    expect(terms).not.toMatch(/Section 5 \(refunds\)/);
    expect(terms).toMatch(/Section 4 \(refunds\)/);
    // Derived rather than asserted by hand, so a future renumbering cannot quietly re-break it:
    // whichever section heading contains the Refunds bullet is the one that must be cited.
    const sections = [...terms.matchAll(/^## (\d+)\. (.+)$/gm)].map((m) => ({ n: Number(m[1]), at: m.index! }));
    const refundsAt = terms.indexOf('- **Refunds.**');
    expect(refundsAt).toBeGreaterThan(-1);
    const owning = [...sections].reverse().find((s) => s.at < refundsAt)!;
    expect(terms).toContain(`Section ${owning.n} (refunds)`);
  });

  it('never names an AI vendor — a legal page is a user-facing surface', () => {
    expect(refund).not.toMatch(/\b(anthropic|claude|openai|gpt-?[0-9]|gemini|vertex ai|glm|z\.ai|kimi|moonshot|grok|xai|bedrock|deepseek|sonnet|opus|haiku)\b/i);
  });
});
