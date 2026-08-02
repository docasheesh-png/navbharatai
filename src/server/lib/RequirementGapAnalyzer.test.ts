import { describe, it, expect } from 'vitest';
import { analyzeRequirementGaps, renderRequirementGaps, shouldSurfaceRequirementGaps, buildRequirementGuidance } from './RequirementGapAnalyzer';

describe('analyzeRequirementGaps', () => {
  it('detects healthcare and flags likely-missing RBAC/audit/EMR for a bare prompt', () => {
    const g = analyzeRequirementGaps('Build a hospital management system');
    expect(g.domain).toBe('healthcare');
    expect(g.likelyMissing).toContain('role-based access (staff / doctor / admin)');
    expect(g.likelyMissing).toContain('audit log of record changes');
    expect(g.clarifyingQuestions.length).toBeGreaterThan(0);
    expect(g.clarifyingQuestions.length).toBeLessThanOrEqual(6); // never over-ask (the admin's rule)
  });

  it('marks a feature MENTIONED when the prompt already covers it', () => {
    const g = analyzeRequirementGaps('A hospital system with staff roles and an audit log of every change');
    expect(g.mentioned).toContain('role-based access (staff / doctor / admin)');
    expect(g.mentioned).toContain('audit log of record changes');
    expect(g.likelyMissing).not.toContain('role-based access (staff / doctor / admin)');
  });

  it('detects non-functional signals (scale, offline, security, i18n)', () => {
    const g = analyzeRequirementGaps('An offline-capable app for 100000 concurrent users with login, in Hindi');
    expect(g.nonFunctional.scale).toBe(true);
    expect(g.nonFunctional.offline).toBe(true);
    expect(g.nonFunctional.security).toBe(true);
    expect(g.nonFunctional.i18n).toBe(true);
  });

  it('falls back to general + generic features for an unknown prompt, and never throws', () => {
    const g = analyzeRequirementGaps('make me a thing');
    expect(g.domain).toBe('general');
    // @ts-expect-error — malformed input must not throw
    expect(() => analyzeRequirementGaps(null)).not.toThrow();
  });

  it('renders a readable block', () => {
    const out = renderRequirementGaps(analyzeRequirementGaps('Build an online store'));
    expect(out).toContain('Likely domain: ecommerce');
    expect(out).toMatch(/Questions to confirm|covers the usual/);
  });

  it('shouldSurfaceRequirementGaps is true for a real domain with gaps, false for a generic prompt', () => {
    // A bare healthcare prompt leaves most features implicit → worth surfacing in the build report.
    expect(shouldSurfaceRequirementGaps(analyzeRequirementGaps('build a hospital system'))).toBe(true);
    // No domain detected → general → nothing domain-specific to surface (keeps the report high-signal).
    expect(shouldSurfaceRequirementGaps(analyzeRequirementGaps('make me a thing'))).toBe(false);
  });

  it('detects the appended verticals (education / logistics / restaurant)', () => {
    expect(analyzeRequirementGaps('build an LMS for a coaching institute').domain).toBe('education');
    expect(analyzeRequirementGaps('a courier delivery tracking app with driver assignment').domain).toBe('logistics');
    expect(analyzeRequirementGaps('a restaurant POS with menu and KOT').domain).toBe('restaurant');
    // and they surface real gaps for the builder
    expect(buildRequirementGuidance(analyzeRequirementGaps('build a school management system'))).toContain('education');
    expect(analyzeRequirementGaps('a school management system').likelyMissing).toContain('assignments & grading');
  });

  it('best-score selection: a restaurant POS that mentions "orders" is restaurant, NOT ecommerce (deep-test 2026-07-21)', () => {
    // The real failing build: a restaurant management + billing system. It says "take an order (KOT)",
    // "orders history" and "billing", so first-match-wins resolved it to 'ecommerce' (ecommerce's \border\b
    // fired first) — and the build was handed ecommerce implicit features (cart/checkout/refunds) instead of
    // menu/KOT/GST. Best-feature-score selection must pick the more-specific 'restaurant'.
    const g = analyzeRequirementGaps(
      'Build a restaurant management & billing system: a table floor view, menu management with dishes and ' +
      'categories, take an order (KOT) for a table, generate a GST bill with CGST + SGST, an orders history ' +
      'page, and Owner vs Waiter roles.',
    );
    expect(g.domain).toBe('restaurant');
  });

  it('does NOT over-correct: a genuine online store still resolves to ecommerce', () => {
    const g = analyzeRequirementGaps(
      'An online store with a product catalog, shopping cart, checkout, payments and order tracking.',
    );
    expect(g.domain).toBe('ecommerce');
  });

  it('detects the 2026-07-21 verticals (fintech / real-estate / fitness / events / jobs)', () => {
    expect(analyzeRequirementGaps('a mobile wallet app with UPI and KYC').domain).toBe('fintech');
    expect(analyzeRequirementGaps('a real estate property listing portal').domain).toBe('real-estate');
    expect(analyzeRequirementGaps('a gym membership and workout tracking app').domain).toBe('fitness');
    expect(analyzeRequirementGaps('an app to manage a tech conference').domain).toBe('events');
    expect(analyzeRequirementGaps('a recruitment platform for hiring candidates').domain).toBe('jobs');
    // and they surface real, domain-specific gaps for the builder
    expect(analyzeRequirementGaps('a neobank wallet').likelyMissing).toContain('KYC / identity verification');
    expect(analyzeRequirementGaps('a property portal').likelyMissing).toContain('mortgage / EMI calculator');
    expect(buildRequirementGuidance(analyzeRequirementGaps('a gym app'))).toContain('fitness');
  });

  it('appended domains never change an existing classification (first match wins)', () => {
    // These matched a prior domain BEFORE the append and must still match the same one.
    expect(analyzeRequirementGaps('Build a hospital management system').domain).toBe('healthcare');
    expect(analyzeRequirementGaps('an online store with a cart and checkout').domain).toBe('ecommerce');
    expect(analyzeRequirementGaps('a booking app for salon slots').domain).toBe('booking');
    // "rent" and "ticket" still resolve to booking (owned it before real-estate/events were appended).
    expect(analyzeRequirementGaps('an app to rent equipment by the hour').domain).toBe('booking');
    expect(analyzeRequirementGaps('a ticket reservation app').domain).toBe('booking');
  });

  it('classifies a CRM / sales-pipeline prompt as crm — not social (autopsy buildId a4be5a05)', () => {
    // The EXACT reported prompt. It used to resolve to 'social' because "contact profiles" fired social's
    // `profile` keyword and no CRM domain existed → the build got realtime-feed/moderation/media-upload
    // implicit features instead of CRM ones.
    const g = analyzeRequirementGaps(
      'Build a CRM to manage contacts and a sales pipeline: kanban deal stages (lead → qualified → won/lost), ' +
        'contact profiles with activity history, notes and tasks, and a dashboard of pipeline value. Include search and filters.',
    );
    expect(g.domain).toBe('crm');
    // it must NOT hand this build social-only implicit features
    expect(g.likelyMissing).not.toContain('realtime feed / updates');
    expect(g.likelyMissing).not.toContain('media upload');
    // the CRM essentials the prompt already covers are recognized as MENTIONED (not asked about)
    expect(g.mentioned).toContain('sales pipeline with deal stages (kanban: lead → qualified → won/lost)');
    expect(g.mentioned).toContain('contact / lead management (profiles, company, activity history)');
  });

  it('a bare "build a CRM" surfaces CRM implicit features and never over-asks', () => {
    const g = analyzeRequirementGaps('Build a CRM');
    expect(g.domain).toBe('crm');
    expect(g.likelyMissing).toContain('sales pipeline with deal stages (kanban: lead → qualified → won/lost)');
    expect(g.clarifyingQuestions.length).toBeLessThanOrEqual(6);
  });

  it('a genuine social prompt still classifies as social (CRM domain did not steal it)', () => {
    expect(analyzeRequirementGaps('a social app with a feed, posts, likes, comments and friends').domain).toBe('social');
  });

  it('buildRequirementGuidance produces INCLUDE guidance for a domain gap, empty for a generic prompt', () => {
    const g = buildRequirementGuidance(analyzeRequirementGaps('build a hospital system'));
    expect(g).toContain('REQUIREMENT AWARENESS');
    expect(g).toContain('healthcare');
    expect(g).toContain('INCLUDE them by default');
    expect(g).toContain('role-based access (staff / doctor / admin)');
    // friction-free: it instructs to build, never to ask
    expect(g).toContain('skip it silently rather than asking');
    // caps at 6 features so the guidance never bloats the prompt
    expect((g.match(/^- /gm) || []).length).toBeLessThanOrEqual(6);
    // a generic prompt gets NO guidance (build path stays exactly as today)
    expect(buildRequirementGuidance(analyzeRequirementGaps('make me a thing'))).toBe('');
  });
});

// M7-S7.1 — India moat: India-first defaults (₹ / UPI / GST / Hindi / Aadhaar) whenever the market is
// clearly Indian, so a generated app ships Indian rails by default, not a US-centric $/Stripe/English one.
describe('India-first requirement guidance (M7-S7.1)', () => {
  it('detects the Indian market from real signals', () => {
    for (const p of ['a shop billing app with GST in ₹', 'accept payments via UPI', 'a hospital in Mumbai with Hindi UI', 'lending app with Aadhaar KYC', 'price in lakh and crore']) {
      expect(analyzeRequirementGaps(p).india, p).toBe(true);
    }
  });
  it('does NOT flag a clearly non-India prompt', () => {
    expect(analyzeRequirementGaps('a US SaaS billed in dollars via Stripe').india).toBe(false);
    expect(analyzeRequirementGaps('a simple todo app').india).toBe(false);
  });
  it('emits the INDIA-FIRST block (₹ / UPI) for an India prompt — even a generic-domain one', () => {
    const g = buildRequirementGuidance(analyzeRequirementGaps('a simple billing tool for a Bharat kirana store in ₹'));
    expect(g).toContain('INDIA-FIRST');
    expect(g).toContain('₹');
    expect(g).toMatch(/UPI/);
  });
  it('adds GST for a commerce domain and Aadhaar for fintech', () => {
    expect(buildRequirementGuidance(analyzeRequirementGaps('a restaurant POS with GST billing in ₹'))).toMatch(/GST-compliant invoice/);
    expect(buildRequirementGuidance(analyzeRequirementGaps('a UPI wallet with Aadhaar KYC'))).toMatch(/Aadhaar \/ PAN-based KYC/);
  });
  it('a non-India generic prompt still gets NO guidance (backward-safe)', () => {
    expect(buildRequirementGuidance(analyzeRequirementGaps('make me a thing'))).toBe('');
  });
});
