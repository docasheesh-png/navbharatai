import type React from 'react';
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

/**
 * The divider's own width in CSS pixels — ONE source of truth, used by the component's style AND by
 * every calculation below.
 *
 * WHY IT HAS TO BE IN THE MATH (bug reported 2026-08-19: "line kahi aur dikh rahi hai"). The divider
 * lives BETWEEN the panes, inside the same container, so the width the panes actually share is the
 * container MINUS these pixels. Sizing them as `split%` and `(100-split)%` of the whole container asks
 * flex for 100% + 11px, which it resolves by shrinking both — so the border lands ~11px left of
 * `containerWidth * split/100`, which is exactly where the drag preview was drawing its line. The
 * promise this also keeps: "Phone" must give the preview a real 390px, and a divider unaccounted for
 * makes that 390 an 401.
 */
export const DIVIDER_PX = 11;

/** The width the two panes genuinely share — the container minus the divider standing between them. */
export function trackWidth(containerPx: number, dividerPx: number = DIVIDER_PX): number {
  return Math.max(0, containerPx - dividerPx);
}

const STORAGE_KEY = 'nbai_v3_split_pct';

/**
 * ONE-TAP DEVICE WIDTHS — the divider stops being a layout knob and becomes a real check
 * (admin 2026-08-17: "yeh bhi adjust kar ke banao").
 *
 * The live px number while dragging was half the idea; a number you can only see WHILE your hand is
 * moving is not a testing tool. These are the other half: tap "Phone" and the preview really is
 * 390px wide — the app rendered at a phone width, in place, with no device emulator, no separate
 * mode, and nothing faked. It is the natural companion of the three-screen contract the builder was
 * taught the day before: the engine is told to build for phone/tablet/desktop, and this is where the
 * user checks whether it did.
 *
 * THE NUMBERS ARE REAL DEVICES, not round guesses:
 *   • 390 — iPhone 14/15/16 logical width, and within a few px of most modern Androids.
 *   • 768 — the classic tablet-portrait width, and the breakpoint most CSS frameworks treat as the
 *     tablet boundary (`md` in Tailwind).
 * "Desktop" is deliberately NOT a number: it means "give the preview the rest of the room", because
 * a desktop is whatever the user's screen is, not a width we get to pick.
 */
export const DEVICE_WIDTHS = [
  { id: 'phone', label: 'Phone', px: 390 },
  { id: 'tablet', label: 'Tablet', px: 768 },
] as const;

export type DeviceId = typeof DEVICE_WIDTHS[number]['id'] | 'desktop';

/** How close a pane width must be to a device's width to count as "showing" it. */
const DEVICE_MATCH_TOLERANCE_PX = 12;

/**
 * The split that gives the WORKSPACE pane `targetPx` — or as close as the window honestly allows.
 *
 * Returns the split AND whether the exact width was achievable, because those are different facts
 * and the UI must not conflate them: on a narrow laptop, "Tablet" (768px) may be impossible without
 * crushing the chat below its minimum. We give the widest we can and let the caller say so. The
 * label always shows the REAL width, so an approximation can never masquerade as the real thing.
 */
export function splitForPaneWidth(targetPx: number, containerPx: number, minPx: number = MIN_PANE_PX, dividerPx: number = DIVIDER_PX): { pct: number; exact: boolean } {
  const track = trackWidth(containerPx, dividerPx);
  if (!(track > 0)) return { pct: SPLIT_DEFAULT, exact: false };
  const wanted = ((track - targetPx) / track) * 100;
  const pct = clampSplit(wanted, containerPx, minPx, dividerPx);
  // Exact when the clamp did not have to move it — compare in PIXELS, since a sub-percent nudge on a
  // wide monitor is still several pixels and would show as a different number to the user.
  return { pct, exact: Math.abs(paneWidthPx(pct, containerPx, dividerPx) - targetPx) <= 1 };
}

/** Which device chip (if any) the current pane width is showing. `null` = a custom, dragged width. */
export function matchedDevice(paneWidth: number, containerPx: number, minPx: number = MIN_PANE_PX, dividerPx: number = DIVIDER_PX): DeviceId | null {
  for (const d of DEVICE_WIDTHS) {
    if (Math.abs(paneWidth - d.px) <= DEVICE_MATCH_TOLERANCE_PX) return d.id;
  }
  // "Desktop" = the preview is as wide as this window can give it, i.e. the chat is at its minimum.
  const { min } = splitBounds(containerPx, minPx, dividerPx);
  if (trackWidth(containerPx, dividerPx) > 0 && Math.abs(paneWidth - paneWidthPx(min, containerPx, dividerPx)) <= 1) return 'desktop';
  return null;
}

/** The minimum/maximum chat percentage a container of this width can honour. */
export function splitBounds(containerPx: number, minPx: number = MIN_PANE_PX, dividerPx: number = DIVIDER_PX): { min: number; max: number } {
  const track = trackWidth(containerPx, dividerPx);
  // A track too narrow for two minimums has no room to choose: pin to the middle rather than
  // returning an inverted range, so callers can use these bounds without a special case.
  if (!(track > 0) || track < minPx * 2) return { min: SPLIT_DEFAULT, max: SPLIT_DEFAULT };
  const minPct = (minPx / track) * 100;
  return { min: minPct, max: 100 - minPct };
}

/** Hold a split inside what the container can actually honour. */
export function clampSplit(pct: number, containerPx: number, minPx: number = MIN_PANE_PX, dividerPx: number = DIVIDER_PX): number {
  const { min, max } = splitBounds(containerPx, minPx, dividerPx);
  if (!Number.isFinite(pct)) return SPLIT_DEFAULT;
  return Math.min(max, Math.max(min, pct));
}

/**
 * The split a pointer at `clientX` implies, given the panes' container rect.
 *
 * The pointer grabs the MIDDLE of the divider, so the chat ends half a divider to its left — without
 * that half the border creeps away from the cursor a little more with every drag.
 */
export function splitFromPointer(
  clientX: number,
  rect: { left: number; width: number },
  minPx: number = MIN_PANE_PX,
  dividerPx: number = DIVIDER_PX,
): number {
  const track = trackWidth(rect.width, dividerPx);
  if (!(track > 0)) return SPLIT_DEFAULT;
  const chatPx = clientX - rect.left - dividerPx / 2;
  return clampSplit((chatPx / track) * 100, rect.width, minPx, dividerPx);
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

export function nextSplitAction(current: number, dir: 'left' | 'right', containerPx: number, minPx: number = MIN_PANE_PX, dividerPx: number = DIVIDER_PX): SplitAction {
  const { min, max } = splitBounds(containerPx, minPx, dividerPx);
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

/**
 * Where the divider's LEFT edge sits, measured from the container's left edge.
 *
 * This is the ONE number the drag preview may use to place its line: it is derived from the same
 * track the panes are laid out on, so the previewed line lands exactly where the border will land.
 * Drawing at `containerWidth * split/100` instead is what put the line "somewhere else".
 */
export function dividerLeftPx(splitPct: number, containerPx: number, dividerPx: number = DIVIDER_PX): number {
  const track = trackWidth(containerPx, dividerPx);
  if (!(track > 0)) return 0;
  return Math.round(track * (splitPct / 100));
}

/**
 * The workspace pane's real width in CSS pixels — shown live while dragging.
 *
 * DERIVED from the divider's position rather than computed independently, so chat + divider + preview
 * always add up to the container exactly. Rounding the two sides separately leaves a stray pixel that
 * makes the readout and the layout disagree — on the very number the device-width check depends on.
 */
export function paneWidthPx(splitPct: number, containerPx: number, dividerPx: number = DIVIDER_PX): number {
  const track = trackWidth(containerPx, dividerPx);
  if (!(track > 0)) return 0;
  return track - dividerLeftPx(splitPct, containerPx, dividerPx);
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

/**
 * The split as CSS VARIABLES, not as a `flex` declaration.
 *
 * ── THE BUG THIS FIXES (admin 2026-08-20: "preview desktop me theek, mobile phone me gadbad") ────
 * Both panes carried `style={{ flex: `0 1 ${pct}%`, minWidth: MIN_PANE_PX }}`. The split is a
 * WIDTH concept — it exists because the desktop layout is `sm:flex-row`, two panes side by side.
 * But the SAME container is `flex-col` on a phone, where the main axis is VERTICAL, so that
 * `flex-basis: <pct>%` silently became a HEIGHT CAP, and `flex-grow: 0` forbade the pane from
 * taking the rest. The workspace pane therefore got only (100 − split)% of the screen's height —
 * the preview squeezed into a strip with a large empty area beneath it — while the class that was
 * supposed to make it fill (`flex-1`) lost, because an inline style always beats a class.
 *
 * The fix is to stop shipping the split as a property that both axes honour. These variables are
 * inert on their own; a `sm:`-prefixed utility consumes them, so the percentage exists ONLY in the
 * row layout it was designed for, and the phone keeps plain `flex-1` (fill). PURE.
 */
export function paneSplitVars(pct: number): React.CSSProperties {
  return {
    '--nbai-pane': `${pct}%`,
    '--nbai-pane-min': `${MIN_PANE_PX}px`,
  } as React.CSSProperties;
}
