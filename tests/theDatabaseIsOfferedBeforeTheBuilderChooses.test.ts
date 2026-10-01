// THE DATABASE IS OFFERED BEFORE THE BUILDER DECIDES WHERE DATA LIVES (2026-09-30, the admin's
// "database aur payment verification", user's own Supabase). Autopsy a7aa447c: an event-booking app kept
// every booking in the visitor's own browser, so no file-based check ever saw a database need and the
// owner could never see a booking. The request, not the files, is what must be read — and early.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { sharedDataNeed, startOfferDecision, startOfferText, START_OFFER_WAIT_MS } from '../src/server/AgentV3/sharedDataNeed';

describe('what the request needs', () => {
  it('names the data other people must later see', () => {
    for (const [prompt, reason] of [
      ['Build an event booking app with Razorpay payment', 'bookings'],
      ['clinic appointment system for my doctor', 'bookings'],
      ['restaurant app to take orders online', 'orders'],
      ['school admission form with an admin panel', 'form submissions'],
      ['gym attendance tracker', 'records'],
      ['inventory management for my shop', 'records'],
      ['todo app with login', 'user accounts'],
      ['ek marketplace banao jahan log saman bechen', 'data shared between users'],
    ] as const) {
      const n = sharedDataNeed(prompt);
      expect(n.needed, prompt).toBe(true);
      expect(n.reasons, prompt).toContain(reason);
    }
  });

  it('stays silent for apps that keep nothing another person needs — precision first', () => {
    for (const prompt of [
      'a scientific calculator',
      'my portfolio website with testimonials',
      'tic tac toe game',
      'a todo list',
      'BMI calculator in order to check my health',
      'password generator',
      'landing page for my bakery',
    ]) {
      expect(sharedDataNeed(prompt), prompt).toEqual({ needed: false, reasons: [] });
    }
  });

  it('respects a request that says, in words, it has no backend', () => {
    expect(sharedDataNeed('booking page, static site, no backend').needed).toBe(false);
    expect(sharedDataNeed('orders list stored in localStorage only').needed).toBe(false);
    expect(sharedDataNeed('appointment tracker without a database').needed).toBe(false);
  });
});

describe('when to ask', () => {
  const need = sharedDataNeed('event booking app');
  const base = { hasUser: true, isEditMode: false, databaseConnected: false, need, supabaseGranted: true };

  it('asks only on a fresh build, with nothing connected, a real need, and a Supabase grant', () => {
    expect(startOfferDecision(base)).toEqual({ offer: true });
    expect(startOfferDecision({ ...base, isEditMode: true })).toEqual({ offer: false, why: 'edit' });
    expect(startOfferDecision({ ...base, databaseConnected: true })).toEqual({ offer: false, why: 'already-connected' });
    expect(startOfferDecision({ ...base, need: sharedDataNeed('a calculator') })).toEqual({ offer: false, why: 'not-needed' });
    expect(startOfferDecision({ ...base, supabaseGranted: false })).toEqual({ offer: false, why: 'no-supabase-grant' });
    expect(startOfferDecision({ ...base, hasUser: false })).toEqual({ offer: false, why: 'no-user' });
  });

  it('the question says what will be saved, whose account, and what Deny means', () => {
    const t = startOfferText(need);
    expect(t).toMatch(/saves bookings/);
    expect(t).toMatch(/YOUR OWN Supabase account/);
    expect(t).toMatch(/2 projects a free Supabase plan allows/);
    expect(t).toMatch(/Deny = .*kept on this device/);
  });

  it('a build never waits long for an unanswered question', () => {
    expect(START_OFFER_WAIT_MS).toBeLessThanOrEqual(2 * 60_000);
  });
});

describe('the wiring (order matters: the answer must land before the prompt is built)', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
  const offerAt = route.indexOf('const decision = startOfferDecision({');
  it('the offer runs after the vault loads and before the vault is handed to the app and the prompt', () => {
    expect(offerAt).toBeGreaterThan(0);
    expect(route.indexOf('vaultSecrets = await loadUserVaultSecrets(userId, workspaceId);')).toBeLessThan(offerAt);
    expect(offerAt).toBeLessThan(route.indexOf('dispatcher.setUserSecrets(appEnv);'));
    expect(offerAt).toBeLessThan(route.indexOf('const dbContext = userDatabaseContext(vaultSecrets);'));
  });
  it('an approved database is re-read from the vault, so the builder is told about it', () => {
    const block = route.slice(offerAt, offerAt + 4000);
    expect(block).toMatch(/provisionDatabaseForUser\(userId[\s\S]*vaultSecrets = await loadUserVaultSecrets\(userId, workspaceId\)/);
    expect(block).toMatch(/waitForUser\(requestId, START_OFFER_WAIT_MS\)/); // the one door that also listens to Stop (autopsy 1219c639)
  });
  it('the mid-build fallback never asks the same question a second time', () => {
    expect(route).toMatch(/if \(asked \|\| databaseOfferedAtStart\) return null;/);
  });
});
