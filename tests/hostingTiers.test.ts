/**
 * THE TWO HOSTING TIERS — and the gates that make their promises real.
 *
 * A plan card that prints "3 domains" or "20 GB" while nothing counts either is the second absolute
 * rule's exact case: built but not working. These tests pin the two directions that matter — that the
 * agreement text is GENERATED from the same numbers the server enforces, and that each entitlement
 * the card advertises has a gate behind it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  HOSTING_TIERS, HOSTING_OVERAGE_INR_PER_GB, LEGACY_HOSTING_PLAN_ID,
  hostingAgreementTerms, isKnownPlanId, overageInr, purchasableTier, tierForPlanId, tierRank,
} from '../src/lib/hostingTiers';

const src = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('the catalogue', () => {
  it('every tier is fully specified — no half-defined plan can be sold', () => {
    for (const t of HOSTING_TIERS) {
      expect(t.priceInr).toBeGreaterThan(0);
      expect(t.days).toBeGreaterThan(0);
      expect(t.domains).toBeGreaterThan(0);
      expect(t.includedTransferGb).toBeGreaterThan(0);
      expect(t.bundledCreditInr).toBeGreaterThanOrEqual(0);
      expect(t.includes.length).toBeGreaterThan(2);
      expect(t.tagline.length).toBeGreaterThan(0);
    }
  });

  it('more money buys strictly more of everything that is countable', () => {
    for (let i = 1; i < HOSTING_TIERS.length; i++) {
      const lo = HOSTING_TIERS[i - 1], hi = HOSTING_TIERS[i];
      expect(hi.priceInr).toBeGreaterThan(lo.priceInr);
      expect(hi.domains).toBeGreaterThanOrEqual(lo.domains);
      expect(hi.includedTransferGb).toBeGreaterThan(lo.includedTransferGb);
      expect(hi.bundledCreditInr).toBeGreaterThanOrEqual(lo.bundledCreditInr);
      expect(tierRank(hi.id)).toBeGreaterThan(tierRank(lo.id));
    }
  });

  it('the bundled credit never exceeds the price — a plan that pays for itself is not a plan', () => {
    for (const t of HOSTING_TIERS) expect(t.bundledCreditInr).toBeLessThan(t.priceInr);
  });

  it('the legacy plan is recognised but NOT purchasable', () => {
    expect(isKnownPlanId(LEGACY_HOSTING_PLAN_ID)).toBe(true);
    expect(tierForPlanId(LEGACY_HOSTING_PLAN_ID)?.id).toBe('starter');
    expect(purchasableTier(LEGACY_HOSTING_PLAN_ID)).toBeNull();
    expect(purchasableTier('nonsense')).toBeNull();
    expect(isKnownPlanId(null)).toBe(false);
  });
});

describe('the agreement the user ticks', () => {
  it('is generated from the tier, so it can never quote a limit the meter does not enforce', () => {
    for (const t of HOSTING_TIERS) {
      const text = hostingAgreementTerms(t).join(' ');
      expect(text).toContain(`₹${t.priceInr}`);
      expect(text).toContain(`${t.includedTransferGb} GB`);
      expect(text).toContain(`₹${HOSTING_OVERAGE_INR_PER_GB} per GB`);
      expect(text).toContain(`${t.days} days`);
      if (t.bundledCreditInr > 0) expect(text).toContain(`₹${t.bundledCreditInr}`);
    }
  });

  it('states plainly that going over does NOT switch the app off', () => {
    for (const t of HOSTING_TIERS) {
      expect(hostingAgreementTerms(t).join(' ')).toContain('KEEP RUNNING');
    }
  });

  it('names no payment provider — the White-Label Law applies to plan terms too', () => {
    const all = HOSTING_TIERS.flatMap((t) => [...hostingAgreementTerms(t), ...t.includes, t.tagline]).join(' ');
    for (const vendor of ['Cashfree', 'Firebase', 'Google', 'Cloud Run', 'Cloudflare', 'Vercel', 'gateway']) {
      expect(all).not.toContain(vendor);
    }
  });
});

describe('overage', () => {
  it('is zero at and below the allowance, and priced above our own cost per GB', () => {
    const starter = HOSTING_TIERS[0];
    expect(overageInr(starter.includedTransferGb, starter)).toBe(0);
    expect(overageInr(starter.includedTransferGb + 1, starter)).toBe(HOSTING_OVERAGE_INR_PER_GB);
    // Measured all-in cost is roughly ₹14/GB. An overage rate at or under cost turns a popular app
    // into a loss that grows with its success, so the rate must sit clearly above it.
    expect(HOSTING_OVERAGE_INR_PER_GB).toBeGreaterThan(14);
  });

  it('never returns a negative or non-finite charge', () => {
    for (const bad of [NaN, Infinity, -5, 0]) {
      expect(overageInr(bad as number, HOSTING_TIERS[0])).toBe(0);
    }
  });
});

describe('every advertised entitlement has a real gate behind it', () => {
  const gallery = src('src/server/routes/gallery.ts');
  const domains = src('src/server/routes/nbaiDomains.ts');
  const wallet = src('src/server/routes/wallet.ts');

  it('REMIX is refused without an active plan, and the refusal opens the purchase panel', () => {
    const remix = gallery.slice(gallery.indexOf("app.post('/api/gallery/:id/remix'"));
    expect(remix).toContain('probeHostingPlan');
    expect(remix).toContain('needsPlan: true');
    expect(remix).toContain('402');
    // Fails OPEN on an outage and exempts the admin/tester list — the same shape as the domain gate,
    // so the two cannot drift into treating an outage differently.
    expect(remix).toContain('plan.known && !plan.active');
    expect(remix).toContain('isAgentV3FreeUser');
  });

  it('the DOMAIN COUNT is counted against the tier, not merely printed on the card', () => {
    expect(domains).toContain('status.tier?.domains');
    expect(domains).toContain('domainLimit');
    expect(domains).toContain('firebaseDomainLinksForUser');
    // Suspended links do not occupy a slot the user is paying for.
    expect(domains).toContain('.filter((l) => !l.suspended)');
  });

  it('the PURCHASE route requires the tick server-side — a disabled button is not the enforcement', () => {
    const buy = wallet.slice(wallet.indexOf("hosting-plan/purchase"));
    expect(buy).toContain('agreedToTerms');
    expect(buy).toContain("req.body?.agreedToTerms === true");
    // A missing tick is the CALLER being wrong (400), not the server being unavailable (503).
    expect(buy).toContain("result.reason === 'agreement_required'");
  });
});

describe('the plan card', () => {
  const card = src('src/components/panels/HostingPlanCard.tsx');

  it('renders the agreement from the shared catalogue and blocks the button until it is ticked', () => {
    expect(card).toContain('hostingAgreementTerms(tier)');
    expect(card).toContain('disabled={busy || !agreed}');
    expect(card).toContain('I have read and accept these terms');
  });

  it('starts every purchase unticked — consent is per purchase, never sticky', () => {
    expect(card).toContain('setAgreed(false); // re-opening always starts unticked');
  });

  it('prefers the SERVER catalogue over the bundled one, so a price change needs no frontend build', () => {
    expect(card).toContain('Array.isArray(status.tiers) && status.tiers.length ? status.tiers');
  });
});
