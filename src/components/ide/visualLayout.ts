/**
 * The layout controls in the visual editor (ROADMAP #1 Phase 3.6).
 *
 * "Put these side by side", "centre this", "add a gap" is the most common thing a non-technical user
 * wants to change after a build — and until now the only way to get it was to ASK THE AI, which
 * means a whole build round-trip: slow, and it costs tokens for a `flex-direction`.
 *
 * These helpers are pure and live outside the component so the decisions can be tested directly. The
 * one that matters is `isLayoutMode`: a toggle that lights up the wrong button teaches the user that
 * the panel lies about their app, and after that they stop trusting every other control on it.
 */

export type LayoutModeId = 'block' | 'row' | 'column';

/** What a computed style looks like to these helpers. Only the fields they read. */
export interface LayoutStyles {
  display?: string;
  flexDirection?: string;
  justifyContent?: string;
  alignItems?: string;
  flexWrap?: string;
  gap?: string;
}

/** Is this element laying its children out with flexbox? */
export function isFlex(styles: LayoutStyles | undefined | null): boolean {
  const d = (styles?.display ?? '').trim();
  return d === 'flex' || d === 'inline-flex';
}

/**
 * Which of the three buttons should read as active.
 *
 * `block` means "not flex" rather than literally `display: block`, because an element can be
 * `grid`, `inline-block` or a table cell and none of those are the row/column the other two buttons
 * produce. Lighting up "Row" for a grid would be a claim the panel cannot back up.
 */
export function isLayoutMode(styles: LayoutStyles | undefined | null, mode: LayoutModeId): boolean {
  if (!isFlex(styles)) return mode === 'block';
  const dir = (styles?.flexDirection ?? 'row').trim();
  // `row-reverse` / `column-reverse` still read as their axis — that is what the user sees.
  return mode === (dir.startsWith('column') ? 'column' : 'row');
}

/** Each button, and exactly the declarations it writes. */
export interface LayoutMode {
  id: LayoutModeId;
  label: string;
  title: string;
  apply: (set: (prop: string, val: string) => void) => void;
}

export const LAYOUT_MODES: LayoutMode[] = [
  {
    id: 'block',
    label: 'Stack',
    title: 'Normal flow — each child on its own line',
    // Clears the flex declarations rather than leaving them behind: a leftover `gap` or
    // `justify-content` does nothing visible now but reappears the moment the user picks Row again,
    // which looks like the editor remembering a setting they never made.
    apply: (set) => { set('display', 'block'); set('gap', ''); set('justifyContent', ''); set('alignItems', ''); set('flexWrap', ''); },
  },
  {
    id: 'row',
    label: 'Row',
    title: 'Side by side',
    // `wrap` on purpose: a nowrap row built on a desktop is the classic thing that overflows a phone,
    // and the user changing this control is rarely thinking about a 390px screen.
    apply: (set) => { set('display', 'flex'); set('flexDirection', 'row'); set('flexWrap', 'wrap'); },
  },
  {
    id: 'column',
    label: 'Column',
    title: 'One above the other, with a gap',
    apply: (set) => { set('display', 'flex'); set('flexDirection', 'column'); },
  },
];
