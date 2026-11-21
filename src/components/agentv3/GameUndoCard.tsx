import { useState } from 'react';
import { RotateCcw, X, Loader2 } from 'lucide-react';
import { authedHeaders } from '../../lib/authHeaders';
import { readVersionRestoreResponse } from '../../lib/versionRestoreClient';

/**
 * "THIS CHANGE MADE YOUR GAME WORSE — GO BACK?" (admin 2026-11-21: "agar game repair se game tut jaye to user ek prompt
 * se wapas game undo ho jaye"). The server played the game after the turn and found it worse than before
 * (gameRegression.ts → the GAME_GOT_WORSE finding, whose detail is the saved version from just before the turn). One tap
 * restores that version through the same /api/agentv3/restore-version the Time Machine uses — which saves the current
 * app first, so the user can come forward again. Nothing is restored until the user taps.
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

export function GameUndoCard({ offer, workspaceId, userId, email, onRestored, onDismiss }: {
  offer: GameUndoOffer;
  workspaceId: string | null | undefined;
  userId?: string | null;
  email?: string | null;
  onRestored: (files: Record<string, string>, message: string) => void;
  onDismiss: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const goBack = async () => {
    if (!workspaceId || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch('/api/agentv3/restore-version', {
        method: 'POST',
        headers: await authedHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ workspaceId, versionId: offer.versionId, userId: userId ?? undefined, email: email ?? undefined }),
      });
      const out = readVersionRestoreResponse(res.ok, await res.json().catch(() => null));
      if (out.ok) onRestored(out.files, 'Your game is back to the version from before that change. The newer version was saved first, so you can return to it from Time Machine.');
      else setNote(out.message);
    } catch {
      setNote('Could not reach the server — nothing was changed. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-xl border border-warn/40 bg-card" data-testid="game-undo-card" role="region" aria-label="Go back to the version before this change">
      <div className="flex items-start gap-2 px-3 pt-2.5 pb-2">
        <RotateCcw className="w-4 h-4 text-warn shrink-0 mt-0.5" />
        <p className="min-w-0 flex-1 text-xs text-body leading-snug">{offer.message}</p>
        <button type="button" onClick={onDismiss} className="shrink-0 p-1 rounded-lg text-faint hover:text-body hover:bg-raised" aria-label="Keep this version" title="Keep this version">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex items-center gap-2 px-3 pb-2.5">
        <button type="button" onClick={goBack} disabled={busy || !workspaceId}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-on-accent disabled:opacity-60">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
          Go back
        </button>
        <button type="button" onClick={onDismiss} className="rounded-lg px-3 py-1.5 text-xs text-muted hover:text-body">Keep this version</button>
      </div>
      {note && <p className="px-3 pb-2.5 text-[11px] text-muted" role="status">{note}</p>}
    </div>
  );
}
