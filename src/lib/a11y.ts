// P-DESIGN.3 — Platform Accessibility Engine (dependency-free).
//
// Centralises the platform's own a11y primitives so accessibility isn't scattered ad-hoc across
// components. The DESIGN follows the same "pure math, thin adapter" split as `charts/chartGeometry`:
//   • Pure functions (clampFontScale / resolveReduceMotion / nextRovingIndex / computeTrapTarget)
//     hold all the logic and are unit-tested in a plain Node environment (no DOM).
//   • Thin DOM adapters (createFocusTrap / applyFontScale / applyMotionMode) just wire that logic to
//     the document; they are verified by `tsc` + `build` and consumed by real components.
//
// Consumers: the Drawer/BottomSheet modal overlays trap focus via `createFocusTrap`; Settings →
// General drives font-scaling (`applyFontScale`) and the tri-state motion preference
// (`applyMotionMode`, which supersedes the old binary "Reduce Animations" toggle while staying
// backward-compatible with the `navbharat_reduce_motion` key that `main.tsx` reads on boot).

// ───────────────────────────── Constants ─────────────────────────────

/** CSS selector matching every element that can receive keyboard focus inside a container. */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

/**
 * Font-scale bounds — a real accessibility zoom range, 50 %–200 % (admin 2026-08-08: "50% to 200%
 * tak font size ho"). It was a cautious 90–140 %, which is narrower than what the platform's own
 * accessibility settings offer, so a user who needs genuinely large text could not get it here.
 *
 * THIS IS THE ONLY DEFINITION. `main.tsx` applies the stored scale before React mounts (to avoid a
 * flash of unscaled text) and used to re-implement this clamp with the numbers inlined — so widening
 * the range here alone would have left the boot path silently pinning every user back to 140 % until
 * hydration. It now imports `clampFontScale` from this module: one definition, no drift.
 */
export const FONT_SCALE_MIN = 0.5;
export const FONT_SCALE_MAX = 2;
export const FONT_SCALE_DEFAULT = 1;
export const FONT_SCALE_STEP = 0.1;

export const FONT_SCALE_STORAGE_KEY = 'navbharat_font_scale';
/** Legacy boolean key ('true'|'false') that `main.tsx` reads on boot — kept in sync for no-FOUC. */
export const MOTION_LEGACY_KEY = 'navbharat_reduce_motion';
/** Tri-state motion preference key. */
export const MOTION_MODE_KEY = 'navbharat_motion_mode';

/** Motion preference: animations on (default), always reduced, or follow the OS setting. */
export type MotionMode = 'animated' | 'reduced' | 'system';

export type RovingOrientation = 'horizontal' | 'vertical' | 'both';

// ───────────────────────────── Pure logic ─────────────────────────────

/** Clamp + round a requested font scale into the safe range. Pure. */
export function clampFontScale(scale: number): number {
  if (!Number.isFinite(scale)) return FONT_SCALE_DEFAULT;
  const clamped = Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, scale));
  return Math.round(clamped * 100) / 100;
}

/** Resolve whether motion should be REDUCED, given the user's mode and the OS preference. Pure. */
export function resolveReduceMotion(mode: MotionMode, systemPrefersReduced: boolean): boolean {
  if (mode === 'reduced') return true;
  if (mode === 'animated') return false;
  return systemPrefersReduced; // 'system' → follow the OS
}

/**
 * Given the current index and a key press, compute the next roving-tabindex position (with wrap).
 * Returns the same (normalised) index when the key isn't a navigation key for this orientation, or
 * -1 when there are no items. Pure — the DOM adapter maps index → element.focus().
 */
export function nextRovingIndex(
  current: number,
  count: number,
  key: string,
  orientation: RovingOrientation = 'vertical',
): number {
  if (count <= 0) return -1;
  const cur = current < 0 || current >= count ? 0 : current;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  const nextKeys = orientation === 'horizontal' ? ['ArrowRight'] : orientation === 'vertical' ? ['ArrowDown'] : ['ArrowRight', 'ArrowDown'];
  const prevKeys = orientation === 'horizontal' ? ['ArrowLeft'] : orientation === 'vertical' ? ['ArrowUp'] : ['ArrowLeft', 'ArrowUp'];
  if (nextKeys.includes(key)) return (cur + 1) % count;
  if (prevKeys.includes(key)) return (cur - 1 + count) % count;
  return cur;
}

/**
 * Focus-trap core. Given the count of ordered focusable elements, the index of the currently
 * focused one (-1 if focus is outside the trap), and whether Shift is held, return the index that
 * Tab / Shift+Tab must move focus TO in order to keep focus inside a modal — or `null` when the
 * browser's native Tab already keeps focus inside (so we don't interfere). Pure.
 */
export function computeTrapTarget(count: number, activeIndex: number, shiftKey: boolean): number | null {
  if (count <= 0) return null;
  if (count === 1) return 0; // a single focusable stays focused
  if (activeIndex === -1) return shiftKey ? count - 1 : 0; // focus escaped → pull to an edge
  if (!shiftKey && activeIndex === count - 1) return 0; // Tab off the last → wrap to first
  if (shiftKey && activeIndex === 0) return count - 1; // Shift+Tab off the first → wrap to last
  return null; // in the middle → let the browser handle it
}

// ───────────────────────────── DOM adapters ─────────────────────────────

export interface FocusTrap {
  /** Detach the trap and restore focus to the element that was focused before it activated. */
  release: () => void;
}

/**
 * Trap keyboard focus inside `container` (a modal overlay). Focuses the first focusable element on
 * activation, keeps Tab / Shift+Tab cycling within the container, and restores the previously
 * focused element on `release()`. Best-effort and SSR-safe (a no-op if there is no document).
 */
export function createFocusTrap(container: HTMLElement, opts?: { initialFocus?: HTMLElement | null }): FocusTrap {
  if (typeof document === 'undefined' || !container) {
    return { release: () => {} };
  }
  const previouslyFocused = document.activeElement as HTMLElement | null;

  const focusables = (): HTMLElement[] =>
    Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const list = focusables();
    const activeIndex = list.indexOf(document.activeElement as HTMLElement);
    const target = computeTrapTarget(list.length, activeIndex, e.shiftKey);
    if (target !== null) {
      e.preventDefault();
      list[target]?.focus();
    }
  };

  container.addEventListener('keydown', onKeyDown);
  const initial = opts?.initialFocus ?? container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
  initial?.focus();

  return {
    release: () => {
      container.removeEventListener('keydown', onKeyDown);
      try { previouslyFocused?.focus?.(); } catch { /* element gone — ignore */ }
    },
  };
}

/** Does the OS request reduced motion right now? Best-effort, SSR-safe. */
export function systemPrefersReducedMotion(): boolean {
  try {
    return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Apply a font scale to the document (`--nb-font-scale`) and persist it. Returns the clamped value. */
export function applyFontScale(scale: number): number {
  const s = clampFontScale(scale);
  try { document.documentElement.style.setProperty('--nb-font-scale', String(s)); } catch { /* no document */ }
  try { localStorage.setItem(FONT_SCALE_STORAGE_KEY, String(s)); } catch { /* storage unavailable */ }
  return s;
}

/** Read the persisted font scale (clamped), defaulting to 1. */
export function getStoredFontScale(): number {
  try {
    const v = localStorage.getItem(FONT_SCALE_STORAGE_KEY);
    return v ? clampFontScale(parseFloat(v)) : FONT_SCALE_DEFAULT;
  } catch {
    return FONT_SCALE_DEFAULT;
  }
}

/**
 * Apply a motion mode: toggles the `nb-reduce-motion` class, persists the tri-state, and keeps the
 * legacy boolean key in sync so `main.tsx`'s pre-mount apply stays correct. Returns whether motion
 * ended up reduced.
 */
export function applyMotionMode(mode: MotionMode): boolean {
  const reduce = resolveReduceMotion(mode, systemPrefersReducedMotion());
  try { document.documentElement.classList.toggle('nb-reduce-motion', reduce); } catch { /* no document */ }
  try {
    localStorage.setItem(MOTION_MODE_KEY, mode);
    localStorage.setItem(MOTION_LEGACY_KEY, reduce ? 'true' : 'false');
  } catch { /* storage unavailable */ }
  return reduce;
}

/** Read the persisted motion mode, migrating the legacy boolean key when the tri-state isn't set. */
export function getStoredMotionMode(): MotionMode {
  try {
    const m = localStorage.getItem(MOTION_MODE_KEY);
    if (m === 'animated' || m === 'reduced' || m === 'system') return m;
    return localStorage.getItem(MOTION_LEGACY_KEY) === 'true' ? 'reduced' : 'animated';
  } catch {
    return 'animated';
  }
}
