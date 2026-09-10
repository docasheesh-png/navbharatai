// Settings → Danger zone: permanently delete this account.
//
// WHY IT EXISTS: Google Play requires an app that lets people create an account to offer account
// deletion IN THE APP, not only through a support email. It is also simply the honest thing — a
// product that makes signing up one tap should not make leaving a letter-writing exercise.
//
// THE PATTERN IS GITHUB'S, deliberately (admin's own comparison): a visually separated red zone at
// the very bottom, and a delete that will not fire until the user physically TYPES the word. A
// single mis-tap must never be able to erase someone's account, and this is irreversible in a way
// almost nothing else in the app is. The typed-confirm rule is the shared one already used for bulk
// file deletes (lib/deleteConfirm.ts) rather than a second copy of the same idea.
//
// HONESTY: the server reports separately whether the DATA was erased and whether the SIGN-IN
// (Firebase Auth record) was removed, because those can genuinely differ. This screen shows exactly
// what the server said — it never turns a partial result into a green tick.

import { useState } from 'react';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { authedHeaders } from '../../lib/authHeaders';
import { isTypedConfirmValid, DELETE_CONFIRM_WORD } from '../../lib/deleteConfirm';
import { signOutEverywhere } from '../../lib/firebase';

/** What the delete endpoint answers with — only the fields this screen needs to tell the truth. */
export interface DeleteAccountResult {
  ok?: boolean;
  message?: string;
  accountDeleted?: boolean;
}

/**
 * Pure: the line to show after the server responds. Kept separate from the component so the honesty
 * rule — never report a clean wipe the server did not confirm — is unit-testable.
 */
export function deletionOutcomeMessage(result: DeleteAccountResult | null): string {
  if (!result || result.ok !== true) {
    return 'We could not complete the deletion. Nothing has been changed — please try again, or email info@navbharatai.com.';
  }
  if (result.message) return result.message;
  return result.accountDeleted
    ? 'Your account and all of its data have been permanently deleted.'
    : 'Your data has been erased, but your sign-in could not be removed automatically. Please email info@navbharatai.com so we can finish it.';
}

export function DangerZone({ signedIn, onLog }: { signedIn: boolean; onLog?: (m: string, t?: string) => void }) {
  const [armed, setArmed] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  // Nothing to delete when nobody is signed in — showing the control would be a dead end.
  if (!signedIn) return null;

  const canDelete = isTypedConfirmValid(typed) && !busy;

  const runDelete = async () => {
    if (!canDelete) return;
    setBusy(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'DELETE',
        headers: { ...(await authedHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'DELETE' }),
      });
      const body = (await res.json().catch(() => null)) as DeleteAccountResult | null;
      const result = res.ok ? body : null;
      setDone(deletionOutcomeMessage(result));
      onLog?.(deletionOutcomeMessage(result), res.ok ? 'success' : 'error');
      if (res.ok) {
        // The session must not outlive the account. Sign out, then reload to a clean app — staying on
        // a screen backed by data that no longer exists would show errors that look like new bugs.
        try { await signOutEverywhere(); } catch { /* the account is gone either way */ }
        setTimeout(() => { try { window.location.replace('/'); } catch { /* nothing else to do */ } }, 2500);
      }
    } catch {
      setDone(deletionOutcomeMessage(null));
      onLog?.('Account deletion failed — nothing was changed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/[0.03] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-red-500/20 flex items-center gap-2">
        <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-red-400">Danger zone</span>
      </div>

      <div className="p-4 flex flex-col gap-3">
        <div>
          <p className="text-xs font-bold text-white">Delete your account</p>
          <p className="text-[11px] text-[#8b949e] leading-relaxed mt-1">
            This permanently removes your profile, chats, projects and built apps, wallet and token
            balance, saved keys and sessions. <span className="text-red-300 font-semibold">It cannot be undone,
            and your unused token balance is not refundable.</span> Payment and tax records are kept as
            the law requires.
          </p>
        </div>

        {done ? (
          <p className="text-[11px] text-[#8b949e] bg-black/30 border border-white/5 rounded-lg p-3 leading-relaxed">
            {done}
          </p>
        ) : !armed ? (
          <button
            type="button"
            onClick={() => setArmed(true)}
            className="self-start flex items-center gap-2 px-3 py-2 rounded-lg border border-red-500/40 text-red-300 text-xs font-bold hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete account
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            <label className="text-[11px] text-[#8b949e]" htmlFor="danger-confirm">
              Type <span className="font-mono font-bold text-red-300">{DELETE_CONFIRM_WORD}</span> to confirm:
            </label>
            <input
              id="danger-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="w-full max-w-[220px] px-3 py-2 rounded-lg bg-black/40 border border-red-500/30 text-xs text-white outline-none focus:border-red-400"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!canDelete}
                onClick={runDelete}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-600 text-white text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-red-500 transition-colors"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                {busy ? 'Deleting…' : 'Permanently delete'}
              </button>
              <button
                type="button"
                onClick={() => { setArmed(false); setTyped(''); }}
                disabled={busy}
                className="px-3 py-2 rounded-lg text-xs font-bold text-[#8b949e] hover:text-white transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default DangerZone;
