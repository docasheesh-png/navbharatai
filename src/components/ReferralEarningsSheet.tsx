// THE EARNING SHEET — who used my referral code, and how far each of them has got.
//
// Admin: *"user ka refral code... user ki profile me clear show hona chahiye. sath me button-
// 'earning'. is earning button par click karne se — yeh user ka refral code kis kis user ne use kiya
// hai, uski email id aur us user ne 3 me se kitne step complete kar liye woh list bhi show ho!"*
//
// 🔒 IT DECIDES NOTHING ABOUT MONEY. Every count here is `GET /api/referral/:userId/referred`'s own
// answer — read straight from `friendVerificationStatus`, the exact signal the server pays the
// referrer's ₹25-a-step from — so a friend shown here at "2 of 3" can never disagree with what the
// wallet actually received for them. This screen only DISPLAYS the server's own bookkeeping.
//
// 🔒 SAME PLATFORM RULE AS THE REST OF THE REFERRAL SURFACE: the server answers `enabled: false`
// when the master switch is off, or when the account has never asked on Android at all — this sheet
// simply shows the server's own honest state rather than inventing one.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Mail, Smartphone, Loader2, Users, CheckCircle2, Circle } from 'lucide-react';
import { Github } from './ui/BrandIcons';
import { authedHeaders } from '../lib/authHeaders';

interface ReferredFriend {
  email: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  githubLinked: boolean;
  completedCount: number;
}

export interface ReferralEarningsSheetProps {
  userId: string;
  open: boolean;
  onClose: () => void;
}

type LoadState = 'loading' | 'ready' | 'error';

function formatEmail(email: string | null): string {
  // Missing only when the account behind that step lookup could not be read — a real account with
  // no visible mailbox does not happen on this platform, but the row must still say something honest
  // rather than render blank.
  return email && email.trim() ? email : 'Account details unavailable';
}

/** One of the three verification badges. `Icon` covers both lucide icons and the vendored Github mark. */
function StepBadge({ label, done, Icon }: { label: string; done: boolean; Icon: React.ComponentType<{ className?: string }> }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold ${done ? 'text-emerald-400' : 'text-[#484f58]'}`}>
      {done ? <CheckCircle2 className="w-3 h-3 shrink-0" /> : <Circle className="w-3 h-3 shrink-0" />}
      <Icon className="w-3 h-3 shrink-0" />
      {label}
    </span>
  );
}

export const ReferralEarningsSheet: React.FC<ReferralEarningsSheetProps> = ({ userId, open, onClose }) => {
  const [state, setState] = useState<LoadState>('loading');
  const [enabled, setEnabled] = useState(true);
  const [friends, setFriends] = useState<ReferredFriend[]>([]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      setState('loading');
      try {
        const res = await fetch(`/api/referral/${encodeURIComponent(userId)}/referred`, {
          headers: await authedHeaders(),
        });
        const data = await res.json().catch(() => null);
        if (!alive) return;
        if (!res.ok || !data?.ok) { setState('error'); return; }
        setEnabled(data.enabled !== false);
        setFriends(Array.isArray(data.friends) ? data.friends : []);
        setState('ready');
      } catch {
        if (alive) setState('error');
      }
    })();
    return () => { alive = false; };
  }, [open, userId]);

  if (!open) return null;

  return createPortal(
    <div
      // `nb-sheet-overlay` / `nb-sheet` (index.css) — never a bare `vh` cap. A phone's `vh` is the
      // LARGE viewport (toolbar hidden), so an `85vh` card sits taller than what is actually on
      // screen and the browser offers no scroll at all for the content past the fold: the exact
      // "niche scroll nahi hota" bug this repo already root-caused twice (admin 2026-08-23,
      // 2026-09-06). These two classes cap against the VISIBLE viewport instead.
      // `nb-sheet-over-nav`: z-[400] sits ABOVE the global tab bar's z-150, so this card paints OVER
      // the bar rather than being covered by it — it must NOT reserve a strip for a bar it already
      // covers (`tests/sheetOverlayGeometry.test.ts`, same pairing PublishCelebration uses at z-300).
      className="nb-sheet-overlay nb-sheet-over-nav fixed inset-0 z-[400] flex items-center justify-center bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label="Who used your referral code"
    >
      <div className="nb-sheet flex w-full flex-col rounded-2xl border border-white/10 bg-[#0d1117] shadow-2xl overflow-hidden sm:max-w-lg">
        <div className="shrink-0 flex items-start justify-between gap-3 border-b border-white/5 p-5">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-amber-400" />
            <div>
              <h3 className="text-sm font-bold text-white">Who used your code</h3>
              {state === 'ready' && enabled && friends.length > 0 && (
                <p className="text-[10px] font-semibold text-[#8b949e]">
                  {friends.length} {friends.length === 1 ? 'person has' : 'people have'} used your referral code
                </p>
              )}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-zinc-500 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* The one scroll container — the header above stays put (`shrink-0`), this body reaches
            `min-h-0` so it can actually shrink instead of pushing the card past the cap. */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
          {state === 'loading' && (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-[#8b949e]">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}

          {state === 'error' && (
            <p className="py-8 text-center text-xs font-semibold text-red-400">
              Could not load this right now. Please try again.
            </p>
          )}

          {state === 'ready' && !enabled && (
            <p className="py-8 text-center text-xs font-semibold text-[#8b949e]">
              Referral rewards are not available right now.
            </p>
          )}

          {state === 'ready' && enabled && friends.length === 0 && (
            <p className="py-8 text-center text-xs font-semibold text-[#8b949e]">
              Nobody has used your referral code yet. Share it and check back here.
            </p>
          )}

          {state === 'ready' && enabled && friends.length > 0 && (
            <ul className="space-y-2.5">
              {friends.map((f, i) => (
                <li key={i} className="rounded-xl border border-white/5 bg-[#161b22] p-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-xs font-semibold text-white">{formatEmail(f.email)}</span>
                    <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-amber-400">
                      {f.completedCount} of 3
                    </span>
                  </div>
                  <div className="mt-2.5 flex items-center gap-4">
                    <StepBadge label="Mobile" done={f.phoneVerified} Icon={Smartphone} />
                    <StepBadge label="Email" done={f.emailVerified} Icon={Mail} />
                    <StepBadge label="GitHub" done={f.githubLinked} Icon={Github} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};
