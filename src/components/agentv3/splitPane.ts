// The chat ⇆ workspace split (admin 2026-08-17: "preview aur chat ke bich ka border move ho sake —
// user jab chahe jisko bada ya chota kar le", plus "tablet me tap karke left/right").
//
// Until now the two panes were a hard-coded `w-1/2` each: a 50/50 nobody could change. Both halves
// of that are wrong for real work — reading a long chat wants a wide chat, judging a layout wants a
// wide preview, and the user is the only one who knows which they are doing right now.
//
// WHY THE LOGIC LIVES HERE RATHER THAN IN THE COMPONENT: every decision below is a pure function of
// numbers, and a dragged divider is exactly the kind of feature whose edge cases (a tiny window, a
// stored value from a bigger screen, the last step of the ladder) are tedious to reproduce by hand
// and trivial to assert. The component is left with pointer plumbing only.

/** Chat's share of the width, in percent. The workspace gets the rest. */
export const SPLIT_DEFAULT = 50;

/**
 * The narrowest either pane may become, in CSS pixels.
 *
 * 280 is not a round number picked for looks: below it the composer's button row wraps into itself,
 * and a preview narrower than this stops representing any real phone. It is also small enough that
 * both minimums (560px total) still fit the 640px breakpoint at which the panes stop stacking — so
 * the clamp can never fight the layout it lives in. The panes carry the same number as a CSS
 * `min-width`, which is what enforces it when the WINDOW shrinks (no resize listener needed).
 */
export const MIN_PANE_PX = 280;

/**
 * The ladder the ◀ ▶ buttons walk. Tablet's reason to exist (admin's own suggestion, and correct):
 * a 1px border is not a touch target — a finger is ~44px wide, so dragging one is a game of chance.
 * Tapping through fixed stops is precise, predictable, and reaches any useful layout in two taps.
 *
 * The stops are deliberately few and asymmetric-friendly: quarter, third, half, two-thirds,
 * three-quarters. More stops would mean more taps to cross the screen for no extra expressiveness.
 */
export const SPLIT_STEPS = [25, 33, 50, 67, 75] as const;

const STORAGE_KEY = 'nbai_v3_split_pct';

/** The minimum/maximum chat percentage a container of this width can honour. */
export function splitBounds(containerPx: number, minPx: number = MIN_PANE_PX): { min: number; max: number } {
  // A container too narrow for two minimums has no room to choose: pin to the middle rather than
  // returning an inverted range, so callers can use these bounds without a special case.
  if (!(containerPx > 0) || containerPx < minPx * 2) return { min: SPLIT_DEFAULT, max: SPLIT_DEFAULT };
  const minPct = (minPx / containerPx) * 100;
  return { min: minPct, max: 100 - minPct };
}

/** Hold a split inside what the container can actually honour. */
export function clampSplit(pct: number, containerPx: number, minPx: number = MIN_PANE_PX): number {
  const { min, max } = splitBounds(containerPx, minPx);
  if (!Number.isFinite(pct)) return SPLIT_DEFAULT;
  return Math.min(max, Math.max(min, pct));
}

/** The split a pointer at `clientX` implies, given the panes' container rect. */
export function splitFromPointer(clientX: number, rect: { left: number; width: number }, minPx: number = MIN_PANE_PX): number {
  if (!(rect.width > 0)) return SPLIT_DEFAULT;
  return clampSplit(((clientX - rect.left) / rect.width) * 100, rect.width, minPx);
}

/**
 * What the ◀ / ▶ buttons (and the arrow keys) should do next.
 *
 * The last step to the RIGHT is not another ratio — it closes the workspace, so "keep tapping ▶"
 * ends at a full-width chat, which is what the admin described as moving the border "last right".
 * That deliberately reuses the EXISTING `showWorkspace` state rather than inventing a second way to
 * express "the workspace is hidden": two states encoding one truth is the bug class that produced
 * this session's Resume-button report, and it is not worth repeating for a divider.
 */
export type SplitAction = { kind: 'split'; pct: number } | { kind: 'collapse' };

export function nextSplitAction(current: number, dir: 'left' | 'right', containerPx: number, minPx: number = MIN_PANE_PX): SplitAction {
  const { min, max } = splitBounds(containerPx, minPx);
  const usable = SPLIT_STEPS.filter((s) => s >= min - 0.5 && s <= max + 0.5);
  const stops: number[] = usable.length > 0 ? [...usable] : [SPLIT_DEFAULT];
  if (dir === 'right') {
    const next = stops.find((s) => s > current + 0.5);
    // Past the widest chat the ladder offers → close the workspace entirely.
    return next === undefined ? { kind: 'collapse' } : { kind: 'split', pct: next };
  }
  const prev = [...stops].reverse().find((s) => s < current - 0.5);
  // Already at the widest preview: stay put rather than pretending something happened.
  return { kind: 'split', pct: prev ?? stops[0] };
}

/** The workspace pane's real width in CSS pixels — shown live while dragging. */
export function paneWidthPx(splitPct: number, containerPx: number): number {
  if (!(containerPx > 0)) return 0;
  return Math.round(containerPx * (1 - splitPct / 100));
}

/**
 * Read the user's saved split. Deliberately forgiving: a corrupt or out-of-range value returns the
 * default rather than throwing, because a broken preference must never be able to break the layout.
 * (Not clamped to a container here — the caller does that against its own real width.)
 */
export function loadSplit(storage?: Pick<Storage, 'getItem'>): number {
  try {
    const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    const raw = store?.getItem(STORAGE_KEY);
    const n = raw === null || raw === undefined ? NaN : Number(raw);
    return Number.isFinite(n) && n > 0 && n < 100 ? n : SPLIT_DEFAULT;
  } catch {
    return SPLIT_DEFAULT; // private-mode / blocked storage is not a reason to lose the layout
  }
}

/** Remember the split. Best-effort: a storage failure must never interrupt a drag. */
export function saveSplit(pct: number, storage?: Pick<Storage, 'setItem'>): void {
  try {
    const store = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    store?.setItem(STORAGE_KEY, String(Math.round(pct)));
  } catch { /* best-effort */ }
}
