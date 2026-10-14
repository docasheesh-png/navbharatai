import React, { useCallback, useState } from 'react';
import { AlertCircle, CheckCircle2, Circle, Copy, Gift, Loader2, Share2, CircleX } from 'lucide-react';
import { shareReferral } from '../../lib/shareReferral';
import { postReferral, type ReferralSurface } from '../../lib/referralClaim';
import { normalizeReferralCodeClient } from '../../lib/referralCodeClient';
import { STEP_ORDER, type RewardStep } from '../../lib/referralStepNames';
import type { ChecklistRow } from '../../lib/referralChecklist';
import { auth as firebaseAuth } from '../../lib/firebase';
import { sendVerificationEmail, linkGithubAccount, describeLinkGithubError } from '../../lib/accountVerificationActions';
import { VerifyPhoneSheet } from '../VerifyPhoneSheet';

/**
 * REFER A FRIEND — the screen where the five free-credit steps are actually claimed.
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
  /** Which rule set this account is on: the app's five steps or the website's three (server's answer). */
  surface: ReferralSurface;
  /** May this account still apply a friend's code? App only, and only while it is still "new". */
  canRedeem: boolean;
  /** App opens left in which a code may still be applied (server's answer), or null. */
  codeOpensLeft?: number | null;
  /** The website's own ceiling (₹200), or null in the app. */
  webCapRupees: number | null;
  /** What the account has actually done, so a row can say what is missing instead of failing. */
  emailVerified: boolean;
  phoneVerified: boolean;
  githubLinked: boolean;
  onRefresh: () => void;
  onToast: (msg: string, kind?: 'success' | 'error') => void;
}> = (props) => {
  const { userId, enabled, code, shareMessage, rows, earnedRupees, capRupees, capReached, referred, surface, canRedeem } = props;
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

  const isAndroid = surface === 'android';

  /** POST with the evidence this surface can give — one shared module (referralClaim.ts), one message. */
  const post = useCallback(
    (path: string, body: Record<string, unknown>) => postReferral(path, body, surface),
    [surface],
  );

  const claim = useCallback(async (step: RewardStep) => {
    setBusy(step); setNotice(null);
    try {
      const data = await post(`/api/referral/${encodeURIComponent(userId)}/claim`, { step });
      setNotice({ kind: 'ok', text: String(data.message || `₹${data.rupees} added to your wallet.`) });
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
    <div className="space-y-5">
      {/* Portals to document.body, so its position in this tree doesn't matter. Reuses the SAME sheet
          ProfilePage does, rather than a second copy — see accountVerificationActions.ts's own note
          on why phone stays out of that file. */}
      <VerifyPhoneSheet
        auth={firebaseAuth}
        open={phoneSheetOpen}
        onClose={() => setPhoneSheetOpen(false)}
        reason="A verified mobile number earns ₹100 of free credit."
        onVerified={() => { setPhoneSheetOpen(false); props.onRefresh(); }}
        onSignInInstead={() => window.dispatchEvent(new CustomEvent('navbharat:navigate', { detail: { signIn: 'phone' } }))}
      />

      {/* YOUR CODE — shareable EVERYWHERE, including the website. Only claiming is Android-only.
          Copy and Share sit side by side as two equal 48px targets; the code itself is the largest thing on the card. */}
      <section aria-labelledby="referral-code-heading" className="rounded-2xl border border-line bg-card p-5">
        <h3 id="referral-code-heading" className="text-sm font-bold text-ink">Your referral code</h3>
        <p className="mt-0.5 text-xs font-semibold text-muted">Invite friends and earn tokens when they verify.</p>
        <div className="mt-3 rounded-xl border border-dashed border-line bg-surface px-4 py-3 text-center">
          <span className="break-all font-mono text-2xl font-extrabold tracking-widest text-ink">{code ?? '—'}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            disabled={!code}
            onClick={() => {
              navigator.clipboard?.writeText(shareMessage || code || '');
              props.onToast('Referral link copied ✓', 'success');
            }}
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-line bg-raised px-3 text-sm font-bold text-ink transition-colors hover:bg-raised-hover disabled:opacity-40"
          >
            <Copy className="h-4 w-4" aria-hidden /> Copy
          </button>
          {/* A REAL share button, not an icon on a sentence (admin 2026-09-17). Same shared helper the
              profile card uses, so the two surfaces can never behave differently. */}
          <button
            type="button"
            disabled={!code}
            onClick={async () => {
              const outcome = await shareReferral(shareMessage || code || '', undefined, navigator);
              if (outcome === 'shared') props.onToast('Shared ✓', 'success');
              if (outcome === 'copied') props.onToast('Referral link copied ✓', 'success');
              if (outcome === 'failed') props.onToast('Could not open sharing — use Copy instead.', 'error');
              // 'dismissed' is silent: the user closed the sheet on purpose.
            }}
            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-accent px-3 text-sm font-bold text-on-accent transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Share2 className="h-4 w-4" aria-hidden /> Share
          </button>
        </div>
        <p className="mt-4 text-sm font-semibold leading-relaxed text-body">
          You earn ₹25 each time a friend you invited completes a verification — up to ₹75 per friend and
          ₹{capRupees} in total. Your friend applies your code in the NavBharatAI Android app.
        </p>
        <p className="mt-2 text-sm font-bold text-ink">
          Earned so far: <span className="text-success">₹{earnedRupees}</span> <span className="font-semibold text-muted">of ₹{capRupees}</span>
          {capReached && <span className="ml-1 font-semibold text-warn">— you have reached the maximum.</span>}
        </p>
      </section>

      {/* The free-credit steps. */}
      <section aria-labelledby="free-credit-heading" className="rounded-2xl border border-line bg-card p-5">
        <h3 id="free-credit-heading" className="flex items-center gap-2 text-sm font-bold text-ink">
          <Gift className="h-4 w-4 text-success" aria-hidden /> Your own free credit
        </h3>
        <p className="mt-0.5 text-xs font-semibold text-muted">Finish each step once to claim its reward.</p>

        {!isAndroid && (
          // Honest about exactly what the website can do: two steps, a ceiling, and the mobile first.
          // The other two rewards are real too, just not here — say where, rather than hide them.
          <p className="mt-3 rounded-xl border border-line bg-well p-3 text-xs font-semibold text-muted">
            On the website you earn ₹50 for signing up, ₹50 for logging in with a verified email and
            ₹100 for verifying your mobile{props.webCapRupees ? <> — up to ₹{props.webCapRupees}</> : null}. The
            referral-code and GitHub rewards are in the NavBharatAI Android app.
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
              // Stacked on a phone (the words get the full width, the button its own 44px row), side by
              // side from `sm` up — a label and a button squeezed onto one 320px line is how a step
              // name ends up cut to "Logged in with a ver…".
              <li key={row.step} className="flex flex-col gap-2.5 rounded-xl border border-line bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <span className="flex min-w-0 items-start gap-2.5">
                  {row.claimed
                    ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-label="Done" />
                    : row.missed
                      ? <CircleX className="mt-0.5 h-5 w-5 shrink-0 text-danger" aria-label="Missed" />
                      : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-label="Not done yet" />}
                  <span className={`break-words text-sm font-semibold ${row.claimed || row.missed ? 'text-muted line-through' : 'text-ink'}`}>
                    {row.label}
                  </span>
                </span>
                {row.missed && !row.claimed && (
                  // The chance has passed (admin 2026-09-30): say so, and offer nothing — there is nothing to do.
                  <span className="shrink-0 text-xs font-bold text-danger">Missed</span>
                )}
                {!row.claimed && !row.missed && (
                  blocked
                    ? (
                      <span className="flex shrink-0 flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-warn">{blocked}</span>
                        {action && (
                          <button
                            onClick={action.onClick}
                            disabled={busy !== null}
                            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg bg-accent px-4 text-xs font-bold text-on-accent transition-opacity hover:opacity-90 disabled:opacity-50"
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
                        className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-accent px-4 text-xs font-bold text-on-accent transition-opacity hover:opacity-90 disabled:opacity-50"
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

        {/* Apply a friend's code — the app only (never on the website), and only while the account can
            still redeem (the server's `canRedeem`: new, and no code applied yet). */}
        {isAndroid && canRedeem && !referred && (
          <div className="mt-5 border-t border-line pt-5">
            <h4 className="text-sm font-bold text-ink">Have a friend&rsquo;s code?</h4>
            {/* Stacked, like the promo code box: side by side the input's minimum width pushed the button
                off a narrow phone, and this panel only ever shows on a phone. */}
            <div className="mt-2.5 flex flex-col gap-3">
              <input
                type="text"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                placeholder="Enter referral code"
                className="w-full min-w-0 rounded-xl border border-line bg-surface px-4 py-3 font-mono text-sm font-bold uppercase tracking-widest text-ink transition-colors focus:border-accent focus:outline-none"
              />
              <button
                onClick={redeem}
                disabled={busy !== null || !codeInput.trim()}
                className="inline-flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-xl bg-accent px-6 text-sm font-bold text-on-accent transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {busy === 'redeem' && <Loader2 className="h-3 w-3 animate-spin" />} Apply
              </button>
            </div>
            <p className="mt-2 text-xs font-semibold text-muted">
              A code can be applied once, to a new account{typeof props.codeOpensLeft === 'number'
                ? <> — only in your first 3 app opens or 7 days. {props.codeOpensLeft === 0
                  ? 'This is your last chance.'
                  : `${props.codeOpensLeft} more app open${props.codeOpensLeft === 1 ? '' : 's'} after this one.`}</>
                : '.'}
            </p>
          </div>
        )}

        {notice && (
          <div role="status" className={`mt-4 flex items-start gap-2 rounded-xl p-3 text-sm font-semibold ${
            notice.kind === 'ok'
              ? 'border border-success/30 bg-success/10 text-success'
              : 'border border-danger/30 bg-danger/10 text-danger'}`}>
            {notice.kind === 'ok' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
            <span className="break-words">{notice.text}</span>
          </div>
        )}
      </section>
    </div>
  );
};
