// THE DOT — one component, so the two tones can never mean two different things on two screens.
//
// The Action Navigator decides WHAT is pending (`actionNavigator.ts`); this decides what that looks
// like. Keeping the second half here is what stops a later screen from inventing a third colour, or
// from painting an opportunity red because red was what the first screen used.
//
// 🎨 IT USES `bg-current` ON A TOKEN-COLOURED SPAN, NOT A COLOUR LITERAL. `bg-red-500` — what the
// older publish dot used — is invisible or wrong on the Light and High-contrast themes and is
// counted by `themeTokensOnly.test.ts`, whose baseline for a new file is ZERO. `text-danger` and
// `text-info` are the real tokens, and `bg-current` paints the dot in whatever the token resolves to
// on the active theme.
//
// ♿ A DOT IS NOT AN ACCESSIBLE LABEL. Every dot carries the pending action's own words, so a screen
// reader says "Publish your changes" rather than announcing nothing at all.

import type { ActionTone } from '../lib/actionNavigator';

export interface ActionDotProps {
  /** `null` renders nothing — so a caller can pass `badgeAt(...)` straight through with no branch. */
  tone: ActionTone | null;
  /** What this dot is about, from `badgeLabelAt`. Required: a bare dot is not a label. */
  label: string | null;
  /** `sm` for a dot beside a small header control, `md` inside a menu row. */
  size?: 'sm' | 'md';
  className?: string;
}

export function ActionDot({ tone, label, size = 'md', className = '' }: ActionDotProps) {
  if (!tone) return null;
  // Red for a fault the user can see the consequences of; blue for a next step that is simply
  // available. The split is the admin's approved design ("do rang theek hai"), and the reason it is
  // a ternary here rather than a lookup table is that a third tone should be a deliberate decision,
  // not something a new map entry can slip in.
  const toneClass = tone === 'attention' ? 'text-danger' : 'text-info';
  const box = size === 'sm' ? 'w-1.5 h-1.5' : 'w-2 h-2';
  return (
    <span
      role="status"
      aria-label={label ?? undefined}
      title={label ?? undefined}
      className={`${toneClass} ${box} rounded-full bg-current shrink-0 ${className}`}
    />
  );
}
