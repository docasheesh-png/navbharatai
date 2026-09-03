import { describe, it, expect } from 'vitest';
import { ACCOUNT_DELETION, ACCOUNT_DELETION_TITLE } from '../src/content/legal/accountDeletion';
import { spaFallbackShouldDefer } from '../src/server/lib/spaFallback';
import { DELETE_ACCOUNT_PATH } from '../src/server/routes/legal';
import { USER_SCOPED_COLLECTIONS } from '../src/server/lib/DataRetentionManager';

// Google Play requires an app that lets people create an account to publish a deletion URL that
// (1) names the app, (2) prominently gives the STEPS, and (3) says what is deleted, what is kept and
// for how long. These tests hold the page to those three, and hold its claims to the code.

describe('the page satisfies what Play actually asks for', () => {
  it('names the app and the Android package, so it is identifiable as ours', () => {
    expect(ACCOUNT_DELETION_TITLE).toMatch(/NavBharatAI/);
    expect(ACCOUNT_DELETION).toMatch(/com\.navbharat\.ai/);
  });

  it('leads with the IN-APP route, which is the half Play requires in the product itself', () => {
    expect(ACCOUNT_DELETION).toMatch(/Danger zone/);
    expect(ACCOUNT_DELETION).toMatch(/\*\*Delete account\*\*/);
    expect(ACCOUNT_DELETION).toMatch(/type the word \*delete\*/i);
  });

  it('also gives a route for someone who cannot reach the app', () => {
    expect(ACCOUNT_DELETION).toMatch(/info@navbharatai\.com/);
    expect(ACCOUNT_DELETION).toMatch(/## Or ask us to do it/);
    expect(ACCOUNT_DELETION).toMatch(/Delete my account/);
  });

  it('says what is deleted, what is kept, and the timeline', () => {
    expect(ACCOUNT_DELETION).toMatch(/## What is deleted/);
    expect(ACCOUNT_DELETION).toMatch(/## What is kept/);
    expect(ACCOUNT_DELETION).toMatch(/\*\*within 30 days\*\*/);
  });

  it('is honest about the carve-out rather than promising a clean wipe', () => {
    // A page that says "everything is deleted" while tax records are retained is the kind of
    // overstatement people rely on and then discover is untrue.
    expect(ACCOUNT_DELETION).toMatch(/Payment, invoice and tax records/);
    expect(ACCOUNT_DELETION).toMatch(/backup/i);
  });

  it('does not promise to delete what is not ours to delete', () => {
    // Disconnecting GitHub removes OUR access; the user's own repositories are untouched.
    expect(ACCOUNT_DELETION).toMatch(/does \*\*not\*\* delete anything in your own GitHub account/);
  });

  it('states the token-balance consequence instead of letting someone find out afterwards', () => {
    expect(ACCOUNT_DELETION).toMatch(/not refundable on deletion/i);
  });
});

describe('the URL is actually served', () => {
  it('the SPA catch-all defers /delete-account to the real handler', () => {
    // Without this the route returns index.html with a 200 — a link that looks fine to a human and
    // fails every automated check Play runs against it.
    expect(DELETE_ACCOUNT_PATH).toBe('/delete-account');
    expect(spaFallbackShouldDefer(DELETE_ACCOUNT_PATH)).toBe(true);
    expect(spaFallbackShouldDefer('/delete-account/')).toBe(true);
  });
});

describe('the page and the deletion code do not drift apart', () => {
  it('everything the automated eraser wipes is described to the user in plain words', () => {
    // USER_SCOPED_COLLECTIONS is the verified registry DELETE /api/profile erases. If a collection is
    // added there, the user-facing description of "what is deleted" must grow with it — otherwise the
    // page silently understates what happens to someone's data.
    const described: Record<string, RegExp> = {
      users: /account record and profile/i,
      user_profiles: /account record and profile/i,
      user_sessions: /saved sessions and preferences/i,
      user_token_wallets: /wallet, token balance/i,
      user_costs: /usage records/i,
      user_build_history: /build history/i,
      chat_sessions: /chat history/i,
    };
    for (const { collection } of USER_SCOPED_COLLECTIONS) {
      const phrase = described[collection];
      expect(phrase, `deletion page must describe the "${collection}" data it erases`).toBeDefined();
      expect(ACCOUNT_DELETION).toMatch(phrase);
    }
  });
});
