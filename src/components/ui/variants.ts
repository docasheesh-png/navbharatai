// P-DESIGN.1 — Single source of truth for UI-primitive variant classes.
//
// The 116 components re-implemented buttons/inputs/cards/badges ad-hoc with inline Tailwind, so there
// was no shared variant/size/state system. These PURE resolvers centralize that vocabulary; the React
// primitives in this folder consume them. Pure (string in → string out) so they are unit-testable in
// the node test env without a DOM. Tailwind v4 classes; indigo is the app's accent.

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';
export type BadgeVariant = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 font-semibold rounded-lg transition-colors ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/60 disabled:opacity-40 disabled:cursor-not-allowed';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-indigo-600 hover:bg-indigo-500 text-white',
  secondary: 'bg-white/10 hover:bg-white/15 text-white border border-white/10',
  ghost: 'bg-transparent hover:bg-white/10 text-[#8b949e] hover:text-white',
  danger: 'bg-red-600 hover:bg-red-500 text-white',
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

const BADGE_VARIANTS: Record<BadgeVariant, string> = {
  neutral: 'bg-white/10 text-[#c9d1d9] border-white/10',
  success: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  warning: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  danger: 'bg-red-500/15 text-red-300 border-red-500/30',
  info: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
};

/** Resolve the full className for a Badge. Pure. */
export function badgeClasses(variant: BadgeVariant = 'neutral'): string {
  return `inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${
    BADGE_VARIANTS[variant] ?? BADGE_VARIANTS.neutral
  }`;
}

/** Resolve the surface className for a Card. Pure. */
export function cardClasses(): string {
  return 'bg-[#161b22] border border-white/10 rounded-2xl';
}

/** Resolve the className for a text Input / Select. Pure. */
export function inputClasses(invalid = false): string {
  return (
    'w-full bg-zinc-900 border rounded-xl px-3 py-2 text-sm text-white placeholder:text-[#6e7681] ' +
    'focus:outline-none transition-colors ' +
    (invalid
      ? 'border-red-500/60 focus:border-red-500'
      : 'border-zinc-700 focus:border-indigo-500')
  );
}

// ── P-DESIGN.2 — Overlay & interaction primitives (Popover / Drawer / BottomSheet) ──
// Pure class resolvers for the overlay atoms, so their look/positioning vocabulary lives here too.

export type OverlaySide = 'left' | 'right';

/** Full-screen dimming backdrop shared by Drawer / BottomSheet. Pure. */
export function overlayBackdropClasses(): string {
  return 'fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm';
}

/** Floating panel for a click-triggered Popover (anchored under its trigger). Pure. */
export function popoverPanelClasses(): string {
  return (
    'absolute z-[90] mt-1 min-w-[10rem] rounded-xl border border-white/10 bg-[#1c2128] ' +
    'shadow-2xl p-1 focus:outline-none'
  );
}

/** Side Drawer panel that slides in from the left or right. Pure. */
export function drawerPanelClasses(side: OverlaySide = 'right'): string {
  return (
    'fixed top-0 bottom-0 z-[90] w-[min(90vw,22rem)] bg-[#161b22] border-white/10 shadow-2xl ' +
    'flex flex-col ' +
    (side === 'right' ? 'right-0 border-l' : 'left-0 border-r')
  );
}

/** Bottom-sheet panel that slides up from the bottom (mobile-friendly). Pure. */
export function bottomSheetClasses(): string {
  return (
    'fixed left-0 right-0 bottom-0 z-[90] max-h-[85vh] rounded-t-2xl bg-[#161b22] border-t border-white/10 ' +
    'shadow-2xl flex flex-col'
  );
}
