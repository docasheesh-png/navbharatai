// NAVBHARAT CLOUD — the two lifecycle rules every path must obey (2026-10-06).
//
// 1. A BANNED OR HELD APP IS NEVER RE-HOSTED. The static deploy path has refused to republish a
//    `taken_down` app since the takedown shipped — but the container path never asked. `/host-app` and the
//    one-button publish went straight to Cloud Build, and `recordHostedDeployment` then wrote
//    `status: 'active'` over the ban. Pressing Host undid an admin's takedown. `hostedRepublishRefusal`
//    is now asked by `hostAppOnNavBharatCloud` itself, BEFORE anything is built, so no caller can skip it.
//
// 2. OFFLINE MEANS THE SERVER TOO. Admin ban, admin unpublish and both plan-pause sweeps removed the
//    static channel and marked the app offline while its Cloud Run service kept answering. Every one of
//    them now calls `removeHostedServers` — one implementation — before the status is written.
//
// Every dependency is injectable, so both rules are tested without Google or Firestore.

import { GoogleAuth } from 'google-auth-library';
import { appsProject, appsRegion, removeWorkspaceServers, type ServerRemoval } from './cloudRunHosting';
import { NAVBHARAT_CLOUD_PROVIDER } from './hostedDeploymentRecord';
import type { DeploymentRecord } from './DeploymentStore';

/**
 * Why this workspace may NOT be hosted, or null when it may. PURE.
 *
 * `taken_down` is an admin ban — permanent by design. `held` is an app waiting on review; re-hosting it
 * would put back exactly what the review is about. `unpublished` and `plan_paused` are NOT refused: the
 * owner took it down themselves, or their plan lapsed, and publishing again is how they bring it back.
 */
export function hostedRepublishRefusal(existing: Pick<DeploymentRecord, 'status'> | null | undefined): string | null {
  const status = existing?.status;
  if (status === 'taken_down') {
    return 'This app was taken down for a policy violation and cannot be published again. Contact support if you believe this is a mistake.';
  }
  if (status === 'held') {
    return 'This app is held for review, so it cannot be published again until the review is finished. Contact support if you believe this is a mistake.';
  }
  return null;
}

/** Does this record describe an app that has (or had) a server on NavBharat Cloud? PURE. */
export function recordHasHostedServer(rec: Pick<DeploymentRecord, 'providerId' | 'service'> | null | undefined): boolean {
  return rec?.providerId === NAVBHARAT_CLOUD_PROVIDER || !!String(rec?.service ?? '').trim();
}

export interface HostedServerRemoval extends Partial<ServerRemoval> {
  /** False when the app never had a server here — nothing to do, and that is success. */
  attempted: boolean;
  /** True only when nothing of this workspace is known to be serving any more. */
  ok: boolean;
  /** Why it is not ok, for the admin log. Never shown to a visitor. */
  note?: string;
}

export interface RemovalDeps {
  token: () => Promise<string | null>;
  remove: typeof removeWorkspaceServers;
  env: NodeJS.ProcessEnv;
}

const realDeps: RemovalDeps = {
  token: async () => {
    const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
    const t = await auth.getAccessToken().catch(() => null);
    return t ? String(t) : null;
  },
  remove: removeWorkspaceServers,
  env: process.env,
};

/**
 * Take every server this app runs on NavBharat Cloud off the internet. NEVER throws.
 *
 * Callers that PROMISE an app is offline (a ban, an admin unpublish, a plan pause) must refuse to write
 * that status when `ok` is false — saying an app is offline while its server answers is the lie this
 * module exists to end.
 */
export async function removeHostedServers(
  workspaceId: string,
  rec: Pick<DeploymentRecord, 'providerId' | 'service'> | null | undefined,
  deps: Partial<RemovalDeps> = {},
): Promise<HostedServerRemoval> {
  if (!recordHasHostedServer(rec)) return { attempted: false, ok: true };
  const d: RemovalDeps = { ...realDeps, ...deps };
  const project = appsProject(d.env);
  if (!project.projectId) {
    return { attempted: true, ok: false, note: `hosting project not configured: ${project.message}` };
  }
  const token = await d.token().catch(() => null);
  if (!token) return { attempted: true, ok: false, note: 'could not authenticate with Google Cloud' };
  const result = await d.remove({
    token, projectId: project.projectId, region: appsRegion(d.env), workspaceId, recordedService: rec?.service ?? null,
  }).catch(() => null);
  if (!result) return { attempted: true, ok: false, note: 'the removal threw' };
  return {
    attempted: true,
    ...result,
    ...(result.ok ? {} : { note: result.failed.length ? `could not delete: ${result.failed.join(', ')}` : 'the service listing was incomplete' }),
  };
}

/**
 * The same, for a caller that must NOT proceed when the server survives: throws with a plain sentence,
 * so the existing "if this throws, nothing is marked" discipline of every takedown path covers it too.
 */
export async function removeHostedServersOrThrow(
  workspaceId: string,
  rec: Pick<DeploymentRecord, 'providerId' | 'service'> | null | undefined,
  deps: Partial<RemovalDeps> = {},
): Promise<HostedServerRemoval> {
  const r = await removeHostedServers(workspaceId, rec, deps);
  if (!r.ok) throw new Error(`The app's server could not be confirmed removed (${r.note ?? 'unknown'}). Nothing was marked — try again.`);
  return r;
}

export type OfflineStatus = 'taken_down' | 'unpublished' | 'plan_paused';

export interface OfflineDeps extends Partial<RemovalDeps> {
  deleteChannel: (workspaceId: string) => Promise<unknown>;
  get: (workspaceId: string) => Promise<DeploymentRecord | null>;
  setStatus: (workspaceId: string, status: OfflineStatus) => Promise<boolean>;
}

/**
 * THE ONE WAY AN APP IS TAKEN OFFLINE: its static channel, then every server it runs, and ONLY THEN the
 * status. Throws (and marks nothing) when either removal is not confirmed — the registry must never say
 * an app is offline while any part of it still answers. Used by the admin ban, the admin unpublish and
 * both plan-pause sweeps; the debt pause used to write `plan_paused` without removing anything at all.
 * Returns whether the status was saved.
 */
export async function takeAppOffline(workspaceId: string, status: OfflineStatus, deps: OfflineDeps): Promise<boolean> {
  await deps.deleteChannel(workspaceId);
  await removeHostedServersOrThrow(workspaceId, await deps.get(workspaceId).catch(() => null), deps);
  return deps.setStatus(workspaceId, status);
}
