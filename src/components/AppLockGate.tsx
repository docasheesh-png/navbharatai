import React, { useCallback, useEffect, useState } from 'react';
import { Lock, ShieldCheck, KeyRound, AlertTriangle, Mail, Loader2 } from 'lucide-react';
import { signOut } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { areaLabel, type AppLockArea } from '../lib/appLockAreas';
import {
  appLockStatus, cachedAppLockStatus, subscribeAppLock, currentUnlock, clearUnlock,
  sendPinCode, setPin, unlockWithPin, unlockIsLive, secondsRemaining, shouldGate,
  looksLikePin, lockoutMinutes, type AppLockStatus, type UnlockState, type VaultError,
} from '../lib/appLock';

/**
 * THE APP LOCK'S DOOR — a 4-digit PIN, in front of whichever parts of the app the user chose.
 *
 * Admin 2026-09-13: *"yeh PIN system sirf 'secret and api key' ke liye nahi … general pin system banana
 * hai. setting me general settings me, user ko option do kahan kahan pin lagana hai"*.
 *
 * 🔴 WHY THE PIN REPLACED THE PHONE LOCK, recorded so nobody rebuilds it. This screen used to offer the
 * phone's own face / fingerprint / PIN through WebAuthn, with a fresh account sign-in behind it. Both were
 * real proofs and BOTH were unreachable on the app the admin actually holds: WebAuthn binds a credential
 * to an ORIGIN and the Capacitor shell's origin is a custom scheme, while the account fallback used the
 * web popup flow a WebView blocks. A lock nobody can open is not a strict lock; it is a broken feature.
 *
 * 🔒 AND IT IS A REAL LOCK WHERE IT MATTERS MOST. Nothing here compares the PIN: the four digits go to the
 * server, which answers right-or-wrong and nothing else, counts the wrong ones, holds the lock for an
 * escalating window after five, and stores only a salted scrypt hash. Success returns a short-lived
 * TICKET. For `api_keys` that ticket is what the server demands before it will decrypt anything, so
 * deleting this component would make those keys unreadable rather than public. For the other areas there
 * is nothing to withhold — the data is the user's own and their session already reaches it — so there the
 * lock protects the SCREEN, which is exactly what an app lock is and is how it is described to the user.
 */

/** Everything the PIN flow needs, shared by the wrapper and the overlay so there is one implementation. */
function usePinFlow(userId: string) {
  const [status, setStatus] = useState<AppLockStatus | null>(() => cachedAppLockStatus());
  const [unlock, setUnlockState] = useState<UnlockState | null>(() => currentUnlock());
  /** `unlock` = type the PIN; `setup` = the code-and-new-PIN form (first time OR after "Forgot PIN"). */
  const [mode, setMode] = useState<'unlock' | 'setup'>('unlock');
  const [pin, setPinValue] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [code, setCode] = useState('');
  const [codeSentTo, setCodeSentTo] = useState('');
  const [busy, setBusy] = useState<'' | 'unlock' | 'code' | 'save'>('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  /** The status read itself failed. Shown ONLY on a screen that cannot open without it (`always`). */
  const [statusError, setStatusError] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(() => secondsRemaining(currentUnlock()));

  // ONE subscription to the shared store, so every gate re-renders together when the ticket is minted or
  // lapses. Per-gate timers would drift and leave one screen open while another had re-locked.
  useEffect(() => subscribeAppLock(() => {
    setUnlockState(currentUnlock());
    setStatus(cachedAppLockStatus());
  }), []);

  const refreshStatus = useCallback(async (force = false) => {
    try {
      const s = await appLockStatus(userId, force);
      setStatus(s);
      setStatusError('');
      // A brand-new account goes straight to the setup form — asking for a PIN that does not exist yet is
      // the kind of dead end that makes people think the feature is broken.
      setMode(s.hasPin ? 'unlock' : 'setup');
      if (s.codePending) setCodeSentTo(s.destination);
      return s;
    } catch (err) {
      // NOT set as a blocking error: a failed status read must not put a red banner on a screen the user
      // can still use. `shouldGate(area, null)` decides what happens, and it is documented in appLock.ts.
      console.warn('[app-lock] status unavailable', (err as Error)?.message);
      setStatusError((err as Error)?.message || 'Could not check your app lock. Please try again.');
      return null;
    }
  }, [userId]);

  useEffect(() => { void refreshStatus(); }, [refreshStatus]);

  /** The countdown, so a lock that is about to close does not look like it broke. */
  useEffect(() => {
    if (!unlock) { setSecondsLeft(0); return; }
    const tick = () => setSecondsLeft(secondsRemaining(currentUnlock()));
    tick();
    const timer = setInterval(tick, 1_000);
    return () => clearInterval(timer);
  }, [unlock]);

  const relock = useCallback(() => {
    clearUnlock();
    setPinValue('');
    setNewPin('');
    setConfirmPin('');
    setCode('');
    setError('');
    setNotice('');
  }, []);

  const handleError = (err: unknown) => {
    const e = err as VaultError;
    setError(e?.message || 'Something went wrong. Please try again.');
    // The server is the authority on lock-outs and on whether a PIN exists, so a refusal re-reads the
    // status rather than this screen guessing what changed.
    if (typeof e?.lockedForMs === 'number' || e?.needsSetup) void refreshStatus(true);
  };

  const doUnlock = async () => {
    if (!looksLikePin(pin)) { setError('Enter your 4-digit PIN.'); return; }
    setBusy('unlock');
    setError('');
    try {
      await unlockWithPin(userId, pin);
      setPinValue('');
    } catch (err) {
      setPinValue('');
      handleError(err);
    } finally {
      setBusy('');
    }
  };

  const requestCode = async () => {
    setBusy('code');
    setError('');
    setNotice('');
    try {
      const out = await sendPinCode(userId, status?.hasPin ? 'reset' : 'create');
      setCodeSentTo(out.destination);
      setNotice(`Code sent to ${out.destination}. It expires in 10 minutes.`);
      void refreshStatus(true);
    } catch (err) {
      handleError(err);
    } finally {
      setBusy('');
    }
  };

  const savePin = async () => {
    if (!looksLikePin(newPin)) { setError('Your PIN must be exactly 4 digits.'); return; }
    if (newPin !== confirmPin) {
      // Checked before the request, because a mistyped PIN the server happily accepts locks the user out
      // of their own screens until they reset it — the one mistake this form must not let through.
      setError('The two PINs do not match.');
      return;
    }
    setBusy('save');
    setError('');
    try {
      await setPin(userId, newPin, code.trim());
      setNewPin('');
      setConfirmPin('');
      setCode('');
      void refreshStatus(true);
    } catch (err) {
      handleError(err);
    } finally {
      setBusy('');
    }
  };

  /**
   * An account with NO email address signs in by mobile number, so there is nowhere to send a code. It
   * proves itself with a fresh sign-in instead — and the sign-in it does is itself a mobile OTP, checked
   * on the server from `auth_time` inside the signed token. Signing out is the whole action; the user
   * returns through the normal login they already know.
   */
  const signInAgain = async () => {
    try {
      await signOut(auth);
    } catch {
      setError('Could not sign you out. Please sign out from Settings and sign in again.');
    }
  };

  return {
    status, unlock, mode, setMode, pin, setPinValue, newPin, setNewPin, confirmPin, setConfirmPin,
    code, setCode, codeSentTo, busy, error, setError, notice, setNotice, secondsLeft, statusError,
    doUnlock, requestCode, savePin, signInAgain, relock, refreshStatus,
  };
}

type PinFlow = ReturnType<typeof usePinFlow>;

const PIN_BOX = 'w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-center text-lg font-bold tracking-[0.5em] text-white placeholder-gray-600 outline-none focus:border-indigo-500/50';
const PRIMARY = 'bg-indigo-600 text-white hover:bg-indigo-500';

/** The PIN card itself. Presentational — every decision is made in `usePinFlow`. */
const PinScreen: React.FC<{ area: AppLockArea; flow: PinFlow; embedded?: boolean; label?: string }> = ({ area, flow, embedded, label }) => {
  const {
    status, mode, setMode, pin, setPinValue, newPin, setNewPin, confirmPin, setConfirmPin,
    code, setCode, codeSentTo, busy, error, setError, notice, setNotice, statusError,
    doUnlock, requestCode, savePin, signInAgain, refreshStatus,
  } = flow;

  const lockedForMs = status?.locked ? status.lockedForMs : 0;
  const noEmail = status?.channel === 'fresh-sign-in';
  const noContact = status?.channel === 'none';
  const what = label ?? areaLabel(area);

  return (
    <div className={embedded ? 'py-6' : 'py-10'}>
      <div className="mx-auto max-w-sm rounded-2xl border border-white/10 bg-[#0d1117] p-6 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-500/10">
          <Lock className="h-6 w-6 text-indigo-300" />
        </div>
        <h3 className="text-base font-bold text-white">
          {status === null ? 'Checking your app lock…' : mode === 'setup' ? (status.hasPin ? 'Reset your PIN' : 'Create your PIN') : 'Enter your PIN'}
        </h3>
        {/* NAMES THE SCREEN BEING OPENED. With one lock in front of six places, "Enter your PIN" on its
            own leaves the user wondering what they are about to unlock — and on the overlay there is
            nothing else on screen to tell them. */}
        <p className="mt-2 text-xs leading-relaxed text-gray-400">
          {mode === 'setup'
            ? `${what} is locked with a 4-digit PIN. We will email a code to the address on your account first, so only you can set it.`
            : area === 'api_keys'
              ? 'Your API keys stay encrypted on our server until you enter your PIN — this is not just a screen being hidden.'
              : `${what} is locked. Enter your 4-digit PIN to open it.`}
        </p>

        {error && (
          <p className="mt-4 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-2.5 text-left text-[11px] leading-snug text-red-300">
            <AlertTriangle size={14} className="mt-px shrink-0" /> {error}
          </p>
        )}
        {notice && !error && (
          <p className="mt-4 flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5 text-left text-[11px] leading-snug text-emerald-300">
            <Mail size={14} className="mt-px shrink-0" /> {notice}
          </p>
        )}

        {status === null && statusError ? (
          /* Honest and retryable. Before 2026-09-17 a failed status read left "One moment…" on screen
             for ever — on a screen that cannot open without the answer, that is a locked door with no
             handle. */
          <div className="mt-5 space-y-2">
            <p className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-left text-[11px] leading-relaxed text-red-300">{statusError}</p>
            <button onClick={() => void refreshStatus(true)} className={`w-full rounded-xl px-4 py-3 text-sm font-bold ${PRIMARY}`}>
              Try again
            </button>
          </div>
        ) : status === null ? (
          <p className="mt-5 flex items-center justify-center gap-2 text-xs text-gray-500">
            <Loader2 size={14} className="animate-spin" /> One moment…
          </p>
        ) : lockedForMs > 0 ? (
          /* 🔒 THE LOCK-OUT IS WHAT MAKES FOUR DIGITS SAFE, so the screen states it plainly rather than
             hiding it behind a generic error — and it still offers the way out, which is a new code. */
          <div className="mt-5 space-y-3">
            <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-200">
              Too many wrong PINs. Locked for about {lockoutMinutes(lockedForMs)} minute
              {lockoutMinutes(lockedForMs) === 1 ? '' : 's'}. You can set a new PIN with an emailed code instead.
            </p>
            <button
              onClick={() => { setMode('setup'); setError(''); }}
              className={`w-full rounded-xl px-4 py-3 text-sm font-bold ${PRIMARY}`}
            >
              Reset my PIN
            </button>
          </div>
        ) : mode === 'unlock' ? (
          <div className="mt-5 space-y-2.5">
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={pin}
              // Digits only, so a stray letter never reaches the server as a failed attempt that would
              // burn one of the five tries.
              onChange={(e) => setPinValue(e.target.value.replace(/\D/g, '').slice(0, 4))}
              onKeyDown={(e) => { if (e.key === 'Enter') void doUnlock(); }}
              placeholder="••••"
              aria-label="Your 4-digit PIN"
              className={PIN_BOX}
            />
            <button
              onClick={() => void doUnlock()}
              disabled={!!busy || !looksLikePin(pin)}
              className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold disabled:opacity-50 ${PRIMARY}`}
            >
              <KeyRound size={16} />
              {busy === 'unlock' ? 'Checking…' : 'Unlock'}
            </button>
            {typeof status.attemptsLeft === 'number' && status.attemptsLeft < status.maxAttempts && (
              <p className="text-[10px] text-amber-300/80">
                {status.attemptsLeft} {status.attemptsLeft === 1 ? 'try' : 'tries'} left before it locks for a while.
              </p>
            )}
            <button
              onClick={() => { setMode('setup'); setError(''); setNotice(''); }}
              className="w-full rounded-xl border border-white/10 px-4 py-2.5 text-xs font-bold text-gray-300 hover:bg-white/5"
            >
              Forgot PIN?
            </button>
          </div>
        ) : noEmail || noContact ? (
          /* HONEST ABOUT THE ONE ACCOUNT WE CANNOT EMAIL, and it names the door that does work. */
          <div className="mt-5 space-y-3 text-left">
            <p className="rounded-xl border border-white/10 bg-black/20 p-3 text-[11px] leading-relaxed text-gray-300">
              {noEmail
                ? `Your account signs in with your mobile number${status.destination ? ` (${status.destination})` : ''} and has no email address, so we cannot email you a code. Sign in again with your mobile OTP — that is your verification — and you will be able to set your PIN straight after.`
                : 'Your account has no email address or mobile number on it, so there is no way to send you a verification code. Add one in Settings, then come back to set your PIN.'}
            </p>
            {noEmail && (
              <button onClick={() => void signInAgain()} className={`w-full rounded-xl px-4 py-3 text-sm font-bold ${PRIMARY}`}>
                Sign in again
              </button>
            )}
            {status.hasPin && (
              <button
                onClick={() => { setMode('unlock'); setError(''); }}
                className="w-full rounded-xl border border-white/10 px-4 py-2.5 text-xs font-bold text-gray-300 hover:bg-white/5"
              >
                Back to PIN
              </button>
            )}
          </div>
        ) : (
          <div className="mt-5 space-y-2.5">
            <button
              onClick={() => void requestCode()}
              disabled={!!busy || status.resendInMs > 0}
              className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold disabled:opacity-50 ${
                codeSentTo ? 'border border-white/10 text-gray-200 hover:bg-white/5' : PRIMARY
              }`}
            >
              <Mail size={16} />
              {busy === 'code'
                ? 'Sending…'
                : status.resendInMs > 0
                  ? `Wait ${Math.ceil(status.resendInMs / 1000)}s to send again`
                  : codeSentTo ? 'Send another code' : `Email me a code${status.destination ? ` (${status.destination})` : ''}`}
            </button>

            {/* The code and PIN fields are shown from the start, not gated behind the send, so a user who
                already has the email open can type straight in — and a pending code survives a reopened
                screen (`codePending`), which a send-first flow would have thrown away. */}
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="6-digit code from your email"
              aria-label="Verification code"
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-center text-sm font-mono tracking-[0.3em] text-white placeholder-gray-600 outline-none focus:border-indigo-500/50"
            />
            <input
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={4}
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="New 4-digit PIN"
              aria-label="New 4-digit PIN"
              className={PIN_BOX}
            />
            <input
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={4}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
              onKeyDown={(e) => { if (e.key === 'Enter') void savePin(); }}
              placeholder="Confirm your PIN"
              aria-label="Confirm your new PIN"
              className={PIN_BOX}
            />
            <button
              onClick={() => void savePin()}
              disabled={!!busy || !looksLikePin(newPin) || !confirmPin || code.length !== 6}
              className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold disabled:opacity-50 ${PRIMARY}`}
            >
              <ShieldCheck size={16} />
              {busy === 'save' ? 'Saving…' : status.hasPin ? 'Reset PIN and open' : 'Create PIN and open'}
            </button>
            <p className="text-[10px] leading-snug text-gray-500">
              Avoid 0000 or 1234. Five wrong PINs holds the lock for a while — you can always reset it with
              a new emailed code.
            </p>
            {status.hasPin && (
              <button
                onClick={() => { setMode('unlock'); setError(''); setNotice(''); }}
                className="w-full rounded-xl border border-white/10 px-4 py-2.5 text-xs font-bold text-gray-300 hover:bg-white/5"
              >
                Back to PIN
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/** The green "Unlocked — re-locks in 4:31" strip. Shown only for `api_keys`, see `AppLockGate`. */
const UnlockedBanner: React.FC<{ secondsLeft: number; onRelock: () => void }> = ({ secondsLeft, onRelock }) => {
  const mm = Math.floor(secondsLeft / 60);
  const ss = String(secondsLeft % 60).padStart(2, '0');
  return (
    <div className="flex items-center justify-between gap-2 flex-wrap rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
      <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-emerald-300">
        <ShieldCheck size={14} />
        Unlocked
        <span className="font-sans font-normal normal-case tracking-normal text-emerald-200/70">with your PIN</span>
      </span>
      <span className="flex items-center gap-3">
        <span className="text-[11px] text-emerald-200/70 tabular-nums">Re-locks in {mm}:{ss}</span>
        <button
          onClick={onRelock}
          className="rounded border border-emerald-400/30 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-200 hover:bg-emerald-400/10"
        >
          Lock now
        </button>
      </span>
    </div>
  );
};

export interface AppLockGateProps {
  userId: string;
  /** Which part of the app this is guarding. Decides whether a PIN is asked for at all. */
  area: AppLockArea;
  /**
   * Rendered once the area is open. Receives the live unlock — non-null only while a ticket is held, so a
   * screen that needs one to call the server (the keys screen) must check it.
   *
   * A named `render` prop rather than `children`, because React's implicit children type is a union with
   * ReactNode and a function then has to satisfy `string` too — a real TypeScript error, not a style
   * preference.
   */
  render: (unlock: UnlockState | null, relock: () => void) => React.ReactNode;
  /** Tighter chrome for a panel inside another screen. */
  embedded?: boolean;
  /**
   * Gate REGARDLESS of which areas the user ticked (admin 2026-09-17: "is app lock ko open karne ke
   * liye bhi lock chahiye"). Used by the App Lock screen itself: the list of what the PIN guards, and
   * the control to change the PIN, are the one place that must never open on an unlocked phone. With
   * no PIN yet, the setup form is shown instead — so the PIN is created right where it is managed.
   */
  always?: boolean;
  /** What the PIN card says it is opening, when the screen is not one of the seven areas. */
  label?: string;
  /** Show the "Unlocked · re-locks in m:ss · Lock now" strip above the opened content. */
  banner?: boolean;
}

/**
 * Wrap a screen in the app lock.
 *
 * ⚠️ THIS UNMOUNTS the wrapped screen while locked, which is correct for Settings, Wallet & Billing and
 * Code Studio and WRONG for the Pro builder — that surface is deliberately kept mounted across tab
 * switches so an in-flight build survives. Use `AppLockOverlay` there.
 */
export const AppLockGate: React.FC<AppLockGateProps> = ({ userId, area, render, embedded, always, label, banner }) => {
  const flow = usePinFlow(userId);
  const { status, unlock, secondsLeft, relock } = flow;

  // Not locked for this user ⇒ the gate is invisible. No banner, no wrapper div, nothing to lay out
  // around: a screen nobody locked must look exactly as it did before this feature existed.
  // `always` skips that question entirely: the App Lock screen is locked for everyone who has a PIN,
  // and offers to create one for everyone who has not.
  if (!always && !shouldGate(area, status)) return <>{render(unlock, relock)}</>;

  if (unlockIsLive(unlock)) {
    // The countdown strip is shown only where the unlock is doing continuous work — on the keys screen,
    // where a sudden re-lock mid-edit would look like a bug, and on the App Lock screen, where every
    // save spends the ticket. Elsewhere it would be chrome on top of a screen the user opened for
    // another reason entirely.
    if (area === 'api_keys' || banner) {
      return (
        <div className="space-y-3">
          <UnlockedBanner secondsLeft={secondsLeft} onRelock={relock} />
          {render(unlock, relock)}
        </div>
      );
    }
    return <>{render(unlock, relock)}</>;
  }

  return <PinScreen area={area} flow={flow} embedded={embedded} label={label} />;
};

/**
 * Is this area locked for this user RIGHT NOW?
 *
 * For a screen that cannot be unmounted — see `AppLockScreen` below — the parent needs the decision
 * itself so it can hide that screen its own way. Shares the module-level status cache and unlock store,
 * so asking here costs no extra request and can never disagree with a gate elsewhere.
 */
export function useAreaLocked(userId: string, area: AppLockArea): boolean {
  const [status, setStatus] = useState<AppLockStatus | null>(() => cachedAppLockStatus());
  const [unlock, setUnlockState] = useState<UnlockState | null>(() => currentUnlock());

  useEffect(() => subscribeAppLock(() => {
    setStatus(cachedAppLockStatus());
    setUnlockState(currentUnlock());
  }), []);

  useEffect(() => {
    if (!userId) return;
    void appLockStatus(userId).then(setStatus).catch(() => { /* see appLock.ts — a failed read renders */ });
  }, [userId]);

  return shouldGate(area, status) && !unlockIsLive(unlock);
}

/**
 * The PIN card on its own, for a screen that MUST NOT BE UNMOUNTED.
 *
 * 🔴 THIS EXISTS FOR ONE REAL REASON, and it is not styling. The Pro builder is deliberately kept mounted
 * while hidden (`v3SurfaceMount.ts` records the two rounds of root-causing behind that) so a build that is
 * mid-stream survives a tab switch. A gate that unmounted it would kill the build the user is waiting for —
 * turning a lock into data loss, which the first absolute rule forbids outright.
 *
 * ⚠️ AND IT IS A BLOCK IN NORMAL FLOW, NOT AN ABSOLUTE OVERLAY. The first attempt was an overlay, and it
 * could not have worked: that surface's keep-alive wrapper uses `display: contents` when active, which
 * removes its box entirely, so `absolute inset-0` inside it would have been positioned against some
 * ancestor further up and covered the wrong thing. Instead the parent hides the surface with the SAME
 * `hidden` class the keep-alive already uses — a mechanism that is known to preserve a running build —
 * and renders this in its place. One less new idea, and it reuses the path that is already proven.
 *
 * Note what that means and what it does not: the content is hidden from view, not withheld from the
 * machine. That is true of every screen lock, it is stated to the user as such, and it is why `api_keys`
 * is server-enforced rather than relying on this.
 */
export const AppLockScreen: React.FC<{ userId: string; area: AppLockArea; embedded?: boolean }> = ({ userId, area, embedded }) => {
  const flow = usePinFlow(userId);
  return (
    <div role="dialog" aria-modal="true" aria-label={`${areaLabel(area)} is locked`} className="flex-1 overflow-y-auto bg-[#0d1117]">
      <PinScreen area={area} flow={flow} embedded={embedded} />
    </div>
  );
};

export default AppLockGate;
