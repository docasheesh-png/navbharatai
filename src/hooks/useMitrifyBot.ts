import { useEffect, useState } from 'react';
import { auth } from '../lib/firebase';
import { authHeader } from '../lib/authHeaders';

export type MitrifyBotAccess = { available: boolean; questions: Array<{ id: string; label: string }> };

/** No client email allowlist: the server grants visibility for the current identity. */
export function useMitrifyBot(uid: string | undefined): MitrifyBotAccess | null {
  const [result, setResult] = useState<{ uid: string; access: MitrifyBotAccess } | null>(null);
  useEffect(() => {
    setResult(null);
    if (!uid) return;
    const controller = new AbortController();
    async function load() {
      try {
        const headers = await authHeader();
        if (auth.currentUser?.uid !== uid || controller.signal.aborted) return;
        const response = await fetch('/api/v1/chat/mitrify-bot', { headers, cache: 'no-store', signal: controller.signal });
        if (!response.ok) return;
        const access: MitrifyBotAccess = await response.json();
        if (auth.currentUser?.uid === uid && !controller.signal.aborted) setResult({ uid, access });
      } catch { /* Fail closed: no visible entry without server authorization. */ }
    }
    void load();
    return () => controller.abort();
  }, [uid]);
  return result?.uid === uid && auth.currentUser?.uid === uid ? result?.access ?? null : null;
}
