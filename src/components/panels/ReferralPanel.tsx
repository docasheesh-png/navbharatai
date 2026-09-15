import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Circle, Copy, Gift, Loader2, Share2 } from 'lucide-react';
import { collectDeviceCheck } from '../../lib/deviceIntegrityNative';
import { normalizeReferralCodeClient } from '../../lib/referralCodeClient';
import { STEP_ORDER, type RewardStep } from '../../lib/referralStepNames';
import { authedHeaders } from '../../lib/authHeaders';
import type { ChecklistRow } from '../../lib/referralChecklist';

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
  /** Opens the existing phone-verification sheet. */
  onVerifyPhone?: () => void;
}> = (props) => {
  const { userId, enabled, code, shareMessage, rows, earnedRupees, capRupees, capReached, referred } = props;
  const [platform, setPlatform] = useState<string>('web');
  const [busy, setBusy] = useState<RewardStep | 'redeem' | null>(null);
  const [codeInput, setCodeInput] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);

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
      <div className="rounded-2xl border border-white/5 bg-black/20 p-6 text-xs font-semibold text-[#8b949e]">
        Referral rewards are not available right now.
      </div>
    );
  }

  const ordered = [...rows].sort((a, b) => STEP_ORDER.indexOf(a.step) - STEP_ORDER.indexOf(b.step));

  return (
    <div className="space-y-6">
      {/* Your code — shareable EVERYWHERE, including the website. Only claiming is Android-only. */}
      <div className="rounded-2xl border border-amber-500/20 bg-black/30 p-6">
        <h4 className="text-[10px] font-black uppercase tracking-widest text-[#8b949e]">Your Referral Code</h4>
        <div className="mt-3 flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-[#0d1117] px-5 py-3.5">
          <span className="font-mono text-base font-black tracking-widest text-amber-400">{code ?? '—'}</span>
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
        <p className="mt-4 text-xs font-semibold leading-relaxed text-amber-200/70">
          <Share2 className="mr-1 inline h-3.5 w-3.5" />
          Share your code. You earn ₹25 for each of your friend&rsquo;s three verifications — ₹75 per friend,
          up to ₹{capRupees} in total. Your friend must apply it in the Android app.
        </p>
        <p className="mt-2 text-[11px] font-bold text-[#8b949e]">
          Earned so far: <span className="text-emerald-400">₹{earnedRupees}</span> of ₹{capRupees}
          {capReached && <span className="ml-1 text-amber-400">— you have reached the maximum.</span>}
        </p>
      </div>

      {/* The four steps. */}
      <div className="rounded-2xl border border-white/5 bg-black/20 p-6">
        <h4 className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-white">
          <Gift className="h-4 w-4 text-emerald-400" /> Your free credit
        </h4>

        {!isAndroid && (
          // Honest, and the reason is stated rather than hidden. The website has no device check, so
          // it cannot pay anything — showing a Claim button here would be a button that cannot work.
          <p className="mt-3 rounded-xl border border-white/10 bg-black/30 p-3 text-[11px] font-semibold text-[#8b949e]">
            These bonuses are claimed in the NavBharatAI Android app, where each one is checked against
            your device. You can still copy and share your code from here.
          </p>
        )}

        <ul className="mt-4 space-y-2.5">
          {ordered.map((row) => {
            const blocked = blockedBy(row.step);
            return (
              <li key={row.step} className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-[#0d1117] px-4 py-3">
                <span className="flex min-w-0 items-center gap-2">
                  {row.claimed
                    ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                    : <Circle className="h-4 w-4 shrink-0 opacity-40" />}
                  <span className={`truncate text-[11px] font-semibold ${row.claimed ? 'text-[#8b949e] line-through' : 'text-white'}`}>
                    {row.label}
                  </span>
                </span>
                {!row.claimed && isAndroid && (
                  blocked
                    ? <span className="shrink-0 text-[10px] font-bold text-amber-400/80">{blocked}</span>
                    : (
                      <button
                        onClick={() => claim(row.step)}
                        disabled={busy !== null}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white transition-all hover:bg-emerald-500 disabled:opacity-40"
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
          <div className="mt-5 border-t border-white/5 pt-5">
            <h5 className="text-[10px] font-black uppercase tracking-widest text-[#8b949e]">Have a friend&rsquo;s code?</h5>
            <div className="mt-2.5 flex gap-3">
              <input
                type="text"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                placeholder="Enter referral code"
                className="flex-1 rounded-xl border border-white/10 bg-[#0d1117] px-4 py-3 font-mono text-xs font-bold uppercase tracking-widest text-white transition-colors focus:border-amber-500 focus:outline-none"
              />
              <button
                onClick={redeem}
                disabled={busy !== null || !codeInput.trim()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-6 py-3 text-[9px] font-black uppercase tracking-widest text-black transition-all hover:bg-amber-600 disabled:bg-amber-500/20 disabled:text-[#8b949e]/30"
              >
                {busy === 'redeem' && <Loader2 className="h-3 w-3 animate-spin" />} Apply
              </button>
            </div>
            <p className="mt-2 text-[10px] font-semibold text-[#8b949e]">A code can be applied once, to a new account.</p>
          </div>
        )}

        {notice && (
          <div className={`mt-4 flex items-center gap-2 rounded-xl p-3 text-xs font-semibold ${
            notice.kind === 'ok'
              ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
              : 'border border-red-500/20 bg-red-500/10 text-red-400'}`}>
            {notice.kind === 'ok' ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
            <span>{notice.text}</span>
          </div>
        )}
      </div>
    </div>
  );
};
