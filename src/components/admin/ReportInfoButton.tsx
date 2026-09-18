import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';
import type { RowFact } from '../../lib/reportRowFacts';
import { placeReportInfoPanel, type PanelPlacement } from './reportInfoPlacement';

/**
 * The ⓘ button both admin build-report lists carry (admin 2026-09-14).
 *
 * "dono me ek extra button bana do information, usme yeh sab (sender, email, time, user, charge
 *  status etc) dal do. bahar ka UI ek dam clean aur clear ho."
 *
 * WHY A BUTTON AND NOT SMALLER TEXT. The inbox used to print all of it as nine table columns, and on
 * the admin's own phone (393 px) that table ran 513 px past the right edge — the last four columns,
 * including Charged and Status, were simply unreachable. Widening a row cannot fix a 393 px screen;
 * moving the detail off the row can. The facts themselves are unchanged and come from ONE pure
 * function per row type, so the two lists cannot drift apart again.
 *
 * ⚠️ It is a real <button> inside a row that is itself clickable, so every handler stops propagation —
 * otherwise asking "who sent this?" would open the report instead of answering.
 *
 * 🔴 THE PANEL IS PORTALLED, AND THAT IS THE FIX FOR "popup crop ho raha hai" (admin 2026-09-18).
 * It used to be `absolute top-full right-0` inside the row. Both lists wrap each row in
 * `rounded-xl overflow-hidden`, a box one row tall, so a panel laid out entirely BELOW the row was
 * clipped by that ancestor every single time — see `reportInfoPlacement.ts` for the full autopsy.
 * Rendering it into <body> at a `fixed` position computed from the button's own rect removes the
 * whole class: no ancestor of the row can clip it, now or after a future list adds another scroller.
 */
export function ReportInfoButton({ facts, title }: { facts: ReadonlyArray<RowFact>; title?: string }) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<PanelPlacement | null>(null);
  const panelId = useId();
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const reposition = useCallback(() => {
    const anchor = wrapRef.current?.getBoundingClientRect();
    if (!anchor) return;
    setPlacement(placeReportInfoPanel(anchor, window.innerWidth, window.innerHeight));
  }, []);

  // Measured before paint so the panel never appears at a stale position for a frame.
  useLayoutEffect(() => {
    if (!open) return;
    reposition();
  }, [open, reposition]);

  // Close on an outside press or Escape. A popover that can only be dismissed by pressing the same
  // small target again is a popover that covers the list it is describing.
  //
  // ⚠️ The panel is no longer a DOM descendant of the wrapper, so "outside" has to consult BOTH —
  // checking the wrapper alone would close the panel the moment the admin touched it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (wrapRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    // Capture, because the row list scrolls inside its own box — a bubbling scroll listener on
    // window never hears that one, and the panel would hang behind where the button used to be.
    const onMove = () => reposition();
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, reposition]);

  const toneClass = (tone: RowFact['tone']) => {
    switch (tone) {
      case 'good': return 'text-emerald-300';
      case 'bad': return 'text-rose-300';
      case 'warn': return 'text-amber-300';
      case 'muted': return 'text-[#8b949e]';
      default: return 'text-white';
    }
  };

  const panel = open && placement && typeof document !== 'undefined' ? createPortal(
    <div
      ref={panelRef}
      id={panelId}
      role="dialog"
      onClick={(e) => { e.stopPropagation(); }}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: placement.left,
        width: placement.width,
        maxHeight: placement.maxHeight,
        ...(placement.top === undefined ? { bottom: placement.bottom } : { top: placement.top }),
      }}
      className="z-[60] overflow-y-auto overscroll-contain rounded-xl border border-white/15 bg-[#0d1117] shadow-2xl shadow-black/60 p-3 space-y-1.5 text-left"
    >
      {facts.length === 0 ? (
        <span className="block text-[11px] text-[#8b949e]">Nothing recorded for this row.</span>
      ) : facts.map((f, i) => (
        <span key={`${f.label}-${i}`} className="flex items-start gap-2 text-[11px]">
          <span className="shrink-0 w-[5.5rem] text-[#8b949e] font-bold">{f.label}</span>
          <span className={`flex-1 min-w-0 break-words ${toneClass(f.tone)}`} title={f.hint}>{f.value}</span>
        </span>
      ))}
    </div>,
    document.body,
  ) : null;

  return (
    <span ref={wrapRef} className="relative shrink-0 inline-flex">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={title || 'Show details'}
        title={title || 'Sender, email, time, user type, charge and status'}
        onClick={(e) => { e.stopPropagation(); e.preventDefault(); setOpen((v) => !v); }}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); }}
        className={`shrink-0 p-1.5 rounded-lg border transition-colors ${
          open ? 'border-indigo-500/60 bg-indigo-500/15 text-indigo-200' : 'border-white/10 text-[#8b949e] hover:text-white hover:border-white/25'
        }`}
      >
        <Info className="w-3.5 h-3.5" />
      </button>
      {panel}
    </span>
  );
}

export default ReportInfoButton;
