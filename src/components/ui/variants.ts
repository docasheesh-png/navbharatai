// P-DESIGN.1 — Single source of truth for UI-primitive variant classes.
//
// The 116 components re-implemented buttons/inputs/cards/badges ad-hoc with inline Tailwind, so there
// was no shared variant/size/state system. These PURE resolvers centralize that vocabulary; the React
// primitives in this folder consume them. Pure (string in → string out) so they are unit-testable in
// the node test env without a DOM. Tailwind v4 classes; indigo is the app's accent.

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 font-semibold rounded-lg transition-colors ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 disabled:opacity-40 disabled:cursor-not-allowed';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-indigo-600 hover:bg-indigo-500 text-on-accent',
  secondary: 'bg-raised hover:bg-raised-hover text-ink border border-line',
  ghost: 'bg-transparent hover:bg-raised text-muted hover:text-ink',
  danger: 'bg-red-600 hover:bg-red-500 text-on-accent',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'text-[11px] px-2.5 py-1.5',
  md: 'text-xs px-3.5 py-2',
  lg: 'text-sm px-5 py-2.5',
};

/** Resolve the full className for a Button. Pure. */
export function buttonClasses(variant: ButtonVariant = 'primary', size: ButtonSize = 'md'): string {
  return `${BUTTON_BASE} ${BUTTON_VARIANTS[variant] ?? BUTTON_VARIANTS.primary} ${BUTTON_SIZES[size] ?? BUTTON_SIZES.md}`;
}

/** Resolve the surface className for a Card. Pure. */
export function cardClasses(): string {
  return 'bg-card border border-line rounded-2xl';
}

/** Resolve the className for a text Input / Select. Pure. */
export function inputClasses(invalid = false): string {
  return (
    'w-full bg-card border rounded-xl px-3 py-2 text-sm text-ink placeholder:text-faint ' +
    'focus:outline-none transition-colors ' +
    (invalid
      ? 'border-red-500/60 focus:border-red-500'
      : 'border-line focus:border-indigo-500')
  );
}

// ── P-DESIGN.2 — Overlay primitives ────────────────────────────────────────────────
// Popover is the only overlay atom left: the Drawer and BottomSheet components, and the
// backdrop + Badge resolvers that existed only for them, were removed on 2026-08-24 as
// unreachable. `cardClasses` below is deliberately kept — Card.tsx went, but two live panels
// (ProjectInsightsPanel, GalleryPanel) use the resolver directly.

/** Floating panel for a click-triggered Popover (anchored under its trigger). Pure. */
export function popoverPanelClasses(): string {
  return (
    'absolute z-[90] mt-1 min-w-[10rem] rounded-xl border border-line bg-raised ' +
    'shadow-2xl p-1 focus:outline-none'
  );
}

