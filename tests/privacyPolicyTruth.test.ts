import { describe, it, expect } from 'vitest';
import { PRIVACY_POLICY } from '../src/content/legal/privacyPolicy';
import { pixelEventFor } from '../src/lib/metaPixel';
import { spaFallbackShouldDefer } from '../src/server/lib/spaFallback';
import { PUBLIC_LEGAL_ROUTES } from '../src/server/routes/legal';

// WHY THIS FILE EXISTS.
//
// On 2026-09-02 the Meta advertising pixel and the Android app-events SDK shipped, and the Privacy
// Policy — written three weeks earlier — still said, in three separate places, that NavBharatAI did
// none of it. Nothing failed. No test broke, no build went red, no reviewer objected: the policy was
// simply, quietly untrue, and would have stayed that way until somebody read it closely.
//
// Correcting the wording once is not the fix. The fix is making the NEXT drift impossible to ship
// silently, because the same thing recurs the moment anyone adds an event to the pixel's allowlist
// and does not think about the legal page. So these tests hold the published promises against the
// code that has to keep them.

/** Every internal event name the app actually emits (grep-verified against trackEvent call sites). */
const EMITTED_EVENTS = ['app_load', 'app_generated', 'feedback', 'message_sent', 'purchase', 'signup'];

describe('Privacy Policy — the three statements that became false', () => {
  it('no longer claims we never share data with advertisers', () => {
    expect(PRIVACY_POLICY).not.toContain('We never share your data with advertisers or data brokers.');
  });

  it('no longer claims we use no third-party advertising cookies', () => {
    expect(PRIVACY_POLICY).not.toContain('We do not use third-party advertising cookies.');
  });

  it('no longer claims flatly that we show no third-party advertising', () => {
    // The honest version distinguishes ads shown INSIDE the product (we show none) from advertising
    // NavBharatAI elsewhere and measuring it (we do).
    expect(PRIVACY_POLICY).not.toContain('we do not show third-party advertising;');
    expect(PRIVACY_POLICY).toContain('we do not show third-party advertising **inside** NavBharatAI');
  });
});

describe('Privacy Policy — it discloses the advertising measurement we actually built', () => {
  it('has a section naming Meta / Facebook and Instagram', () => {
    expect(PRIVACY_POLICY).toContain('### 3.1 Advertising measurement (Meta / Facebook and Instagram)');
  });

  it('states the consent precondition, which is what the code enforces', () => {
    expect(PRIVACY_POLICY).toMatch(/if and only if you accept the consent banner/i);
  });

  it('discloses the advertising ID that the Android SDK collects', () => {
    expect(PRIVACY_POLICY).toMatch(/advertising ID/i);
  });

  it('promises that chats, files and clinical data are never shared', () => {
    expect(PRIVACY_POLICY).toMatch(/the content of your chats or prompts/i);
    expect(PRIVACY_POLICY).toMatch(/anything from the Doctor AI \/ clinical surface/i);
  });

  it('keeps the clinical promise that is still TRUE — no advertising use of health data', () => {
    // Worth locking rather than assuming: the pixel's allowlist carries no clinical event, so this
    // sentence survived the update honestly and must keep surviving it.
    expect(PRIVACY_POLICY).toContain('It is never used for advertising, profiling, or model training.');
  });
});

describe('THE DRIFT GUARD — the pixel may only send what the policy discloses', () => {
  // The policy's Section 3.1 lists what reaches Meta. This asserts the CODE cannot exceed that list.
  const disclosed: Record<string, RegExp> = {
    signup: /that an account was created/i,
    purchase: /that a purchase completed/i,
    app_generated: /that an app was built/i,
  };

  it('every event the pixel forwards is described in the policy', () => {
    const forwarded = EMITTED_EVENTS.filter((e) => pixelEventFor(e) !== null);
    expect(forwarded.sort()).toEqual(Object.keys(disclosed).sort());
    for (const [event, phrase] of Object.entries(disclosed)) {
      expect(PRIVACY_POLICY, `policy must describe the "${event}" event`).toMatch(phrase);
    }
  });

  it('ordinary product telemetry is forwarded to Meta for none of these', () => {
    for (const e of ['app_load', 'message_sent', 'feedback']) {
      expect(pixelEventFor(e), `${e} must not reach an ad platform`).toBeNull();
    }
  });

  it('a purchase reports the REAL rupee amount the policy promises', () => {
    expect(pixelEventFor('purchase', { value: 499 })?.params).toEqual({ value: 499, currency: 'INR' });
    expect(PRIVACY_POLICY).toMatch(/the \*\*real amount in rupees\*\*/i);
  });
});

describe('The policy has a PUBLIC URL — the thing Meta and Play actually require', () => {
  it('serves /privacy and /terms from the server, not the app shell', () => {
    expect(Object.keys(PUBLIC_LEGAL_ROUTES).sort()).toEqual(['/privacy', '/terms']);
    expect(PUBLIC_LEGAL_ROUTES['/privacy']).toBe('legal_privacy');
  });

  it('the SPA catch-all DEFERS both, or they would silently return index.html', () => {
    // The exact failure this repo has already had twice (live preview, deployed PWA): a 200 with the
    // wrong page looks like a working link, and an automated policy checker would accept nothing.
    expect(spaFallbackShouldDefer('/privacy')).toBe(true);
    expect(spaFallbackShouldDefer('/terms')).toBe(true);
    expect(spaFallbackShouldDefer('/privacy/')).toBe(true);
  });

  it('still serves the SPA for ordinary app paths', () => {
    expect(spaFallbackShouldDefer('/')).toBe(false);
    expect(spaFallbackShouldDefer('/store')).toBe(false);
  });
});
