import React, { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  nextSplitAction, splitFromPointer, paneWidthPx, dividerLeftPx, DIVIDER_PX, SPLIT_DEFAULT,
  type SplitAction,
} from './splitPane';

/**
 * The movable border between the v5.0 chat and its workspace (admin 2026-08-17).
 *
 * THREE WAYS TO MOVE IT, one per kind of user, all driving the same single number:
 *   • DRAG — a mouse user grabs it. The hit area is 11px wide while the LINE stays 1px, because a
 *     1px grab target is a coin toss; the visible weight and the touchable weight are different
 *     things and only the second one has to be comfortable.
 *   • TAP ◀ ▶ — the tablet answer, and the admin's own suggestion. A finger is ~44px across, so
 *     dragging a border on a touch screen is guesswork; stepping through fixed stops is exact.
 *     The buttons are ALWAYS visible rather than hover-revealed: our users are not IDE veterans,
 *     and a control that only exists on hover does not exist at all on a tablet.
 *   • ARROW KEYS — the divider is a real `role="separator"` with `aria-valuenow`, so it is
 *     reachable by keyboard. Nearly free once the step logic exists, and it is the difference
 *     between a control and a mouse-only trick.
 *
 * WHY THE PANES ONLY MOVE ON POINTER-UP: the workspace hosts an <iframe>. Re-laying it out on every
 * pointermove reflows and re-renders the user's whole app dozens of times a second — the drag goes
 * sticky and the preview flickers. So a drag paints a cheap GHOST line and commits one width at the
 * end. The tap/keyboard paths commit immediately: they move in discrete steps, so there is nothing
 * to smear.
 *
 * The live px readout is not decoration. Dragging the preview narrow is the fastest honest way to
 * see the app at a phone width, and the number turns an accidental gesture into a real check —
 * which is the same three-screen discipline the builder was taught on the same day.
 *
 * WHY THE DRAG PREVIEW IS A PORTAL ON document.body, AND WHY LINE + LABEL SHARE ONE NUMBER
 * (bug reported 2026-08-19: "line ko move karte hai to line kahi aur dikh rahi hai"). Two faults put
 * the preview in the wrong place, and both are fixed here by construction:
 *   1. The label was `absolute` INSIDE this divider while the line was `fixed` at the pointer. The
 *      panes deliberately do not move until pointer-up, so the divider — and with it the label — stayed
 *      at the OLD border while the line moved: one gesture, two positions, and the number pinned to
 *      the wrong one. Now a single `lineLeft` places both, so they cannot disagree again.
 *   2. A `position: fixed` element is only positioned against the VIEWPORT while no ancestor creates a
 *      containing block. Any ancestor with a transform, filter, backdrop-filter, contain or
 *      will-change silently re-parents it, and viewport coordinates then land wherever that ancestor
 *      happens to be. This app's shell uses backdrop-blur in places, so that was a live hazard rather
 *      than a theoretical one. Rendering into document.body removes the whole class — there is no
 *      ancestor left to re-parent it.
 */
export function SplitDivider({ split, onSplit, onCollapse, containerRef }: {
  /** Chat's share of the width, in percent. */
  split: number;
  /** Commit a new split (already the caller's job to persist). */
  onSplit: (pct: number) => void;
  /** The ladder ran out to the right — close the workspace (chat takes the full width). */
  onCollapse: () => void;
  /** The element the two panes share, used to convert pointer position into a percentage. */
  containerRef: React.RefObject<HTMLElement | null>;
}) {
  // The split being previewed mid-drag. `null` = not dragging, so the ghost is absent and the panes
  // own their width — one flag, so a ghost can never outlive its drag.
  const [ghost, setGhost] = useState<number | null>(null);
  const dragging = ghost !== null;
  const pointerIdRef = useRef<number | null>(null);
  /**
   * The container's rect, measured ONCE when the drag starts.
   *
   * Two reasons it is captured rather than re-read (bug 2026-08-19). It was being read inside the JSX,
   * so the preview line's position depended on WHEN React re-rendered instead of on where the pointer
   * is — and each read forces a layout while the user is dragging. The panes cannot move mid-drag by
   * design, so this rect cannot go stale within one gesture.
   */
  const dragRectRef = useRef<{ left: number; width: number } | null>(null);

  const containerWidth = (): number => containerRef.current?.getBoundingClientRect().width ?? 0;

  const apply = useCallback((action: SplitAction) => {
    if (action.kind === 'collapse') onCollapse();
    else onSplit(action.pct);
  }, [onCollapse, onSplit]);

  const step = useCallback((dir: 'left' | 'right') => {
    apply(nextSplitAction(split, dir, containerWidth()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apply, split]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = containerRef.current?.getBoundingClientRect();
    if (!box) return;
    pointerIdRef.current = e.pointerId;
    dragRectRef.current = { left: box.left, width: box.width };
    // Capture so the drag survives the pointer crossing the iframe — without this the preview
    // swallows the move events and the divider sticks the moment you drag over the app.
    e.currentTarget.setPointerCapture(e.pointerId);
    setGhost(splitFromPointer(e.clientX, dragRectRef.current));
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = dragRectRef.current;
    if (pointerIdRef.current !== e.pointerId || ghost === null || !rect) return;
    setGhost(splitFromPointer(e.clientX, rect));
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== e.pointerId) return;
    pointerIdRef.current = null;
    if (ghost !== null) onSplit(ghost);   // the one and only layout commit of the whole gesture
    setGhost(null);
    dragRectRef.current = null;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); step('left'); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step('right'); }
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); onSplit(SPLIT_DEFAULT); }
  };

  const shown = ghost ?? split;

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize chat and workspace"
      aria-valuenow={Math.round(shown)}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      // Double-click is the universal "put it back" — cheaper to discover than any reset button.
      onDoubleClick={() => onSplit(SPLIT_DEFAULT)}
      title="Drag to resize · double-click for 50/50 · ← → to step"
      className={`hidden sm:flex relative shrink-0 cursor-col-resize select-none touch-none
        items-center justify-center group focus:outline-none
        ${dragging ? 'bg-indigo-500/20' : 'hover:bg-indigo-500/10'}`}
      // The width comes from the SAME constant the geometry uses — a hardcoded `w-[11px]` here and an
      // 11 in the maths are two copies of one fact, and the drifted one is what misplaced the line.
      style={{ touchAction: 'none', width: DIVIDER_PX, flexBasis: DIVIDER_PX }}
    >
      {/* The visible line stays 1px — the generous part is the invisible hit area around it. */}
      <div className={`absolute inset-y-0 left-1/2 -translate-x-1/2 w-px transition-colors
        ${dragging ? 'bg-indigo-400' : 'bg-zinc-800 group-hover:bg-indigo-400/60 group-focus:bg-indigo-400/60'}`} />

      {/* ◀ ▶ — the tablet path, always visible so a touch user can find it without hovering. */}
      <div className="relative z-10 flex flex-col gap-1">
        <button
          type="button"
          aria-label="Give the preview more room"
          onPointerDown={(e) => e.stopPropagation()}   // a tap on the button must not start a drag
          onClick={(e) => { e.stopPropagation(); step('left'); }}
          className="w-[18px] h-[22px] flex items-center justify-center rounded bg-zinc-800/90 border border-zinc-700 text-zinc-300 hover:bg-indigo-600 hover:text-white hover:border-indigo-500 transition-colors"
        ><ChevronLeft className="w-3 h-3" /></button>
        <button
          type="button"
          aria-label="Give the chat more room"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); step('right'); }}
          className="w-[18px] h-[22px] flex items-center justify-center rounded bg-zinc-800/90 border border-zinc-700 text-zinc-300 hover:bg-indigo-600 hover:text-white hover:border-indigo-500 transition-colors"
        ><ChevronRight className="w-3 h-3" /></button>
      </div>

      {/* Mid-drag preview — see the block comment above for why it is a PORTAL sharing ONE x. */}
      {dragging && dragRectRef.current && typeof document !== 'undefined' && createPortal(
        (() => {
          const rect = dragRectRef.current!;
          // ONE number places both the line and its label: the exact left edge the border will take.
          const lineLeft = rect.left + dividerLeftPx(shown, rect.width) + DIVIDER_PX / 2;
          return (
            <div className="fixed inset-0 z-[60] pointer-events-none">
              <div className="absolute inset-y-0 w-px bg-indigo-400" style={{ left: lineLeft }} />
              <div
                className="absolute top-2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-indigo-600 text-white text-[10px] font-mono whitespace-nowrap shadow"
                style={{ left: lineLeft }}
              >
                {paneWidthPx(shown, rect.width)}px
              </div>
            </div>
          );
        })(),
        document.body,
      )}
    </div>
  );
}
