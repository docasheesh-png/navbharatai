import { useFreeAnswerStatus } from '../../hooks/useFreeAnswerStatus';
import { freeAnswerStatusLine } from '../../lib/freeAnswerStatus';

/** Informational only: paid actions keep their independent admission rules. */
export function FreeAnswerStatusBadge({ active = true }: { active?: boolean }) {
  const status = useFreeAnswerStatus(active);
  return <div className="px-4 py-1 text-[11px] text-muted border-b border-line" role="status" aria-live="polite">
    <span>Shared Free daily ceiling: {freeAnswerStatusLine(status)}</span>
    <span>{status ? ` · ${status.used} used · resets at 12:00 AM IST` : ' · check again shortly'}</span>
    {status && <span> · availability and attempt protections still apply</span>}
    {status?.inProgress && <span> · another answer can start when this one finishes</span>}
  </div>;
}
