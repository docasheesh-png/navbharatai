import { useEffect, useState } from 'react';

/** Static UI copy follows the English-only standard. The caller keys this component
 * by turn identity, so a new request never inherits an older request's delay. */
export function ReplyPendingStatus({ pending }: { pending: boolean }) {
 const [delayed, setDelayed] = useState(false);
 useEffect(() => {
  setDelayed(false);
  if (!pending) return;
  let active = true;
  const timer = setTimeout(() => { if (active) setDelayed(true); }, 10_000);
  return () => { active = false; clearTimeout(timer); };
 }, [pending]);
 if (!pending) return null;
 return <div role="status" aria-live="polite" aria-atomic="true" className="px-1 py-2 text-sm text-muted">{delayed ? 'Your reply is taking a little longer. Please wait.' : 'Preparing your reply… 🤔'}</div>;
}
