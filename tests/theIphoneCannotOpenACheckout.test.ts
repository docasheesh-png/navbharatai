/**
 * THE iPHONE CANNOT OPEN A CHECKOUT — Apple Guideline 3.1.1, made true by construction.
 *
 * 🔴 WHAT WAS ABOUT TO BE SUBMITTED (found 2026-09-20, guiding the admin through the App Store).
 * `purchaseRail` answered `'web-gateway'` on iOS — not by decision but by fall-through: Play Billing
 * does not exist there, so the last branch won. `BillingPanel` renders the Cashfree top-up on
 * `'web-gateway'`. So the iPhone app offered to sell wallet credit through an outside payment
 * gateway, which is the single most reliable App Store rejection there is, and every App Store build
 * is reviewed by a person.
 *
 * ⚠️ **THE STRATEGY WAS DECIDED LONG AGO AND NEVER BUILT.** `MOBILE_PUBLISHING.md` §5 says in so many
 * words: *"v1 strategy (already decided — in-app purchases hidden in v1): do NOT show a 'Buy credits'
 * flow inside the native app… Detect the app via `Capacitor.isNativePlatform()` and hide the buy
 * buttons."* A grep of every `isNativeApp()` call site returned ZERO purchase gates. A decision
 * written in a runbook and never implemented reads exactly like a decision that was implemented.
 *
 * ⚠️ That quotation is HISTORICAL — §5 was rewritten on 2026-09-21 to describe what this file
 * actually does, so grepping the runbook for those words now finds nothing. It was rewritten
 * because it did not merely go stale: it told the next reader to gate on `isNative` (which would
 * delete Android's working top-up) and to add "add credits on the web" copy (anti-steering, a second
 * rejection reason). This test is the lock; the runbook is no longer a competing instruction.
 *
 * 🔑 **AND IT IS DELIBERATELY NARROWER THAN THE RUNBOOK SAID.** Hiding on `isNative` would have
 * removed the working, revenue-earning top-up from ANDROID too — a fix that trades one problem for
 * another, which this repo's own core rule forbids. The gate is the PLATFORM, not the flag.
 *
 * Admin, choosing this over shipping StoreKit first: *"ham ios par buy ui chupa kar publish karwao"*.
 *
 * Each test fails if its fix is reverted — checked by reverting each one.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { purchaseRail, isApplePlatform, type StoreConfig } from '../src/lib/storePurchase';

const config = (over: Partial<StoreConfig> = {}): StoreConfig => ({
  enabled: true, apple: false, google: true,
  packs: [{ productId: 'nbai.tokens.99', priceInr: 119, creditInr: 99, label: '₹99' }],
  ...over,
});

const src = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8');

/**
 * Source with COMMENTS REMOVED — and this is not tidiness, the first draft failed on it.
 *
 * The anti-steering assertion below matched the code's own explanatory comment, which necessarily
 * quotes the forbidden wording ("do NOT add 'cheaper on the web' copy") in order to forbid it. A
 * test that cannot tell a comment from a rendered string would force that explanation to be deleted
 * to stay green — the same reason `oneWayBackAndEveryoneKnowsIt.test.ts` strips them.
 */
const code = (rel: string): string =>
  src(rel).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

describe('an Apple device may not buy inside the app', () => {
  it('🔴 iOS gets NO rail — never the web gateway it used to fall through to', () => {
    expect(purchaseRail({ isNative: true, platform: 'ios', config: config(), pluginReady: false })).toBe('none');
    // REVERSION GUARD: without the Apple branch this is 'web-gateway' — the Cashfree checkout, i.e.
    // the rejection. The whole bug is that 'web-gateway' looks like a perfectly reasonable answer.
    expect(purchaseRail({ isNative: true, platform: 'ios', config: config(), pluginReady: false })).not.toBe('web-gateway');
  });

  it('…and no configuration can talk it out of that', () => {
    // Even with the store fully configured and a plugin claiming to be ready, iOS still cannot buy:
    // the Apple branch is checked BEFORE every other rung, because on iOS there is no rail to fall to.
    for (const cfg of [config(), config({ apple: true }), config({ enabled: false }), null]) {
      for (const pluginReady of [true, false]) {
        expect(purchaseRail({ isNative: true, platform: 'ios', config: cfg, pluginReady })).toBe('none');
      }
    }
  });

  it('the platform match is exact, and case/spacing do not defeat it', () => {
    for (const p of ['ios', 'iOS', 'IOS', ' ios ']) expect(isApplePlatform(p), p).toBe(true);
  });

  it('⚠️ anything NOT Apple is unaffected — a wrong "yes" would cost a real user their top-up', () => {
    for (const p of ['android', 'web', '', null, undefined, 'windows', 'ipados']) {
      expect(isApplePlatform(p), String(p)).toBe(false);
    }
  });
});

describe('🔒 ANDROID AND WEB ARE BYTE-IDENTICAL TO BEFORE', () => {
  it('Android still buys, on exactly the rail it did', () => {
    expect(purchaseRail({ isNative: true, platform: 'android', config: config(), pluginReady: true })).toBe('play-billing');
    expect(purchaseRail({ isNative: true, platform: 'android', config: config(), pluginReady: false })).toBe('web-gateway');
    expect(purchaseRail({ isNative: true, platform: 'android', config: null, pluginReady: true })).toBe('web-gateway');
    expect(purchaseRail({ isNative: true, platform: 'android', config: config({ google: false }), pluginReady: true })).toBe('web-gateway');
  });

  it('the web still buys', () => {
    expect(purchaseRail({ isNative: false, platform: 'web', config: config(), pluginReady: true })).toBe('web-gateway');
  });

  it('a MISSING platform behaves exactly as it did before this existed', () => {
    // The safe direction: an unanswered platform is not Apple, so the worst a forgotten call site can
    // do is keep today's behaviour — never remove a working top-up from somebody who has one.
    expect(purchaseRail({ isNative: true, platform: undefined, config: config(), pluginReady: true })).toBe('play-billing');
    expect(purchaseRail({ isNative: true, platform: null, config: config(), pluginReady: false })).toBe('web-gateway');
  });
});

describe('the gate cannot be got round by finding another button', () => {
  it('🔑 the ORDER ITSELF is refused, not just the buttons hidden', () => {
    // Four separate screens can start a top-up, and gating each is a list the fifth is missing from.
    // REVERSION GUARD: delete the refusal in createBillingOrder and this fails.
    const hook = src('src/hooks/usePaymentEngine.ts');
    expect(hook).toMatch(/createBillingOrder\s*=\s*async[\s\S]{0,1400}?storeRail === 'none'/);
  });

  it('the hook answers the platform question — it does not leave it undefined', () => {
    const hook = src('src/hooks/usePaymentEngine.ts');
    expect(hook).toMatch(/platform:\s*nativePlatformName\(\)/);
  });

  it('🔒 EVERY purchaseRail call in the app passes a platform (tests are not typechecked)', () => {
    // `tsconfig.json` includes only `src/**`, so `tsc` cannot enforce the required field in tests —
    // and a call site that omits it silently reopens the rejection. This reads the source instead.
    const files = ['src/hooks/usePaymentEngine.ts'];
    for (const f of files) {
      const body = src(f);
      const calls = body.match(/purchaseRail\(\{[\s\S]*?\}\)/g) || [];
      expect(calls.length, `${f} should call purchaseRail`).toBeGreaterThan(0);
      for (const call of calls) expect(call, `${f}: ${call}`).toContain('platform:');
    }
  });
});

describe('the user is told the truth, and never steered outside', () => {
  it('a screen that cannot sell says so — it is not a hidden section or a dead button', () => {
    const panel = src('src/components/panels/BillingPanel.tsx');
    expect(panel).toContain("storeRail === 'none'");
    expect(panel).toMatch(/not available in this app/i);
  });

  it('🔴 ANTI-STEERING: the notice never sends the user to an outside purchase', () => {
    // Apple's rule (and CLAUDE.md's own Play note: "do NOT add 'cheaper on the web' copy to the app").
    // Stating a feature is unavailable is allowed; routing around the store is not.
    const panel = code('src/components/panels/BillingPanel.tsx');
    const notice = panel.slice(panel.indexOf("storeRail === 'none'"), panel.indexOf("storeRail === 'play-billing'"));
    expect(notice.length, 'the notice block must be found').toBeGreaterThan(20);
    expect(notice).not.toMatch(/navbharatai\.com|on the web|website|browser|cheaper/i);
  });

  it('the profile card stops naming an outside payment method on iOS', () => {
    const profile = src('src/components/profile/ProfilePage.tsx');
    expect(profile).toContain('purchasesBlocked');
    // The UPI/Card promise must be the NOT-blocked branch, never the blocked one.
    expect(profile).toMatch(/purchasesBlocked \? '[^']*' : 'Recharge via UPI \/ Card'/);
  });

  it('🔒 and it asks the SAME question the rail does, never a second rule', () => {
    const profile = src('src/components/profile/ProfilePage.tsx');
    expect(profile).toMatch(/isApplePlatform\(nativePlatformName\(\)\)/);
  });
});
