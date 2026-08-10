// ── SECURITY MASTER PLAN, Phase 0 (admin-approved 2026-07-07) — THE identity policy ─────────────
//
// One tested module that states the platform's two-tier access law, so every later security fix
// (Phases 1-5) wires a route to a CLASS-level rule here instead of hand-rolling per-route checks
// that drift. This phase is a pure foundation: nothing imports it yet, no behavior changes.
//
// THE LAW (two tiers, no third):
//
//   TIER 1 — MONEY / QUOTA / BILLING / CROSS-USER DATA  →  REAL VERIFIED IDENTITY ONLY.
//     Anything that spends NavBharatAI's money (model calls, sandbox time), counts against a quota,
//     bills a user, or reads/writes data across users MUST resolve the caller from the VERIFIED
//     Firebase token. A claimed body/query userId is NEVER identity here — it is spoofable by
//     construction. No token → refuse (401), never "degrade and spend anyway".
//
//   TIER 2 — ANON CAPABILITY  →  ONLY the exact unguessable sessionId, NEVER enumeration.
//     Anonymous (identity-degraded) sessions keep working — Fix 26's "tab switch → sab wapas"
//     restore is sacred — but an anon artifact is reachable ONLY by presenting the full random
//     sessionId that names it (a capability, like an unguessable URL). Nothing may LIST anon
//     artifacts, and a claimed uid grants nothing.
//
// Existing single-purpose guards (resolveBuildIdentity, workspaceOwnershipOk, conversationAccess,
// candidateConversationIds in routes/agentv3.ts) already implement pieces of tier 2 — they stay;
// later phases converge them onto these primitives where they overlap.

import type { Request } from 'express';
import { verifyFirebaseIdentity } from './authMiddleware';

export interface VerifiedIdentity {
  uid: string;
  email: string | null;
}

/** A client-supplied session id must be a safe, bounded token — THE single definition (it becomes
 *  part of workspace ids, sandbox paths and Firestore doc ids). Mirrored client-side by
 *  v3SessionContinuity's id shape; routes/agentv3.ts uses this same rule. */
export const SESSION_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

/**
 * Anon (identity-degraded) workspaces live under this prefix — capability-scoped, never listed.
 * Re-exported from `workspaceIdentity`, which owns the workspace-id scheme (audit finding #2); kept
 * exported here so every existing importer of this module is unchanged.
 */
export { ANON_WORKSPACE_PREFIX } from './workspaceIdentity';
import { ANON_WORKSPACE_PREFIX } from './workspaceIdentity';

/**
 * Resolve the caller's REAL identity: the Firebase-token-verified uid/email, or null.
 * NEVER falls back to a claimed body/query userId — that is the whole point of Tier 1.
 *
 * Test seam: under VITEST there is no real Firebase, so a test may present an explicit
 * `x-test-verified-uid` header to simulate a verified caller. A claimed userId still counts for
 * NOTHING — tests must opt in to identity exactly like production callers present a token.
 */
export async function verifiedIdentity(req: Request): Promise<VerifiedIdentity | null> {
  if (process.env.VITEST) {
    const uid = req.headers['x-test-verified-uid'];
    if (typeof uid === 'string' && uid.length > 0) {
      const email = req.headers['x-test-verified-email'];
      return { uid, email: typeof email === 'string' && email.length > 0 ? email : null };
    }
    return null;
  }
  return verifyFirebaseIdentity(req);
}

export type MoneyGateResult =
  | { ok: true; uid: string; email: string | null }
  | { ok: false; status: 401; error: string };

/**
 * TIER 1 gate, pure: money/quota/billing/cross-user surfaces take a VERIFIED identity or refuse.
 * There is deliberately no "degrade to anon and proceed" branch here — an unidentified caller can
 * chat on free surfaces, but can never make the platform spend or cross a user boundary.
 */
export function moneyGate(verified: VerifiedIdentity | null): MoneyGateResult {
  if (!verified || !verified.uid) {
    return {
      ok: false,
      status: 401,
      error: 'Sign in required — this action is billed/quota-tracked and needs a verified account.',
    };
  }
  return { ok: true, uid: verified.uid, email: verified.email };
}

/** Convenience wrapper for routes: verify the request, then apply the Tier-1 gate. */
export async function requireVerifiedForMoney(req: Request): Promise<MoneyGateResult> {
  return moneyGate(await verifiedIdentity(req));
}

/**
 * TIER 2, pure: is this anon workspace reachable with the presented capability?
 * True ONLY when the workspace is anon-prefixed AND the caller presented the EXACT full sessionId
 * that names it (well-formed per SESSION_ID_RE). A claimed uid, a prefix, or an empty proof grant
 * nothing. Non-anon workspaces always return false here — they are uid-gated elsewhere
 * (workspaceOwnershipOk), never capability-gated.
 */
export function anonCapabilityOk(workspaceId: string, presentedSessionId: string | null | undefined): boolean {
  if (typeof workspaceId !== 'string' || !workspaceId.startsWith(ANON_WORKSPACE_PREFIX)) return false;
  const sid = workspaceId.slice(ANON_WORKSPACE_PREFIX.length);
  if (!sid || !SESSION_ID_RE.test(sid)) return false;
  return typeof presentedSessionId === 'string' && presentedSessionId === sid;
}

/**
 * TIER 2 corollary, pure: may this caller LIST/enumerate the given artifact in a collection
 * listing? Anon artifacts are NEVER enumerable (capability-only access); a real user's artifact
 * lists only for its verified owner. This is the class rule behind the Phase-3 enumeration fixes.
 */
export function listableBy(artifactOwnerUid: string | null | undefined, verifiedUid: string | null): boolean {
  if (!artifactOwnerUid || artifactOwnerUid === 'anon') return false; // capability-only, never listed
  return !!verifiedUid && artifactOwnerUid === verifiedUid;
}
