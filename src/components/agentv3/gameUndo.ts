import { authedHeaders } from '../../lib/authHeaders';
import { readVersionRestoreResponse } from '../../lib/versionRestoreClient';

/**
 * "THIS CHANGE MADE YOUR GAME WORSE — GO BACK?" (admin 2026-11-21: "agar game repair se game tut jaye to user ek prompt
 * se wapas game undo ho jaye"). The server played the game after the turn and found it worse than before
 * (gameRegression.ts → the GAME_GOT_WORSE finding, whose detail is the saved version from just before the turn).
 *
 * 🔒 IT LIVES IN THE ❗️ LIST, NOT IN A CARD OF ITS OWN (admin 2026-11-21: "alag se card dikhaoge, to user paresan ho
 * jayega! koi new button nahi, existing ❗️ button ko hi update kar do"). gameUndoOffer feeds a row into the list
 * (userActionView.mergeLiveActions); "Go back" calls restoreGameVersion — the same /api/agentv3/restore-version the
 * Time Machine uses, which saves the current app first, so the user can come forward again. Nothing is restored until
 * the user taps.
 */
export interface GameUndoOffer { versionId: string; message: string }

interface IssueLike { code?: string; message?: string; detail?: string; autoResolved?: boolean }

/** The offer in a finished build's report, or null. A version id is only ever one the server minted (v_…). PURE. */
export function gameUndoOffer(diagnostics: { issues?: ReadonlyArray<IssueLike> } | null | undefined): GameUndoOffer | null {
  const issue = (diagnostics?.issues ?? []).find((i) => i?.code === 'GAME_GOT_WORSE' && i.autoResolved !== true);
  const versionId = String(issue?.detail ?? '').trim();
  if (!issue || !/^v_[A-Za-z0-9_-]{4,100}$/.test(versionId)) return null;
  return { versionId, message: String(issue.message ?? 'This change made your game worse.') };
}

export const GAME_RESTORED_MESSAGE = 'Your game is back to the version from before that change. The newer version was saved first, so you can return to it from Time Machine.';

/** Restore the saved version. Resolves to the restored files, or to the honest reason nothing changed. */
export async function restoreGameVersion(input: { workspaceId: string; versionId: string; userId?: string | null; email?: string | null }):
  Promise<{ ok: true; files: Record<string, string> } | { ok: false; message: string }> {
  try {
    const res = await fetch('/api/agentv3/restore-version', {
      method: 'POST',
      headers: await authedHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ workspaceId: input.workspaceId, versionId: input.versionId, userId: input.userId ?? undefined, email: input.email ?? undefined }),
    });
    const out = readVersionRestoreResponse(res.ok, await res.json().catch(() => null));
    return out.ok ? { ok: true, files: out.files } : { ok: false, message: out.message };
  } catch {
    return { ok: false, message: 'Could not reach the server — nothing was changed. Please try again.' };
  }
}
