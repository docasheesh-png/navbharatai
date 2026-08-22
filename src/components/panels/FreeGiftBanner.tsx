import React from 'react';
import { Gift, Sparkles, AlertTriangle } from 'lucide-react';
import { PhoneBonusCard } from './PhoneBonusCard';

/**
 * The free gift ladder, made visible.
 *
 * WHY THIS EXISTS (2026-07-28): the ladder (₹250 at signup → +₹200 → +₹200 → cut off) was built
 * server-side and was, from the user's side, invisible — credit simply appeared, a ledger row was
 * written that no screen rendered, and nothing said how much was left or when the next one arrived. A
 * balance that changes on its own with no explanation is not a feature, it is a mystery.
 *
 * It is also the moment that matters commercially. "This was your last free credit" is when someone
 * decides whether to recharge, and the app was not saying it. So the finished state is deliberately the
 * loudest of the three, and it names the next step rather than just reporting an ending.
 *
 * Every number comes from the server's `freeGift` block, which is derived from the SAME inputs the
 * grant itself uses — so this can never show a figure the ledger disagrees with.
 */

export interface FreeGift {
  giftedTokens: number;
  capTokens: number;
  remainingTokens: number;
  exhausted: boolean;
  nextCreditAt: string | null;
  /** 'v2' = the weekly ladder is retired for this wallet; free credit now comes from verifying a
   *  phone instead. Absent on every wallet created before that switch, which keeps its ladder. */
  plan?: string;
  /** v2 only: wallet tokens a phone verification would add right now. 0 once at the total. */
  phoneBonusClaimable?: number;
}

export interface FreeGiftBannerProps {
  freeGift?: FreeGift | null;
  tokensPerRupee?: number;
  /** Opens the recharge flow — shown once the gift is finished. */
  onRecharge?: () => void;
  /** Refetch the wallet after a claim lands, so the balance on screen is the real one. */
  onClaimed?: (grantedTokens: number) => void;
}

/** "in 3 days" / "tomorrow" / "today" — a date is harder to feel than a distance. */
export function creditArrivesIn(nextCreditAt: string, now: number = Date.now()): string {
  const at = Date.parse(nextCreditAt);
  if (!Number.isFinite(at)) return '';
  const days = Math.ceil((at - now) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}

export const FreeGiftBanner: React.FC<FreeGiftBannerProps> = ({ freeGift, tokensPerRupee = 100, onRecharge, onClaimed }) => {
  if (!freeGift || !Number.isFinite(freeGift.capTokens) || freeGift.capTokens <= 0) return null;

  const rupees = (t: number) => Math.round(t / tokensPerRupee);
  const usedPct = Math.max(0, Math.min(100, (freeGift.giftedTokens / freeGift.capTokens) * 100));
  const isLast = !freeGift.exhausted && freeGift.remainingTokens > 0
    && freeGift.remainingTokens <= freeGift.capTokens - freeGift.giftedTokens
    && freeGift.capTokens - freeGift.giftedTokens <= rupeesToTokens(200, tokensPerRupee);

  // A v2 wallet with credit still to claim gets the claim, not the ladder and not the recharge nag.
  // Ordering matters: such a wallet reads as `exhausted` in ladder terms (it has had everything the
  // ladder would give), and pushing "add credit" at someone with ₹250 sitting unclaimed would be
  // wrong at the exact moment being wrong costs the most.
  const claimable = freeGift.plan === 'v2' ? Number(freeGift.phoneBonusClaimable ?? 0) : 0;
  if (claimable > 0) {
    return <PhoneBonusCard claimableTokens={claimable} tokensPerRupee={tokensPerRupee} onClaimed={onClaimed} />;
  }

  if (freeGift.exhausted) {
    return (
      <div className="rounded-[1.6rem] border border-amber-500/25 bg-amber-500/[0.07] p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-black tracking-tight text-amber-200">
              Your free credit is finished
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-[#8b949e]">
              You&apos;ve used all ₹{rupees(freeGift.capTokens)} of the free credit NavBharatAI gives every
              new account. Add credit to keep building — you only pay for what you actually use.
            </p>
            {onRecharge && (
              <button
                onClick={onRecharge}
                className="mt-3 rounded-xl bg-amber-500 px-4 py-2.5 text-[11px] font-black uppercase tracking-widest text-black transition-colors hover:bg-amber-400"
              >
                Add credit
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[1.6rem] border border-emerald-500/20 bg-emerald-500/[0.06] p-4 sm:p-5">
      <div className="flex items-start gap-3">
        {isLast ? (
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
        ) : (
          <Gift className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black tracking-tight text-emerald-200">
            ₹{rupees(freeGift.giftedTokens)} of ₹{rupees(freeGift.capTokens)} free credit received
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-[#8b949e]">
            {freeGift.nextCreditAt ? (
              <>
                Your next ₹{rupees(freeGift.remainingTokens > rupeesToTokens(200, tokensPerRupee)
                  ? rupeesToTokens(200, tokensPerRupee)
                  : freeGift.remainingTokens)} arrives{' '}
                <span className="font-semibold text-emerald-300">{creditArrivesIn(freeGift.nextCreditAt)}</span>
                {isLast ? ' — and that is the last one.' : '.'}
              </>
            ) : (
              <>₹{rupees(freeGift.remainingTokens)} of free credit still to come.</>
            )}
          </p>

          {/* Progress along the ladder — how much of the one-time gift has arrived. */}
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-emerald-400/80 transition-all"
              style={{ width: `${usedPct}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

function rupeesToTokens(rupees: number, tokensPerRupee: number): number {
  return rupees * tokensPerRupee;
}

export default FreeGiftBanner;
