// The publish state, fetched once and shared by every surface that shows the red dot.
//
// WHY A HOOK (admin 2026-08-21: "edit karte hai, ek red dot ana chahiye — publish (*) → connect your
// own domain (*) → publish (green)(*)"). The dot is a trail across three screens. If each screen
// fetched and interpreted the state itself, the trail would eventually disagree with itself: a dot on
// the outer Publish button leading to an inner screen that says everything is fine. One hook, one
// endpoint, one answer.
//
// It re-reads on `refreshKey` rather than polling: the state only changes when the app is built or
// published, and both of those are moments the caller already knows about. Polling a status endpoint
// on a screen nobody is acting on would be cost with no answer in it.

import { useState, useEffect } from 'react';
import { authJsonHeaders } from '../lib/authHeaders';
import type { PublishFreshness } from '../lib/publishFreshness';

export interface PublishStateView {
  live: boolean;
  url: string | null;
  publishedAt: number | null;
  freshness: PublishFreshness;
}

/**
 * Read this workspace's publish state. Returns `null` until it is known — callers render nothing for
 * null, which is also what a failed fetch leaves behind: a dot is a claim, and an unreachable server
 * is not evidence that anyone's site is stale.
 *
 * @param refreshKey change it (e.g. a build/publish counter) to re-read.
 */
export function usePublishState(workspaceId: string | undefined | null, refreshKey: unknown = 0): PublishStateView | null {
  const [state, setState] = useState<PublishStateView | null>(null);

  useEffect(() => {
    if (!workspaceId) { setState(null); return; }
    let cancelled = false;
    void (async () => {
      try {
        const params = new URLSearchParams({ workspaceId });
        const res = await fetch(`/api/agentv3/publish-state?${params.toString()}`, { headers: await authJsonHeaders() });
        if (!res.ok) return;                       // not signed in / not ours — show nothing, say nothing
        const data = await res.json().catch(() => null);
        if (cancelled || !data || typeof data.freshness !== 'string') return;
        setState({
          live: data.live === true,
          url: typeof data.url === 'string' ? data.url : null,
          publishedAt: typeof data.publishedAt === 'number' ? data.publishedAt : null,
          freshness: data.freshness as PublishFreshness,
        });
      } catch { /* offline — the buttons all still work, they just carry no dot */ }
    })();
    return () => { cancelled = true; };
  }, [workspaceId, refreshKey]);

  return state;
}
