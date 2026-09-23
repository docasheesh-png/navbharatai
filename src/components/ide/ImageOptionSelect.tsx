import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, X } from 'lucide-react';

/**
 * ONE SELECTOR, USED FOUR TIMES — the image generator's option control.
 *
 * Admin, 2026-09-21: *"images type . style .size/formate .colour hint yeh sab ko dropdown selector
 * bana do! jisse ui clear lage."*
 *
 * WHAT IT REPLACES, AND WHY THE CHIPS HAD TO GO. Each of the four option groups used to render its
 * whole list on screen at once — eight image types, seven styles, four sizes, six colour dots, about
 * twenty-five controls stacked above the prompt box. On a phone that is the entire first screen spent
 * on settings, with the thing the user came to do pushed below the fold. A dropdown shows ONE line
 * per group: what it is, and what it is set to.
 *
 * 🔒 WHY A SHARED COMPONENT AND NOT FOUR DROPDOWNS. This repo has paid four separate times for the
 * drifted-copy class (`safeRelPath` ×4, `tagsOnLine` ×2, the HTML boot guard ×2,
 * `PLAYWRIGHT_BROWSERS_PATH` ×2). Four copies of a bottom sheet is four chances for the Escape key,
 * the scrim, the tick, or the tab-bar reservation to be right in three places and wrong in the
 * fourth. There is one sheet; every group gets the same one.
 *
 * 🔴 THE SHEET IS RENDERED INTO `document.body`, AND THAT IS A BUG FIX, NOT A STYLE CHOICE.
 * A size selector that opened inside a footer carrying `backdrop-blur` could not be changed: an element with a `backdrop-filter` (like `transform` and `filter`) becomes
 * the CONTAINING BLOCK for every `position: fixed` descendant. So `fixed inset-0` resolved to that
 * ~100px footer strip instead of the viewport, the panel's `overflow-hidden` clipped what was left,
 * and the sheet opened where nobody could see it. The value never changed because the list was never
 * reachable — and nothing errored.
 *
 * Deleting the blur would have fixed today and left the trap armed: any ancestor gaining a transform,
 * a filter or `contain` re-breaks it, silently, from a file nobody was editing. A portal takes the
 * sheet out of the ancestor chain entirely, so the containing block cannot be stolen by ANY call
 * site, present or future. That is the class, not the instance.
 *
 * 🔴 THE SHEET GEOMETRY IS THE SHARED ONE, NOT A `max-h-[80vh]`. On a phone `vh` is the LARGE
 * viewport, so a hand-written fraction puts the last rows under the browser toolbar AND under this
 * app's own tab bar, where there is no scroll left to reach them. `nb-sheet-overlay-flush` +
 * `nb-sheet` + `nb-sheet-partial` subtract all three (toolbar, device inset, tab bar); the z-index
 * stays BELOW the bar's 150, which is what pairs it with reserving rather than opting out.
 * `tests/sheetOverlayGeometry.test.ts` checks that pairing mechanically.
 *
 * Colour comes from tokens only — this file is new, so its theme-ratchet baseline is zero. A swatch
 * is the one exception the ratchet cannot see anyway: it is the USER'S colour, arriving as a prop.
 */

export interface ImageOption {
  id: string;
  label: string;
  /** One short line under the label. Optional — a size's pixels, a style's look. */
  desc?: string;
  /** Shown before the label. */
  emoji?: string;
  /** A CSS colour for the dot before the label. Absent or empty renders an outlined "none" dot. */
  swatch?: string;
}

interface Props {
  /** The tiny uppercase name of the group — "STYLE", "SIZE / FORMAT". */
  label: string;
  /** The question the sheet asks — "How should it look?". */
  heading: string;
  options: ImageOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}

/**
 * Which option a given value means — the ONE place that question is answered.
 *
 * An id nothing matches falls back to the FIRST option rather than rendering an empty control. That
 * is not a new rule: the panel already did `SIZES.find(s => s.id === size) || SIZES[0]` in two
 * places, and a stored history row from an older build can genuinely carry a style id that no longer
 * exists. An empty options list returns `undefined`, and the component then renders a trigger with no
 * value rather than throwing — a caller with nothing to offer is a caller bug, not a crash.
 *
 * PURE.
 */
export function currentOption(options: ImageOption[], value: string): ImageOption | undefined {
  return options.find((o) => o.id === value) || options[0];
}

/** The dot, so the trigger and the sheet row can never draw it two different ways. */
function Swatch({ colour }: { colour?: string }) {
  if (!colour) {
    return <span aria-hidden="true" className="w-3 h-3 rounded-full border border-line shrink-0" />;
  }
  return (
    <span
      aria-hidden="true"
      className="w-3 h-3 rounded-full border border-line shrink-0"
      style={{ backgroundColor: colour }}
    />
  );
}

export function ImageOptionSelect({ label, heading, options, value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const current = currentOption(options, value);
  const showsSwatch = options.some((o) => 'swatch' in o);

  // Escape closes, and focus goes back to the button that opened it — otherwise a keyboard user lands
  // at the top of the page every time they change a setting.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); triggerRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        /* `min-w-0` on the button AND on the text column is the fix recorded on the old style chips:
           a flex item defaults to `min-width: auto` and refuses to shrink below its content, so the
           longest label ("Modern app logo") held the cell wider than its grid track and spilled onto
           the neighbour. With it, `truncate` decides what happens at the boundary. */
        className="flex items-center gap-2 min-w-0 w-full text-left rounded-xl border border-line bg-card px-2.5 py-1.5 min-h-[46px] transition-colors hover:border-accent-text/40 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[9px] font-bold uppercase tracking-wider text-muted">{label}</span>
          <span className="flex items-center gap-1.5 min-w-0">
            {showsSwatch && <Swatch colour={current?.swatch} />}
            <span className="block text-xs font-semibold text-ink truncate">
              {current?.emoji ? `${current.emoji} ` : ''}{current?.label ?? ''}
            </span>
          </span>
        </span>
        <ChevronDown className="w-3.5 h-3.5 text-muted shrink-0" aria-hidden="true" />
      </button>

      {open && typeof document !== 'undefined' && createPortal((
        <div
          className="nb-sheet-overlay-flush fixed inset-0 z-50 flex items-end justify-center bg-scrim"
          onClick={() => { setOpen(false); triggerRef.current?.focus(); }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={heading}
            onClick={(e) => e.stopPropagation()}
            style={{ ['--nb-sheet-cap' as string]: '82%' }}
            className="nb-sheet nb-sheet-partial w-full sm:max-w-md flex flex-col rounded-t-2xl sm:rounded-2xl border border-line bg-surface"
          >
            <div className="shrink-0 flex items-center gap-3 px-4 pt-3 pb-2 border-b border-line">
              <div className="min-w-0 flex-1">
                <div className="text-[9px] font-bold uppercase tracking-wider text-muted">{label}</div>
                <div className="text-sm font-semibold text-ink truncate">{heading}</div>
              </div>
              <button
                type="button"
                aria-label="Close"
                onClick={() => { setOpen(false); triggerRef.current?.focus(); }}
                className="shrink-0 w-8 h-8 rounded-lg border border-line bg-card text-body flex items-center justify-center"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* `role="radiogroup"` and not a list of toggles: exactly one of these is always in force,
                and a screen reader should say so rather than announce four independent "pressed"
                buttons. */}
            <div role="radiogroup" aria-label={heading} className="flex-1 min-h-0 overflow-y-auto p-2 space-y-0.5">
              {options.map((o) => {
                const sel = o.id === (current?.id ?? value);
                return (
                  <button
                    key={o.id}
                    type="button"
                    role="radio"
                    aria-checked={sel}
                    onClick={() => pick(o.id)}
                    className={`flex items-center gap-3 w-full text-left rounded-xl px-3 py-2.5 min-h-[52px] border transition-colors ${
                      sel ? 'border-accent-text/50 bg-raised' : 'border-transparent hover:bg-raised'
                    }`}
                  >
                    {o.emoji && <span className="text-lg w-6 shrink-0" aria-hidden="true">{o.emoji}</span>}
                    {showsSwatch && <Swatch colour={o.swatch} />}
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-ink truncate">{o.label}</span>
                      {o.desc && <span className="block text-[11px] text-muted truncate">{o.desc}</span>}
                    </span>
                    {sel
                      ? <Check className="w-4 h-4 text-accent-text shrink-0" aria-hidden="true" />
                      : <span className="w-4 h-4 shrink-0" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ), document.body)}
    </>
  );
}

export default ImageOptionSelect;
