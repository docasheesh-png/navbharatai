// THE HEADER'S BADGE STRIP — the surface (admin 2026-09-20). Rules live in `headerBadgeRules.ts`.

import { visibleBadges, badgeCountLabel, type BadgeTone, type HeaderBadge } from './headerBadgeRules';

/**
 * Tone → classes. Tokens only, so every theme repaints it; the brand hues that survive are the ones
 * the ratchet permits (a 500-shade tint and a hue border read correctly on light and dark alike).
 */
const TONE_CLASS: Record<BadgeTone, string> = {
  urgent: 'bg-amber-500/15 border-amber-500/40 text-warn hover:bg-amber-500/25',
  info: 'bg-raised border-line text-muted hover:text-ink hover:border-indigo-500',
  done: 'bg-emerald-500/10 border-emerald-500/25 text-success hover:bg-emerald-500/20',
};

export function HeaderBadges({ badges }: { badges: readonly HeaderBadge[] }) {
  const shown = visibleBadges(badges);
  // Nothing to say ⇒ nothing rendered. Not a greyed-out icon, not a zero: see `visibleBadges`.
  if (shown.length === 0) return null;
  return (
    <div className="flex items-center gap-1">
      {shown.map((badge) => (
        <button
          key={badge.id}
          type="button"
          onClick={badge.onOpen}
          title={badge.label}
          aria-label={`${badge.label} — ${badge.count}`}
          aria-haspopup="dialog"
          className={`flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${TONE_CLASS[badge.tone]}`}
        >
          <span aria-hidden className="text-[11px] leading-none">{badge.glyph}</span>
          {badgeCountLabel(badge.count)}
        </button>
      ))}
    </div>
  );
}
