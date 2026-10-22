// PAGE 2 — PROMO CODE AND REFERRAL REWARDS.
//
// Top to bottom, the order a person needs: their own referral code (copy / share), the steps that earn
// them free credit, the friends who joined with their code and how far each has got, then the box for a
// promo code they were given, and — tucked behind one tap, because it is the rarest action — buying a
// gift code for somebody else.
//
// Nothing on this page is invented. The referral card and steps are `ReferralPanel` (every amount and
// verdict is the server's); the friends are the server's `/referred` answer with masked labels; the
// promo box and the gift flow keep the exact handlers App.tsx already wires. The gift price is
// `giftPriceAtPct` — the SAME function the server prices the order with — so the buyer is never shown
// one number and charged another.

import { AlertCircle, CheckCircle2, ChevronDown, Gift as GiftIcon } from 'lucide-react';
import { ReferralPanel } from '../panels/ReferralPanel';
import { ReferredFriendsList } from './ReferredFriendsList';
import type { ReferralProgress } from '../../hooks/useReferralProgress';
import { giftPriceAtPct } from '../../lib/platformFee';
import { usePublicFlags } from '../../lib/publicFlags';
import { giftWhatsAppUrl, type GiftCodeRow } from '../../lib/giftCodeRow';

export interface PromoRewardsTabProps {
  userId: string;
  referral: ReferralProgress;
  onRefreshReferral: () => void;
  onToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
  couponCodeInput: string;
  onSetCouponCodeInput: (v: string) => void;
  isRedeemingCoupon: boolean;
  couponError: string | null;
  couponSuccess: string | null;
  onRedeemPromoCoupon: (code: string) => void;
  platformFeePct: number;
  giftFaceInput: string;
  onSetGiftFaceInput?: (v: string) => void;
  isBuyingGift: boolean;
  giftError: string | null;
  giftCodes: GiftCodeRow[];
  giftBounds: { minInr: number; maxInr: number };
  lastGiftCode: GiftCodeRow | null;
  /** The gift section exists only when this is wired — a button with nothing behind it is not shipped. */
  onCreateGiftOrder?: (faceInr: number) => void;
}

function GiftSection(props: PromoRewardsTabProps & { onCreateGiftOrder: (faceInr: number) => void }) {
  const {
    giftFaceInput, onSetGiftFaceInput, isBuyingGift, giftError, giftCodes, giftBounds, lastGiftCode,
    onCreateGiftOrder, platformFeePct, onToast,
  } = props;
  const giftPrice = giftPriceAtPct(Math.floor(Number(giftFaceInput) || 0), platformFeePct);
  const outOfBounds = giftPrice.faceInr < giftBounds.minInr || giftPrice.faceInr > giftBounds.maxInr;

  return (
    <details className="group rounded-2xl border border-line bg-card">
      <summary className="flex min-h-[56px] cursor-pointer list-none items-center justify-between gap-3 rounded-2xl p-4 text-sm font-bold text-ink [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2"><GiftIcon className="h-4 w-4 text-accent-text" aria-hidden /> Gift a promo code to a friend</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="space-y-4 border-t border-line p-4">
        <p className="text-xs font-semibold text-muted">
          Buy a code and send it to family or a friend. They redeem it in the promo code box on this page.
        </p>

        {/* THE CODE JUST BOUGHT — large, because the moment after paying is the only one that matters. */}
        {lastGiftCode && (
          <div className="space-y-3 rounded-2xl border border-success/30 bg-success/10 p-4">
            <p className="text-xs font-bold text-success">Your gift code is ready</p>
            <p className="select-all break-all font-mono text-lg font-extrabold text-ink">{lastGiftCode.code}</p>
            <p className="text-xs font-semibold text-muted">Worth ₹{lastGiftCode.faceInr.toLocaleString('en-IN')} when they redeem it.</p>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => {
                  // A clipboard write can be refused (an insecure context, a denied permission), and a
                  // silent failure here loses somebody's money — so the failure is SAID, and the code is
                  // selectable above either way.
                  navigator.clipboard?.writeText(lastGiftCode.code)
                    .then(() => onToast('Gift code copied.', 'success'))
                    .catch(() => onToast('Could not copy — press and hold the code to select it.', 'warning'));
                }}
                className="min-h-[48px] rounded-xl border border-line bg-raised px-3 text-sm font-bold text-ink hover:bg-raised-hover"
              >
                Copy code
              </button>
              <a
                href={giftWhatsAppUrl(lastGiftCode.code, lastGiftCode.faceInr)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-accent px-3 text-sm font-bold text-on-accent hover:opacity-90"
              >
                Share on WhatsApp
              </a>
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="nbai-gift-amount" className="block text-xs font-bold text-muted">
            Gift amount (₹{giftBounds.minInr} to ₹{giftBounds.maxInr.toLocaleString('en-IN')})
          </label>
          <div className="flex items-center gap-2 rounded-2xl border border-line bg-surface px-4 py-1 focus-within:border-accent">
            <span className="text-base font-bold text-muted" aria-hidden>₹</span>
            <input
              id="nbai-gift-amount"
              type="number"
              inputMode="numeric"
              min={giftBounds.minInr}
              max={giftBounds.maxInr}
              step="1"
              value={giftFaceInput}
              onChange={(e) => onSetGiftFaceInput?.(e.target.value)}
              className="min-h-[44px] min-w-0 flex-1 bg-transparent text-base font-bold text-ink focus:outline-none"
              placeholder="Amount"
            />
          </div>
        </div>

        {/* WHAT THEY PAY AND WHAT THE FRIEND GETS — both, before anything is pressed. */}
        <div className="space-y-1 rounded-2xl bg-well p-4" aria-live="polite">
          <div className="flex items-center justify-between text-sm font-semibold text-body"><span>Your friend gets</span><span>₹{giftPrice.faceInr.toFixed(2)}</span></div>
          <div className="flex items-center justify-between text-xs font-semibold text-muted"><span>Platform fee</span><span>₹{giftPrice.feeInr.toFixed(2)}</span></div>
          <div className="mt-1.5 flex items-center justify-between border-t border-line pt-1.5 text-base font-bold text-ink"><span>You pay</span><span>₹{giftPrice.payInr.toFixed(2)}</span></div>
        </div>

        {giftError && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm font-semibold text-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> <span className="break-words">{giftError}</span>
          </div>
        )}

        <button
          type="button"
          onClick={() => onCreateGiftOrder(giftPrice.faceInr)}
          disabled={isBuyingGift || outOfBounds}
          className="min-h-[52px] w-full rounded-2xl bg-accent px-5 text-base font-bold text-on-accent hover:opacity-90 disabled:opacity-40"
        >
          {isBuyingGift ? 'Opening checkout…' : `Buy gift code — ₹${giftPrice.payInr.toFixed(2)}`}
        </button>
        <p className="text-xs font-semibold text-muted">
          A code can be redeemed once, by one person, and does not expire. It cannot be exchanged for cash and
          can be spent only inside NavBharatAI.
        </p>

        {giftCodes.length > 0 && (
          <div className="space-y-2 border-t border-line pt-4">
            <p className="text-xs font-bold text-muted">Codes you have bought</p>
            <ul className="space-y-2">
              {giftCodes.map((g) => (
                <li key={g.code} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-2.5">
                  <span className="select-all break-all font-mono text-xs font-bold text-ink">{g.code}</span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm font-bold text-ink">₹{g.faceInr.toLocaleString('en-IN')}</span>
                    <span className={`block text-xs font-semibold ${g.status === 'unused' ? 'text-success' : 'text-muted'}`}>
                      {g.status === 'redeemed' ? 'Used' : g.status === 'voided' ? 'Refunded' : 'Unused'}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}

export function PromoRewardsTab(props: PromoRewardsTabProps) {
  const {
    userId, referral, onRefreshReferral, onToast, couponCodeInput, onSetCouponCodeInput,
    isRedeemingCoupon, couponError, couponSuccess, onRedeemPromoCoupon, onCreateGiftOrder,
  } = props;
  // FREE PROGRAM PAUSED (admin 2026-10-22): nothing here may hint that rewards ever existed. The referral card and
  // friends list go; the code box stays, because a PURCHASED gift code is redeemed in it, and says "gift code".
  const { freeProgramPaused } = usePublicFlags();

  return (
    <div className="space-y-5">
      {/* REFER A FRIEND — the code and the earned steps. Every number in it is the server's. */}
      {!freeProgramPaused && <ReferralPanel
        userId={userId}
        enabled={referral.enabled}
        code={referral.code}
        shareMessage={referral.shareMessage}
        rows={referral.rows}
        earnedRupees={referral.earnedRupees}
        capRupees={referral.capRupees}
        capReached={referral.capReached}
        referred={referral.referred}
        surface={referral.surface}
        canRedeem={referral.canRedeem}
        codeOpensLeft={referral.codeOpensLeft}
        webCapRupees={referral.webCapRupees}
        emailVerified={referral.emailVerified}
        phoneVerified={referral.phoneVerified}
        githubLinked={referral.githubLinked}
        onRefresh={onRefreshReferral}
        onToast={onToast}
      />}

      {!freeProgramPaused && referral.enabled && <ReferredFriendsList userId={userId} refreshKey={referral.earnedRupees} />}

      {/* A PROMO CODE the person was given. Each code can be applied once — the server enforces it. */}
      <section aria-labelledby="promo-code-heading" className="space-y-3 rounded-2xl border border-line bg-card p-5">
        <div>
          <h3 id="promo-code-heading" className="text-sm font-bold text-ink">{freeProgramPaused ? 'Have a gift code?' : 'Have a promo code?'}</h3>
          <p className="mt-0.5 text-xs font-semibold text-muted">{freeProgramPaused ? 'Each gift code can be applied once.' : 'Each promo code can be applied once.'}</p>
        </div>
        {/* The button sits UNDER the box, full width (admin 2026-09-24, phone screenshot: "apply code
            button screen se bahar ja raha hai"). Side by side, an <input> will not shrink below its
            built-in minimum width, so on a narrow phone the row was wider than the screen and the
            button was pushed off it. Stacked, both always fit, and the tap target is the full width. */}
        <div className="flex flex-col gap-3">
          <input
            type="text"
            placeholder="Enter your promo code"
            value={couponCodeInput}
            onChange={(e) => onSetCouponCodeInput(e.target.value)}
            className="w-full min-w-0 rounded-xl border border-line bg-surface px-4 py-3 font-mono text-sm font-bold uppercase tracking-widest text-ink focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={() => onRedeemPromoCoupon(couponCodeInput)}
            disabled={isRedeemingCoupon || !couponCodeInput}
            className="min-h-[48px] w-full rounded-xl bg-accent px-6 text-sm font-bold text-on-accent hover:opacity-90 disabled:opacity-40"
          >
            {isRedeemingCoupon ? 'Checking…' : 'Apply code'}
          </button>
        </div>
        {couponError && (
          <div role="alert" className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm font-semibold text-danger">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> <span className="break-words">{couponError}</span>
          </div>
        )}
        {couponSuccess && (
          <div role="status" className="flex items-start gap-2 rounded-xl border border-success/30 bg-success/10 p-3 text-sm font-semibold text-success">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> <span className="break-words">{couponSuccess}</span>
          </div>
        )}
      </section>

      {onCreateGiftOrder && <GiftSection {...props} onCreateGiftOrder={onCreateGiftOrder} />}
    </div>
  );
}
