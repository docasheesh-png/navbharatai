// Shared prompt card for every NavBharatAI AI surface (2026-10-25).
// The latest request supersedes the footer-dependent single-line layout: writing always gets
// a full-width row, with controls below. Each caller retains its own handlers and live state.

import React from 'react';
import { autoGrow, resizeMobileComposer } from '../../lib/autoGrowTextarea';
import './composer.css';
export { resizeMobileComposer } from '../../lib/autoGrowTextarea';
import { HistoryButton } from './HistoryButton';
import { ModeButton } from './ModeButton';
import { CONVERSATION_COLUMN_CLASS } from './conversation';

export const COMPOSER_PANEL_CLASS = 'px-3 pt-2 pb-2 sm:pt-3 sm:pb-3 bg-surface shrink-0';

/** The rounded message box: a soft pill on the card surface; focus lifts the shadow and tints the border. */
export const COMPOSER_BOX_CLASS =
  'nb-composer-box bg-card border border-line rounded-[1.5rem] shadow-[0_2px_16px_rgba(0,0,0,0.06)] focus-within:border-accent focus-within:shadow-[0_4px_24px_rgba(0,0,0,0.10)] transition-all';

/**
 * The textarea: the box's WHOLE top row (admin 2026-09-23, with a phone screenshot of the box squeezed
 * to a sliver). It used to share one line with the controls and reserve a fixed ~176px on its right
 * for them — so the moment the box got narrow (a phone, with History and Mode beside it) the writing
 * area fell to a few pixels. The controls now have their own row underneath, so the text takes the
 * full width at ANY width, and there is no right-hand reserve to get wrong. 16px text also stops iOS
 * zooming the page on focus.
 */
export const COMPOSER_TEXTAREA_CLASS =
  'nb-composer-text w-full bg-transparent text-ink placeholder:text-muted px-4 pt-4 pb-2 outline-none transition-all resize-none min-h-[72px] leading-relaxed text-[16px]';

/** A quiet icon control in the bottom row (attach, mic, voice, star). 36px. */
export const COMPOSER_ICON_CLASS =
  'p-2.5 rounded-full text-muted hover:text-ink hover:bg-raised transition-colors flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed';

/**
 * Send — a filled circle at the box's bottom-right corner, an arrow pointing up. 36px, so it stays a
 * real thumb target, and set apart from the voice button by the box's own gap so a reach for Send
 * cannot land on a paid control. Its non-shrinking slot pins it to the bottom edge, so a message that grows to several lines keeps Send where the thumb already is.
 */
export const COMPOSER_SEND_CLASS =
  'h-9 w-9 rounded-full bg-accent text-on-accent disabled:opacity-30 disabled:cursor-not-allowed hover:brightness-110 transition-all flex items-center justify-center active:scale-95';

/** The one-tap Stop that replaces Send while a reply loads — the same circle, in ink. */
export const COMPOSER_STOP_CLASS =
  'h-9 w-9 rounded-full bg-ink text-surface hover:opacity-90 transition-all flex items-center justify-center active:scale-95';

/** Send never shrinks or competes with the writing row. */
export const COMPOSER_SEND_SLOT_CLASS = 'nb-composer-send-slot shrink-0 self-end';

export interface ComposerShellProps {
  /** Opens chat history. Absent ⇒ no History half in the left column. */
  onOpenHistory?: (() => void) | undefined;
  /** Opens the mode picker. Absent ⇒ no Mode half. Both absent ⇒ no left column at all. */
  onOpenMode?: (() => void) | undefined;
  /** The surface's own `<textarea>` (styled with `COMPOSER_TEXTAREA_CLASS`), plus any overlay it needs. */
  children: React.ReactNode;
  /** The quiet controls for the wrapping bottom row: attach, mic, voice, star. */
  controls: React.ReactNode;
  /** The Send / Stop button, at the bottom-right of the toolbar. */
  send: React.ReactNode;
}

/** Blank card space focuses the editor; real controls keep their own click behavior. */
const COMPOSER_CONTROL_SELECTOR = 'button, a, input, textarea, select, label, [role="button"], [contenteditable="true"]';

/** True when a tap on `target` inside the box should be handed to the text rather than to a control. */
export function tapFocusesComposerText(
  target: EventTarget | null,
  box: Pick<Element, 'contains'> | null,
): boolean {
  // Duck-typed rather than `instanceof Element`: a text node or an SVG child is still a tap inside the
  // box, and the check stays runnable where there is no DOM global at all.
  const el = target as Partial<Pick<Element, 'closest'>> | null;
  if (!box || !el || typeof el.closest !== 'function') return false;
  if (!box.contains(target as Node)) return false;
  const control = el.closest(COMPOSER_CONTROL_SELECTOR);
  return !control || !box.contains(control);
}

function focusComposerText(box: HTMLElement | null): void {
  const text = box?.querySelector('textarea');
  if (!text || text.disabled) return;
  text.focus();
  const end = text.value.length;
  try { text.setSelectionRange(end, end); } catch { /* a textarea that refuses a selection still has focus */ }
}

function useWholeBoxInput() {
  const boxRef = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const text = boxRef.current?.querySelector('textarea');
    if (text) resizeMobileComposer(text);
  });
  React.useEffect(() => {
    const resize = () => {
      const text = boxRef.current?.querySelector('textarea');
      if (text) autoGrow(text, parseFloat(getComputedStyle(text).maxHeight) || 240);
    };
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
    };
  }, []);
  const onMouseDown = (e: React.MouseEvent) => {
    if (tapFocusesComposerText(e.target, boxRef.current)) e.preventDefault();
  };
  const onClick = (e: React.MouseEvent) => {
    if (tapFocusesComposerText(e.target, boxRef.current)) focusComposerText(boxRef.current);
  };
  return { ref: boxRef, onMouseDown, onClick };
}

export function ComposerShell({ onOpenHistory, onOpenMode, children, controls, send }: ComposerShellProps) {
  const wholeBox = useWholeBoxInput();
  // The column sits at the BOTTOM of the row and never stretches (admin 2026-09-24: *"jab text jyada
  // bada ho, aur input box ka size badhe, to history/mode button ka size na bade, bas input box ka size
  // badhe"*). Its buttons have their own fixed height (`RAIL_BUTTON_CLASS`), so a growing message moves
  // nothing but the box.
  const rail = onOpenHistory || onOpenMode ? (
    <div className="flex flex-col gap-1.5 shrink-0 self-end" data-composer-rail="">
      <HistoryButton onOpen={onOpenHistory} size="rail" />
      <ModeButton onOpen={onOpenMode} size="rail" />
    </div>
  ) : null;
  return (
    <div className={`${CONVERSATION_COLUMN_CLASS} flex items-end gap-2`} data-composer-layout="two-rows">
      {rail}
      <div className={`${COMPOSER_BOX_CLASS} flex-1 min-w-0 cursor-text ${controls ? '' : 'nb-composer-no-tools'}`} ref={wholeBox.ref} onMouseDown={wholeBox.onMouseDown} onClick={wholeBox.onClick}>
        <div className="relative w-full min-w-0">{children}</div>
        <div className="flex items-end justify-between gap-2 px-2 pb-2" data-composer-toolbar="">
          {controls ? <MobileComposerTools><div className="flex min-w-0 flex-wrap items-center gap-1">{controls}</div></MobileComposerTools> : <div className="nb-composer-controls" />}
          <div className={COMPOSER_SEND_SLOT_CLASS}>{send}</div>
        </div>
      </div>
    </div>
  );
}

/** Mobile disclosure only; desktop keeps the original control layout and mounted state. */
export function MobileComposerTools({ children, open: controlledOpen, onOpenChange }: {
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = React.useCallback((next: boolean) => {
    setInternalOpen(next);
    onOpenChange?.(next);
  }, [onOpenChange]);
  const root = React.useRef<HTMLDivElement>(null);
  const toggle = React.useRef<HTMLButtonElement>(null);
  const id = React.useId();
  React.useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const resize = () => {
      if (!mq.matches) setOpen(false);
      const viewport = window.visualViewport;
      const height = viewport?.height ?? window.innerHeight;
      const inset = Math.max(0, window.innerHeight - height - (viewport?.offsetTop ?? 0));
      root.current?.style.setProperty('--nb-composer-menu-max-height', `${Math.max(44, height - 80)}px`);
      root.current?.style.setProperty('--nb-composer-menu-bottom', `${inset + 60}px`);
    };
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (mq.matches && open && event.key === 'Escape' && !event.defaultPrevented) {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    resize();
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('scroll', resize);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('scroll', resize);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open, setOpen]);
  return <div ref={root} className="nb-composer-tools">
    <button ref={toggle} type="button" className="nb-composer-tools-toggle text-muted hover:text-ink hover:bg-raised"
      aria-label="Composer tools" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>+</button>
    <div id={id} className="nb-composer-tools-content" data-open={open}>{children}</div>
  </div>;
}
