// AgentV3 — sticky-session continuity (admin rule 2026-07-05, REPLACES the 2026-07-01 always-fresh rule).
//
// THE RULE: the v5.0 chat only ever changes/closes via exactly three deliberate actions —
//   1. ☰ → "+New chat"            (mints + sticks a new session)
//   2. ☰ → opening another chat    (sticks that chat's session)
//   3. the header tab-bar ✕ close  (CLEARS the sticky session → next open is fresh)
// Everything else — in-app tab switches, a reload, the phone being switched off, the browser being
// killed — must bring the user back to the SAME chat, text visible where they left it, and typing
// anything continues that project's engine.
//
// (The old 2026-07-01 "always start a brand-new chat on open" rule existed because a stuck chat once
// could not be cleared from the box at all; the admin retired it on 2026-07-05 — "ab sab theek hai,
// is rule ki need nahi hai".)
//
// This module is the ONE source of truth for the sticky-session storage key + clear, shared by the
// panel (which reads/writes it) and App's closeTab (which clears it on ✕) so they can never drift.

import { normalizeUid } from '../../lib/agentv3Workspace';

/** The per-user storage key holding the sticky (active) v5.0 session id. */
export function v3SessionStorageKey(userId: string | null | undefined): string {
  return `agentv3_session_${userId || 'anon'}`;
}

/** Read the sticky session id ('' when none). Checks localStorage then sessionStorage. Never throws. */
export function readStickySession(userId: string | null | undefined): string {
  const key = v3SessionStorageKey(userId);
  try { const v = localStorage.getItem(key); if (v) return v; } catch { /* storage unavailable */ }
  try { return sessionStorage.getItem(key) || ''; } catch { return ''; }
}

/** Clear the sticky session (the ✕ tab-close action) so the next v5.0 open starts fresh. Never throws. */
export function clearStickySession(userId: string | null | undefined): void {
  const key = v3SessionStorageKey(userId);
  try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
  try { sessionStorage.removeItem(key); } catch { /* storage unavailable */ }
}

/**
 * The client-side mirror of the server's `deriveWorkspaceId(userId, sessionId)` — including the
 * ANON identity ('anon' when signed out / auth not yet resolved), so continuity features can compute
 * the real workspace id in every identity state instead of silently going dead.
 *
 * ROOT CAUSE this kills (report 2026-07-07, "tab switch → sab gayab"): the panel derived the
 * workspace as `userId && sid ? \`agentv3-\${uid}-\${sid}\` : undefined` in several places — so for a
 * build that ran under the anon identity (workspaceId `agentv3-anon-<sid>`, proven by the admin's
 * diagnostics JSON), EVERY continuity organ (sticky chat restore, durable file rehydrate, checkpoint
 * timeline, history row, report download by workspace) was disabled client-side, while the durable
 * data sat safely on the server (the recovery import reported "42/46 unchanged since the last
 * build"). The panel looked wiped; nothing was actually lost. Returns '' only when there is no
 * session id at all. Pure.
 */
export function clientWorkspaceId(userId: string | null | undefined, sessionId: string | null | undefined): string {
  if (!sessionId) return '';
  return `agentv3-${normalizeUid(userId)}-${sessionId}`;
}
