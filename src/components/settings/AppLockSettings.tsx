import React, { useCallback, useEffect, useState } from 'react';
import { Lock, ShieldCheck, AlertTriangle, Loader2, KeyRound, ChevronRight, RotateCcw } from 'lucide-react';
import { APP_LOCK_AREAS, coveredByBilling, normaliseLockedAreas, type AppLockArea } from '../../lib/appLockAreas';
import {
  appLockStatus, cachedAppLockStatus, subscribeAppLock, saveLockedAreas, changePin, clearUnlock,
  looksLikePin, invalidateAppLockStatus, type AppLockStatus, type VaultError,
} from '../../lib/appLock';

/**
 * SETTINGS → GENERAL → [App Lock] → THE APP LOCK SCREEN (admin 2026-09-13; reshaped 2026-09-17).
 *
 * Admin 2026-09-17, verbatim: *"app lock aapne setting me aise hi bahar bana diya, 'app lock' button banao.
 * jab user setting ja kar app lock option press kare to yeh option dikhe. sath me change lock ka bhi
 * option dikhe. aur is app lock ko open karne ke liye bhi lock chahiye."*
 *
 * So this file is now TWO things:
 *  - `AppLockRow` — the button on General. One line of status, a chevron, nothing else. It never shows
 *    a tick box, because a tick box on an open screen is a lock somebody else can flip.
 *  - `AppLockSettings` — the screen the row opens. It is rendered INSIDE `AppLockGate` with `always`,
 *    so by the time anything here draws, the server has accepted the PIN moments ago (or the user has
 *    just created one). That is why there is no PIN field on this screen any more: the door is the PIN.
 *
 * 🔒 THE ONE THING THAT MAKES THIS MORE THAN A PREFERENCE PANEL IS UNCHANGED: SAVING NEEDS THE PIN.
 * The gate guarantees a live ticket on the way in; the SERVER still demands it on `PUT /areas`, and a
 * ticket that lapses mid-edit re-locks the screen rather than leaving a Save that keeps failing.
 *
 * `api_keys` is still not a toggle. Its checkbox is drawn ticked and disabled, but that is only the
 * picture: `normaliseLockedAreas` puts it back whatever the request contains, on both sides.
 *
 * ⚠️ NOTHING IS SAVED UNTIL "Save" IS PRESSED. The rest of Settings persists on tap, which is right for a
 * theme; it is wrong here, because a stray tap on a phone would silently lock the user out of a screen
 * they use. The ticks are a draft with an explicit Save and an Undo.
 */

/** How many OPTIONAL areas are locked — what the row on General reports. */
export function optionalLockedCount(status: AppLockStatus | null): number {
  if (!status) return 0;
  return status.areas.filter((a) => !APP_LOCK_AREAS.find((s) => s.id === a)?.mandatory).length;
}

/** The one-line status the row shows. Pure, so the wording is tested rather than eyeballed. */
export function appLockRowSubtitle(status: AppLockStatus | null, loadFailed: boolean): string {
  if (loadFailed) return 'Could not read your lock — tap to retry.';
  if (!status) return 'Checking…';
  if (!status.hasPin) return 'No PIN yet — tap to set one up.';
  const n = optionalLockedCount(status);
  const optional = APP_LOCK_AREAS.filter((s) => !s.mandatory).length;
  return n === 0
    ? 'PIN set · only your API keys are locked.'
    : `PIN set · ${n} of ${optional} optional areas locked.`;
}

/**
 * THE BUTTON on General Settings. Opens the App Lock screen — which is itself behind the PIN.
 *
 * It reads the shared status cache, so it costs no request of its own once any gate has asked.
 */
export const AppLockRow: React.FC<{ userId: string | undefined; onOpen: () => void }> = ({ userId, onOpen }) => {
  const [status, setStatus] = useState<AppLockStatus | null>(() => cachedAppLockStatus());
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => subscribeAppLock(() => setStatus(cachedAppLockStatus())), []);

  const load = useCallback(() => {
    if (!userId) return;
    setLoadFailed(false);
    appLockStatus(userId).then(setStatus).catch(() => setLoadFailed(true));
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3 pt-6 border-t border-line">
      <label className="text-[10px] font-black text-accent-text uppercase tracking-widest mb-2 block pl-1">App Lock</label>
      <button
        type="button"
        onClick={() => { if (loadFailed) load(); onOpen(); }}
        disabled={!userId}
        aria-label="Open App Lock"
        className="w-full flex items-center gap-3 rounded-xl border border-line bg-well p-3 text-left hover:bg-raised active:bg-raised transition-colors disabled:opacity-60"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/10">
          <Lock className="h-5 w-5 text-accent-text" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-ink">App Lock</span>
          <span className="block text-[11px] text-muted leading-snug">
            {userId ? appLockRowSubtitle(status, loadFailed) : 'Sign in to set a PIN on parts of the app.'}
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-faint" />
      </button>
      <p className="text-[10px] leading-snug text-faint pl-1">
        One 4-digit PIN, and you choose what it guards. Opening this screen needs the PIN too.
      </p>
    </div>
  );
};

const PIN_BOX = 'w-full rounded-lg border border-line bg-well px-3 py-2.5 text-center text-sm font-bold tracking-[0.4em] text-ink placeholder-faint outline-none focus:border-indigo-500/50';
const digits = (v: string) => v.replace(/\D/g, '').slice(0, 4);

/**
 * CHANGE PIN — with the current PIN, right now.
 *
 * The server needs both the live ticket (this card is only reachable behind the gate) AND the current
 * PIN typed here, because a ticket alone proves only that the PIN was entered in the last five minutes.
 * A wrong current PIN spends one of the five tries exactly like a wrong unlock; five wrong ones lock the
 * screen, and the gate then offers the emailed-code reset.
 */
const ChangePinCard: React.FC<{ userId: string }> = ({ userId }) => {
  const [open, setOpen] = useState(false);
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const reset = () => { setCurrentPin(''); setNewPin(''); setConfirmPin(''); };

  const submit = async () => {
    setError('');
    setDone('');
    if (!looksLikePin(currentPin)) { setError('Enter your current 4-digit PIN.'); return; }
    if (!looksLikePin(newPin)) { setError('Your new PIN must be exactly 4 digits.'); return; }
    if (newPin !== confirmPin) {
      // Checked before the request: a mistyped PIN the server happily accepts locks the user out of
      // their own screens until they reset it — the one mistake this form must not let through.
      setError('The two new PINs do not match.');
      return;
    }
    if (newPin === currentPin) { setError('Your new PIN is the same as the current one.'); return; }
    setBusy(true);
    try {
      await changePin(userId, currentPin, newPin);
      reset();
      setOpen(false);
      setDone('Your PIN is changed. Use the new one from now on.');
    } catch (err) {
      const e = err as VaultError;
      setCurrentPin('');
      setError(e?.message || 'Could not change your PIN. Please try again.');
      // The server is the authority on lock-outs and on whether the ticket is still good. Either way the
      // right response is to close the screen: the gate then shows the lock-out (with its reset) or asks
      // for the PIN again.
      if (typeof e?.lockedForMs === 'number' || e?.needsUnlock) {
        invalidateAppLockStatus();
        clearUnlock();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-line bg-well p-3 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-muted">
          <KeyRound size={14} className="mt-px shrink-0 text-accent-text" />
          <span><span className="font-bold text-body">Change PIN.</span> You will need your current PIN.</span>
        </p>
        {!open && (
          <button
            type="button"
            onClick={() => { setOpen(true); setDone(''); setError(''); }}
            className="shrink-0 rounded-lg border border-line px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-body hover:bg-raised"
          >
            Change PIN
          </button>
        )}
      </div>

      {done && !open && (
        <p className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5 text-[11px] leading-snug text-success">
          <ShieldCheck size={14} className="mt-px shrink-0" /> {done}
        </p>
      )}

      {open && (
        <div className="space-y-2.5">
          <input type="password" inputMode="numeric" autoComplete="current-password" maxLength={4} value={currentPin}
            onChange={(e) => setCurrentPin(digits(e.target.value))} placeholder="Current PIN" aria-label="Current PIN" className={PIN_BOX} />
          <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={4} value={newPin}
            onChange={(e) => setNewPin(digits(e.target.value))} placeholder="New PIN" aria-label="New PIN" className={PIN_BOX} />
          <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={4} value={confirmPin}
            onChange={(e) => setConfirmPin(digits(e.target.value))} onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
            placeholder="Confirm new PIN" aria-label="Confirm new PIN" className={PIN_BOX} />
          {error && (
            <p className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-2.5 text-[11px] leading-snug text-danger">
              <AlertTriangle size={14} className="mt-px shrink-0" /> {error}
            </p>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || !looksLikePin(currentPin) || !looksLikePin(newPin) || !confirmPin}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-on-accent hover:bg-indigo-500 disabled:opacity-40"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />}
              {busy ? 'Changing…' : 'Save new PIN'}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); reset(); setError(''); }}
              className="rounded-lg border border-line px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-muted hover:text-ink"
            >
              Cancel
            </button>
          </div>
          <p className="text-[10px] leading-snug text-faint">
            Avoid 0000 or 1234. Forgot your current PIN? Press <strong className="text-muted">Lock now</strong> above,
            then <strong className="text-muted">Forgot PIN?</strong> — a code is emailed and you set a new one.
          </p>
        </div>
      )}
    </div>
  );
};

/**
 * THE APP LOCK SCREEN. Rendered only behind `AppLockGate always`, so a live unlock is a given on entry.
 */
export const AppLockSettings: React.FC<{ userId: string }> = ({ userId }) => {
  const [status, setStatus] = useState<AppLockStatus | null>(null);
  const [loadError, setLoadError] = useState('');
  /** The ticks on screen. `null` until the stored list has been read — a draft must never start from a guess. */
  const [draft, setDraft] = useState<AppLockArea[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const s = await appLockStatus(userId, true);
      setStatus(s);
      setDraft(s.areas);
    } catch (err) {
      // Honest and retryable: a settings list we could not read must not be drawn as "nothing is locked",
      // which is exactly the screen a user would act on and get wrong.
      setLoadError((err as Error)?.message || 'Could not read your app lock settings.');
    }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  const toggle = (id: AppLockArea) => {
    setSaved('');
    setError('');
    setDraft((list) => {
      const current = list ?? [];
      const next = current.includes(id) ? current.filter((a) => a !== id) : [...current, id];
      // Normalised on every change, so the mandatory area can never be removed even from the DRAFT and
      // the order stays canonical for the comparison below.
      return normaliseLockedAreas(next);
    });
  };

  const stored = status?.areas ?? [];
  const dirty = !!draft && (draft.length !== stored.length || draft.some((a) => !stored.includes(a)));

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError('');
    setSaved('');
    try {
      const out = await saveLockedAreas(userId, draft);
      setDraft(out);
      setStatus((s) => (s ? { ...s, areas: out } : s));
      setSaved('Saved. Your app lock is updated.');
    } catch (err) {
      const e = err as VaultError;
      setError(e?.message || 'Could not save. Please try again.');
      // The ticket lapsed between opening and saving: close the screen so the gate asks for the PIN
      // again, rather than leaving a "Save" button that will keep failing.
      if (e?.needsUnlock) clearUnlock();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-well p-3 space-y-3">
        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-muted">
          <Lock size={14} className="mt-px shrink-0 text-accent-text" />
          <span><span className="font-bold text-body">What your PIN guards.</span> Tick a part of the app and it opens only
          with your PIN. One unlock opens every locked screen for five minutes.</span>
        </p>

        {loadError && (
          <p className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-2.5 text-[11px] leading-snug text-danger">
            <AlertTriangle size={14} className="mt-px shrink-0" /> {loadError}
            <button onClick={() => void load()} className="ml-auto shrink-0 underline underline-offset-2">Retry</button>
          </p>
        )}

        {status === null && !loadError && (
          <p className="flex items-center gap-2 text-[11px] text-faint"><Loader2 size={12} className="animate-spin" /> Reading your settings…</p>
        )}

        {status !== null && (
          <>
            <div className="space-y-2">
              {APP_LOCK_AREAS.map((spec) => {
                const ticked = !!draft?.includes(spec.id);
                // Locking the whole Wallet & Billing screen already covers the plans card and the recharge
                // tab inside it, so the screen says so instead of leaving a tick that appears to do nothing.
                const impliedByBilling = !spec.mandatory && coveredByBilling(spec.id) && !!draft?.includes('billing');
                return (
                  <label
                    key={spec.id}
                    className={`flex items-start gap-2.5 rounded-lg border p-2.5 ${
                      spec.mandatory ? 'border-indigo-500/20 bg-indigo-500/5' : 'border-line cursor-pointer hover:bg-raised'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={ticked || spec.mandatory === true}
                      disabled={spec.mandatory === true}
                      onChange={() => { if (!spec.mandatory) toggle(spec.id); }}
                      className="mt-0.5 accent-indigo-500 disabled:opacity-70"
                      aria-label={`Lock ${spec.label}`}
                    />
                    <span className="min-w-0 text-xs text-body leading-snug">
                      {spec.label}
                      {spec.mandatory && <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-accent-text">Always on</span>}
                      <span className="block text-[11px] text-faint">{spec.hint}</span>
                      {impliedByBilling && (
                        <span className="block text-[11px] text-warn">Already covered — Wallet &amp; Billing is locked.</span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>

            {error && (
              <p className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-2.5 text-[11px] leading-snug text-danger">
                <AlertTriangle size={14} className="mt-px shrink-0" /> {error}
              </p>
            )}
            {saved && !error && (
              <p className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5 text-[11px] leading-snug text-success">
                <ShieldCheck size={14} className="mt-px shrink-0" /> {saved}
              </p>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={() => void save()}
                disabled={!dirty || busy}
                className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-on-accent hover:bg-indigo-500 disabled:opacity-40"
              >
                {busy ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
                {busy ? 'Saving…' : 'Save'}
              </button>
              {dirty && (
                <button
                  onClick={() => { setDraft(stored); setError(''); setSaved(''); }}
                  className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-muted hover:text-ink"
                >
                  <RotateCcw size={12} /> Undo
                </button>
              )}
              {!dirty && !saved && <span className="text-[10px] text-faint">No changes.</span>}
            </div>
          </>
        )}
      </div>

      <ChangePinCard userId={userId} />

      {/* Said once, plainly, rather than implied. The admin is the person who decides whether this
          trade is acceptable, and they cannot decide it if the screen overstates what it does. */}
      <p className="text-[10px] leading-snug text-faint px-1">
        Two things are protected on our server, not just on your screen: your API key values stay
        encrypted until the PIN is accepted, and anything that <strong className="text-muted">spends
        money</strong> — a recharge, buying or renewing a plan, auto-renew — is refused without it, with
        nothing charged. On the other screens the PIN keeps the screen closed on this device, which is
        what stops someone who picks up your phone. Money you have already paid is always credited
        without a PIN.
      </p>
    </div>
  );
};

export default AppLockSettings;
