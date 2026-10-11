// WHO MAY READ A BUILD HISTORY — the authorization these routes never had (Q-780).
//
// 🔴 THE HOLE. `GET /api/build-history/:sessionId`, `GET /:sessionId/:versionId` (which returns the
// app's whole `files` map) and `POST /:sessionId/checkpoint` had NO authentication at all. The stated
// model, in `routes/build.ts` and again in `CodeVersioning.tsx`, was that "the sessionId is the
// unguessable capability".
//
// For a signed-in Pro user on the web it is not unguessable. `App.tsx` mints it as:
//
//     const id = `pro-${Date.now()}`;
//
// — a millisecond timestamp, then kept in localStorage for ever. The chain is short: that id goes to
// the build, the workspace is `agentv3-{uid}-{sessionId}`, and `restorePointKey` strips the prefix
// back off, so the history document id is the bare `pro-<ts>`. Guess the timestamp and you could read
// a stranger's source code, or write a version into their Time Machine.
//
// ⚠️ AND ANON WORKSPACES ARE A DELIBERATE EXCEPTION, not an oversight. `workspaceIdentity.ts` says it
// in its own words: an `agentv3-anon-…` workspace carries "no real owner to protect — they are scoped
// only by their unguessable random sessionId (a capability, like a secret URL)". A signed-out person
// has no token to present, so demanding one would delete a working feature for them. Those keep the
// capability model, UNCHANGED. What this module fixes is the case where an owner exists and was not
// being checked.
//
// The ownership probe is deliberately the CHEAPEST exact one: `countWorkspaceFiles` reads a single
// metadata document and never throws. It is injected so the rule is unit-testable without Firestore.

import { WORKSPACE_PREFIX, ANON_WORKSPACE_PREFIX, workspacePrefixFor, ownedByVerifiedUid } from './workspaceIdentity';

/** How many files a workspace has; 0 when it does not exist. `countWorkspaceFiles`'s shape. */
export type CountWorkspaceFiles = (workspaceId: string) => Promise<number>;

export type HistoryAccess =
  /** An `agentv3-anon-…` history: no owner exists, so the session id IS the capability (by design). */
  | { allowed: true; as: 'anon-capability'; workspaceId: string }
  /** The caller owns a workspace with this session id. */
  | { allowed: true; as: 'owner'; workspaceId: string }
  | { allowed: false; reason: 'no-session' | 'sign-in-required' | 'not-yours' };

/**
 * May `uid` touch `build_history/{sessionId}`?
 *
 * The three accepted shapes, and why each is exactly what the listing route produces:
 *  · `agentv3-anon-…`        — the documented capability case, allowed with or without a token.
 *  · a bare session id       — `/api/versioning/apps` hands the client `workspaceId` MINUS the user's
 *    own `agentv3-{uid}-` prefix, so the caller's workspace is that prefix plus this id. Probed.
 *  · a full `agentv3-{uid}-…` id — some callers pass the workspace id itself; accepted only when the
 *    prefix is the CALLER's (`ownedByVerifiedUid`) and that workspace exists.
 *
 * 🔒 Why the existence probe is the thing that matters, and `ownedByVerifiedUid` alone is not enough
 * for the bare-id case: the workspace id is DERIVED by prefixing the caller's own uid, so
 * `ownedByVerifiedUid` is true for any string they send. It proves nothing. Only "this user really has
 * an app with that session id" refuses a guessed `pro-<timestamp>`.
 */
export async function mayTouchBuildHistory(
  uid: string | null,
  sessionId: string,
  countFiles: CountWorkspaceFiles,
): Promise<HistoryAccess> {
  const sid = String(sessionId ?? '').trim();
  if (!sid) return { allowed: false, reason: 'no-session' };

  // An anon workspace has no owner to check. Unchanged by design.
  if (sid.startsWith(ANON_WORKSPACE_PREFIX)) {
    return { allowed: true, as: 'anon-capability', workspaceId: sid };
  }

  if (!uid) return { allowed: false, reason: 'sign-in-required' };

  // A full workspace id: it must be the caller's own prefix, and it must exist.
  if (sid.startsWith(WORKSPACE_PREFIX)) {
    if (!ownedByVerifiedUid(uid, sid)) return { allowed: false, reason: 'not-yours' };
    return (await countFiles(sid)) > 0
      ? { allowed: true, as: 'owner', workspaceId: sid }
      : { allowed: false, reason: 'not-yours' };
  }

  // A bare session id: the caller's workspace is their prefix plus it.
  const prefix = workspacePrefixFor(uid);
  if (!prefix) return { allowed: false, reason: 'sign-in-required' };
  const workspaceId = `${prefix}${sid}`;
  return (await countFiles(workspaceId)) > 0
    ? { allowed: true, as: 'owner', workspaceId }
    : { allowed: false, reason: 'not-yours' };
}

/** The HTTP answer for a refusal — 401 when a token would help, 403 when it would not. */
export function refusalStatus(reason: Exclude<HistoryAccess, { allowed: true }>['reason']): number {
  if (reason === 'no-session') return 400;
  return reason === 'sign-in-required' ? 401 : 403;
}

/**
 * What the user is told. It does NOT say whether the history exists: "not found" and "not yours" must
 * read the same from outside, or the refusal itself becomes an oracle for enumerating session ids.
 */
export function refusalMessage(reason: Exclude<HistoryAccess, { allowed: true }>['reason']): string {
  if (reason === 'no-session') return 'sessionId required';
  if (reason === 'sign-in-required') return 'Sign in to open your version history.';
  return 'This version history is not available.';
}
