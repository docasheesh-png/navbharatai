// AgentV3 — WHERE a project import lands, decided BEFORE any bytes move.
//
// ROOT CAUSE (admin report 2026-08-04, a 161.3 MB "1526mitrify.zip" that showed "Importing…" and then
// nothing): `handleZipProject` was the ONLY caller in the panel that passed `state.workspaceId`
// straight through. Everywhere else uses `expectedWorkspaceId()`, which falls back to the deterministic
// client-side id when a session has not built yet. On a FRESH v5.0 tab — exactly the reported state,
// Files (0) / History (0) / no build — `state.workspaceId` is still empty.
//
// The damage was not just "it failed": the workspace id is only used by the COMMIT call, which runs
// AFTER the whole archive has been transferred. So 161 MB uploaded over several minutes, and only then
// did the server correctly answer 403 "This workspace does not belong to you." The user paid the full
// upload cost for a failure that was decidable in the first millisecond.
//
// The class of bug is "an expensive transfer starts before its preconditions are checked". The server
// already got this right for the size/disk preflight in /api/zip-upload/begin — it refuses in one
// second rather than dying at 90%. This module gives the WORKSPACE precondition the same treatment,
// as one pure, tested decision instead of an inline expression at a single call site.

/** The shape the panel already has to hand: the live session id and its fallback. */
export interface ImportTargetInput {
  /** `state.workspaceId` — populated only once a build has attached to this session. */
  stateWorkspaceId?: string | null;
  /** `clientWorkspaceId(userId, sessionId)` — the deterministic id a fresh session already owns. */
  fallbackWorkspaceId?: string | null;
}

/**
 * The workspace an import should land in, or null when there is genuinely nowhere to put it yet.
 *
 * Prefers the live session's id and falls back to the deterministic client id — the same precedence
 * `expectedWorkspaceId()` uses, so the import can no longer disagree with the rest of the panel about
 * which workspace this session is.
 */
export function resolveImportWorkspaceId(input: ImportTargetInput): string | null {
  const live = (input.stateWorkspaceId || '').trim();
  if (live) return live;
  const fallback = (input.fallbackWorkspaceId || '').trim();
  return fallback || null;
}

/**
 * The honest, user-facing refusal shown INSTEAD of starting a transfer that cannot succeed. Names no
 * internal identifier — the user cannot act on a workspace id, only on what to do next.
 */
export function importTargetUnavailableMessage(): string {
  return 'I could not open a workspace for this import — please reload the page and try again. Nothing was uploaded, so your file is untouched.';
}
