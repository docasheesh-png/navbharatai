import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PRIVACY_POLICY } from '../src/content/legal/privacyPolicy';
import { pixelEventFor, pixelBootSequence } from '../src/lib/metaPixel';
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
  it('serves the compliance pages from the server, not the app shell', () => {
    // `/grievance` joined on 2026-09-12 for exactly the same reason as the other two: it is a URL a
    // regulator or a store reviewer opens, sometimes with a tool that does not run JavaScript.
    // `/dpa` and `/security` joined on 2026-09-14, when those two lost their Settings tiles — a tile
    // only serves somebody already signed in, and the people who want these are a business
    // customer's lawyer and a security researcher, neither of whom has an account.
    expect(Object.keys(PUBLIC_LEGAL_ROUTES).sort()).toEqual(['/dpa', '/grievance', '/privacy', '/security', '/terms']);
    expect(PUBLIC_LEGAL_ROUTES['/privacy']).toBe('legal_privacy');
    expect(PUBLIC_LEGAL_ROUTES['/grievance']).toBe('legal_grievance');
    expect(PUBLIC_LEGAL_ROUTES['/dpa']).toBe('legal_dpa');
    expect(PUBLIC_LEGAL_ROUTES['/security']).toBe('legal_security');
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

describe('THE "NEVER SHARED" PROMISE — enforced by code, not by a Meta dashboard', () => {
  // Section 3.1 promises that a user's name, email address and phone number never reach Meta. The
  // allowlist alone does NOT deliver that: Meta's Automatic Advanced Matching reads form fields on
  // the page and attaches hashed email/phone to every event, and it is a toggle in Events Manager —
  // frequently on by default — that needs no code from us to start working. A promise resting on a
  // switch we do not control is not a promise, so the pixel refuses it from the page side.
  const seq = pixelBootSequence('1234567890123456');

  it('the policy makes the promise', () => {
    expect(PRIVACY_POLICY).toMatch(/your name, email address or phone number/i);
  });

  it('and the boot sequence disables automatic matching BEFORE init, which is what keeps it', () => {
    const setIndex = seq.findIndex((c) => c[0] === 'set' && c[1] === 'autoConfig' && c[2] === false);
    const initIndex = seq.findIndex((c) => c[0] === 'init');
    expect(setIndex).toBeGreaterThanOrEqual(0);
    expect(initIndex).toBeGreaterThanOrEqual(0);
    expect(setIndex).toBeLessThan(initIndex);
    expect(seq[initIndex]).toContainEqual({ withAutoMatching: false });
  });
});

describe('No claim about which jurisdictions a government has restricted', () => {
  it('does not assert that Singapore is unrestricted — a fact that can change without us noticing', () => {
    expect(PRIVACY_POLICY).not.toMatch(/not a jurisdiction restricted by the Indian government/i);
  });

  it('states what we actually control instead', () => {
    expect(PRIVACY_POLICY).toMatch(/we transfer it only where permitted by applicable law/i);
  });
});

describe('Privacy Policy — it discloses the visitor analytics on published apps (ROADMAP §13, 1.1)', () => {
  // The beacon collects exactly three things (siteAnalytics.ts header). Each is named in the policy,
  // and the list is imported from the code rather than retyped — so adding a fourth field to the
  // beacon fails this test until the policy discloses it. The same guard that caught the pixel drift.
  it('names each collected field, from the code\'s own list', async () => {
    const { POLICY_PHRASES } = await import('../src/server/lib/siteAnalytics');
    for (const phrase of POLICY_PHRASES) expect(PRIVACY_POLICY).toContain(phrase);
  });

  it('promises what the beacon actually does: no cookie, nothing on the device, builder-only', () => {
    expect(PRIVACY_POLICY).toMatch(/sets no cookie and stores nothing on the visitor's device/);
    expect(PRIVACY_POLICY).toMatch(/shown only to you, the app's builder/);
    expect(PRIVACY_POLICY).toMatch(/kept for 30 days/);
  });

  it('🔒 the 30-day promise is KEPT, not just printed — something actually deletes the counts', async () => {
    // 🔴 THIS FILE ASSERTED THE SENTENCE AND NOT THE MECHANISM, and for `kept for 30 days` there WAS no
    // mechanism: `site_analytics` sat in neither `RETENTION_POLICIES` nor `RETAINED_INDEFINITELY`, and no
    // purge, TTL or sweep in the repo touched it — so the counts grew for ever while the published policy
    // stated a 30-day limit as fact. A guard that checks a promise is PRESENT cannot fail when the promise
    // stops being true; that is the whole reason this case exists beside the prose one above.
    const { RETENTION_POLICIES } = await import('../src/server/lib/DataRetentionManager');
    const { SITE_ANALYTICS_COLLECTION } = await import('../src/server/lib/siteAnalyticsStore');
    const policy = RETENTION_POLICIES.find((p) => p.collection === SITE_ANALYTICS_COLLECTION);
    expect(policy, `no retention policy deletes ${SITE_ANALYTICS_COLLECTION}`).toBeDefined();
    // The NUMBER is tied to the sentence, so changing either alone fails here.
    expect(policy?.ttlDays).toBe(30);
    expect(PRIVACY_POLICY).toMatch(/kept for 30 days/);
    // The field it deletes by must be one the writer actually sets.
    expect(policy?.timestampField).toBe('updatedAt');
    expect(policy?.timestampKind).toBe('epochMs');
  });

  it('🔒 and the Load board can SEE the collection — a hand-kept inventory is how this was missed', async () => {
    // `GROWING_COLLECTIONS` says "verified by reading each store on 2026-09-07"; the beacon shipped on
    // 2026-09-10. The storage warning cannot warn about a collection nobody added to its list, so the
    // omission was invisible from both directions at once.
    const admin = readFileSync(resolve(__dirname, '../src/server/routes/admin.ts'), 'utf8');
    const { SITE_ANALYTICS_COLLECTION } = await import('../src/server/lib/siteAnalyticsStore');
    const inventory = admin.slice(admin.indexOf('const GROWING_COLLECTIONS'));
    expect(inventory.slice(0, inventory.indexOf('];'))).toContain(`'${SITE_ANALYTICS_COLLECTION}'`);
  });

  it('🔒 the beacon keeps those promises in code, not only in prose', async () => {
    const { beaconHtml } = await import('../src/server/lib/siteAnalytics');
    const html = beaconHtml('nbai-0123456789abcdef0123', 'https://navbharatai.com');
    expect(html).not.toMatch(/cookie|localStorage|sessionStorage/i);
    expect(html).toContain('doNotTrack');
    expect(html).not.toContain('location.search');
  });
});
