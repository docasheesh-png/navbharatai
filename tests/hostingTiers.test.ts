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
  HOSTING_TIERS, HOSTING_OVERAGE_INR_PER_GB, LEGACY_HOSTING_PLAN_ID, FREE_PUBLISHED_APPS,
  hostingAgreementTerms, isKnownPlanId, overageInr, purchasableTier, tierForPlanId, tierRank,
} from '../src/lib/hostingTiers';
import { appsToPauseOnLapse } from '../src/server/lib/hostingPlan';
import { publishedAppCap, publishedAppCapForTier } from '../src/server/lib/HostingQuota';

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

  it('🔒 admits the traffic meter is not live yet, instead of implying a limit nothing enforces', () => {
    // An agreement describing an enforcement we do not have would be the second absolute rule's
    // exact case. This line goes the day the meter covers a site — until then it must stand, and
    // this test is what makes removing it a deliberate act.
    for (const t of HOSTING_TIERS) {
      const text = hostingAgreementTerms(t).join(' ');
      expect(text).toContain('Traffic measurement is still being rolled out');
      expect(text).toContain('charged the plan price and nothing more');
    }
  });

  it('names no payment provider — the White-Label Law applies to plan terms too', () => {
    const all = HOSTING_TIERS.flatMap((t) => [...hostingAgreementTerms(t), ...t.includes, t.tagline]).join(' ');
    for (const vendor of ['Cashfree', 'Firebase', 'Google', 'Cloud Run', 'Cloudflare', 'Vercel', 'gateway']) {
      expect(all).not.toContain(vendor);
    }
  });
});

describe('the lapse demotion — which apps survive, and why', () => {
  const app = (id: string, updatedAt: number, status = 'active') => ({ workspaceId: id, updatedAt, status });

  it('under the free cap ⇒ nothing is paused', () => {
    expect(appsToPauseOnLapse([app('a', 1), app('b', 2)], 5)).toEqual([]);
    expect(appsToPauseOnLapse([], 5)).toEqual([]);
  });

  it('over the cap ⇒ the freshest survive, the stalest are paused', () => {
    const apps = [app('old', 1), app('mid', 2), app('new', 3)];
    expect(appsToPauseOnLapse(apps, 1)).toEqual(['mid', 'old']);
  });

  it('🔑 an app with a real custom domain keeps its free slot, however old it is', () => {
    // Somebody bought a domain and pointed it here: the strongest evidence we have that a site has
    // real visitors. Losing THAT one while a scratch app from yesterday survives would be the worst
    // possible guess, and "just take the first five" would make it silently.
    const apps = [app('ancient-shop', 1), app('scratch-1', 90), app('scratch-2', 80)];
    expect(appsToPauseOnLapse(apps, 1, ['ancient-shop'])).toEqual(['scratch-1', 'scratch-2']);
  });

  it('only LIVE apps are candidates — an unpublished or taken-down one holds no slot', () => {
    const apps = [app('a', 3), app('b', 2, 'unpublished'), app('c', 1, 'taken_down'), app('d', 4)];
    // Two live apps, cap of 1 ⇒ exactly one pause, and never the already-inactive ones.
    expect(appsToPauseOnLapse(apps, 1)).toEqual(['a']);
  });

  it('🔒 a cap of 0 pauses NOTHING — a misconfiguration must not black out a whole account', () => {
    const apps = [app('a', 1), app('b', 2)];
    expect(appsToPauseOnLapse(apps, 0)).toEqual([]);
    expect(appsToPauseOnLapse(apps, -3)).toEqual([]);
    expect(appsToPauseOnLapse(apps, NaN)).toEqual([]);
  });

  it('the free floor the demotion falls back to is never zero, and matches the server cap', () => {
    // The whole fairness of the design rests on this: a lapsed PAYER lands on exactly what a free
    // account gets. If these two ever drift, the agreement quotes one number and the sweep enforces
    // another — which is how a user ends up with fewer apps than they were promised.
    expect(FREE_PUBLISHED_APPS).toBeGreaterThan(0);
    expect(publishedAppCap()).toBe(FREE_PUBLISHED_APPS);
  });

  it('a plan grants MORE room than free, and never less however the env is set', () => {
    for (const t of HOSTING_TIERS) {
      expect(t.publishedApps).toBeGreaterThan(FREE_PUBLISHED_APPS);
      expect(publishedAppCapForTier(t)).toBe(t.publishedApps);
    }
    // No plan, or an unreadable one, is the free cap — never more.
    expect(publishedAppCapForTier(null)).toBe(publishedAppCap());
    expect(publishedAppCapForTier({ publishedApps: 0 })).toBe(publishedAppCap());
  });

  it('the agreement warns about the demotion BEFORE the user pays', () => {
    for (const t of HOSTING_TIERS) {
      const text = hostingAgreementTerms(t).join(' ');
      expect(text).toContain(`up to ${t.publishedApps} apps published`);
      expect(text).toContain(`free ${FREE_PUBLISHED_APPS} apps`);
      expect(text).toContain('PAUSED, never deleted');
      // The restore is described EXACTLY as it works — open the app, press Publish — because
      // republishing re-runs a real build and there is no one-tap Restore button. Promising less
      // friction than exists would be discovered just after the user paid to get their apps back.
      expect(text).toContain('open a paused app and press Publish');
      expect(text).not.toContain('one tap');
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
