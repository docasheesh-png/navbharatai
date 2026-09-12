import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Lock, ShieldCheck, Fingerprint, KeyRound, AlertTriangle } from 'lucide-react';
import { EmailAuthProvider, GoogleAuthProvider, reauthenticateWithCredential, reauthenticateWithPopup } from 'firebase/auth';
import { auth } from '../lib/firebase';
import {
  deviceLockAvailable, lockStatus, registerDeviceLock, unlockWithDevice, unlockWithAccount,
  unlockIsLive, secondsRemaining, deviceLabel, type UnlockState,
} from '../lib/vaultLock';

/**
 * THE DOOR ON THE SECRET VAULT (admin 2026-09-12: "user jab secret and api keys par click kare to
 * phone lock / face lock / pin dalna pade, tab open ho!").
 *
 * 🔴 WHAT THIS COMPONENT IS HONEST ABOUT. Hiding a list behind a React flag protects nothing — the
 * values would still be one ordinary request away. So this screen does not "guard" the vault; it
 * COLLECTS a proof and holds the resulting ticket, and the server refuses to decrypt anything without
 * it (`server/lib/deviceUnlock.ts`). If somebody deleted this component entirely, the keys would become
 * unreadable rather than public — which is the test of whether a lock is real.
 *
 * TWO DOORS, BOTH REAL, AND WHY THERE MUST BE TWO. The device lock (face / fingerprint / PIN) is the one
 * the admin asked for and the one this screen offers first. But a user whose device has no platform
 * authenticator — an older Android WebView, a desktop with no Hello, a borrowed machine — would
 * otherwise be locked out of their own API keys permanently, which breaks the app far worse than a
 * weaker prompt does. So confirming the account password is the second door, and the server checks that
 * the sign-in really happened moments ago rather than trusting the screen.
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
  /** Tighter chrome for the v5 sheet, same as SecretManager's own `embedded`. */
  embedded?: boolean;
}> = ({ userId, render, embedded }) => {
  const [unlock, setUnlock] = useState<UnlockState | null>(null);
  const [canUseDevice, setCanUseDevice] = useState<boolean | null>(null);
  const [hasDeviceLock, setHasDeviceLock] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<'' | 'device' | 'register' | 'account'>('');
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [askPassword, setAskPassword] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  /** Held in a ref so the expiry timer never closes over a stale ticket. */
  const unlockRef = useRef<UnlockState | null>(null);
  unlockRef.current = unlock;

  const relock = useCallback(() => {
    // Dropping the ticket is the whole of locking: without it every read and delete is refused at the
    // server, so there is no "locked in the UI but still readable" state to get wrong.
    setUnlock(null);
    setError('');
    setPassword('');
    setAskPassword(false);
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const available = await deviceLockAvailable();
      if (!alive) return;
      setCanUseDevice(available);
      try {
        const status = await lockStatus(userId);
        if (alive) setHasDeviceLock(status.hasDeviceLock);
      } catch {
        // A status we could not read must not claim "no lock set up" — that would push the user into
        // registering a second credential over a working one. Unknown stays unknown.
        if (alive) setHasDeviceLock(null);
      }
    })();
    return () => { alive = false; };
  }, [userId]);

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

  const run = async (kind: 'device' | 'register' | 'account', fn: () => Promise<UnlockState>) => {
    setBusy(kind);
    setError('');
    try {
      setUnlock(await fn());
    } catch (err: unknown) {
      const e = err as { message?: string; name?: string };
      // A cancelled prompt is not a failure worth shouting about — the user changed their mind.
      const cancelled = e?.name === 'NotAllowedError' || e?.name === 'AbortError';
      setError(cancelled ? '' : (e?.message || 'Could not confirm it is you. Please try again.'));
    } finally {
      setBusy('');
    }
  };

  /**
   * Re-authenticate with Firebase FIRST, then ask the server to check it.
   *
   * The order is the security: Firebase refreshes `auth_time` inside the ID token, and the server reads
   * that from the signed token — so this screen cannot turn an old sign-in into a new one by saying so.
   * Google accounts re-authenticate through the provider popup; password accounts through the field.
   */
  const unlockViaAccount = async () => {
    const user = auth.currentUser;
    if (!user) { setError('Please sign in again.'); return; }
    const isGoogle = user.providerData.some((p) => p.providerId === GoogleAuthProvider.PROVIDER_ID);
    await run('account', async () => {
      if (isGoogle) {
        await reauthenticateWithPopup(user, new GoogleAuthProvider());
      } else {
        if (!user.email) throw new Error('This account has no password to confirm. Use your device lock instead.');
        if (!password) throw new Error('Enter your account password.');
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
      }
      // The fresh token has to be in hand before the server reads auth_time off it.
      await user.getIdToken(true);
      setPassword('');
      return unlockWithAccount(userId);
    });
  };

  const setUpDeviceLock = async () => {
    const user = auth.currentUser;
    if (!user) { setError('Please sign in again.'); return; }
    await run('register', async () => {
      // 🔒 Registering a device is gated by a fresh sign-in on the SERVER too. Without that, a stolen
      // session could enrol the thief's own face and hold the vault open forever — the lock would be
      // handing out keys instead of withholding them.
      const isGoogle = user.providerData.some((p) => p.providerId === GoogleAuthProvider.PROVIDER_ID);
      if (isGoogle) {
        await reauthenticateWithPopup(user, new GoogleAuthProvider());
      } else {
        if (!password) throw new Error('Enter your account password to set up the device lock.');
        if (!user.email) throw new Error('This account has no password. Device lock cannot be set up here.');
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, password));
      }
      await user.getIdToken(true);
      setPassword('');
      const state = await registerDeviceLock(userId, user.email || user.displayName || 'NavBharatAI account');
      setHasDeviceLock(true);
      return state;
    });
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
            <span className="font-sans font-normal normal-case tracking-normal text-emerald-200/70">
              {unlock.method === 'device-lock' ? 'with your device lock' : 'with your account password'}
            </span>
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

  const isGoogleAccount = !!auth.currentUser
    && auth.currentUser.providerData.some((p) => p.providerId === GoogleAuthProvider.PROVIDER_ID);

  // A Google account has no password to type, so the field would be an empty box that explains nothing.
  const showPasswordField = askPassword && !!auth.currentUser && !isGoogleAccount;

  /**
   * 🔴 WHICH DOOR LOOKS LIKE THE MAIN ONE (admin 2026-09-12, from a real screenshot of this screen).
   *
   * The admin asked for the phone lock — "jaise UPI se payment kare to lock ko unlock karna hota hai" —
   * opened this screen on an iPhone that CAN do Face ID, and still asked whether a simple phone lock was
   * possible at all. It was: the button was there. It was just the small outline one at the bottom while
   * the password path wore the primary colour, so the screen answered a different question than the one
   * the user was asking.
   *
   * So the rule is now explicit rather than incidental: whenever the device can do face / fingerprint /
   * PIN, THAT is the primary button — whether it is already set up (unlock) or not yet (set up). The
   * account door keeps its full strength and never disappears (a device with no lock must never strand
   * somebody outside their own API keys), it simply stops being the loudest thing on the screen.
   */
  const offerSetUp = canUseDevice === true && hasDeviceLock !== true;
  const deviceIsPrimary = hasDeviceLock === true || offerSetUp;

  const primaryButton = 'bg-indigo-600 text-white hover:bg-indigo-500';
  const secondaryButton = 'border border-white/10 text-gray-200 hover:bg-white/5';

  /**
   * The label names what will actually happen. "Use my account password" in front of a Google user is
   * a promise of a field they will never see — the popup is the confirmation, so the button says so.
   */
  const accountLabel = busy === 'account'
    ? 'Checking…'
    : isGoogleAccount
      ? 'Confirm with Google'
      : askPassword
        ? 'Confirm and unlock'
        : 'Use my account password';

  return (
    <div className={embedded ? 'py-6' : 'py-10'}>
      <div className="mx-auto max-w-sm rounded-2xl border border-white/10 bg-[#0d1117] p-6 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-500/10">
          <Lock className="h-6 w-6 text-indigo-300" />
        </div>
        <h3 className="text-base font-bold text-white">Your keys are locked</h3>
        <p className="mt-2 text-xs leading-relaxed text-gray-400">
          Confirm it is you before your API keys are shown. They stay encrypted on our server until you do —
          this is not just a screen being hidden.
        </p>

        {error && (
          <p className="mt-4 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 p-2.5 text-left text-[11px] leading-snug text-red-300">
            <AlertTriangle size={14} className="mt-px shrink-0" /> {error}
          </p>
        )}

        <div className="mt-5 space-y-2.5">
          {/* The device lock first when this account already has one — one tap, no typing. */}
          {hasDeviceLock === true && canUseDevice !== false && (
            <button
              onClick={() => void run('device', () => unlockWithDevice(userId))}
              disabled={!!busy}
              className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold disabled:opacity-50 ${primaryButton}`}
            >
              <Fingerprint size={16} />
              {busy === 'device' ? 'Waiting for your device…' : 'Unlock with device lock'}
            </button>
          )}

          {/* Offered only when the device can actually do it, so nobody is sent to a prompt that cannot
              appear. A device with no screen lock is told what to turn on, by the server, by name. */}
          {offerSetUp && (
            <>
              <button
                onClick={() => {
                  // A password account has to type it first. Firing the registration now would only
                  // raise an error saying what the field itself is about to ask for — an error as a
                  // form of instruction, which is how a one-tap feature comes to feel broken.
                  if (!isGoogleAccount && !password) { setAskPassword(true); return; }
                  void setUpDeviceLock();
                }}
                disabled={!!busy}
                className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold disabled:opacity-50 ${primaryButton}`}
              >
                <Fingerprint size={16} />
                {busy === 'register' ? 'Setting up…' : `Set up ${deviceLabel().toLowerCase()} lock`}
              </button>
              <p className="text-[10px] leading-snug text-gray-500">
                Uses this device's own face, fingerprint or PIN. Confirm your account once to set it up —
                after that it is one tap, every time.
              </p>
            </>
          )}

          {showPasswordField && (
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void unlockViaAccount(); }}
              placeholder="Your account password"
              autoComplete="current-password"
              className="w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-indigo-500/50"
            />
          )}

          <button
            onClick={() => (askPassword || isGoogleAccount ? void unlockViaAccount() : setAskPassword(true))}
            disabled={!!busy}
            className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold disabled:opacity-50 ${
              deviceIsPrimary ? secondaryButton : primaryButton
            }`}
          >
            <KeyRound size={16} />
            {accountLabel}
          </button>

          {canUseDevice === false && (
            <p className="text-[10px] leading-snug text-gray-500">
              This device has no face, fingerprint or PIN lock available to the browser, so your account
              password is used instead. It is checked on our server, not here.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default VaultLockGate;
