// ONE MESSAGE BOX FOR EVERY AI IN NAVBHARATAI FREE (admin 2026-09-23: "sabhi ai aur professionals ke
// inputbox ko navbharatai free ke jaisa karo — sabhi professionals navbharatai free jaise hi lagne
// chahiye").
//
// Three surfaces open from the FREE mode picker besides the free chat itself — the professionals
// (`ProfessionalChat`), Doctor AI (`SDAChat`) and the image generator — and each had hand-built its
// own composer: a square `rounded-xl` input with the paperclip OUTSIDE it on the left, a violet pill.
// Several copies of one idea is the drifted-copy class this repo keeps
// paying for, so the fix is not four restyles but ONE shell they all render:
//
//     [ 🕘 / ☰ ]  [ message box, full width           | ➤ ]
//                 [                     📎  🎤  🔊    |   ]
//
// …and, when the phone's bottom bar already carries History and Mode, ONE line with no column
// (admin 2026-09-24) — see `ComposerShell` below for why the column decides it.
//
// The free chat (`AIChat.tsx`) renders this same shell, so "like the free chat" is true by
// construction rather than by copying its classes. `tests/oneComposerEverywhere.test.ts` fails if any
// of the five surfaces builds its own box again.
//
// It holds no state and sends nothing: each surface keeps its own textarea (handlers, placeholder,
// auto-grow) and its own buttons, and only takes the LOOK from here.

import React from 'react';
import { HistoryButton } from './HistoryButton';
import { ModeButton } from './ModeButton';
import { CONVERSATION_COLUMN_CLASS } from './conversation';

/**
 * THE LOOK (admin 2026-10-13, verbatim: *"navbharatai ke sabhi ke chat wala ui aur ux ko claude jaisa
 * karo!"*). The strip the composer sits on is the page itself — no border, no blur, no shadow strip —
 * and the box is a large soft pill on the card surface with a faint shadow, so it reads as the one
 * object on the screen rather than as a bar. The LAYOUT rules below (two rows beside the rail, one
 * line beside the footer, the whole box is the input) are unchanged: they already match that shape.
 *
 * ⚠️ SUPERSEDED, and recorded so nobody restores it from the older quote: the 2026-09-23 tall Send
 * ("send button ko bhi 2 line me banao") and the indigo focus border. Send is now a circle at the
 * bottom-right corner, sized as a thumb target (36px), and focus is shown by the accent token.
 */
export const COMPOSER_PANEL_CLASS = 'px-3 pt-1 pb-2 bg-surface shrink-0';

/** The rounded message box: a soft pill on the card surface; focus lifts the shadow and tints the border. */
export const COMPOSER_BOX_CLASS =
  'bg-card border border-line rounded-[1.5rem] shadow-[0_2px_16px_rgba(0,0,0,0.06)] focus-within:border-accent focus-within:shadow-[0_4px_24px_rgba(0,0,0,0.10)] transition-all';

/**
 * The textarea: the box's WHOLE top row (admin 2026-09-23, with a phone screenshot of the box squeezed
 * to a sliver). It used to share one line with the controls and reserve a fixed ~176px on its right
 * for them — so the moment the box got narrow (a phone, with History and Mode beside it) the writing
 * area fell to a few pixels. The controls now have their own row underneath, so the text takes the
 * full width at ANY width, and there is no right-hand reserve to get wrong. 16px text also stops iOS
 * zooming the page on focus.
 */
export const COMPOSER_TEXTAREA_CLASS =
  'w-full bg-transparent text-ink placeholder:text-muted pl-4 pr-3 pt-3 pb-1 outline-none transition-all resize-none min-h-[40px] leading-relaxed text-[16px]';

/** A quiet icon control in the bottom row (attach, mic, voice, star). 36px. */
export const COMPOSER_ICON_CLASS =
  'p-2.5 rounded-full text-muted hover:text-ink hover:bg-raised transition-colors flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed';

/**
 * Send — a filled circle at the box's bottom-right corner, an arrow pointing up. 36px, so it stays a
 * real thumb target, and set apart from the voice button by the box's own gap so a reach for Send
 * cannot land on a paid control. Its slot (`SEND_SLOT_CLASS`) pins it to the bottom edge in both
 * layouts, so a message that grows to several lines keeps Send where the thumb already is.
 */
export const COMPOSER_SEND_CLASS =
  'h-9 w-9 rounded-full bg-accent text-on-accent disabled:opacity-30 disabled:cursor-not-allowed hover:brightness-110 transition-all flex items-center justify-center active:scale-95';

/** The one-tap Stop that replaces Send while a reply loads — the same circle, in ink. */
export const COMPOSER_STOP_CLASS =
  'h-9 w-9 rounded-full bg-ink text-surface hover:opacity-90 transition-all flex items-center justify-center active:scale-95';

/** The slot Send sits in, per layout: at the bottom edge of the box in both. */
export const SEND_SLOT_CLASS = {
  twoRows: 'flex items-end p-1.5 pl-0.5',
  oneLine: 'flex p-1.5 pl-0.5 self-end',
} as const;

export interface ComposerShellProps {
  /** Opens chat history. Absent ⇒ no History half in the left column. */
  onOpenHistory?: (() => void) | undefined;
  /** Opens the mode picker. Absent ⇒ no Mode half. Both absent ⇒ no left column at all. */
  onOpenMode?: (() => void) | undefined;
  /** The surface's own `<textarea>` (styled with `COMPOSER_TEXTAREA_CLASS`), plus any overlay it needs. */
  children: React.ReactNode;
  /** The quiet controls for the bottom row, right-aligned: attach, mic, voice, star. */
  controls: React.ReactNode;
  /** The Send / Stop button, which spans both rows on the right. */
  send: React.ReactNode;
}

/**
 * The composer's layout is decided by ONE fact: is the History / Mode column beside it?
 *
 * TWO ROWS, beside the column — the admin's own sketch (2026-09-23):
 *
 *     ┌──┐ ┌──────────────────────────┬──┐
 *     │🕘│ │ Ask NavBharatAI…         │  │
 *     ├──┤ │                          │➤ │
 *     │☰ │ │           📎   🎤   🔊   │  │
 *     └──┘ └──────────────────────────┴──┘
 *
 * ONE LINE, with no column (admin 2026-09-24: *"jab footer on hai … input box double line dikhane ki
 * jarurat nahi hai … input box ko 2 line me is liye dikhaya ja raha tha, kyu ki history button gayab
 * tha. ab jab history button footer me hai, to input box single line me chalega"*):
 *
 *     ┌────────────────────────────────────────┐
 *     │ Ask NavBharatAI…        📎  🎤  🔊  ➤  │
 *     └────────────────────────────────────────┘
 *
 * 🔑 WHY THE COLUMN IS THE RIGHT SIGNAL, and not a second "is the footer on?" check. The two rows only
 * ever existed to stand beside History and Mode: the box was squeezed to a sliver once they sat next to
 * it, so the text got a row of its own. Both openers are `undefined` EXACTLY when the phone's bottom
 * bar is on screen — App derives that once (`modePickerOpener` / `historyOpener`, from
 * `showsGlobalMobileNav`), and the bar carries History and Mode itself. So "no column" already MEANS
 * "the footer has these", and asking the device question again here would be a second answer that
 * could disagree with the first. In full screen the bar is gone, the column comes back, and so do the
 * two rows.
 *
 * In the one-line box the text still takes all the width the controls leave it — the whole box's
 * width, now that nothing stands beside the box — and the controls and Send stay on the bottom edge as
 * a message grows. Everything is `items-stretch`, so the text column is always the box's full height.
 */
/**
 * THE WHOLE BOX IS THE INPUT (admin 2026-09-24, with two phone screenshots: *"input box ka pura area
 * hi input box hona chahiye. abhi yeh 2 part me divide ho raha hai — 1 jaha text type hoga, 2 jaha text
 * nahi hoga … pura box hi 1 simple input box jaisa hona chahiye"*).
 *
 * The text area is only part of the box — the top row of the two-row box, the left of the one-line
 * one — so a tap on the empty part beside the icons used to do nothing. A tap anywhere in the box that
 * is not on one of its controls now puts the cursor in the text, at the end, like one plain input.
 * `mousedown` is held back on those taps so the text never loses focus (and the phone keyboard never
 * closes and reopens) on the way; the focus itself happens on `click`, which iOS treats as the user's
 * own gesture and so lets open the keyboard.
 */
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
  if (!rail) {
    return (
      <div className={`${CONVERSATION_COLUMN_CLASS} ${COMPOSER_BOX_CLASS} flex items-stretch cursor-text`} ref={wholeBox.ref} onMouseDown={wholeBox.onMouseDown} onClick={wholeBox.onClick} data-composer-layout="one-line">
        {/* `[&>textarea]:pb-2.5` evens the textarea's padding out: its shared class keeps a small bottom
            pad for the two-row box, where the control row sits right under it. Alone on a line it
            would sit visibly high.
            The placeholder is held to ONE line: on a 390px phone the text gets ~190px beside three
            controls and Send, and a longer hint ("Describe your image…", "Ask Chartered Accountant AI…")
            wrapped into a second line the one-row box then cut in half. Clipped at the edge reads as a
            hint; half a second line reads as a bug. What the user TYPES still wraps and grows. */}
        <div className="relative flex-1 min-w-0 flex flex-col justify-center [&>textarea]:pb-2.5 [&>textarea]:placeholder:whitespace-nowrap [&>textarea]:placeholder:overflow-hidden">{children}</div>
        <div className="flex items-center gap-1 pl-1 pb-1.5 self-end">{controls}</div>
        <div className={SEND_SLOT_CLASS.oneLine}>{send}</div>
      </div>
    );
  }
  return (
    <div className={`${CONVERSATION_COLUMN_CLASS} flex items-stretch gap-2`} data-composer-layout="two-rows">
      {rail}
      <div className={`${COMPOSER_BOX_CLASS} flex-1 min-w-0 flex items-stretch cursor-text`} ref={wholeBox.ref} onMouseDown={wholeBox.onMouseDown} onClick={wholeBox.onClick}>
        <div className="relative flex-1 min-w-0 flex flex-col">
          {children}
          <div className="flex items-center justify-end gap-1 px-1.5 pb-1">{controls}</div>
        </div>
        <div className={SEND_SLOT_CLASS.twoRows}>{send}</div>
      </div>
    </div>
  );
}
