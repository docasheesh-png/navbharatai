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
    async function refresh() {
      if (stopped || document.visibilityState === 'hidden') return;
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
    const changed = () => { void refresh(); clearTimeout(admissionTimer); admissionTimer = setTimeout(refresh, 1000); };
    const storage = (event: StorageEvent) => { if (isFreeAnswerStorageKey(event.key)) changed(); };
    const unsubscribe = auth.onAuthStateChanged(identityChanged);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener(FREE_ANSWER_CHANGED, changed);
    window.addEventListener('storage', storage);
    const poll = setInterval(refresh, 15_000);
    void refresh();
    return () => {
      stopped = true; reader.invalidate(); unsubscribe(); clearTimeout(resetTimer); clearTimeout(admissionTimer); clearInterval(poll);
      window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener(FREE_ANSWER_CHANGED, changed); window.removeEventListener('storage', storage);
    };
  }, [active]);
  return status;
}
