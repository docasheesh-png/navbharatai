import { useEffect, useId, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import type { RowFact } from '../../lib/reportRowFacts';

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
 */
export function ReportInfoButton({ facts, title }: { facts: ReadonlyArray<RowFact>; title?: string }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  // Close on an outside press or Escape. A popover that can only be dismissed by pressing the same
  // small target again is a popover that covers the list it is describing.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const toneClass = (tone: RowFact['tone']) => {
    switch (tone) {
      case 'good': return 'text-emerald-300';
      case 'bad': return 'text-rose-300';
      case 'warn': return 'text-amber-300';
      case 'muted': return 'text-[#8b949e]';
      default: return 'text-white';
    }
  };

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
      {open && (
        <span
          id={panelId}
          role="dialog"
          onClick={(e) => { e.stopPropagation(); }}
          onPointerDown={(e) => e.stopPropagation()}
          /* Right-anchored and width-capped so it cannot itself push the page sideways — the defect
             this component exists to remove. `max-w-[min(18rem,calc(100vw-2rem))]` keeps a gutter on
             the narrowest phone the admin actually uses. */
          className="absolute top-full right-0 z-50 mt-1.5 w-[min(18rem,calc(100vw-2rem))] max-w-[min(18rem,calc(100vw-2rem))] rounded-xl border border-white/15 bg-[#0d1117] shadow-2xl shadow-black/60 p-3 space-y-1.5 text-left"
        >
          {facts.length === 0 ? (
            <span className="block text-[11px] text-[#8b949e]">Nothing recorded for this row.</span>
          ) : facts.map((f, i) => (
            <span key={`${f.label}-${i}`} className="flex items-start gap-2 text-[11px]">
              <span className="shrink-0 w-[5.5rem] text-[#8b949e] font-bold">{f.label}</span>
              <span className={`flex-1 min-w-0 break-words ${toneClass(f.tone)}`} title={f.hint}>{f.value}</span>
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

export default ReportInfoButton;
