import React, { useCallback, useEffect, useState } from 'react';
import { Lock, ShieldCheck, AlertTriangle, Loader2, KeyRound } from 'lucide-react';
import { APP_LOCK_AREAS, coveredByBilling, normaliseLockedAreas, type AppLockArea } from '../../lib/appLockAreas';
import {
  appLockStatus, subscribeAppLock, currentUnlock, saveLockedAreas, unlockWithPin, looksLikePin,
  lockoutMinutes, invalidateAppLockStatus, type AppLockStatus, type VaultError,
} from '../../lib/appLock';

/**
 * SETTINGS → GENERAL SETTINGS → APP LOCK (admin 2026-09-13).
 *
 * Admin, verbatim: *"setting me general settings me, user ko option do kahan kahan pin lagana hai.
 * settings - general setting - app lock - tick ✅ toggles. 1- api keys and secret (non removal ✅) 2- user
 * chahe to (on/off) default off: navbharatai pro, billings, subscription, wallet recharge, code studio,
 * settings"*.
 *
 * 🔒 THE ONE THING THAT MAKES THIS MORE THAN A PREFERENCE PANEL: CHANGING A TOGGLE NEEDS THE PIN.
 *
 * A lock that somebody holding your unlocked phone can switch off in Settings is not a lock. So this
 * screen asks for the PIN before it will save, and the SERVER demands the same ticket — the check is not
 * the disabled-looking UI, it is `PUT /api/app-lock/:userId/areas` refusing without proof.
 *
 * And `api_keys` is not a toggle at all. Its checkbox is drawn ticked and disabled, but that is only the
 * picture: `normaliseLockedAreas` puts it back whatever the request contains, on both sides, so "unlock my
 * keys permanently" is a request that does not exist rather than one we decline.
 *
 * ⚠️ NOTHING IS SAVED UNTIL "Save" IS PRESSED. The rest of this Settings screen persists on tap, which is
 * right for a theme; it is wrong here, because a stray tap on a phone would silently lock the user out of
 * a screen they use, and because every save costs a PIN entry. So the ticks are a draft with an explicit
 * save, and the draft says how it differs from what is stored.
 */
export const AppLockSettings: React.FC<{ userId: string | undefined }> = ({ userId }) => {
  const [status, setStatus] = useState<AppLockStatus | null>(null);
  const [loadError, setLoadError] = useState('');
  /** The ticks on screen. `null` until the stored list has been read — a draft must never start from a guess. */
  const [draft, setDraft] = useState<AppLockArea[] | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState<'' | 'unlock' | 'save'>('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [hasTicket, setHasTicket] = useState(() => !!currentUnlock());

  useEffect(() => subscribeAppLock(() => setHasTicket(!!currentUnlock())), []);

  const load = useCallback(async () => {
    if (!userId) return;
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

  const doUnlock = async () => {
    if (!userId || !looksLikePin(pin)) { setError('Enter your 4-digit PIN.'); return; }
    setBusy('unlock');
    setError('');
    try {
      await unlockWithPin(userId, pin);
      setPin('');
    } catch (err) {
      setPin('');
      setError((err as VaultError)?.message || 'That PIN is not right.');
      if (typeof (err as VaultError)?.lockedForMs === 'number') {
        invalidateAppLockStatus();
        void load();
      }
    } finally {
      setBusy('');
    }
  };

  const save = async () => {
    if (!userId || !draft) return;
    setBusy('save');
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
      // The ticket lapsed between unlocking and saving: ask for the PIN again rather than leaving a
      // "Save" button that will keep failing.
      if (e?.needsUnlock) setHasTicket(false);
    } finally {
      setBusy('');
    }
  };

  if (!userId) {
    return (
      <div className="space-y-3 pt-6 border-t border-white/10">
        <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-2 block pl-1">App Lock</label>
        <p className="text-[11px] text-gray-500 leading-snug pl-1">Sign in to set a PIN on parts of the app.</p>
      </div>
    );
  }

  const noPin = status !== null && !status.hasPin;
  const lockedOut = !!status?.locked;

  return (
    <div className="space-y-3 pt-6 border-t border-white/10">
      <label className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-2 block pl-1">App Lock</label>

      <div className="rounded-xl border border-white/10 bg-black/20 p-3 space-y-3">
        <p className="flex items-start gap-2 text-[11px] leading-relaxed text-gray-400">
          <Lock size={14} className="mt-px shrink-0 text-indigo-300" />
          One 4-digit PIN, and you choose what it guards. Unlocking once opens every locked screen for five
          minutes.
        </p>

        {loadError && (
          <p className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-2.5 text-[11px] leading-snug text-red-300">
            <AlertTriangle size={14} className="mt-px shrink-0" /> {loadError}
            <button onClick={() => void load()} className="ml-auto shrink-0 underline underline-offset-2">Retry</button>
          </p>
        )}

        {status === null && !loadError && (
          <p className="flex items-center gap-2 text-[11px] text-gray-500"><Loader2 size={12} className="animate-spin" /> Reading your settings…</p>
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
                      spec.mandatory ? 'border-indigo-500/20 bg-indigo-500/5' : 'border-white/5 cursor-pointer hover:bg-white/5'
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
                    <span className="min-w-0 text-xs text-gray-200 leading-snug">
                      {spec.label}
                      {spec.mandatory && <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-indigo-300">Always on</span>}
                      <span className="block text-[11px] text-gray-500">{spec.hint}</span>
                      {impliedByBilling && (
                        <span className="block text-[11px] text-amber-300/80">Already covered — Wallet &amp; Billing is locked.</span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>

            {noPin && (
              <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5 text-[11px] leading-relaxed text-amber-200">
                You have no PIN yet. Open <strong>Settings → App Settings → Secrets &amp; API Keys</strong> once to
                create it — we email a code to your account address first. Then come back here to choose what
                else it locks.
              </p>
            )}

            {!noPin && lockedOut && (
              <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5 text-[11px] leading-relaxed text-amber-200">
                Too many wrong PINs. Try again in about {lockoutMinutes(status.lockedForMs)} minute
                {lockoutMinutes(status.lockedForMs) === 1 ? '' : 's'}.
              </p>
            )}

            {/* 🔒 THE PIN IS REQUIRED TO SAVE. Shown only once there is something to save, so the field is
                not a permanent challenge on a settings page nobody is changing. */}
            {!noPin && !lockedOut && dirty && !hasTicket && (
              <div className="space-y-2 rounded-lg border border-white/10 bg-black/30 p-2.5">
                <p className="text-[11px] leading-snug text-gray-300">Enter your PIN to save this change.</p>
                <div className="flex gap-2">
                  <input
                    type="password"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={4}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    onKeyDown={(e) => { if (e.key === 'Enter') void doUnlock(); }}
                    placeholder="••••"
                    aria-label="Your 4-digit PIN"
                    className="w-28 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-center text-sm font-bold tracking-[0.4em] text-white placeholder-gray-600 outline-none focus:border-indigo-500/50"
                  />
                  <button
                    onClick={() => void doUnlock()}
                    disabled={!!busy || !looksLikePin(pin)}
                    className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-white hover:bg-indigo-500 disabled:opacity-50"
                  >
                    <KeyRound size={13} /> {busy === 'unlock' ? 'Checking…' : 'Confirm'}
                  </button>
                </div>
              </div>
            )}

            {error && (
              <p className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-2.5 text-[11px] leading-snug text-red-300">
                <AlertTriangle size={14} className="mt-px shrink-0" /> {error}
              </p>
            )}
            {saved && !error && (
              <p className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5 text-[11px] leading-snug text-emerald-300">
                <ShieldCheck size={14} className="mt-px shrink-0" /> {saved}
              </p>
            )}

            {!noPin && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void save()}
                  disabled={!dirty || !hasTicket || !!busy || lockedOut}
                  className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-white hover:bg-indigo-500 disabled:opacity-40"
                >
                  {busy === 'save' ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
                  {busy === 'save' ? 'Saving…' : 'Save'}
                </button>
                {dirty && (
                  <button
                    onClick={() => { setDraft(stored); setError(''); setSaved(''); }}
                    className="rounded-lg border border-white/10 px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-gray-400 hover:text-white"
                  >
                    Undo
                  </button>
                )}
                {!dirty && !saved && <span className="text-[10px] text-gray-500">No changes.</span>}
              </div>
            )}

            {/* Said once, plainly, rather than implied. The admin is the person who decides whether this
                trade is acceptable, and they cannot decide it if the screen overstates what it does. */}
            <p className="text-[10px] leading-snug text-gray-500">
              Your API keys are protected on our server — their values stay encrypted until the PIN is
              accepted. On the other screens the PIN keeps the screen closed on this device, which is what
              stops someone who picks up your phone.
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default AppLockSettings;
