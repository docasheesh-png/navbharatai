// ONE answer to "is this app's live site current?" — read by every surface that shows it.
//
// WHY IT IS ITS OWN MODULE (admin, 2026-08-21). The publish state is now shown in THREE places at
// once, as a trail the user follows: a dot on the v5 Publish button → a dot on "Connect your own
// domain" → the Publish button on the domain screen. Three surfaces answering one question is
// exactly the shape that drifts — one gets a fix, the others keep the old rule, and the trail starts
// disagreeing with itself (a dot on the outer button leading to an inner screen that says all is
// well). So the question is answered ONCE, here, and every surface renders what this returns.
//
// The measurement itself is the shared, pure `publishFreshness`; this module is only the I/O around
// it — which is also why it is the piece allowed to be best-effort.

import { deploymentStore, isLiveDeployment } from './DeploymentStore';
import { workspaceFilesSavedAt } from './WorkspaceFileStore';
import { publishFreshness, type PublishFreshness } from '../../lib/publishFreshness';

export interface PublishState {
  /** Is something genuinely live for this workspace right now? */
  live: boolean;
  /** The live URL, or null when nothing is live. */
  url: string | null;
  /** When the live bytes were published (ms), or null when unknown. */
  publishedAt: number | null;
  /** Whether the live site is behind the app — the thing the red dot is made of. */
  freshness: PublishFreshness;
}

/** What we return when we could not measure. Claims nothing, so no surface shows a dot. */
const UNKNOWN: PublishState = { live: false, url: null, publishedAt: null, freshness: 'unknown' };

/**
 * Resolve a workspace's publish state.
 *
 * `everPublished` is the hosting service's own release count when a caller already has it. It is
 * authoritative for "nothing is up": a deployment record outlives the site it describes, so trusting
 * the record alone can offer "Republish" for a site that has never served anything — the exact
 * mitrify.com confusion, one screen over. Callers without it pass nothing and lose only that check.
 *
 * Best-effort and bounded (3s). This decorates screens; it never gates a publish, so a slow store
 * degrades to `unknown` — which every surface renders as silence — rather than delaying the page.
 */
export async function resolvePublishState(
  workspaceId: string,
  everPublished?: boolean | null,
): Promise<PublishState> {
  if (!workspaceId) return UNKNOWN;
  try {
    const [dep, filesSavedAt] = await Promise.race([
      Promise.all([
        deploymentStore.get(workspaceId).catch(() => null),
        workspaceFilesSavedAt(workspaceId).catch(() => null),
      ]),
      new Promise<[null, null]>((r) => setTimeout(() => r([null, null]), 3_000)),
    ]);
    if (!dep) return UNKNOWN;
    const live = isLiveDeployment(dep) && everPublished !== false;
    return {
      live,
      url: live && typeof dep.url === 'string' ? dep.url : null,
      publishedAt: live && typeof dep.updatedAt === 'number' ? dep.updatedAt : null,
      freshness: publishFreshness({ live, publishedAt: dep.updatedAt, filesSavedAt }),
    };
  } catch {
    return UNKNOWN;
  }
}
