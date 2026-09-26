import { useState } from 'react';
import { CheckCircle2, ChevronRight, Circle, Gift, Loader2 } from 'lucide-react';
import { rewardsChecklistModel, type RewardChecklistInput, type RewardChecklistRow } from '../lib/rewardsChecklist';
import { postReferral, REFERRAL_GRANTED_EVENT } from '../lib/referralClaim';
import { openProfileVerifications } from '../lib/profileFocus';

/**
 * The rewards checklist, pinned as the FIRST item of the notifications panel (admin 2026-09-26).
 *
 * Every rule about what a row says and where its button goes lives in `lib/rewardsChecklist.ts`
 * (pure, tested); this file only draws it and wires the three actions. It decides nothing about money:
 * a Claim is a request the server re-decides, and the amounts are the server's.
 *
 * Colour comes from theme tokens only — this is new code, so it carries no literals for the ratchet.
 */
export function RewardsChecklistCard({ userId, progress, onRefresh, onNavigate }: {
  userId: string;
  progress: RewardChecklistInput;
  onRefresh: () => void;
  /** Called before leaving for the profile or the wallet, so the panel can close behind the user. */
  onNavigate: () => void;
}) {
  const model = rewardsChecklistModel(progress);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!model) return null;

  const act = async (row: RewardChecklistRow) => {
    setError(null);
    if (row.state === 'complete') {
      onNavigate();
      if (row.target === 'wallet') {
        window.dispatchEvent(new CustomEvent('navbharat:navigate', { detail: { view: 'billing' } }));
      } else {
        openProfileVerifications();
      }
      return;
    }
    if (row.state !== 'claim') return;
    setBusy(row.step);
    try {
      const data = await postReferral(`/api/referral/${encodeURIComponent(userId)}/claim`, { step: row.step }, progress.surface);
      const rupees = Number(data.rupees) || 0;
      if (rupees > 0) window.dispatchEvent(new CustomEvent(REFERRAL_GRANTED_EVENT, { detail: { rupees } }));
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  // Everything claimed: one quiet line, still first — the admin asked for it "hamesha", and a finished
  // checklist is worth a glance, not a card's worth of green.
  if (model.allDone) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 border-b border-line bg-well">
        <CheckCircle2 className="w-4 h-4 shrink-0 text-success" />
        <span className="text-[12px] font-bold text-ink">{model.headline}</span>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 border-b border-line bg-well" data-testid="rewards-checklist">
      <div className="flex items-center gap-2">
        <Gift className="w-4 h-4 shrink-0 text-success" />
        <span className="text-[12px] font-black text-ink">{model.headline}</span>
      </div>
      <ul className="mt-2.5 space-y-1.5">
        {model.rows.map((row) => (
          <li key={row.step} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-card px-3 py-2">
            <span className="flex min-w-0 items-center gap-2">
              {row.state === 'done'
                ? <CheckCircle2 className="w-4 h-4 shrink-0 text-success" aria-label="Done" />
                : <Circle className="w-4 h-4 shrink-0 text-faint" aria-label="Pending" />}
              <span className="min-w-0">
                <span className={`block truncate text-[12px] font-bold ${row.state === 'done' ? 'text-muted' : 'text-ink'}`}>
                  {row.name} <span className={row.state === 'done' ? 'text-success' : 'text-accent-text'}>· ₹{row.rupees}</span>
                </span>
                <span className="block truncate text-[10px] text-muted">{row.hint}</span>
              </span>
            </span>
            {row.state !== 'done' && (
              <button
                onClick={() => void act(row)}
                disabled={busy !== null}
                className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-accent px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider text-on-accent disabled:opacity-50"
              >
                {busy === row.step && <Loader2 className="w-3 h-3 animate-spin" />}
                {row.state === 'claim' ? 'Claim' : <>Complete <ChevronRight className="w-3 h-3" /></>}
              </button>
            )}
          </li>
        ))}
      </ul>
      {model.surfaceNote && <p className="mt-2 text-[10px] text-muted">{model.surfaceNote}</p>}
      {error && <p className="mt-2 text-[10px] text-danger">{error}</p>}
    </div>
  );
}
