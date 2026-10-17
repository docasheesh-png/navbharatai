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

/**
 * THE SERVER-HALF FACT — known the moment this reads, so nobody has to fail a publish to learn it.
 *
 * ⚠️ IT IS DELIBERATELY NOT A REFUSAL CODE. The obvious shortcut is to seed the panel's
 * `publishRefusalCode` from this; `shouldAutoDeployBackend` watches the TRANSITION into that code
 * exactly so that "reacting to the code merely BEING set" cannot start a deploy in someone's own
 * Render account just because they reopened a panel. This fact shows the CARD; a fresh refusal still
 * drives the auto-deploy. See src/server/AgentV3/appServerHalf.ts.
 *
 * `null` means "no server half, or we could not tell" — both of which render exactly what the panel
 * rendered before. A card is a claim, and an unreadable workspace is not evidence for one.
 */
export interface ServerHalfView {
  /** The app's own files contain something a website host cannot run. */
  hasServerHalf: true;
  shape: string;
  /** A deploy could run right now — a key resolved, the user's own or the server's. */
  canDeploy: boolean;
  /** WHOSE key it would be. Never the key itself. */
  keySource: 'user' | 'server' | null;
}

export interface PublishStateView {
  live: boolean;
  url: string | null;
  publishedAt: number | null;
  freshness: PublishFreshness;
  /** Absent until known; see ServerHalfView. */
  serverHalf?: ServerHalfView | null;
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

  /**
   * 🔒 FORGET THE PREVIOUS APP BEFORE ASKING ABOUT THIS ONE (admin 2026-08-25).
   *
   * Sibling of the live-URL leak in AgentV3Panel, and the same shape: this state was per-HOOK while
   * the thing it describes is per-WORKSPACE. The old code cleared only when `workspaceId` went EMPTY,
   * so switching from a published app to a different one kept the first app's answer on screen through
   * every path that returns early — a non-ok response, an unparseable body, or an offline fetch. The
   * user then sees "published 2 minutes ago" and a green state against an app that was never published.
   *
   * Its own effect, keyed on the id alone, so it does NOT re-fire on `refreshKey` (a build finishing),
   * which would blink the dot off and on mid-build for no reason.
   */
  useEffect(() => { setState(null); }, [workspaceId]);

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
          // Read defensively: the field is new, and a body that predates it (or a proxy that drops
          // it) must leave the panel exactly as it is rather than render a card from `undefined`.
          serverHalf: data.serverHalf && data.serverHalf.hasServerHalf === true
            ? {
              hasServerHalf: true,
              shape: typeof data.serverHalf.shape === 'string' ? data.serverHalf.shape : '',
              canDeploy: data.serverHalf.canDeploy === true,
              keySource: data.serverHalf.keySource === 'user' || data.serverHalf.keySource === 'server'
                ? data.serverHalf.keySource : null,
            }
            : null,
        });
      } catch { /* offline — the buttons all still work, they just carry no dot */ }
    })();
    return () => { cancelled = true; };
  }, [workspaceId, refreshKey]);

  return state;
}
