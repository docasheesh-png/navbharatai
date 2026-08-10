/**
 * WHO OWNS A WORKSPACE — the one place that knows (audit finding #2, 2026-08-09).
 *
 * THE INVARIANT: every Pro v5 app lives at `agentv3-{uid}-{sessionId}`, and the uid embedded in that
 * id IS the authorization decision. Get it right and a user reaches only their own apps; get it wrong
 * — or forget it — and a caller reaches somebody else's (an IDOR).
 *
 * WHY THIS MODULE EXISTS: the audit found that string re-typed by hand at **nine** sites, plus two
 * routes carrying their own private `ownsWorkspace()`. No leak today — both copies were read and are
 * equally strict — but an invariant that must never be wrong should not depend on eleven authors
 * remembering to write the same template literal. The day a new route forgets it, the failure is
 * silent and it is a data breach. `identityPolicy.ts` anticipated exactly this ("later phases
 * converge them onto these primitives"); this is that convergence.
 *
 * DEPENDENCY-FREE ON PURPOSE. A Firestore store and an Express route both need these rules, so this
 * module imports nothing — no express, no firebase-admin. That is what lets the STORE layer share the
 * route layer's definition instead of re-deriving it.
 *
 * ⚠️ THREE POLICIES, NOT ONE — the differences are deliberate and each has a real reason. Picking the
 * wrong one is the mistake this file is trying to prevent, so read them before choosing:
 *
 *   1. `workspaceOwnershipOk`  — BUILD path. Accepts a claimed uid when no token verified, because a
 *      user whose token blips mid-build must not have their build hard-fail ("the app must never
 *      break"). Spoofable by design; never use it to gate a READ.
 *   2. `verifiedWorkspaceReadOk` — PRIVATE READS (build report, decision trace). Demands the VERIFIED
 *      uid, because the claimed fallback is spoofable: the uid is IN the workspace id, so anyone who
 *      learned `agentv3-victim-{sid}` could claim `userId=victim`. Reads can safely demand a token —
 *      the client re-fetches and retries. Anon workspaces stay reachable by their unguessable sid.
 *   3. `ownedByVerifiedUid` — STRICTEST. Verified uid AND no anon exemption. For actions that need a
 *      real, durable owner: attaching a custom domain, debugging an app. An anon workspace has no
 *      owner to attach anything to, so it is refused rather than shared.
 */

/** Every Pro v5 workspace id starts here. */
export const WORKSPACE_PREFIX = 'agentv3-';

/**
 * Anon (identity-degraded) workspaces. These carry no real owner to protect — they are scoped only by
 * their unguessable random sessionId (a capability, like a secret URL) — which is why two of the three
 * policies let them through and the strictest one does not.
 */
export const ANON_WORKSPACE_PREFIX = 'agentv3-anon-';

/**
 * A uid safe to embed in a workspace id, a Firestore document id and a sandbox path. Bounded and
 * character-restricted so it cannot contain a path separator, a wildcard, or the `-` grouping this
 * scheme relies on being unambiguous at the PREFIX position.
 */
export const WORKSPACE_UID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** The uid if it is usable as an owner, else null. Pure. */
export function safeWorkspaceUid(uid: string | null | undefined): string | null {
  return typeof uid === 'string' && WORKSPACE_UID_RE.test(uid) ? uid : null;
}

/**
 * The id prefix that contains exactly this user's workspaces — the ONE definition used by every
 * listing/range query. Returns null for an unusable uid, so a caller cannot accidentally build the
 * prefix `agentv3--` and range over somebody else's rows.
 */
export function workspacePrefixFor(uid: string | null | undefined): string | null {
  const safe = safeWorkspaceUid(uid);
  return safe ? `${WORKSPACE_PREFIX}${safe}-` : null;
}

/**
 * Build a workspace id from an owner and a session. Returns null for an unusable uid.
 *
 * ⚠️ The SESSION id is NOT validated here, deliberately: callers disagree on what a session may look
 * like (`identityPolicy.SESSION_ID_RE` is 6–64 chars, `workspaceEdit` allows 1–128, and the build
 * route falls back to a timestamp). Unifying them would silently tighten or loosen real validation,
 * which is a behaviour change and not this fix. Each caller keeps its own session rule.
 */
export function workspaceIdFor(uid: string | null | undefined, sessionId: string): string | null {
  const prefix = workspacePrefixFor(uid);
  return prefix ? `${prefix}${sessionId}` : null;
}

/** Is this string shaped like a Pro v5 workspace id at all? Pure. */
export function isWorkspaceId(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith(WORKSPACE_PREFIX) && v.length > WORKSPACE_PREFIX.length;
}

/**
 * The uid a workspace id claims as its owner, or null if the id is not shaped like one. This READS
 * the claim; it does not authorize anything — the caller still has to compare it with a verified
 * identity. Kept separate so "who does this say it belongs to?" (a report needs it) can never be
 * mistaken for "may this caller have it?".
 */
export function workspaceOwnerUid(workspaceId: string | null | undefined): string | null {
  if (!isWorkspaceId(workspaceId)) return null;
  const rest = workspaceId.slice(WORKSPACE_PREFIX.length);
  const dash = rest.indexOf('-');
  if (dash <= 0) return null;
  return safeWorkspaceUid(rest.slice(0, dash));
}

/**
 * POLICY 1 — the BUILD path. A verified token always wins; a claimed uid is accepted only as the
 * fallback that keeps a token-blipped user's own build alive. Anon workspaces pass (no owner to
 * protect). Never gate a private read with this — see the header.
 */
export function workspaceOwnershipOk(
  verifiedUid: string | null,
  claimedUid: string | null,
  workspaceId: string,
): boolean {
  if (!isWorkspaceId(workspaceId)) return false;
  if (workspaceId.startsWith(ANON_WORKSPACE_PREFIX)) return true;
  const uid = safeWorkspaceUid(verifiedUid ?? claimedUid) ?? 'anon';
  return workspaceId.startsWith(`${WORKSPACE_PREFIX}${uid}-`);
}

/**
 * POLICY 2 — PRIVATE READS. Verified uid required for a real workspace; an anon workspace stays
 * reachable by whoever holds its unguessable sid (the capability model that keeps a degraded
 * session's own report readable).
 */
export function verifiedWorkspaceReadOk(verifiedUid: string | null, workspaceId: string): boolean {
  if (!isWorkspaceId(workspaceId)) return false;
  if (workspaceId.startsWith(ANON_WORKSPACE_PREFIX)) return true;
  const prefix = workspacePrefixFor(verifiedUid);
  return !!prefix && workspaceId.startsWith(prefix);
}

/**
 * POLICY 3 — STRICTEST. Verified uid, and no anon exemption. For anything that needs a real, durable
 * owner (custom domains, app debugging): an anon workspace is refused because there is nobody to own
 * the result, not because it is untrusted.
 */
export function ownedByVerifiedUid(verifiedUid: string | null, workspaceId: unknown): workspaceId is string {
  if (!isWorkspaceId(workspaceId)) return false;
  const prefix = workspacePrefixFor(verifiedUid);
  return !!prefix && workspaceId.startsWith(prefix);
}
