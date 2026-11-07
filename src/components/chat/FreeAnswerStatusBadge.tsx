import { useLayoutEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFreeAnswerStatus } from '../../hooks/useFreeAnswerStatus';
import { freeAnswerStatusLine, type FreeAnswerStatus } from '../../lib/freeAnswerStatus';

function QuotaDetails({ status }: { status: FreeAnswerStatus | null }) {
  return <>
    <span>Shared Free daily ceiling: {freeAnswerStatusLine(status)}</span>
    <span>{status ? ` · ${status.used} used · resets at 12:00 AM IST` : ' · check again shortly'}</span>
    {status && <span> · availability and attempt protections still apply</span>}
    {status?.inProgress && <span> · another answer can start when this one finishes</span>}
  </>;
}

/** Non-modal details stay outside the chat's flex layout and overflow clipping. */
export function FreeAnswerStatusCounter({ status }: { status: FreeAnswerStatus | null }) {
  const [open, setOpen] = useState(false);
  const [top, setTop] = useState(0);
  const trigger = useRef<HTMLButtonElement>(null);
  const details = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = () => { setOpen(false); trigger.current?.focus({ preventScroll: true }); };
  useLayoutEffect(() => {
    if (!open) return;
    setTop(Math.max(8, Math.min(window.innerHeight - 80, (trigger.current?.getBoundingClientRect().bottom ?? 0) + 8)));
    const reposition = (event: Event) => {
      if (!(event.target instanceof Node) || !details.current?.contains(event.target)) setOpen(false);
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    details.current?.focus({ preventScroll: true });
    const outside = (event: Event) => {
      if (event.target instanceof Node && !details.current?.contains(event.target) && !trigger.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      const leavingDetails = event.key === 'Tab' && (event.shiftKey
        ? document.activeElement === details.current
        : document.activeElement === details.current?.querySelector('button'));
      if (event.key === 'Escape' || leavingDetails) { event.preventDefault(); setOpen(false); trigger.current?.focus({ preventScroll: true }); }
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return <>
    <button ref={trigger} type="button" aria-label={`Free daily quota: ${freeAnswerStatusLine(status)}`} aria-haspopup="dialog"
      aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)}
      className="shrink-0 max-w-28 truncate rounded-full border border-line bg-raised px-2.5 py-1 text-xs font-medium tabular-nums text-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
      {status ? `${status.remaining}/${status.limit}` : '—/—'}
    </button>
    {open && createPortal(<div className="fixed inset-0 z-[100] flex items-start justify-center px-4 pointer-events-none" style={{ paddingTop: top }}>
      <div ref={details} id={id} role="dialog" aria-label="Free daily quota details" tabIndex={-1} style={{ maxHeight: `calc(100dvh - ${top + 16}px)` }}
        className="pointer-events-auto w-full max-w-sm overflow-y-auto rounded-xl border border-line bg-surface p-4 text-sm text-ink shadow-xl break-words">
        <div className="flex items-center justify-between gap-3 mb-2"><strong>Free daily quota</strong>
          <button type="button" onClick={close} aria-label="Close quota details" className="rounded px-2 py-1 hover:bg-raised focus-visible:ring-2 focus-visible:ring-indigo-500">×</button>
        </div>
        <div role="status" aria-live="polite"><QuotaDetails status={status} /></div>
      </div>
    </div>, document.body)}
  </>;
}

/** Informational only: paid actions keep their independent admission rules. */
export function FreeAnswerStatusBadge({ active = true, compact = false }: { active?: boolean; compact?: boolean }) {
  const status = useFreeAnswerStatus(active);
  if (compact) return <FreeAnswerStatusCounter status={status} />;
  return <div className="px-4 py-1 text-[11px] text-muted border-b border-line" role="status" aria-live="polite">
    <QuotaDetails status={status} />
  </div>;
}
