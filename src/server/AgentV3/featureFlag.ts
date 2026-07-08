// AgentV3 feature flag (strangler-fig, D1).
//
// Default OFF: the live app is never affected by v3.0 until explicitly enabled,
// and even then can be limited to an allowlist of users while the engine is
// under construction. This is the single gate that keeps v3.0 inert in
// production until it is proven (NAVBHARATAI_PRO_V3_DESIGN.md §6).

/** True when v3.0 is globally enabled via AGENTV3_ENABLED=true. */
export function isAgentV3GloballyEnabled(): boolean {
  return process.env.AGENTV3_ENABLED === 'true';
}

/** Parsed allowlist of userIds from AGENTV3_ALLOWLIST (comma-separated). */
export function agentV3Allowlist(): string[] {
  return (process.env.AGENTV3_ALLOWLIST || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Whether v3.0 is available for a given user. Enabled when the global flag is on
 * AND (the allowlist is empty → all logged-in users, OR the user matches an
 * allowlist entry). An entry matches either the Firebase uid OR the email
 * (case-insensitive) — so an admin can allowlist by the email they know rather
 * than hunting for a uid.
 */
export function isAgentV3Enabled(userId?: string | null, email?: string | null): boolean {
  if (!isAgentV3GloballyEnabled()) return false;
  const allow = agentV3Allowlist();
  if (allow.length === 0) return true;
  return matchesIdentityList(allow, userId, email);
}

/** Pure: does a uid OR (case-insensitive) email match any entry in a comma-parsed identity list? */
function matchesIdentityList(list: string[], userId?: string | null, email?: string | null): boolean {
  const id = (userId ?? '').trim();
  const mail = (email ?? '').trim().toLowerCase();
  return list.some((entry) => (id !== '' && entry === id) || (mail !== '' && entry.toLowerCase() === mail));
}

/**
 * FREE-LIST (paid-public plan, admin 2026-07-06). The verified accounts for whom v3.0 is FREE — the
 * admin/tester accounts. Everyone ELSE (once v3.0 is public) is a paying user, billed via the wallet.
 *
 * Source: `AGENTV3_FREE_LIST` (comma-separated uid/email). BACKWARD-COMPAT: when it is unset, the free
 * list DEFAULTS to the current `AGENTV3_ALLOWLIST` — i.e. today, exactly the allowlisted admins are the
 * free users, so this changes nothing until public billing is turned on and the two lists are set apart
 * (ACCESS = who may use v3.0; FREE = who uses it for ₹0).
 */
export function agentV3FreeList(): string[] {
  const raw = process.env.AGENTV3_FREE_LIST;
  const src = raw === undefined || raw.trim() === '' ? (process.env.AGENTV3_ALLOWLIST || '') : raw;
  return src.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Is this VERIFIED user on the free-list (admin/tester → v3.0 is free, no billing gate)? Match by uid
 * OR email (case-insensitive). MUST be called with the server-VERIFIED identity, never a client-claimed
 * one — a spoofed email could otherwise claim free access. Pure over the env-derived list.
 */
export function isAgentV3FreeUser(userId?: string | null, email?: string | null): boolean {
  return matchesIdentityList(agentV3FreeList(), userId, email);
}

/**
 * PAID-PUBLIC master switch (admin plan 2026-07-06). When ON, non-free-list users' v3.0 builds pass
 * through the affordability gate (wallet balance vs pre-flight estimate → proceed / economy / block).
 * Default OFF: absent/any-non-'true' value = today's exact behavior (no billing gate for anyone). This is
 * the single flag that keeps the whole money path inert until it is explicitly turned on.
 */
export function isAgentV3PaidPublicEnabled(): boolean {
  return process.env.AGENTV3_PAID_PUBLIC === 'true';
}

/**
 * SECURITY Phase 1.3 (admin-approved 2026-07-07) — must a v3.0 build be REFUSED for lack of a
 * billable identity? A build spends NavBharatAI's paid model budget, so it may run ONLY for:
 *   • a VERIFIED user (`verifiedUserId` present — billable / free-list-checkable), or
 *   • the Fix-26 graceful degrade of an ALLOWLISTED identity (no verified uid, but the claimed
 *     `email` matches the allowlist — a signed-in admin whose token briefly failed to verify, whom
 *     we must not hard-block: "the app must never break").
 * A genuinely anonymous caller (no verified uid AND no allowlist email match) is refused — this is
 * the "bill-or-refuse" rule, and it is FORWARD-SAFE: in the public / empty-allowlist future it stops
 * any drive-by anonymous caller from running unbounded FREE paid builds on the platform's account,
 * while today (non-empty allowlist) it changes nothing for real users. PURE + unit-tested.
 */
export function buildRequiresSignIn(verifiedUserId: string | null, email: string | null): boolean {
  if (verifiedUserId) return false;
  return !matchesIdentityList(agentV3Allowlist(), null, email);
}
