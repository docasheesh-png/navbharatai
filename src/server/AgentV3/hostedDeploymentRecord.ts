// A HOSTED APP IS A PUBLISHED APP — one place that says so (ROADMAP §11, slice 5).
//
// 🔴 THE GAP THIS CLOSES. `hostAppOnNavBharatCloud` returns a live URL and wrote nothing to the
// deployment registry, so an app hosted on NavBharat Cloud was invisible to everything that reads it:
// it did not appear in "Your published apps", the History menu's Live dot stayed dark, and — worst —
// "Take offline" had no row to act on, for an app that was genuinely serving the public. The takedown
// CODE has always deleted the Cloud Run service; it simply could never be reached for an app nobody
// had recorded.
//
// 🔒 WHY IT IS A SHARED FUNCTION AND NOT TWO CALL SITES. Two routes now host an app — the explicit
// `/host-app` and the one-button publish — and a registry write copied into both is the drift this
// codebase has paid for repeatedly (four `safeRelPath`s, five hardcoded model ids). One
// implementation means a third caller is recorded correctly for free.
//
// 🔒 `firstParty: true` IS SET EXPLICITLY, not inferred. NavBharatAI pays the Cloud Run bill, so a
// hosted app occupies a free publish slot exactly like a Firebase one — `liveAppCount` honours an
// explicit `firstParty` over the provider allow-list, which is what lets this be true without adding
// a container host to a set named for static CDNs.

import { deploymentStore } from './DeploymentStore';

/** The provider id a NavBharat Cloud app is recorded under. One string, one meaning. */
export const NAVBHARAT_CLOUD_PROVIDER = 'navbharat-cloud';

/**
 * Record a successful container host so the app is visible and removable. Best-effort and never
 * throws: the app IS live by the time this runs, and failing the user's publish over a telemetry
 * write would be refusing to report something that already happened. A missed write shows up as an
 * app that is live but not listed — which `markOrphaned` and the admin inventory already surface —
 * rather than as a takedown that silently does nothing.
 */
export async function recordHostedDeployment(opts: {
  workspaceId: string;
  userId: string | null;
  url: string;
  fileCount: number;
}): Promise<void> {
  if (!opts.workspaceId || !opts.url) return;
  try {
    await deploymentStore.record(opts.workspaceId, opts.userId, opts.url, opts.fileCount, {
      providerId: NAVBHARAT_CLOUD_PROVIDER,
      firstParty: true,
      status: 'active',
    });
  } catch (e) {
    console.error(`[host-app] ${opts.workspaceId} is live at ${opts.url} but was NOT recorded:`, e);
  }
}
