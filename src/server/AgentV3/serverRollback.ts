/** Cloud Run revision history and rollback, used by the existing publish history picker. */
import { GoogleAuth } from 'google-auth-library';
import { appsProject, appsRegion, RUN_API, serviceBelongsTo } from './cloudRunHosting';
import { appsIdentities } from './appsIdentity';
import { firestoreDeployStore, TrackedDeploy, type DeployStore } from './hostedDeployments';
import type { DeploymentRecord } from './DeploymentStore';

type Choice = { versionName: string; releaseTime: string | null; live: boolean };
type History = { serviceName: string; etag: string; choices: Choice[]; current: string };
export interface RollbackDeps {
  env: NodeJS.ProcessEnv;
  fetch: typeof fetch;
  token: () => Promise<string | null>;
  store: DeployStore;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}
const defaults: RollbackDeps = {
  env: process.env, fetch, store: firestoreDeployStore, now: Date.now,
  token: async () => (await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getAccessToken()) ?? null,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

async function readHistory(workspaceId: string, rec: DeploymentRecord, token: string, deps: RollbackDeps): Promise<History> {
  const project = appsProject(deps.env).projectId;
  if (!project || !rec.service || !serviceBelongsTo(rec.service, workspaceId)) throw new Error('Unknown server ownership.');
  const identities = appsIdentities(project, deps.env);
  if (!identities.ok) throw new Error('Server identities are unavailable.');
  const name = `projects/${project}/locations/${appsRegion(deps.env)}/services/${rec.service}`;
  const get = async (path: string) => {
    const result = await deps.fetch(`${RUN_API}/${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
    if (!result.ok) throw new Error('Publish history is unavailable.');
    return result.json();
  };
  const service = await get(name);
  if (service.reconciling || typeof service.etag !== 'string' || !service.etag) throw new Error('The server is updating.');
  const serving = service.trafficStatuses;
  if (!Array.isArray(serving) || serving.length !== 1 || serving[0].percent !== 100 || typeof serving[0].revision !== 'string') throw new Error('Server traffic is not a single confirmed revision.');
  const current = serving[0].revision.split('/').pop()!;
  const result = await get(`${name}/revisions?pageSize=100`);
  if (!Array.isArray(result.revisions)) throw new Error('Revision history is unreadable.');
  const choices: Choice[] = result.revisions.filter((r: any) =>
    typeof r?.name === 'string' && r.name.startsWith(name + '/revisions/') && !r.deleteTime
    && r.serviceAccount === identities.identities.runtime
    && Array.isArray(r.conditions) && r.conditions.some((c: any) => c.type === 'Ready' && c.state === 'CONDITION_SUCCEEDED')
  ).map((r: any) => ({ versionName: r.name, releaseTime: typeof r.createTime === 'string' ? r.createTime : null, live: r.name.split('/').pop() === current }))
    .sort((a: Choice, b: Choice) => Number(b.live) - Number(a.live) || String(b.releaseTime).localeCompare(String(a.releaseTime)));
  // Never resurrect a revision running as an old privileged identity. Never guess the current one.
  if (!choices.some((c) => c.live)) throw new Error('The current revision is outside the verified history.');
  return { serviceName: name, etag: service.etag, choices, current };
}

/** Never returns env variables, image names, service-account emails or provider error text. */
export async function serverRollbackStatus(workspaceId: string, ownerUid: string, rec: DeploymentRecord, overrides: Partial<RollbackDeps> = {}) {
  const deps = { ...defaults, ...overrides };
  if (!ownerUid || rec.userId !== ownerUid) return { available: false, choices: null, reason: 'forbidden', message: 'This app does not belong to this account.' };
  try {
    const token = await deps.token(); if (!token) throw new Error('No cloud identity.');
    const history = await readHistory(workspaceId, rec, token, deps);
    return { available: history.choices.some((c) => !c.live), choices: history.choices,
      message: history.choices.length > 1 ? '' : 'No earlier eligible server revision is retained.' };
  } catch { return { available: false, choices: null, reason: 'unreadable', message: 'Server publish history is temporarily unavailable. Please retry.' }; }
}

/** The caller must verify the owner and pass a CURRENT live registry record. Uses the publish lease. */
export async function rollbackServer(workspaceId: string, ownerUid: string, rec: DeploymentRecord, requested: string, overrides: Partial<RollbackDeps> = {}) {
  const deps = { ...defaults, ...overrides };
  let tracked: TrackedDeploy | undefined;
  let uncertainMutation = false;
  const failure = (status: number, error: string) => ({ status, body: { ok: false, error } });
  try {
    if ((rec.status ?? 'active') !== 'active' || rec.userId !== ownerUid) return failure(403, 'This server app cannot be restored by this account.');
    const claim = await deps.store.claim(workspaceId, ownerUid, deps.now(), 'rollback');
    if (!claim.claimed) return failure(409, 'Another publish or rollback is running. Please wait for it to finish.');
    tracked = new TrackedDeploy(claim.attempt, deps.store, deps.now);
    const token = await deps.token(); if (!token) throw new Error('Cloud authentication unavailable.');
    const history = await readHistory(workspaceId, rec, token, deps);
    const target = requested ? history.choices.find((c) => c.versionName === requested && !c.live) : history.choices.find((c) => !c.live);
    if (!target) {
      await tracked.move('failed', { category: 'blocked', message: 'No matching eligible server revision.' });
      return failure(409, 'That revision is not an earlier eligible version of this app.');
    }
    await tracked.move('deploying');
    const revision = target.versionName.split('/').pop()!;
    uncertainMutation = true;
    const response = await deps.fetch(`${RUN_API}/${history.serviceName}?updateMask=traffic`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: history.serviceName, etag: history.etag,
        traffic: [{ type: 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION', revision, percent: 100 }] }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      if ([400, 401, 403, 404, 409, 412].includes(response.status)) uncertainMutation = false;
      throw new Error('Traffic update unconfirmed.');
    }
    const deadline = deps.now() + 60000;
    for (let n = 0; n < 20 && deps.now() <= deadline; n++) {
      const current = await deps.fetch(`${RUN_API}/${history.serviceName}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
      const service = current.ok ? await current.json() : null;
      const statuses = service?.trafficStatuses;
      if (!service?.reconciling && Array.isArray(statuses) && statuses.length === 1 && statuses[0].percent === 100
        && String(statuses[0].revision).split('/').pop() === revision) {
        await tracked.move('live', { ready: true, url: rec.url, service: rec.service });
        uncertainMutation = false;
        return { status: 200, body: { ok: true, url: rec.url, message: 'The selected server version is now serving your app.' } };
      }
      await deps.sleep(3000);
    }
    throw new Error('Traffic update not yet confirmed.');
  } catch {
    if (tracked && tracked.attempt.state !== 'failed') await tracked.move('failed', { category: 'unavailable', message: 'Server rollback could not be confirmed.' });
    return failure(503, 'Server rollback could not be confirmed. Check the live app and refresh publish history before trying again.');
  } finally {
    // A lost acknowledgement does not prove the cloud operation stopped. Keep the durable lease
    // until its stale horizon rather than racing a new publish against an update still in flight.
    if (!uncertainMutation) await tracked?.end();
  }
}
