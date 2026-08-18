import React, { useCallback, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { nextSplitAction, splitFromPointer, paneWidthPx, SPLIT_DEFAULT, type SplitAction } from './splitPane';

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
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    pointerIdRef.current = e.pointerId;
    // Capture so the drag survives the pointer crossing the iframe — without this the preview
    // swallows the move events and the divider sticks the moment you drag over the app.
    e.currentTarget.setPointerCapture(e.pointerId);
    setGhost(splitFromPointer(e.clientX, rect));
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== e.pointerId || ghost === null) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) setGhost(splitFromPointer(e.clientX, rect));
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== e.pointerId) return;
    pointerIdRef.current = null;
    if (ghost !== null) onSplit(ghost);   // the one and only layout commit of the whole gesture
    setGhost(null);
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
      className={`hidden sm:flex relative shrink-0 w-[11px] cursor-col-resize select-none touch-none
        items-center justify-center group focus:outline-none
        ${dragging ? 'bg-indigo-500/20' : 'hover:bg-indigo-500/10'}`}
      style={{ touchAction: 'none' }}
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

      {/* Mid-drag: the ghost line the panes will snap to, and the width the preview will end up. */}
      {dragging && (
        <>
          <div className="fixed inset-y-0 w-px bg-indigo-400 pointer-events-none z-[60]"
            style={{ left: (containerRef.current?.getBoundingClientRect().left ?? 0) + containerWidth() * (shown / 100) }} />
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-indigo-600 text-white text-[10px] font-mono whitespace-nowrap pointer-events-none">
            {paneWidthPx(shown, containerWidth())}px
          </div>
        </>
      )}
    </div>
  );
}
