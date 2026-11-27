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
//
// SAVED APP SIGNING KEYS GO WITH THE ACCOUNT (Q-3703, admin decision (a), 2026-11-27). Without its upload key an
// app already on Google Play can never be updated under the same listing, so before the delete can be confirmed
// this screen asks the server which keys the user really has (`/api/mobile-builds/signing-keys`) and, only when
// there are some, warns in red, offers each key's download, and requires the user to tick that they understand.
// A check that failed is said as a failure (never read as "no keys"), and it needs the same acknowledgement.

import { useEffect, useState } from 'react';
import { AlertTriangle, Download, KeyRound, Loader2, Trash2 } from 'lucide-react';
import { authedHeaders } from '../../lib/authHeaders';
import { isTypedConfirmValid, DELETE_CONFIRM_WORD } from '../../lib/deleteConfirm';
import { signOutEverywhere } from '../../lib/firebase';
import { readAnswer } from '../../lib/serverAnswer';
import { isKeyListAnswer, type ExportedKey, type SigningKeyMeta } from '../../lib/mobileBuildClient';
import { downloadSigningKey } from '../../lib/signingKeyDownload';

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
    return 'We could not confirm the deletion outcome. Some changes may already have completed. Please check your account before retrying, or email info@navbharatai.com.';
  }
  if (typeof result.message === 'string' && result.message) return result.message;
  return result.accountDeleted === true
    ? 'Your account has been deleted. Data removal is not fully confirmed; records with unverified ownership need review. Please email info@navbharatai.com.'
    : 'Your sign-in removal and data erasure are not fully confirmed. Please email info@navbharatai.com so we can finish it.';
}

/** What the server said about the user's saved signing keys. `loading` until it answers. */
export type SigningKeysState =
  | { status: 'loading' }
  | { status: 'ready'; keys: SigningKeyMeta[] }
  | { status: 'error'; sentence: string };

/**
 * Pure: may the delete go ahead as far as signing keys are concerned? With no keys, yes. With keys — or when the
 * check failed, so we cannot say there are none — only after the user ticked that they understand. While the check
 * is still running, no: the warning must be seen before the delete can fire.
 */
export function signingKeysAllowDelete(state: SigningKeysState, acknowledged: boolean): boolean {
  if (state.status === 'loading') return false;
  if (state.status === 'ready' && state.keys.length === 0) return true;
  return acknowledged;
}

export interface SigningKeysNoticeProps {
  state: SigningKeysState;
  acknowledged: boolean;
  onAcknowledge: (v: boolean) => void;
  onDownload: (appId: string) => void;
  downloading: string | null;
  downloaded: Record<string, { key: ExportedKey; message: string }>;
  failures: Record<string, string>;
}

/** The red signing-key warning. Renders NOTHING when the server confirmed the user has no saved keys. */
export function SigningKeysNotice({ state, acknowledged, onAcknowledge, onDownload, downloading, downloaded, failures }: SigningKeysNoticeProps) {
  if (state.status === 'loading') {
    return (
      <p className="text-[11px] text-muted flex items-center gap-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking whether you have saved app signing keys…
      </p>
    );
  }
  if (state.status === 'ready' && state.keys.length === 0) return null;
  const keys = state.status === 'ready' ? state.keys : [];
  return (
    <div role="alert" className="rounded-lg border border-danger/40 bg-danger/5 p-3 flex flex-col gap-2">
      <p className="text-xs font-bold text-danger flex items-center gap-1.5">
        <KeyRound className="w-3.5 h-3.5 flex-shrink-0" />
        {state.status === 'ready'
          ? `Deleting your account deletes ${keys.length === 1 ? 'your Google Play signing key' : `your ${keys.length} Google Play signing keys`} forever`
          : 'We could not check whether you have saved Google Play signing keys'}
      </p>
      <p className="text-[11px] text-danger leading-relaxed">
        {state.status === 'ready'
          ? 'Without its signing key you can never publish an update to that app under the same Google Play listing. NavBharatAI cannot recover it after deletion. Download each key below and keep it safe before you continue.'
          : `${state.sentence} If you ever built a Google Play bundle (.aab) with NavBharatAI, deleting your account deletes its signing key forever, and without it you can never update that app on Google Play. Reload this page to check again before you continue.`}
      </p>
      {keys.map((k) => {
        const got = downloaded[k.appId];
        return (
          <div key={k.appId} className="rounded-md border border-line bg-well p-2 flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold text-ink break-all">{k.appId}</span>
              <button
                type="button"
                onClick={() => onDownload(k.appId)}
                disabled={downloading !== null}
                className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-line text-[11px] font-bold text-accent-text disabled:opacity-40"
              >
                {downloading === k.appId ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                Download key
              </button>
            </div>
            <p className="text-[10px] text-muted break-all">Alias: {k.alias} · SHA-256: {k.certSha256}</p>
            {got && (
              <div className="text-[11px] text-body flex flex-col gap-0.5">
                <span className="text-success font-semibold">{got.message}</span>
                <span className="break-all">Keystore password: <span className="font-mono text-ink">{got.key.storePassword}</span></span>
                <span className="break-all">Key password: <span className="font-mono text-ink">{got.key.keyPassword}</span></span>
                <span className="break-all">Key alias: <span className="font-mono text-ink">{got.key.keyAlias}</span></span>
                <span className="text-muted">Write these down — the key file is useless without them.</span>
              </div>
            )}
            {failures[k.appId] && <span className="text-[11px] text-danger">{failures[k.appId]}</span>}
          </div>
        );
      })}
      <label className="flex items-start gap-2 text-[11px] text-ink">
        <input type="checkbox" checked={acknowledged} onChange={(e) => onAcknowledge(e.target.checked)} className="mt-0.5" />
        <span>I understand that my saved signing keys are deleted forever with my account.</span>
      </label>
    </div>
  );
}

export function DangerZone({ signedIn, onLog }: { signedIn: boolean; onLog?: (m: string, t?: string) => void }) {
  const [armed, setArmed] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [keysState, setKeysState] = useState<SigningKeysState>({ status: 'loading' });
  const [acknowledged, setAcknowledged] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState<Record<string, { key: ExportedKey; message: string }>>({});
  const [failures, setFailures] = useState<Record<string, string>>({});

  // Ask the server which signing keys this account really holds — the warning follows real state, never a guess.
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    (async () => {
      try {
        const res = await fetch('/api/mobile-builds/signing-keys', { headers: await authedHeaders() });
        const a = await readAnswer(res, isKeyListAnswer);
        if (live) setKeysState(a.ok ? { status: 'ready', keys: a.value.keys } : { status: 'error', sentence: a.sentence });
      } catch {
        if (live) setKeysState({ status: 'error', sentence: 'Your saved signing keys could not be checked right now.' });
      }
    })();
    return () => { live = false; };
  }, [signedIn]);

  // Nothing to delete when nobody is signed in — showing the control would be a dead end.
  if (!signedIn) return null;

  const canDelete = isTypedConfirmValid(typed) && !busy && signingKeysAllowDelete(keysState, acknowledged);

  const onDownload = async (appId: string) => {
    setDownloading(appId);
    setFailures((f) => { const n = { ...f }; delete n[appId]; return n; });
    const r = await downloadSigningKey(appId);
    if (r.ok) setDownloaded((d) => ({ ...d, [appId]: { key: r.key, message: r.message } }));
    else setFailures((f) => ({ ...f, [appId]: r.sentence }));
    setDownloading(null);
  };

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
      const accountConfirmed = res.ok && result?.ok === true && result.accountDeleted === true;
      setDone(deletionOutcomeMessage(result));
      onLog?.(deletionOutcomeMessage(result), accountConfirmed ? 'success' : 'error');
      if (accountConfirmed) {
        // The session must not outlive the account. Sign out, then reload to a clean app — staying on
        // a screen backed by data that no longer exists would show errors that look like new bugs.
        try { await signOutEverywhere(); } catch { /* the account is gone either way */ }
        setTimeout(() => { try { window.location.replace('/'); } catch { /* nothing else to do */ } }, 2500);
      }
    } catch {
      setDone(deletionOutcomeMessage(null));
      onLog?.(deletionOutcomeMessage(null), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6 rounded-xl border border-red-500/30 bg-red-500/[0.03] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-red-500/20 flex items-center gap-2">
        <AlertTriangle className="w-3.5 h-3.5 text-danger flex-shrink-0" />
        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-danger">Danger zone</span>
      </div>

      <div className="p-4 flex flex-col gap-3">
        <div>
          <p className="text-xs font-bold text-ink">Delete your account</p>
          <p className="text-[11px] text-muted leading-relaxed mt-1">
            This removes your account and attributable data, including your profile, wallet and token
            balance, saved keys and sessions. Older records whose ownership cannot be verified are
            retained for review, including workspaces, chat and voice conversations, synced copies,
            snapshots, engineering notes, app connections and uploaded assets.
            Email info@navbharatai.com for help with that review. <span className="text-danger font-semibold">It cannot be undone,
            and your unused token balance is not refundable.</span> Payment and tax records are kept as
            the law requires.
          </p>
        </div>

        {done ? (
          <p className="text-[11px] text-muted bg-well border border-line rounded-lg p-3 leading-relaxed">
            {done}
          </p>
        ) : !armed ? (
          <button
            type="button"
            onClick={() => setArmed(true)}
            className="self-start flex items-center gap-2 px-3 py-2 rounded-lg border border-red-500/40 text-danger text-xs font-bold hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete account
          </button>
        ) : (
          <div className="flex flex-col gap-2">
            <SigningKeysNotice
              state={keysState}
              acknowledged={acknowledged}
              onAcknowledge={setAcknowledged}
              onDownload={(appId) => void onDownload(appId)}
              downloading={downloading}
              downloaded={downloaded}
              failures={failures}
            />
            <label className="text-[11px] text-muted" htmlFor="danger-confirm">
              Type <span className="font-mono font-bold text-danger">{DELETE_CONFIRM_WORD}</span> to confirm:
            </label>
            <input
              id="danger-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="w-full max-w-[220px] px-3 py-2 rounded-lg bg-well border border-red-500/30 text-xs text-ink outline-none focus:border-red-400"
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!canDelete}
                onClick={runDelete}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-600 text-on-accent text-xs font-bold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-red-500 transition-colors"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                {busy ? 'Deleting…' : 'Permanently delete'}
              </button>
              <button
                type="button"
                onClick={() => { setArmed(false); setTyped(''); }}
                disabled={busy}
                className="px-3 py-2 rounded-lg text-xs font-bold text-muted hover:text-ink transition-colors disabled:opacity-40"
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
