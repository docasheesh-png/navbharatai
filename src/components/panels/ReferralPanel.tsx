import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Circle, Copy, Gift, Loader2, Share2 } from 'lucide-react';
import { shareReferral } from '../../lib/shareReferral';
import { collectDeviceCheck } from '../../lib/deviceIntegrityNative';
import { normalizeReferralCodeClient } from '../../lib/referralCodeClient';
import { STEP_ORDER, type RewardStep } from '../../lib/referralStepNames';
import { authedHeaders } from '../../lib/authHeaders';
import type { ChecklistRow } from '../../lib/referralChecklist';
import { auth as firebaseAuth } from '../../lib/firebase';
import { sendVerificationEmail, linkGithubAccount, describeLinkGithubError } from '../../lib/accountVerificationActions';
import { VerifyPhoneSheet } from '../VerifyPhoneSheet';

/**
 * REFER A FRIEND — the screen where the four steps are actually claimed.
 *
 * 🔒 IT NEVER SHOWS A BUTTON THAT CANNOT WORK. That is the whole design brief, and it is the second
 * absolute rule applied to a screen: a row whose prerequisite is unmet shows what to do ("Verify your
 * email first"), not a Claim button that would fail; the website shows an honest "in the Android app"
 * state rather than a form with nothing behind it; and an older shell that has no device plugin says
 * so instead of failing silently. The referral surface this replaces was decorative, and every rule
 * here exists so that cannot happen twice.
 *
 * 🔒 IT DECIDES NOTHING ABOUT MONEY. Every amount is the server's, every verdict is the server's, and
 * a claim that is refused prints the server's own sentence. Nothing here adds ₹ to anything.
 */
export const ReferralPanel: React.FC<{
  userId: string;
  enabled: boolean;
  code: string | null;
  shareMessage: string;
  rows: ChecklistRow[];
  earnedRupees: number;
  capRupees: number;
  capReached: boolean;
  referred: boolean;
  /** What the account has actually done, so a row can say what is missing instead of failing. */
  emailVerified: boolean;
  phoneVerified: boolean;
  githubLinked: boolean;
  onRefresh: () => void;
  onToast: (msg: string, kind?: 'success' | 'error') => void;
}> = (props) => {
  const { userId, enabled, code, shareMessage, rows, earnedRupees, capRupees, capReached, referred } = props;
  const [platform, setPlatform] = useState<string>('web');
  const [busy, setBusy] = useState<RewardStep | 'redeem' | null>(null);
  const [codeInput, setCodeInput] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);

  // ── The three verification actions, real (admin 2026-09-16) ────────────────────────────────────
  // 🔴 ROOT CAUSE this replaces: a blocked row used to render "Verify your email address first" /
  // "Connect your GitHub account first" as PLAIN TEXT, and this component's own `onVerifyPhone` prop
  // was declared and never called by anything — three buttons that only ever rendered as words.
  // `emailVerified` / `phoneVerified` / `githubLinked` are the SERVER's answer (useReferralProgress,
  // itself reading the same Firebase Admin facts `stepIsProven` claims against), so nothing here needs
  // to derive them client-side — completing an action and calling `props.onRefresh()` re-fetches the
  // real state, the same as every other change on this screen already does.
  const [phoneSheetOpen, setPhoneSheetOpen] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const verifyEmail = useCallback(async () => {
    const user = firebaseAuth.currentUser;
    if (!user?.email) { setNotice({ kind: 'bad', text: 'No email on this account.' }); return; }
    setBusy('email'); setNotice(null);
    try {
      await sendVerificationEmail(user);
      setEmailSent(true);
      setNotice({ kind: 'ok', text: `We sent a link to ${user.email}. Open it, then press Refresh below.` });
    } catch (e) {
      setNotice({ kind: 'bad', text: e instanceof Error ? e.message : 'Could not send the verification email.' });
    } finally {
      setBusy(null);
    }
  }, []);

  const connectGithub = useCallback(async () => {
    setBusy('github'); setNotice(null);
    try {
      const outcome = await linkGithubAccount(firebaseAuth);
      if (outcome === 'ok') props.onRefresh();
      // 'cancelled' (closed popup) and 'redirecting' (page navigates away) need no message here.
    } catch (e) {
      setNotice({ kind: 'bad', text: describeLinkGithubError(e) });
    } finally {
      setBusy(null);
    }
  }, [props]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (alive) setPlatform(Capacitor.getPlatform());
      } catch { /* web */ }
    })();
    return () => { alive = false; };
  }, []);

  const isAndroid = platform === 'android';

  /** Collect the device evidence and POST it. Shared by claim and redeem — one place, one message. */
  const post = useCallback(async (path: string, body: Record<string, unknown>) => {
    const device = await collectDeviceCheck();
    if (device.outcome !== 'ok') {
      // Honest and specific: an older shell needs an update, everything else is "try again".
      throw new Error(device.outcome === 'unavailable'
        ? 'Update the NavBharatAI app from the Play Store to claim this bonus.'
        : 'We could not check this device just now. Please try again in a few minutes.');
    }
    const res = await fetch(path, {
      method: 'POST',
      headers: { ...(await authedHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, deviceId: device.deviceId, integrityToken: device.integrityToken, platform: 'android' }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.ok) throw new Error(String(data?.message || 'That did not work. Please try again.'));
    return data;
  }, []);

  const claim = useCallback(async (step: RewardStep) => {
    setBusy(step); setNotice(null);
    try {
      const data = await post(`/api/referral/${encodeURIComponent(userId)}/claim`, { step });
      setNotice({ kind: 'ok', text: `₹${data.rupees} added to your wallet.` });
      props.onRefresh();
    } catch (e) {
      setNotice({ kind: 'bad', text: e instanceof Error ? e.message : 'That did not work.' });
    } finally {
      setBusy(null);
    }
  }, [post, userId, props]);

  const redeem = useCallback(async () => {
    const clean = normalizeReferralCodeClient(codeInput);
    if (!clean) { setNotice({ kind: 'bad', text: 'That code does not look right — please check the spelling.' }); return; }
    setBusy('redeem'); setNotice(null);
    try {
      await post(`/api/referral/${encodeURIComponent(userId)}/redeem`, { code: clean });
      setNotice({ kind: 'ok', text: 'Referral code applied. You can now claim that step.' });
      setCodeInput('');
      props.onRefresh();
    } catch (e) {
      setNotice({ kind: 'bad', text: e instanceof Error ? e.message : 'That did not work.' });
    } finally {
      setBusy(null);
    }
  }, [post, userId, codeInput, props]);

  /** What stops this step being claimed right now, or null when the Claim button is honest. */
  const blockedBy = (step: RewardStep): string | null => {
    if (step === 'email' && !props.emailVerified) return 'Verify your email address first';
    if (step === 'mobile' && !props.phoneVerified) return 'Verify your mobile number first';
    if (step === 'github' && !props.githubLinked) return 'Connect your GitHub account first';
    if (step === 'referral-code' && !referred) return 'Apply a friend’s code below first';
    return null;
  };

  if (!enabled) {
    return (
      <div className="rounded-2xl border border-line bg-well p-6 text-xs font-semibold text-muted">
        Referral rewards are not available right now.
      </div>
    );
  }

  const ordered = [...rows].sort((a, b) => STEP_ORDER.indexOf(a.step) - STEP_ORDER.indexOf(b.step));

  return (
    <div className="space-y-6">
      {/* Portals to document.body, so its position in this tree doesn't matter. Reuses the SAME sheet
          ProfilePage does, rather than a second copy — see accountVerificationActions.ts's own note
          on why phone stays out of that file. */}
      <VerifyPhoneSheet
        auth={firebaseAuth}
        open={phoneSheetOpen}
        onClose={() => setPhoneSheetOpen(false)}
        reason="A verified number is one of your three referral steps, worth ₹100."
        onVerified={() => { setPhoneSheetOpen(false); props.onRefresh(); }}
        onSignInInstead={() => window.dispatchEvent(new CustomEvent('navbharat:navigate', { detail: { signIn: 'phone' } }))}
      />
      {/* Your code — shareable EVERYWHERE, including the website. Only claiming is Android-only. */}
      <div className="rounded-2xl border border-amber-500/20 bg-well p-6">
        <h4 className="text-[10px] font-black uppercase tracking-widest text-muted">Your Referral Code</h4>
        <div className="mt-3 flex items-center justify-between gap-4 rounded-xl border border-line bg-surface px-5 py-3.5">
          <span className="font-mono text-base font-black tracking-widest text-warn">{code ?? '—'}</span>
          <button
            disabled={!code}
            onClick={() => {
              navigator.clipboard?.writeText(shareMessage || code || '');
              props.onToast('Referral link copied ✓', 'success');
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-black transition-all hover:bg-amber-600 disabled:opacity-40"
          >
            <Copy className="h-3 w-3" /> Copy
          </button>
        </div>
        {/* A REAL share button, not an icon on a sentence (admin 2026-09-17). Same shared helper the
            profile card uses, so the two surfaces can never behave differently. */}
        <button
          disabled={!code}
          onClick={async () => {
            const outcome = await shareReferral(shareMessage || code || '', undefined, navigator);
            if (outcome === 'shared') props.onToast('Shared ✓', 'success');
            if (outcome === 'copied') props.onToast('Referral link copied ✓', 'success');
            if (outcome === 'failed') props.onToast('Could not open sharing — use Copy instead.', 'error');
            // 'dismissed' is silent: the user closed the sheet on purpose.
          }}
          className="mt-3 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-[11px] font-black uppercase tracking-widest text-black transition-all hover:bg-amber-600 disabled:opacity-40"
        >
          <Share2 className="h-3.5 w-3.5" /> Share
        </button>
        <p className="mt-4 text-xs font-semibold leading-relaxed text-warn">
          You earn ₹25 for each of your friend&rsquo;s three verifications — ₹75 per friend,
          up to ₹{capRupees} in total. Your friend must apply it in the Android app.
        </p>
        <p className="mt-2 text-[11px] font-bold text-muted">
          Earned so far: <span className="text-success">₹{earnedRupees}</span> of ₹{capRupees}
          {capReached && <span className="ml-1 text-warn">— you have reached the maximum.</span>}
        </p>
      </div>

      {/* The four steps. */}
      <div className="rounded-2xl border border-line bg-well p-6">
        <h4 className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-ink">
          <Gift className="h-4 w-4 text-success" /> Your free credit
        </h4>

        {!isAndroid && (
          // Honest, and the reason is stated rather than hidden. The website has no device check, so
          // it cannot pay anything — showing a Claim button here would be a button that cannot work.
          <p className="mt-3 rounded-xl border border-line bg-well p-3 text-[11px] font-semibold text-muted">
            These bonuses are claimed in the NavBharatAI Android app, where each one is checked against
            your device. You can still copy and share your code from here.
          </p>
        )}

        <ul className="mt-4 space-y-2.5">
          {ordered.map((row) => {
            const blocked = blockedBy(row.step);
            // The real click-to-verify action for a blocked step. `referral-code` has none here on
            // purpose — applying a code is the box below, not a one-tap action.
            const action: { label: string; onClick: () => void } | null =
              row.step === 'email' ? (emailSent ? { label: 'Refresh', onClick: () => props.onRefresh() } : { label: 'Verify', onClick: () => void verifyEmail() })
              : row.step === 'mobile' ? { label: 'Verify', onClick: () => setPhoneSheetOpen(true) }
              : row.step === 'github' ? { label: 'Connect', onClick: () => void connectGithub() }
              : null;
            return (
              <li key={row.step} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3">
                <span className="flex min-w-0 items-center gap-2">
                  {row.claimed
                    ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                    : <Circle className="h-4 w-4 shrink-0 opacity-40" />}
                  <span className={`truncate text-[11px] font-semibold ${row.claimed ? 'text-muted line-through' : 'text-ink'}`}>
                    {row.label}
                  </span>
                </span>
                {!row.claimed && isAndroid && (
                  blocked
                    ? (
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-[10px] font-bold text-warn">{blocked}</span>
                        {action && (
                          <button
                            onClick={action.onClick}
                            disabled={busy !== null}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-on-accent transition-all hover:bg-indigo-500 disabled:opacity-40"
                          >
                            {busy === row.step && <Loader2 className="h-3 w-3 animate-spin" />}
                            {action.label}
                          </button>
                        )}
                      </span>
                    )
                    : (
                      <button
                        onClick={() => claim(row.step)}
                        disabled={busy !== null}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-on-accent transition-all hover:bg-emerald-500 disabled:opacity-40"
                      >
                        {busy === row.step && <Loader2 className="h-3 w-3 animate-spin" />}
                        Claim ₹{row.rupees}
                      </button>
                    )
                )}
              </li>
            );
          })}
        </ul>

        {/* Apply a friend's code — Android only, and only while the account has none. */}
        {isAndroid && !referred && (
          <div className="mt-5 border-t border-line pt-5">
            <h5 className="text-[10px] font-black uppercase tracking-widest text-muted">Have a friend&rsquo;s code?</h5>
            <div className="mt-2.5 flex gap-3">
              <input
                type="text"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                placeholder="Enter referral code"
                className="flex-1 rounded-xl border border-line bg-surface px-4 py-3 font-mono text-xs font-bold uppercase tracking-widest text-ink transition-colors focus:border-amber-500 focus:outline-none"
              />
              <button
                onClick={redeem}
                disabled={busy !== null || !codeInput.trim()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-6 py-3 text-[9px] font-black uppercase tracking-widest text-black transition-all hover:bg-amber-600 disabled:bg-amber-500/20 disabled:text-on-accent"
              >
                {busy === 'redeem' && <Loader2 className="h-3 w-3 animate-spin" />} Apply
              </button>
            </div>
            <p className="mt-2 text-[10px] font-semibold text-muted">A code can be applied once, to a new account.</p>
          </div>
        )}

        {notice && (
          <div className={`mt-4 flex items-center gap-2 rounded-xl p-3 text-xs font-semibold ${
            notice.kind === 'ok'
              ? 'border border-emerald-500/20 bg-emerald-500/10 text-success'
              : 'border border-red-500/20 bg-red-500/10 text-danger'}`}>
            {notice.kind === 'ok' ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
            <span>{notice.text}</span>
          </div>
        )}
      </div>
    </div>
  );
};
