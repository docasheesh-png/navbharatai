// A FLOATING BUTTON THE FINGER CAN PUT ANYWHERE — the drag, the clamp, the memory and "was that a tap?"
// in ONE hook (admin 2026-09-22: *"full-screen-off button upper right corner me fix hai, isko moveable
// banao, user usko ungli se khich ke kahi bhi rakh sake"*).
//
// The admin copy button had exactly this behaviour written inline (2026-09-14). A second floating
// button meant either a second copy of ~60 lines of pointer arithmetic — the drifted-copy class this
// repo has paid for four times — or one hook both buttons call. The arithmetic itself stays in
// `lib/floatingButtonPosition.ts`, pure and tested; this hook is only the React plumbing around it.
//
// What every caller gets for free: pointer events (one path for a finger and a mouse), pointer capture
// so a fast drag does not lose the button, a clamp on every position it ever sets (the drag, the first
// paint, a resize, a rotation — a button parked in a laptop's corner must not be off-screen on a phone),
// a remembered position per browser, and a tap that is a TAP rather than the end of a drag.

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  clampPosition, isTap, parsePosition, serializePosition,
  type Point, type Size, type Viewport,
} from '../lib/floatingButtonPosition';

export interface DraggableFloatOptions {
  /** localStorage key the position is remembered under. Per browser; nothing but two numbers. */
  storageKey: string;
  /** The button's size before it has been measured (used for the first clamp). */
  fallbackSize: Size;
  /** Where it goes when nothing is remembered. Called with the size and the viewport; must be pure. */
  initialPosition: (size: Size, view: Viewport) => Point;
  /** A PRESS (not a drag) ended on the button. */
  onTap: () => void;
}

export interface DraggableFloat {
  /** Null until the first effect has decided where it goes — render nothing until then. */
  pos: Point | null;
  dragging: boolean;
  /** Attach to the element that is dragged and measured. */
  shellRef: React.RefObject<HTMLDivElement | null>;
  handlers: {
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (e: ReactPointerEvent<HTMLDivElement>) => void;
  };
}

const viewport = (): Viewport => ({ width: window.innerWidth, height: window.innerHeight });

export function useDraggableFloat({ storageKey, fallbackSize, initialPosition, onTap }: DraggableFloatOptions): DraggableFloat {
  const [pos, setPos] = useState<Point | null>(null);
  const [dragging, setDragging] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<{ id: number; startX: number; startY: number; originX: number; originY: number; at: number } | null>(null);
  const onTapRef = useRef(onTap);
  onTapRef.current = onTap;

  const size = useCallback((): Size => {
    const r = shellRef.current?.getBoundingClientRect();
    return { width: r?.width || fallbackSize.width, height: r?.height || fallbackSize.height };
  }, [fallbackSize.width, fallbackSize.height]);

  // Where it starts: where it was last left, clamped to THIS screen — else the caller's default.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const view = viewport();
    let stored: Point | null = null;
    try { stored = parsePosition(window.localStorage?.getItem(storageKey)); } catch { stored = null; }
    setPos(stored ? clampPosition(stored, fallbackSize, view) : initialPosition(fallbackSize, view));
    // The default and the key are identity, not state: a change to either is a different button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // A rotation or a resized window must never strand it off the edge.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setPos((p) => (p ? clampPosition(p, size(), viewport()) : p));
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [size]);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pos) return;
    try { shellRef.current?.setPointerCapture(e.pointerId); } catch { /* capture is an optimisation, not a requirement */ }
    gesture.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, originX: pos.x, originY: pos.y, at: Date.now() };
    setDragging(true);
  }, [pos]);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    setPos(clampPosition({ x: g.originX + (e.clientX - g.startX), y: g.originY + (e.clientY - g.startY) }, size(), viewport()));
  }, [size]);

  const endGesture = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    setDragging(false);
    try { shellRef.current?.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    // A press and a drag end the same way, so the gesture itself decides which one happened.
    if (isTap(e.clientX - g.startX, e.clientY - g.startY, Date.now() - g.at)) { onTapRef.current(); return; }
    setPos((p) => {
      if (p) { try { window.localStorage?.setItem(storageKey, serializePosition(p)); } catch { /* private mode */ } }
      return p;
    });
  }, [storageKey]);

  return {
    pos,
    dragging,
    shellRef,
    handlers: { onPointerDown, onPointerMove, onPointerUp: endGesture, onPointerCancel: endGesture },
  };
}
