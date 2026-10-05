// WHAT A CALLER WITH NO VERIFIED ACCOUNT MAY USE — one table, read by every AI route (Q-622, 2026-10-05).
//
// THE HOLE THIS CLOSES. The question "which model chain does an anonymous caller get?" was answered
// separately in each gate, and the answers drifted. With `PROFESSIONAL_FREE_QUOTA=off`, the shared
// Professionals / Doctor AI gate handed a caller with NO account `tier: 'paid'` — the full chain, Claude
// included — and nothing was charged, because there was no wallet to charge (passGate.ts, forensic audit
// 2026-10-04). The Other-AI tool gate returned the same `'paid'` for an anonymous caller while its flag was
// off; no route read that tier yet, so it was a hole waiting for its first reader rather than a live one.
// Neither gate was wrong about signed-in users. Both were wrong about the same class of caller, because
// "anonymous" was a branch each gate wrote for itself.
//
// THE RULE, enforced by TYPE and by test:
//   • an anonymous caller is NEVER on the `paid` tier — `AnonymousTier` excludes it, and `CallerTier` ties a
//     tier to the identity it was resolved for, so `{ uid: null, tier: 'paid' }` does not typecheck;
//   • what an anonymous caller may use is decided HERE, per surface, and nowhere else;
//   • a surface that is not in this table is a sign-in surface (fail-closed).
//
// WHAT "free" MEANS FOR A GUEST, honestly. The free universe is Claude-free and never runs the premium
// rungs (ROUTING_AND_BILLING.md), but it is not all ₹0: past its zero-cost leader it falls back to cheap,
// metered rungs, held under the admin's free-chat price ceiling (`freeTierCostCeiling.ts`). A guest's use
// of those is the admin's own decision (2026-09-27: ten AI messages a day without an account, "sabhi mila
// kar") and it is BOUNDED by `guestDailyQuota.ts` — per device, with a per-address backstop — on every
// guest surface. This table does not widen that, and it does not quietly take it away either: removing the
// metered fallbacks from guests would leave the admin's ten free messages resting on one zero-cost rung.
//
// The refusal is the existing one (`anonymousAiRefusal`), so every sign-in prompt reads the same.

import { anonymousAiRefusal } from './costlyAiAccess';

/** The two model universes a route can run a turn on. `paid` includes the premium rungs. */
export type ModelTier = 'free' | 'paid';

/** The only tiers an anonymous caller can ever be given. */
export type AnonymousTier = Exclude<ModelTier, 'paid'>;

/**
 * A tier bound to WHO it was resolved for. A signed-in caller may be on either tier; an anonymous one
 * (`uid: null`) only on an `AnonymousTier`. Gates return this shape, so a gate that hands an anonymous
 * caller `paid` is a compile error in the server typecheck, not a review comment.
 */
export type CallerTier =
  | { uid: string; tier: ModelTier }
  | { uid: null; tier: AnonymousTier };

/**
 * How an anonymous caller is treated on one surface.
 *  • `guest`        — allowed on the free universe, bounded by the shared guest daily allowance
 *                     (`guestDailyQuota`) on every route of the surface. A guest surface's routes MUST
 *                     carry that middleware; the census test checks it.
 *  • `owner-billed` — the caller is a visitor of a user's published app. The app's OWNER pays from their
 *                     own wallet, inside the per-app and per-visitor ₹ caps (`appAiGateway.ts`).
 *  • `sign-in`      — refused with the shared sign-in prompt, naming `noun`.
 */
export type AnonymousCapability =
  | { access: 'guest'; tier: AnonymousTier; routes: readonly string[] }
  | { access: 'owner-billed'; tier: AnonymousTier; routes: readonly string[] }
  | { access: 'sign-in'; noun: string; routes: readonly string[] };

/**
 * THE TABLE. Every AI surface a caller without an account can reach, and what it gets there.
 *
 * `routes` are the Express paths that serve the surface. They are what the census test
 * (`tests/anAnonymousCallerNeverRunsOnPaidRungs.test.ts`) uses to prove the routes and this table agree.
 * A surface with no route of its own (picture editing happens inside the free chat) lists none.
 *
 * Guest surface names are the ones `guestDailyQuota` already reported in its refusal body, unchanged.
 */
export const ANONYMOUS_CAPABILITIES = {
  // ── Guest allowance: the free universe, ten messages a day across ALL of these together ──────────
  chat: { access: 'guest', tier: 'free', routes: ['/api/chat/navbharat', '/api/chat/navbharatai'] },
  'repo-analyst': { access: 'guest', tier: 'free', routes: ['/api/repo-analyst/chat', '/api/repo-analyst/generate'] },
  'app-review': { access: 'guest', tier: 'free', routes: ['/api/app-review/review'] },
  'security-scan': { access: 'guest', tier: 'free', routes: ['/api/security/scan'] },
  debug: { access: 'guest', tier: 'free', routes: ['/api/debug'] },
  design: { access: 'guest', tier: 'free', routes: ['/api/design/suggest', '/api/design/palette'] },
  'app-debug': { access: 'guest', tier: 'free', routes: ['/api/app-debug/run', '/api/app-debug/investigate'] },

  // ── A visitor of a published app: the app's owner pays, inside the owner's caps ─────────────────────
  'app-assistant': { access: 'owner-billed', tier: 'free', routes: ['/api/app-ai/ask', '/api/app-ai/image'] },

  // ── Sign-in from the first message ───────────────────────────────────────────────────────────────
  professionals: { access: 'sign-in', noun: 'the Professionals', routes: ['/api/professional/:id/chat'] },
  'professional-exam': { access: 'sign-in', noun: 'Exam mode', routes: ['/api/professional/:id/exam'] },
  'doctor-ai': { access: 'sign-in', noun: 'Doctor AI', routes: ['/api/sda-chat'] },
  'image-generation': { access: 'sign-in', noun: 'image generation', routes: ['/api/image/generate'] },
  'image-download': { access: 'sign-in', noun: 'image download', routes: ['/api/image/relay'] },
  'prompt-improvement': { access: 'sign-in', noun: 'prompt improvement', routes: ['/api/image/enhance-prompt'] },
  'picture-editing': { access: 'sign-in', noun: 'picture editing', routes: [] },
  'screenshot-to-code': { access: 'sign-in', noun: 'screenshot to code', routes: ['/api/screenshot/to-prompt'] },
  'website-to-app': { access: 'sign-in', noun: 'Website → App', routes: ['/api/site-import/to-prompt'] },
  'app-builder': { access: 'sign-in', noun: 'NavBharatAI Pro', routes: ['/api/agentv3/chat'] },
} as const satisfies Record<string, AnonymousCapability>;

export type AiSurface = keyof typeof ANONYMOUS_CAPABILITIES;

/** The surfaces that carry the guest allowance — the only names `guestDailyQuota` accepts. */
export type GuestSurface = {
  [K in AiSurface]: (typeof ANONYMOUS_CAPABILITIES)[K]['access'] extends 'guest' ? K : never;
}[AiSurface];

/** The surfaces the shared Professionals / Doctor AI gate serves. */
export type ProfessionalSurface = 'professionals' | 'doctor-ai';

/** The block shape every gate already returns, so a refusal from here passes straight through. */
export interface AnonymousRefusal {
  allow: false;
  status: number;
  body: Record<string, unknown>;
}

export type AnonymousResolution = { allow: true; uid: null; tier: AnonymousTier } | AnonymousRefusal;

/** PURE: the capability of one surface, or `undefined` for a name that is not in the table. */
export function anonymousCapabilityFor(surface: string): AnonymousCapability | undefined {
  return Object.prototype.hasOwnProperty.call(ANONYMOUS_CAPABILITIES, surface)
    ? (ANONYMOUS_CAPABILITIES as Record<string, AnonymousCapability>)[surface]
    : undefined;
}

/**
 * PURE — the tier an anonymous caller gets on `surface`, or the sign-in refusal. Every gate calls this
 * for a caller with no verified uid; it never consults an env flag, so no flag can widen it.
 *
 * An unknown surface is refused (fail-closed): a new AI route that forgot to declare itself here asks for
 * an account rather than serving strangers on whatever chain it happens to run.
 */
export function anonymousCallerTier(surface: AiSurface | string): AnonymousResolution {
  const cap = anonymousCapabilityFor(surface);
  if (cap && cap.access !== 'sign-in') return { allow: true, uid: null, tier: cap.tier };
  const refusal = anonymousAiRefusal(cap?.access === 'sign-in' ? cap.noun : 'this');
  return { allow: false, status: refusal.status, body: refusal.body };
}

