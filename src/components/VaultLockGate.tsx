import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Lock, ShieldCheck, KeyRound, AlertTriangle, Mail, Loader2 } from 'lucide-react';
import { signOut } from 'firebase/auth';
import { auth } from '../lib/firebase';
import {
  pinStatus, sendPinCode, setPin, unlockWithPin, unlockIsLive, secondsRemaining,
  looksLikePin, lockoutMinutes, type PinStatus, type UnlockState, type VaultError,
} from '../lib/vaultLock';

/**
 * THE DOOR ON THE SECRET VAULT — a 4-digit PIN (admin 2026-09-13, verbatim: *"ek kaam karo! isko aur
 * simple bana do! bas — PIN banao, mobile number/email otp se PIN banao, PIN (4 digit pin se hi open
 * ho). pin bhul jaye to, forget pin — otp — pin reset! waaki sab hata do … phone unlock etc sab hata
 * do, simple rahne do"*).
 *
 * 🔴 WHY THE PREVIOUS DOOR WAS REPLACED RATHER THAN REPAIRED, recorded so nobody rebuilds it.
 *
 * This screen used to offer the phone's own face / fingerprint / PIN through WebAuthn, with a fresh
 * account sign-in behind it. Both were real proofs and BOTH were unreachable on the app the admin
 * actually holds: WebAuthn binds a credential to an ORIGIN and the Capacitor shell's origin is a custom
 * scheme, while the account fallback used the web popup flow a WebView blocks — which is how the admin
 * came to photograph `auth/argument-error` on the only button on this screen. A lock nobody can open is
 * not a strict lock; it is a broken feature, and the honest fix was to stop insisting on the stronger
 * proof and ship the one that works everywhere.
 *
 * 🔒 AND IT IS A REAL LOCK, not a screen. Nothing here compares the PIN. The four digits go to the
 * server, which answers right-or-wrong and nothing else, counts the wrong ones, locks the vault for an
 * escalating window after five, and stores only a salted scrypt hash. Success returns a short-lived
 * TICKET, and the routes that can decrypt or delete a key refuse to act without it — so deleting this
 * component would make the keys unreadable rather than public, which is the test of whether a lock is
 * real. The rules are in `server/lib/vaultPin.ts`; the ticket is in `server/lib/vaultTicket.ts`.
 */
export const VaultLockGate: React.FC<{
  userId: string;
  /**
   * Rendered only once the vault is genuinely open; receives the live ticket to spend on reads/deletes.
   *
   * A named `render` prop rather than `children`, because React's implicit children type is a union with
   * ReactNode and a function then has to satisfy `string` too — a real TypeScript error, not a style
   * preference.
   */
  render: (unlock: UnlockState, relock: () => void) => React.ReactNode;
  /** Tighter chrome for the Pro sheet, same as SecretManager's own `embedded`. */
  embedded?: boolean;
}> = ({ userId, render, embedded }) => {
  const [unlock, setUnlock] = useState<UnlockState | null>(null);
  const [status, setStatus] = useState<PinStatus | null>(null);
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
  const [secondsLeft, setSecondsLeft] = useState(0);
  /** Held in a ref so the expiry timer never closes over a stale ticket. */
  const unlockRef = useRef<UnlockState | null>(null);
  unlockRef.current = unlock;

  const relock = useCallback(() => {
    // Dropping the ticket is the whole of locking: without it every read and delete is refused at the
    // server, so there is no "locked in the UI but still readable" state to get wrong.
    setUnlock(null);
    setPinValue('');
    setNewPin('');
    setConfirmPin('');
    setCode('');
    setError('');
    setNotice('');
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await pinStatus(userId);
      setStatus(s);
      // A brand-new account goes straight to the setup form — asking for a PIN that does not exist yet
      // is the kind of dead end that makes people think the feature is broken.
      setMode(s.hasPin ? 'unlock' : 'setup');
      if (s.codePending) setCodeSentTo(s.destination);
      return s;
    } catch (err) {
      setError((err as Error)?.message || 'Could not reach your vault. Please try again.');
      return null;
    }
  }, [userId]);

  useEffect(() => { void refreshStatus(); }, [refreshStatus]);

  /** The vault re-locks ITSELF. A screen left open on a shared desk must not stay open indefinitely. */
  useEffect(() => {
    if (!unlock) { setSecondsLeft(0); return; }
    const tick = () => {
      const live = unlockIsLive(unlockRef.current);
      setSecondsLeft(secondsRemaining(unlockRef.current));
      if (!live) relock();
    };
    tick();
    const timer = setInterval(tick, 1_000);
    return () => clearInterval(timer);
  }, [unlock, relock]);

  /** Turn any thrown vault error into the right screen state, in one place. */
  const handleError = (err: unknown) => {
    const e = err as VaultError;
    setError(e?.message || 'Something went wrong. Please try again.');
    // The server is the authority on lock-outs and on whether a PIN exists, so a refusal refreshes the
    // status rather than this screen guessing what changed.
    if (typeof e?.lockedForMs === 'number' || e?.needsSetup) void refreshStatus();
  };

  const doUnlock = async () => {
    if (!looksLikePin(pin)) { setError('Enter your 4-digit PIN.'); return; }
    setBusy('unlock');
    setError('');
    try {
      setUnlock(await unlockWithPin(userId, pin));
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
      void refreshStatus();
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
      // of their own keys until they reset it — the one mistake this form must not let through.
      setError('The two PINs do not match.');
      return;
    }
    setBusy('save');
    setError('');
    try {
      setUnlock(await setPin(userId, newPin, code.trim()));
      setNewPin('');
      setConfirmPin('');
      setCode('');
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

  if (unlock && unlockIsLive(unlock)) {
    const mm = Math.floor(secondsLeft / 60);
    const ss = String(secondsLeft % 60).padStart(2, '0');
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
          <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-emerald-300">
            <ShieldCheck size={14} />
            Unlocked
            <span className="font-sans font-normal normal-case tracking-normal text-emerald-200/70">with your PIN</span>
          </span>
          <span className="flex items-center gap-3">
            {/* The countdown is shown because a vault that closes without warning looks broken. */}
            <span className="text-[11px] text-emerald-200/70 tabular-nums">Re-locks in {mm}:{ss}</span>
            <button
              onClick={relock}
              className="rounded border border-emerald-400/30 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-200 hover:bg-emerald-400/10"
            >
              Lock now
            </button>
          </span>
        </div>
        {render(unlock, relock)}
      </div>
    );
  }

  const lockedForMs = status?.locked ? status.lockedForMs : 0;
  const noEmail = status?.channel === 'fresh-sign-in';
  const noContact = status?.channel === 'none';
  const pinBox = 'w-full rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-center text-lg font-bold tracking-[0.5em] text-white placeholder-gray-600 outline-none focus:border-indigo-500/50';
  const primaryButton = 'bg-indigo-600 text-white hover:bg-indigo-500';

  return (
    <div className={embedded ? 'py-6' : 'py-10'}>
      <div className="mx-auto max-w-sm rounded-2xl border border-white/10 bg-[#0d1117] p-6 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-500/10">
          <Lock className="h-6 w-6 text-indigo-300" />
        </div>
        <h3 className="text-base font-bold text-white">
          {status === null ? 'Checking your vault…' : mode === 'setup' ? (status.hasPin ? 'Reset your PIN' : 'Create your PIN') : 'Enter your PIN'}
        </h3>
        <p className="mt-2 text-xs leading-relaxed text-gray-400">
          {mode === 'setup'
            ? 'Your saved API keys open with a 4-digit PIN. We will email a code to the address on your account first, so only you can set it.'
            : 'Your API keys stay encrypted on our server until you enter your PIN — this is not just a screen being hidden.'}
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

        {status === null ? (
          <p className="mt-5 flex items-center justify-center gap-2 text-xs text-gray-500">
            <Loader2 size={14} className="animate-spin" /> One moment…
          </p>
        ) : lockedForMs > 0 ? (
          /* 🔒 THE LOCK-OUT IS WHAT MAKES FOUR DIGITS SAFE, so the screen states it plainly rather than
             hiding it behind a generic error — and it still offers the way out, which is a new code. */
          <div className="mt-5 space-y-3">
            <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-200">
              Too many wrong PINs. Your vault is locked for about {lockoutMinutes(lockedForMs)} minute
              {lockoutMinutes(lockedForMs) === 1 ? '' : 's'}. You can set a new PIN with an emailed code instead.
            </p>
            <button
              onClick={() => { setMode('setup'); setError(''); }}
              className={`w-full rounded-xl px-4 py-3 text-sm font-bold ${primaryButton}`}
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
              className={pinBox}
            />
            <button
              onClick={() => void doUnlock()}
              disabled={!!busy || !looksLikePin(pin)}
              className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold disabled:opacity-50 ${primaryButton}`}
            >
              <KeyRound size={16} />
              {busy === 'unlock' ? 'Checking…' : 'Unlock'}
            </button>
            {typeof status.attemptsLeft === 'number' && status.attemptsLeft < status.maxAttempts && (
              <p className="text-[10px] text-amber-300/80">
                {status.attemptsLeft} {status.attemptsLeft === 1 ? 'try' : 'tries'} left before your vault locks for a while.
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
              <button onClick={() => void signInAgain()} className={`w-full rounded-xl px-4 py-3 text-sm font-bold ${primaryButton}`}>
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
                codeSentTo ? 'border border-white/10 text-gray-200 hover:bg-white/5' : primaryButton
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
                screen (`codePending`), which the previous flow would have thrown away. */}
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
              className={pinBox}
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
              className={pinBox}
            />
            <button
              onClick={() => void savePin()}
              disabled={!!busy || !looksLikePin(newPin) || !confirmPin || code.length !== 6}
              className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold disabled:opacity-50 ${primaryButton}`}
            >
              <ShieldCheck size={16} />
              {busy === 'save' ? 'Saving…' : status.hasPin ? 'Reset PIN and open' : 'Create PIN and open'}
            </button>
            <p className="text-[10px] leading-snug text-gray-500">
              Avoid 0000 or 1234. Five wrong PINs locks the vault for a while — you can always reset it with
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

export default VaultLockGate;
