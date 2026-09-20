// THE HEADER'S BADGE STRIP — the rules, with no surface attached (admin 2026-09-20).
//
// 🔴 THE FILENAME IS `headerBadgeRules`, NOT `headerBadges`, AND THAT IS NOT A STYLE CHOICE. It was
// `headerBadges.ts` beside the component `HeaderBadges.tsx` — two paths differing ONLY by case. Linux
// has two files there; macOS and Windows have one. So on the macOS runner that builds the iOS app,
// `import { HeaderBadges } from './HeaderBadges'` resolved to THIS file, which exports no such symbol,
// and every `.ipa` build died at `npm run build` — while Linux CI stayed green, because on Linux the
// import was never ambiguous. Do not reintroduce a pair of paths that differ only in case;
// `scripts/nativeShellGuard.mjs` fails CI if one appears.
//
// THE ASK, verbatim: *"aur ❓ ko hard core mat banana, future me ham yahi par ⁉️✔️❓ its use karenge,
// alag alag kamo ke liye. abhi nahi, future me."*
//
// So the header does not gain a question-mark button; it gains a STRIP, and a badge is a row of data:
// a glyph, a count, a tone and what to open. Today exactly one row is registered. Adding the next one
// is one entry in an array, and nothing about this file changes.
//
// ⚠️ AND IT STOPS THERE, DELIBERATELY. This is a list and a sort, not a plugin system: no registry
// object, no lifecycle, no dynamic loading. Building a framework for users who do not exist yet is the
// other way to get this wrong, and it costs more than the duplication it imagines it is preventing.

/** Ordered by urgency. The order is the RENDER order, so a badge never moves under the user's finger. */
export const BADGE_TONES = ['urgent', 'info', 'done'] as const;
export type BadgeTone = (typeof BADGE_TONES)[number];

export interface HeaderBadge {
  id: string;
  /**
   * The glyph, as text. Data rather than an imported icon component, because the admin named the next
   * two (⁉️ and ✔️) before either exists, and a badge whose icon is a prop cannot be the reason a
   * later one needs this file edited.
   */
  glyph: string;
  /** What a screen reader and a tooltip say. Never a bare count. */
  label: string;
  /** Zero means the badge is NOT rendered. There is no empty state, by design — see `visibleBadges`. */
  count: number;
  tone: BadgeTone;
  onOpen: () => void;
}

/**
 * How many badges the header shows at once.
 *
 * Three, because the header already carries the wallet, the framework and the build stamp on a phone,
 * and a strip that can grow without limit is a strip that eventually pushes the Stop button off the
 * screen. A fourth badge would need a decision about what collapses, and that decision belongs to
 * whoever adds it rather than to a guess made today.
 */
export const MAX_VISIBLE_BADGES = 3;

/**
 * What the header actually renders.
 *
 * 🔴 A BADGE WITH NOTHING BEHIND IT IS NEVER SHOWN, and this is the admin's first rule made
 * structural: *"yeh popup sirf tab dikhna chahiye jab sach me need ho, nahi to user isko ignore
 * karega"*. A permanently-lit icon teaches the user that it means nothing, and the day it means
 * something they will not look. Sorted by tone, then by registration order, so the same badge is
 * always in the same place.
 */
export function visibleBadges(badges: readonly HeaderBadge[]): HeaderBadge[] {
  return badges
    .filter((b) => b.count > 0)
    .map((b, i) => ({ b, i }))
    .sort((x, y) => BADGE_TONES.indexOf(x.b.tone) - BADGE_TONES.indexOf(y.b.tone) || x.i - y.i)
    .slice(0, MAX_VISIBLE_BADGES)
    .map((x) => x.b);
}

/** Counts past this are shown as "9+" so one noisy badge cannot widen the header. */
export const BADGE_COUNT_CEILING = 9;

export function badgeCountLabel(count: number): string {
  return count > BADGE_COUNT_CEILING ? `${BADGE_COUNT_CEILING}+` : String(count);
}
