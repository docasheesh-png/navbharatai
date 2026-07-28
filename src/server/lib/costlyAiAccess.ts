// "This call costs real money — who is paying for it?" (admin 2026-07-28)
//
// THE HOLE THIS CLOSES. NavBharatAI's spend controls all hang off the wallet: a build, an image or a
// strong-model answer draws down the caller's balance, and the free tier's lifetime gift is capped at
// ₹650. Every one of those controls needs an ACCOUNT. Two AI endpoints with a real per-call provider
// charge — image generation and screenshot→code — were serving ANONYMOUS callers at 10 an hour per IP,
// with no global anonymous ceiling behind it. An image costs roughly ₹3.3 to produce, so that is about
// ₹33 an hour per IP address, repeated across as many addresses as someone cares to use, billed to
// NavBharatAI, with no account to charge and no wallet to draw from. A rate limiter bounds the RATE;
// nothing bounded the SPEND.
//
// WHY REQUIRING SIGN-IN IS THE RIGHT FIX RATHER THAN A TIGHTER ANONYMOUS LIMIT. Any anonymous
// allowance is still uncapped in total, because the identity it is keyed on (an IP) is free to obtain
// in bulk. And it costs the funnel nothing: the ₹250 welcome credit only exists on an account, so a
// visitor who wants an AI image is being asked to do the thing that gives them free credit. This is a
// conversion step, not a toll gate.
//
// WHAT IS DELIBERATELY NOT GATED. Everything that costs nothing to serve stays open to anonymous
// visitors — the free flash-model chat, and every deterministic tool (Minifier, Diff, Versioning, APK
// Builder, CI/CD, SEO, the Nav App Store). Gating those would be friction with no saving behind it.

import type { Request } from 'express';
import { verifyFirebaseIdentity } from './authMiddleware';

export interface CostlyAiIdentity {
  ok: true;
  uid: string;
  email: string | null;
}

export interface CostlyAiRefusal {
  ok: false;
  status: number;
  body: Record<string, unknown>;
}

/**
 * PURE: the refusal an anonymous caller receives. Kept separate from the lookup so the wording is
 * unit-testable and identical on every route.
 *
 * It names what the visitor gets by signing in rather than what they are being denied — the credit is
 * the actual reason to do it, and an error that only says "no" invites a reload rather than a signup.
 */
export function anonymousAiRefusal(noun: string): CostlyAiRefusal {
  return {
    ok: false,
    status: 401,
    body: {
      error: `Please sign in to use ${noun}. New accounts start with free NavBharatAI credit.`,
      code: 'login_required',
      noun,
    },
  };
}

/**
 * Resolve the VERIFIED account behind a request to an AI endpoint that costs real money, or return a
 * ready-to-send refusal. Never trusts a client-supplied id — the uid comes from the Firebase token.
 */
export async function requireAccountForCostlyAi(
  req: Request,
  noun: string,
): Promise<CostlyAiIdentity | CostlyAiRefusal> {
  const identity = await verifyFirebaseIdentity(req);
  if (!identity?.uid) return anonymousAiRefusal(noun);
  return { ok: true, uid: identity.uid, email: identity.email ?? null };
}
