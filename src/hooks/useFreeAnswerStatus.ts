import { useEffect, useState } from 'react';
import { auth } from '../lib/firebase';
import { authHeader } from '../lib/authHeaders';
import { FREE_ANSWER_CHANGED, FreeAnswerStatusReader, isFreeAnswerStorageKey, type FreeAnswerStatus } from '../lib/freeAnswerStatus';

/** Refetch on visibility, account, cross-tab changes, in-flight completion and IST midnight. */
export function useFreeAnswerStatus(active = true): FreeAnswerStatus | null {
  const [status, setStatus] = useState<FreeAnswerStatus | null>(null);
  useEffect(() => {
    if (!active) { setStatus(null); return; }
    let stopped = false;
    let admissionTimer: ReturnType<typeof setTimeout> | undefined;
    let resetTimer: ReturnType<typeof setTimeout> | undefined;
    const reader = new FreeAnswerStatusReader(value => {
      setStatus(value);
      clearTimeout(resetTimer);
      if (value) resetTimer = setTimeout(refresh, Math.max(1000, Math.min(86_400_000, value.resetsAt - Date.now() + 100)));
    });
    async function refresh(includeHidden = false) {
      // The interval stays quiet while the document is hidden. A turn can still finish
      // then — backgrounded tab, locked screen, or a mobile composer that reports hidden —
      // and that completion has a new server count. Skipping it left the badge on the
      // first in-flight reading (49/50) after later answers had already been counted.
      if (stopped || (!includeHidden && document.visibilityState === 'hidden')) return;
      await reader.refresh(async () => {
        const identity = auth.currentUser?.uid;
        const headers = await authHeader();
        if (identity !== auth.currentUser?.uid) throw new Error('Account changed');
        const response = await fetch('/api/free-answers/status', { headers, cache: 'no-store' });
        if (!response.ok) throw new Error('Status unavailable');
        return response.json();
      });
    }
    const identityChanged = () => { reader.invalidate(); setStatus(null); void refresh(); };
    const changed = () => { void refresh(true); clearTimeout(admissionTimer); admissionTimer = setTimeout(() => void refresh(true), 1000); };
    const storage = (event: StorageEvent) => { if (isFreeAnswerStorageKey(event.key)) changed(); };
    const unsubscribe = auth.onAuthStateChanged(identityChanged);
    // DOM events are not the includeHidden permission; only explicit settlement/invalidation opts in.
    const visibleRefresh = () => { void refresh(); };
    window.addEventListener('focus', visibleRefresh);
    document.addEventListener('visibilitychange', visibleRefresh);
    window.addEventListener(FREE_ANSWER_CHANGED, changed);
    window.addEventListener('storage', storage);
    const poll = setInterval(refresh, 15_000);
    void refresh();
    return () => {
      stopped = true; reader.invalidate(); unsubscribe(); clearTimeout(resetTimer); clearTimeout(admissionTimer); clearInterval(poll);
      window.removeEventListener('focus', visibleRefresh); document.removeEventListener('visibilitychange', visibleRefresh);
      window.removeEventListener(FREE_ANSWER_CHANGED, changed); window.removeEventListener('storage', storage);
    };
  }, [active]);
  return status;
}
