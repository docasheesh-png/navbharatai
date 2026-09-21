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
import { PUBLIC_LEGAL_ROUTES, LEGAL_PATH_ALIASES, ALL_PUBLIC_LEGAL_PATHS, CONTACT_PATH } from '../src/server/lib/legalPaths';
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

  it('🔒 BOTH DOCUMENTS STATE FINALITY, AND NEITHER OFFERS A CASH-REFUND WINDOW', () => {
    // REPLACES the 7-day-window agreement test (2026-09-21). That test locked a NUMBER that was a
    // session's assumption; this one locks the admin's actual ruling — *"agar user ne ek bar
    // navbharatai me payment kar diya to woh non refundable hai"*. A refund policy that says
    // "final" while the Terms still offer a 7-day window is not a smaller problem than having no
    // refund policy; it is a bigger one, because both are published and a reviewer reads both.
    expect(refund).toMatch(/non-refundable/i);
    expect(terms).toMatch(/non-refundable/i);

    // Neither document may promise a period inside which money comes back. This is the reversion
    // guard: restoring either half of the old wording fails here rather than shipping a
    // contradiction between two live pages.
    const cashWindow = /refundable within \*{0,2}\d+/i;
    expect(refund).not.toMatch(cashWindow);
    expect(terms).not.toMatch(cashWindow);

    // And the cross-reference that used to send a reader to "refunds ... the unused part" must not
    // survive the reversal — it was the third place the old promise lived, and the one easiest to
    // miss because it sits in a different section entirely.
    expect(terms).not.toMatch(/\(refunds\) applies to the unused part/i);
  });

  it('🔒 OUR OWN DEFECT IS REPAID IN CREDIT, NEVER IN CASH', () => {
    // Admin, verbatim: *"agar kisi user ke credit khatam ho gaye, navbharatai ki galti se to
    // credit/token wapas milenge? ₹ nahi."* Both documents must carry the remedy, because a
    // non-refundable policy with no stated remedy for OUR fault is the version an aggregator's
    // reviewer — and a customer — is right to object to.
    expect(refund).toMatch(/re-?credit|put that credit back/i);
    expect(terms).toMatch(/re-?credit/i);
    expect(refund).toMatch(/in credit, not in money/i);

    // The two things that are NOT refunds must stay covered: refusing a duplicate charge invites a
    // chargeback, which costs more than the disputed amount.
    expect(refund).toMatch(/duplicate/i);
    expect(refund).toMatch(/Charged twice/i);
  });

  it('🔒 A PAYMENT MADE BY MISTAKE IS FINAL — but an UNAUTHORISED one is not the same thing', () => {
    // Admin, 2026-09-21: *"koi kahe galti se payment ho gaya, woh bhi non refundable hai. xx
    // payment karna chah raha tha, xxx ho gaya, non refundble"*. This is the commonest refund
    // request there is, so the policy states it rather than leaving it to be argued case by case.
    expect(refund).toMatch(/payment made by mistake is final/i);
    expect(refund).toMatch(/check the amount on the payment screen/i);

    // 🔴 THE LINE THAT MUST NOT BE ERASED WITH IT. "I chose the wrong amount" is the customer's own
    // error and is covered above. "I never authorised this" is an unauthorised transaction — a
    // legal matter, not a change of mind — and collapsing the two would put a fraud victim and a
    // careless typist under one sentence. The policy keeps them apart and points at section 5.
    expect(refund).toMatch(/did not authorise at all/i);
    expect(refund).toMatch(/A payment you do not recognise/i);
  });

  it('🔒 THE PERMANENT-UNLOCK CLAIM IS THE JUSTIFICATION, so it may not quietly disappear', () => {
    // The policy tells a paying customer that one payment unlocks every build tier PERMANENTLY.
    // That is the consideration which makes finality fair, and it was verified against
    // powerUnlocked -> isFreeTierUser -> hasEverPaid (a lifetime field, never decremented) before
    // it was published. If the entitlement is ever made balance-dependent, this sentence becomes
    // false and the policy must change with it.
    expect(refund).toMatch(/all three build tiers/i);
    expect(refund).toMatch(/balance reaching zero|spend every last token/i);
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

// ── THE THIRD PAGE ──────────────────────────────────────────────────────────────────────────────
// The aggregator's whitelisting dialog names THREE: "Contact Us. Terms & Conditions. Refunds &
// Cancellations." Terms had a URL, the refund rules had no address, and Contact Us did not exist at
// all — verified by filename AND content search before it was written, not assumed.
import { contactDoc, CONTACT_EMAIL, CONTACT_TITLE } from '../src/content/legal/contact';

describe('Contact Us — the third page, and it may invent nothing', () => {
  it('/contact is a real server-rendered page with its own spellings', () => {
    expect(CONTACT_PATH).toBe('/contact');
    expect(ALL_PUBLIC_LEGAL_PATHS).toContain('/contact');
    expect(spaFallbackShouldDefer('/contact')).toBe(true);
    for (const alias of ['/contact-us', '/contactus', '/support', '/help']) {
      expect(LEGAL_PATH_ALIASES[alias], `${alias} is not an alias`).toBe('/contact');
      expect(spaFallbackShouldDefer(alias), `${alias} would be swallowed by the SPA catch-all`).toBe(true);
    }
  });

  it('gives a real address and routes the things people actually write about', () => {
    const c = contactDoc(null);
    expect(CONTACT_TITLE).toMatch(/Contact/i);
    expect(c).toContain(CONTACT_EMAIL);
    for (const topic of [/Refund/i, /Payment/i, /Grievance/i, /SECURITY/]) expect(c).toMatch(topic);
    expect(c).toMatch(/Indian Rupees|₹/);            // the aggregator also asks that pricing be INR
    expect(c).toContain('(/refund)');
    expect(c).toContain('(/terms)');
    expect(c).toContain('(/grievance)');
  });

  it('🔒 PRINTS NO POSTAL ADDRESS OR PHONE UNLESS ONE IS REALLY CONFIGURED', () => {
    // A contact page is exactly where a fabricated detail does the most damage. Unconfigured, the
    // page must omit the line — never show an empty label, and never invent a plausible one.
    const bare = contactDoc(null);
    expect(bare).not.toMatch(/Postal address/);
    expect(bare).not.toMatch(/Telephone:/);
    expect(bare).toMatch(/do not run a telephone support line/i);

    const configured = contactDoc({ name: 'A Person', email: 'x@y.z', phone: '+91 98765 43210', address: '1 Example Road\nNew Delhi 110001' });
    expect(configured).toMatch(/Postal address/);
    expect(configured).toContain('+91 98765 43210');
    expect(configured).toContain('1 Example Road');
  });

  it('quotes the grievance clocks from the constants, never re-typed', async () => {
    const { ACK_HOURS, RESOLVE_DAYS } = await import('../src/content/legal/grievance');
    const c = contactDoc(null);
    expect(c).toContain(`${ACK_HOURS} hours`);
    expect(c).toContain(`${RESOLVE_DAYS} days`);
  });
});
