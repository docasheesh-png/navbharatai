// Verify your mobile number — while already signed in.
//
// ADMIN 2026-08-22: *"otp verified nahi to — github/zip app import nahi!"* plus *"agar koi aisa mobile
// number re verify ho jisse pahle hi koi account ban rakhi hai, to … otp bhejo hi mat."*
//
// ⚠️ THIS IS NOT THE SIGN-IN SCREEN, AND THE DIFFERENCE IS THE WHOLE POINT.
//
// `AuthComponent` SIGNS IN with a phone number: it exchanges the code for a session, which opens
// whatever account owns that number. Doing that here would be a bug the user would experience as
// their account silently changing underneath them — they came to attach a number to the account they
// are already in, and would end up in a different one.
//
// So this LINKS instead: the credential is attached to the CURRENT user. Firebase enforces
// one-number-one-account at that moment (`auth/credential-already-in-use`), which is the real
// guarantee; the server's pre-check exists to refuse earlier, more cheaply, and with a better message.
//
// THE REFUSAL CARRIES THE DOOR. When the number turns out to belong to another account, the sheet does
// not stop at "already in use" — that is a dead end. It offers the one action that genuinely helps:
// sign in with that number, which opens the account that owns it. That is the same journey the admin
// described ("direct mobile number se otp login ho, to old account apne aap open ho jayega"), reached
// from the place the user actually got stuck.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Smartphone, Loader2, ShieldCheck } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { RecaptchaVerifier, linkWithCredential, type Auth } from 'firebase/auth';
import { normalizePhone } from '../lib/phoneNumber';
import { authJsonHeaders } from '../lib/authHeaders';

/**
 * `linkWithPhoneNumber` and `PhoneAuthProvider` exist at runtime but the v12 umbrella types do not
 * surface them to tsc — the same resolution `AuthComponent` already uses for `PhoneAuthProvider`, kept
 * identical here so both sites fail (or work) the same way rather than one drifting.
 */
async function phoneAuthApi(): Promise<{ linkWithPhoneNumber: Function; PhoneAuthProvider: { credential: (id: string, code: string) => unknown } }> {
  const mod = (await import('firebase/auth')) as any;
  return { linkWithPhoneNumber: mod.linkWithPhoneNumber, PhoneAuthProvider: mod.PhoneAuthProvider };
}

export interface VerifyPhoneSheetProps {
  /** The SAME Auth instance the app signed in with — passed as a prop, exactly as AuthComponent takes it. */
  auth: Auth;
  open: boolean;
  onClose: () => void;
  /** Why the sheet opened, shown at the top so the user knows what this unlocks. */
  reason?: string;
  /** Verified successfully — the caller can retry whatever was blocked. */
  onVerified: () => void;
  /** The number belongs to another account: the caller opens the phone SIGN-IN screen. */
  onSignInInstead: (phone: string) => void;
}

type Stage = 'enter' | 'code' | 'taken';

export const VerifyPhoneSheet: React.FC<VerifyPhoneSheetProps> = ({ auth, open, onClose, reason, onVerified, onSignInInstead }) => {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<Stage>('enter');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const recaptchaRef = useRef<HTMLDivElement | null>(null);
  const verifier = useRef<RecaptchaVerifier | null>(null);
  const confirmation = useRef<{ confirm: (code: string) => Promise<unknown> } | null>(null);
  const nativeVerificationId = useRef<string | null>(null);

  useEffect(() => {
    if (open) return;
    // A closed sheet keeps nothing: a stale verifier or half-finished confirmation would make the NEXT
    // open fail for a reason the user could not possibly understand.
    setPhone(''); setCode(''); setStage('enter'); setError(''); setBusy(false);
    confirmation.current = null;
    nativeVerificationId.current = null;
    try { verifier.current?.clear(); } catch { /* already gone */ }
    verifier.current = null;
  }, [open]);

  const send = useCallback(async () => {
    const e164 = normalizePhone(phone);
    if (!e164) {
      setError('Enter a 10-digit mobile number, or include the country code (e.g. +91…).');
      return;
    }
    setBusy(true); setError('');
    try {
      // ASK THE SERVER FIRST. It refuses a number that belongs to another account BEFORE an SMS is
      // sent — that is the admin's rule, and it also means the user is not charged a minute of waiting
      // for a code that could never have worked.
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        // The SHARED header helper (src/lib/authHeaders). A local copy here is exactly what
        // tests/authHeaders.test.ts forbids, and it caught this one before it shipped.
        headers: await authJsonHeaders(),
        body: JSON.stringify({ phone: e164, purpose: 'verify' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        if (data?.code === 'phone-belongs-to-another-account') {
          setStage('taken');
          setError(data.message || 'This number is already linked to another account.');
          return;
        }
        setError(data?.message || 'Could not start verification. Please try again.');
        return;
      }

      if (Capacitor.isNativePlatform()) {
        const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
        await FirebaseAuthentication.removeAllListeners();
        await FirebaseAuthentication.addListener('phoneCodeSent', (ev: { verificationId?: string }) => {
          nativeVerificationId.current = ev?.verificationId ?? null;
        });
        await FirebaseAuthentication.linkWithPhoneNumber({ phoneNumber: e164 });
      } else {
        if (!verifier.current && recaptchaRef.current) {
          verifier.current = new RecaptchaVerifier(auth, recaptchaRef.current, { size: 'invisible' });
        }
        if (!auth.currentUser || !verifier.current) throw new Error('Please sign in again and retry.');
        const { linkWithPhoneNumber } = await phoneAuthApi();
        confirmation.current = await linkWithPhoneNumber(auth.currentUser, e164, verifier.current);
      }
      setStage('code');
    } catch (err) {
      // Firebase's own one-number-one-account rule, hit at link time. The server check above is the
      // cheap early refusal; THIS is the guarantee, and it must produce the same helpful ending.
      const codeStr = String((err as { code?: string })?.code || '');
      if (codeStr.includes('credential-already-in-use') || codeStr.includes('account-exists')) {
        setStage('taken');
        setError('This number is already linked to another NavBharatAI account.');
      } else {
        setError(readableAuthError(err));
      }
    } finally {
      setBusy(false);
    }
  }, [phone, auth]);

  const confirm = useCallback(async () => {
    const entered = code.trim();
    if (entered.length < 4) { setError('Enter the code from the SMS.'); return; }
    setBusy(true); setError('');
    try {
      if (Capacitor.isNativePlatform()) {
        const vid = nativeVerificationId.current;
        if (!vid || !auth.currentUser) throw new Error('Verification expired. Send the code again.');
        const { PhoneAuthProvider } = await phoneAuthApi();
        await linkWithCredential(auth.currentUser, PhoneAuthProvider.credential(vid, entered) as never);
      } else {
        if (!confirmation.current) throw new Error('Verification expired. Send the code again.');
        await confirmation.current.confirm(entered);
      }
      onVerified();
      onClose();
    } catch (err) {
      const codeStr = String((err as { code?: string })?.code || '');
      if (codeStr.includes('credential-already-in-use')) {
        setStage('taken');
        setError('This number is already linked to another NavBharatAI account.');
      } else {
        setError(readableAuthError(err));
      }
    } finally {
      setBusy(false);
    }
  }, [code, auth, onVerified, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[400] flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Verify your mobile number">
      <div className="w-full sm:max-w-md bg-[#0d1117] border border-white/10 rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-emerald-400" />
            <h3 className="text-sm font-bold text-white">Verify your mobile number</h3>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-zinc-500 hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        {reason && <p className="text-[12px] text-zinc-400 mb-3 leading-relaxed">{reason}</p>}

        {stage === 'taken' ? (
          <div className="space-y-3">
            <p className="text-[12px] text-amber-300 leading-relaxed">{error}</p>
            {/* The door, not a dead end — this is the whole reason the refusal is worth showing. */}
            <button
              onClick={() => { onSignInInstead(normalizePhone(phone) ?? phone); onClose(); }}
              className="w-full text-[12px] font-bold px-3 py-2.5 rounded-xl bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 hover:text-white hover:bg-emerald-600/30"
            >
              Sign in with this number instead
            </button>
            <button onClick={() => { setStage('enter'); setError(''); }} className="w-full text-[11px] text-zinc-500 hover:text-zinc-300">
              Use a different number
            </button>
          </div>
        ) : stage === 'code' ? (
          <div className="space-y-3">
            <p className="text-[12px] text-zinc-400">We sent a code to {normalizePhone(phone)}.</p>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6-digit code"
              className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white tracking-[0.3em] text-center outline-none focus:border-emerald-500/60"
            />
            {error && <p className="text-[11px] text-red-400">{error}</p>}
            <button onClick={confirm} disabled={busy} className="w-full flex items-center justify-center gap-2 text-[12px] font-bold px-3 py-2.5 rounded-xl bg-emerald-600 text-white disabled:opacity-40">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />} Verify
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              autoComplete="tel"
              placeholder="+91 Mobile number"
              className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500/60"
            />
            {error && <p className="text-[11px] text-red-400">{error}</p>}
            <button onClick={send} disabled={busy} className="w-full flex items-center justify-center gap-2 text-[12px] font-bold px-3 py-2.5 rounded-xl bg-emerald-600 text-white disabled:opacity-40">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Smartphone className="w-3.5 h-3.5" />} Send code
            </button>
            <p className="text-[10px] text-zinc-600 leading-relaxed">
              One number, one account. You only do this once — after that, importing works everywhere.
            </p>
          </div>
        )}
        <div ref={recaptchaRef} />
      </div>
    </div>,
    document.body,
  );
};

/** Firebase's error codes are not sentences. Turn the ones a user can act on into ones they can read. */
export function readableAuthError(err: unknown): string {
  const code = String((err as { code?: string })?.code || '');
  if (code.includes('invalid-verification-code')) return 'That code did not match. Check the SMS and try again.';
  if (code.includes('code-expired')) return 'That code has expired. Send a new one.';
  if (code.includes('invalid-phone-number')) return 'That does not look like a valid mobile number.';
  if (code.includes('too-many-requests')) return 'Too many attempts. Please wait a few minutes and try again.';
  if (code.includes('requires-recent-login')) return 'For your security, sign in again and then verify your number.';
  const message = (err as { message?: string })?.message;
  return typeof message === 'string' && message ? message : 'Verification failed. Please try again.';
}
