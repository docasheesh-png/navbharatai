// WHO MAY DO WHAT IN APP MART (admin 2026-09-12).
//
// Verbatim: "remix sirf wahi user kar sakta hai, jisme 149₹ ya usse adhik ka plan liya hai, har koi
// nahi. app mart se app play koi bhi user kar sakta hai, signout wala bhi. par download ke liye sign
// in jaruri hai."
//
// Three rules, and the third one — PLAY STAYS OPEN — is the one most likely to be broken by accident
// later, because gating it would look like tightening security. It is not: an open player is the
// store's whole promise ("one click — others run your app instantly in their browser") and its only
// conversion loop. So it is pinned here as deliberately as the two gates are.
//
// These read the ROUTE SOURCE, like the other access tests in this repo: the rules are broken by
// ADDING or REMOVING a line, which exercising current behaviour would not catch.
//
// ⚠️ Comments are stripped before absence assertions — a file's own explanation necessarily quotes
// the thing it is refusing to do.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, 'navStore.ts'), 'utf8');

function handler(startsWith: string, endsBefore: string): string {
  const start = src.indexOf(startsWith);
  expect(start, `route not found: ${startsWith}`).toBeGreaterThan(-1);
  const end = src.indexOf(endsBefore, start + startsWith.length);
  expect(end, `end anchor not found after ${startsWith}`).toBeGreaterThan(start);
  return src.slice(start, end);
}

function code(text: string): string {
  return text
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');
}

const remixHandler = () => handler("app.post('/api/nav-store/web/app/:id/remix'", "app.get('/api/nav-store/web/purchases'");
const openHandler = () => handler("app.post('/api/nav-store/web/app/:id/open'", "app.get('/api/nav-store/web/apps'");
const downloadHandler = () => handler("app.get('/api/nav-store/download/:id'", "app.get('/api/nav-store/admin/queue'");
const ticketHandler = () => handler("app.post('/api/nav-store/download-ticket/:id'", "app.get('/api/nav-store/download/:id'");

describe('REMIX — only a plan holder may take someone else’s app', () => {
  it('runs the shared gate, not a second copy of the check', () => {
    const h = code(remixHandler());
    expect(h).toContain('remixGate(');
    expect(h).toContain('remixRefusal(');
  });

  it('feeds the gate the real facts — sign-in, free-list, ownership, purchase, plan', () => {
    const h = code(remixHandler());
    expect(h).toContain('isAgentV3FreeUser(');
    expect(h).toContain('probeHostingPlan(');
    expect(h).toContain('isOwnApp:');
    expect(h).toContain('alreadyPurchased:');
    expect(h).toContain('planKnown:');
    expect(h).toContain('planActive:');
  });

  it('refuses with the gate’s own status and body — no hand-written 402 beside it', () => {
    const h = code(remixHandler());
    expect(h).toContain('res.status(refusal.status).json(refusal.body)');
  });

  it('🔒 an app the caller ALREADY BOUGHT is still theirs — a plan gate may not take back a purchase', () => {
    // "buy once, take the code whenever you like" (admin 2026-08-16). The route must compute this
    // and hand it to the gate; the gate's own test proves it then allows.
    expect(code(remixHandler())).toContain('hasPurchased(');
  });

  it('asks "who is this?" ONCE per request — two verifications could disagree', () => {
    // The workspace-ownership check and the plan gate each used to verify the token themselves. A
    // token can expire between two calls, so one request must resolve one identity and reuse it.
    const calls = code(remixHandler()).match(/verifyFirebase(?:Identity|Token)\(req\)/g) ?? [];
    expect(calls.length).toBe(1);
  });
});

describe('PLAY — anyone may run an app, signed out included', () => {
  // 🔒 THIS IS A DELIBERATE OPENNESS, NOT AN OVERSIGHT. Do not "fix" it.
  const h = () => code(openHandler());

  it('never demands sign-in', () => {
    expect(h()).not.toContain('verifyFirebaseIdentity');
    expect(h()).not.toContain('verifyFirebaseToken');
  });

  it('never asks for a plan', () => {
    expect(h()).not.toContain('probeHostingPlan');
    expect(h()).not.toContain('remixGate');
    expect(h()).not.toContain('needsPlan');
  });

  it('still checks a PRIVATE app’s password — open to everyone is not open to anything', () => {
    expect(h()).toContain('verifyAppPassword(');
  });
});

describe('DOWNLOAD — sign in first, checked the only way a navigation allows', () => {
  it('the ticket is minted behind a real sign-in check', () => {
    const h = code(ticketHandler());
    expect(h).toContain('verifyFirebaseIdentity(req)');
    expect(h).toContain('signDownloadTicket(');
    expect(h).toContain("res.status(401)");
  });

  it('the ticket names the app, so one cannot be minted for an app that is not on the store', () => {
    const h = code(ticketHandler());
    expect(h).toContain('getApp(');
    expect(h).toContain("status !== 'approved'");
  });

  it('the file route verifies the ticket', () => {
    const h = code(downloadHandler());
    expect(h).toContain('downloadSignInRequired()');
    expect(h).toContain('verifyDownloadTicket(');
  });

  it('🔒 a refused download renders as a PAGE, not JSON — the browser opens this URL itself', () => {
    // The exact defect this route was already fixed for once (admin 2026-08-19: "apk download hi
    // nahi hoti"): a JSON body shown to a navigating browser is a line of raw code or nothing.
    const h = code(downloadHandler());
    expect(h).toContain('ticketRefusalMessage(');
    expect(h).toContain('fail(');
    expect(h).not.toContain('res.status(401).json');
    expect(h).not.toContain('res.status(403).json');
  });

  it('a missing ticket and a bad one get different statuses, because they are different situations', () => {
    expect(code(downloadHandler())).toContain("verdict === 'missing' ? 401 : 403");
  });

  it('the kill switch exists — every door in this codebase has a key', () => {
    expect(code(downloadHandler())).toContain('downloadSignInRequired()');
  });
});

describe('ONE entitlement, ONE implementation — the drift this module exists to kill', () => {
  // App Mart's remix had no gate at all while the Community Gallery's did, so the same sentence on
  // the same pricing page ("Remix any app in the gallery", on both hosting tiers) was true on one
  // screen and false on the other. Two surfaces sharing one module is what stops that returning.
  const gallerySrc = readFileSync(join(__dirname, 'gallery.ts'), 'utf8');

  it('the Community Gallery uses the shared gate', () => {
    expect(gallerySrc).toContain("from '../lib/remixPlanGate'");
    expect(gallerySrc).toContain('remixGate(');
    expect(gallerySrc).toContain('remixRefusal(');
  });

  it('neither surface writes its own refusal sentence any more', () => {
    // The words live in remixPlanGate.ts so the two pitches cannot diverge.
    for (const text of [gallerySrc, src]) {
      expect(text).not.toContain("Open Billing → Plans to start one, then remix.`,");
    }
  });

  it('the Gallery exempts a creator remixing their OWN published app', () => {
    expect(gallerySrc).toContain('who.uid === found.uid');
  });
});
