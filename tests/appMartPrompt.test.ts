/**
 * App Mart is offered where it is EARNED (admin 2026-09-01).
 *
 * The publish sheet's four paths — NavBharatAI hosting, your own domain, the APK Builder and App Mart
 * — are siblings, so App Mart sat beside the hosting card as one more option a user had to notice on
 * their own. The admin's ask: *"koi user apni app publish on navbharatai kare, TABHI usko ek tick
 * dikhe — post in app mart"*. The moment someone has just published is the moment putting it in front
 * of people makes sense to them.
 *
 * ⚠️ WHAT WAS DELIBERATELY **NOT** BUILT, and why — recorded here because the ask had a second half.
 *
 * The admin also asked that App Mart contain ONLY apps published on NavBharatAI ("ham host kar rahe
 * hai"), expecting it to load faster. It would not, and it would cost real capacity, because the store
 * does not serve the hosted copy at all: `navStoreWeb.ts` publishes an IMMUTABLE SNAPSHOT that runs in
 * each viewer's OWN browser — "1 viewer or 10,000 cost us the same". Requiring a hosting publish first
 * would make every store app consume a Firebase Hosting channel, and channels are finite per site
 * (CLAUDE.md's scale plan §3, tracked by the Publish Capacity panel) — for a copy nobody ever reads.
 * The speed the admin wanted is already how it works.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = readFileSync(join(__dirname, '..', 'src/components/agentv3/HostingChooser.tsx'), 'utf8');
const STORE = readFileSync(join(__dirname, '..', 'src/server/lib/navStoreWeb.ts'), 'utf8');

/** The App Mart card, from its comment marker to the publish button. */
const CARD = SRC.slice(SRC.indexOf('Path 4 — Nav App Store'), SRC.indexOf('Publish to the store'));

describe('the prompt appears only once the app is genuinely live', () => {
  it('is gated on liveUrl — the durable deployment record, not a hopeful local flag', () => {
    // Same signal the Unpublish control trusts: set only for a genuinely live deployment, so this
    // cannot appear for an app that was never published or one already taken down.
    expect(CARD).toMatch(/\{liveUrl && \(/);
    expect(CARD).toMatch(/Your app is live on NavBharatAI/);
  });

  it('reads as a next step, not as a warning or a chore', () => {
    // Scoped to the PROMPT itself. The surrounding card legitimately contains words like "required"
    // in its icon/screenshot help, and asserting across the whole card would be testing the wrong text.
    const at = SRC.indexOf('{liveUrl && (');
    const prompt = SRC.slice(at, SRC.indexOf(')}', SRC.indexOf('</p>', at)));
    expect(prompt).toMatch(/so people can actually find it/i);
    expect(prompt).toMatch(/take it off any time/i);
    expect(prompt).not.toMatch(/error|failed|must|required/i);
  });

  it('the card is still usable WITHOUT a live URL — the prompt adds, it does not gate', () => {
    // App Mart never required a hosting publish and still must not: the store runs its own snapshot.
    // A user who only wants App Mart must not be forced through hosting to reach it.
    const publishBtn = SRC.slice(SRC.indexOf('void publishToStore()') - 400, SRC.indexOf('void publishToStore()') + 400);
    expect(publishBtn).not.toMatch(/liveUrl/);
  });
});

describe('listing stays a SEPARATE decision from publishing', () => {
  it('nothing auto-publishes to the store when an app goes live', () => {
    // Publishing your app and showing it to strangers are two different decisions — the same reason
    // the agent may no longer publish on its own (publishConsent.ts).
    const at = SRC.indexOf('{liveUrl && (');
    expect(SRC.slice(at, at + 800)).not.toMatch(/publishToStore\(\)/);
  });

  it('the store publish still needs a name the user typed', () => {
    expect(SRC).toMatch(/if \(!name\) \{ setStoreResult\(\{ ok: false, message: 'Give your app a name first\.' \}\); return; \}/);
  });
});

describe('why the second half of the ask was refused', () => {
  it('the store serves its OWN snapshot, not the hosted copy', () => {
    // This is the fact that makes "only hosted apps" costly and pointless rather than faster.
    expect(STORE).toMatch(/PUBLISH = SNAPSHOT/);
    expect(STORE).toMatch(/never the live\s*\n\/\/\s*workspace/);
  });

  it('and it costs nothing per viewer, which is the speed the admin wanted', () => {
    expect(STORE).toMatch(/1 viewer or 10,000 cost us the same/);
  });
});
