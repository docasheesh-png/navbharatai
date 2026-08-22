import React, { useRef, useState } from 'react';
import { Gift, Loader2, Smartphone, ShieldCheck, AlertTriangle } from 'lucide-react';
import { RecaptchaVerifier, linkWithCredential } from 'firebase/auth';
import type { ConfirmationResult } from 'firebase/auth';
import { Capacitor } from '@capacitor/core';
import { auth } from '../../lib/firebase';
import { authJsonHeaders } from '../../lib/authHeaders';

/**
 * Claim the phone-verified half of the welcome gift (gift plan v2, admin 2026-08-21).
 *
 * ⚠️ THIS LINKS A NUMBER TO THE SIGNED-IN ACCOUNT. IT DOES NOT SIGN IN.
 * The existing phone flow in `AuthComponent` is a LOGIN: it calls `forceLogoutBeforeLogin()` and then
 * `signInWithPhoneNumber` / `signInWithCredential`. Reusing that here would sign the user OUT of the
 * Google account they are standing in and INTO a phone-only account — leaving their apps, their
 * wallet and their history behind, in exchange for a bonus. So this uses `linkWithPhoneNumber` /
 * `linkWithCredential` on `auth.currentUser`, which adds the number to the account that already
 * exists. Do not "simplify" this back to the sign-in helpers.
 *
 * The MONEY is never decided here. This component links a number and then asks the server to settle;
 * the amount comes from `decidePhoneClaim`, and the server reads the number from the verified ID
 * token, not from anything typed on this screen. A refusal ("this number already claimed") arrives as
 * a 200 with `granted: 0` and is shown as information, not as an error — real people hit it (one
 * handset in a family, someone locked out of an older account) and their account is fine.
 */

export interface PhoneBonusCardProps {
  /** Wallet-token amount the server says is still claimable. Rendered as ₹ using tokensPerRupee. */
  claimableTokens: number;
  tokensPerRupee?: number;
  /** Called after a successful claim so the wallet screen can refetch the real balance. */
  onClaimed?: (grantedTokens: number) => void;
}

type Stage = 'offer' | 'phone' | 'otp' | 'done' | 'refused';

/** Firebase link errors that mean something specific to a real person, in words that person can use. */
export function linkErrorMessage(code: string): string {
  if (/credential-already-in-use|account-exists-with-different-credential/.test(code)) {
    // The number is on ANOTHER NavBharatAI account. Common and innocent: an older account they can no
    // longer sign in to, or a shared family handset. Never phrased as an accusation.
    return 'This number is already linked to another NavBharatAI account. Use a different number, or sign in to that account instead.';
  }
  if (/provider-already-linked/.test(code)) return 'Your account already has a phone number linked.';
  if (/invalid-phone-number/.test(code)) return 'That does not look like a valid phone number.';
  if (/invalid-verification-code/.test(code)) return 'That code is not right. Check it and try again.';
  if (/code-expired/.test(code)) return 'That code has expired. Send a new one.';
  if (/too-many-requests/.test(code)) return 'Too many attempts. Please try again in a little while.';
  if (/operation-not-allowed/.test(code)) return 'Phone verification is not available right now.';
  if (/requires-recent-login/.test(code)) return 'For your security, please sign in again and then claim the bonus.';
  return 'Could not verify that number. Please try again.';
}

/** Digits only, and never longer than a real number — the server normalizes properly; this is just
 *  so the field cannot carry junk into an SMS request. */
export function sanitisePhoneInput(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 12);
}

export const PhoneBonusCard: React.FC<PhoneBonusCardProps> = ({
  claimableTokens,
  tokensPerRupee = 100,
  onClaimed,
}) => {
  const [stage, setStage] = useState<Stage>('offer');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [granted, setGranted] = useState(0);

  const recaptchaRef = useRef<HTMLDivElement>(null);
  const recaptchaVerifier = useRef<RecaptchaVerifier | null>(null);
  const confirmation = useRef<ConfirmationResult | null>(null);
  const nativeVerificationId = useRef<string | null>(null);

  const rupees = (t: number) => Math.round(t / tokensPerRupee);
  if (!Number.isFinite(claimableTokens) || claimableTokens <= 0) return null;

  const e164 = () => (phone.length === 10 ? `+91${phone}` : `+${phone}`);

  /** The server's own anti-spam + SMS-bill gateway. Asked FIRST, so a refusal costs no SMS. */
  const passGateway = async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: e164() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        setError(data?.message || 'Please wait a moment before requesting another code.');
        return false;
      }
      return true;
    } catch {
      setError('Could not reach the network. Please try again.');
      return false;
    }
  };

  const sendCode = async () => {
    setError('');
    if (phone.length < 10) { setError('Enter your 10-digit mobile number.'); return; }
    const user = auth.currentUser;
    if (!user) { setError('Please sign in again, then claim the bonus.'); return; }

    setBusy(true);
    try {
      if (!(await passGateway())) return;

      if (Capacitor.isNativePlatform()) {
        const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
        const { PhoneAuthProvider } = (await import('firebase/auth')) as any;
        await FirebaseAuthentication.removeAllListeners();
        nativeVerificationId.current = null;
        // Android reads the code itself (SMS Retriever) — LINK it, never sign in with it.
        await FirebaseAuthentication.addListener('phoneVerificationCompleted', async (ev: any) => {
          const vid = ev?.verificationId ?? nativeVerificationId.current;
          if (!vid || !ev?.verificationCode) return;
          try {
            await linkWithCredential(user, PhoneAuthProvider.credential(vid, ev.verificationCode));
            await settle();
          } catch (err: any) {
            setError(linkErrorMessage(String(err?.code || err?.message || '')));
            setBusy(false);
          }
        });
        await FirebaseAuthentication.addListener('phoneCodeSent', (ev: any) => {
          nativeVerificationId.current = ev?.verificationId ?? null;
          setStage('otp');
          setMessage('Code sent. On Android it may fill in by itself.');
          setBusy(false);
        });
        await FirebaseAuthentication.addListener('phoneVerificationFailed', (ev: any) => {
          setError(linkErrorMessage(String(ev?.code || ev?.message || '')));
          setBusy(false);
        });
        await FirebaseAuthentication.signInWithPhoneNumber({ phoneNumber: e164() });
        return;
      }

      if (!recaptchaVerifier.current && recaptchaRef.current) {
        recaptchaVerifier.current = new RecaptchaVerifier(auth, recaptchaRef.current, { size: 'invisible' });
      }
      if (!recaptchaVerifier.current) throw new Error('recaptcha-unavailable');
      // `linkWithPhoneNumber` exists at runtime but the v12 umbrella types do not surface it — the
      // same gap AuthComponent documents for `PhoneAuthProvider`. Resolved dynamically so the rest of
      // this file keeps real types.
      const { linkWithPhoneNumber } = (await import('firebase/auth')) as any;
      confirmation.current = await linkWithPhoneNumber(user, e164(), recaptchaVerifier.current);
      setStage('otp');
      setMessage('Code sent.');
    } catch (err: any) {
      setError(linkErrorMessage(String(err?.code || err?.message || '')));
      if (recaptchaVerifier.current) {
        try { recaptchaVerifier.current.clear(); } catch { /* already gone */ }
        recaptchaVerifier.current = null;
      }
    } finally {
      if (!Capacitor.isNativePlatform()) setBusy(false);
    }
  };

  /** Ask the server to settle. The amount is ITS decision, read from the verified token. */
  const settle = async () => {
    const user = auth.currentUser;
    if (!user) { setError('Please sign in again, then claim the bonus.'); setBusy(false); return; }
    try {
      // The claim reads `phone_number` off the ID token, which only carries it AFTER the link — so the
      // token must be refreshed first or the server will honestly say "verify your phone first".
      await user.getIdToken(true);
      const res = await fetch(`/api/wallet/${user.uid}/claim-phone-bonus`, {
        method: 'POST',
        headers: await authJsonHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.ok && Number(data.granted) > 0) {
        setGranted(Number(data.granted));
        setStage('done');
        onClaimed?.(Number(data.granted));
      } else {
        // Not an error: the number is genuinely spent, or the account is already at the total.
        setMessage(String(data?.message || 'No bonus was added.'));
        setStage('refused');
      }
    } catch {
      setError('Your number is verified, but the bonus could not be added. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async () => {
    setError('');
    if (otp.trim().length < 4) { setError('Enter the code from your SMS.'); return; }
    setBusy(true);
    try {
      const user = auth.currentUser;
      if (!user) { setError('Please sign in again, then claim the bonus.'); setBusy(false); return; }
      if (Capacitor.isNativePlatform()) {
        if (!nativeVerificationId.current) throw new Error('Send a code first.');
        const { PhoneAuthProvider } = (await import('firebase/auth')) as any;
        await linkWithCredential(user, PhoneAuthProvider.credential(nativeVerificationId.current, otp.trim()));
      } else {
        if (!confirmation.current) throw new Error('Send a code first.');
        await confirmation.current.confirm(otp.trim());
      }
      await settle();
    } catch (err: any) {
      setError(linkErrorMessage(String(err?.code || err?.message || '')));
      setBusy(false);
    }
  };

  if (stage === 'done') {
    return (
      <div className="rounded-[1.6rem] border border-emerald-500/25 bg-emerald-500/[0.08] p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          <div>
            <p className="text-sm font-black tracking-tight text-emerald-200">
              ₹{rupees(granted)} added to your wallet
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-[#8b949e]">
              Your number is verified. Your account is also easier to recover now.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (stage === 'refused') {
    return (
      <div className="rounded-[1.6rem] border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#8b949e]" />
          <p className="text-[11px] leading-relaxed text-[#8b949e]">{message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[1.6rem] border border-indigo-500/25 bg-indigo-500/[0.07] p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <Gift className="mt-0.5 h-4 w-4 shrink-0 text-indigo-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black tracking-tight text-indigo-200">
            ₹{rupees(claimableTokens)} more — verify your number
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-[#8b949e]">
            {/* Says what the money BUYS, not just what it is: "₹250" means nothing to someone who has
                never seen a token bill. And the number earns its keep for the user too, rather than
                being a tax we collect — it is what makes the account recoverable. */}
            Enough for another full app. Verifying also keeps your account recoverable if you lose
            access to your email.
          </p>

          {stage === 'offer' && (
            <button
              onClick={() => setStage('phone')}
              className="mt-3 rounded-xl bg-indigo-600 px-4 py-2.5 text-[11px] font-black uppercase tracking-widest text-white transition-colors hover:bg-indigo-500"
            >
              Claim ₹{rupees(claimableTokens)}
            </button>
          )}

          {stage === 'phone' && (
            <div className="mt-3 space-y-2">
              <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#0d1117] px-3 py-2.5">
                <Smartphone className="h-3.5 w-3.5 shrink-0 text-[#484f58]" />
                <span className="text-[12px] font-mono text-[#8b949e]">+91</span>
                <input
                  value={phone}
                  onChange={(e) => setPhone(sanitisePhoneInput(e.target.value))}
                  inputMode="numeric"
                  autoComplete="tel"
                  placeholder="98765 43210"
                  aria-label="Mobile number"
                  className="min-w-0 flex-1 bg-transparent text-[13px] font-mono text-white outline-none placeholder:text-[#484f58]"
                />
              </div>
              <button
                onClick={sendCode}
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-[11px] font-black uppercase tracking-widest text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Send code
              </button>
            </div>
          )}

          {stage === 'otp' && (
            <div className="mt-3 space-y-2">
              <input
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 8))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="Enter code"
                aria-label="Verification code"
                className="w-full rounded-xl border border-white/10 bg-[#0d1117] px-3 py-2.5 text-center text-[15px] font-mono tracking-[0.4em] text-white outline-none placeholder:tracking-normal placeholder:text-[#484f58]"
              />
              <button
                onClick={verifyCode}
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-[11px] font-black uppercase tracking-widest text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Verify &amp; claim
              </button>
            </div>
          )}

          {message && <p className="mt-2 text-[10px] text-emerald-300/80">{message}</p>}
          {error && <p className="mt-2 text-[10px] leading-relaxed text-amber-300">{error}</p>}

          {/* Invisible reCAPTCHA host (web only). Must exist in the DOM before the verifier is built. */}
          <div ref={recaptchaRef} />
        </div>
      </div>
    </div>
  );
};

export default PhoneBonusCard;
