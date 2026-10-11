// NAVBHARAT CLOUD — publishing an app that needs a server, as ONE orchestration (2026-10-06).
//
// The one-button Publish used to run this inline in a 16,000-line route, and a second copy lived on
// `/host-app`. The copies had drifted (only one enforced the plan's server cap) and neither could be tested
// except by reading its source. This is the single sequence, with every dependency injected:
//
//   verified owner → server-app cap → per-workspace deploy lease (one at a time) → the existing record
//   (ban check + the service a redeploy must update) → build + deploy, each phase recorded → registry
//   record → the attempt's terminal state → lease released, whatever happened.
//
// It returns an HTTP status and body rather than touching `res`, so the route stays glue and every branch
// is tested against fakes. It never throws.

import type { Availability, HostAppOutcome } from './hostApp';
import type { DeploymentRecord } from './DeploymentStore';
import { TrackedDeploy, deployEventLine, type DeployStore, type DeployFailureCategory } from './hostedDeployments';

export interface ServerPublishInput {
  workspaceId: string;
  /** The VERIFIED owner. Never the body's claimed uid. */
  ownerUid: string;
  isAdmin: boolean;
  appName: string | null;
  files: Record<string, string>;
  firstPublish?: boolean;
}

export interface ServerPublishDeps {
  serverCap: (input: { ownerUid: string; workspaceId: string; isAdmin: boolean }) => Promise<Availability>;
  store: DeployStore;
  /** The workspace's deployment record; null when none or unreadable (fail-open, like the static guard). */
  existing: (workspaceId: string) => Promise<DeploymentRecord | null>;
  vault: (ownerUid: string, workspaceId: string) => Promise<Record<string, string> | null>;
  token: () => Promise<string | null>;
  host: (opts: {
    workspaceId: string; appName: string | null; files: Record<string, string>;
    vaultSecrets: Record<string, string> | null; existing: Pick<DeploymentRecord, 'status' | 'service'> | null;
    onPhase: (phase: 'building' | 'deploying') => Promise<void>; token: string;
  }) => Promise<HostAppOutcome>;
  record: (opts: { workspaceId: string; userId: string; url: string; fileCount: number; service: string }) => Promise<void>;
  now?: () => number;
  /** Where the provider's own words go — the admin log, never a response body. */
  logDetail?: (line: string) => void;
}

export interface ServerPublishResult {
  status: number;
  body: Record<string, unknown>;
  /** True when the app went live — the caller then records the build outcome. */
  live: boolean;
  /** Cloud Run's own word that a revision is serving. False on every failure. A resell must not bill without it. */
  ready: boolean;
  /** Set only when `live` is true. The service a failed charge has to delete. */
  service?: string;
  url?: string;
}

/** HTTP status for a failed host. ONE mapping, so a reason can never be reported as a different one. PURE. */
export function hostFailureStatus(reason: Extract<HostAppOutcome, { ok: false }>['reason']): number {
  switch (reason) {
    case 'unavailable': return 503;
    case 'blocked': return 403;
    case 'no-source': case 'unpackable': case 'too-large': return 422;
    default: return 502;
  }
}

export async function runServerPublish(input: ServerPublishInput, deps: ServerPublishDeps): Promise<ServerPublishResult> {
  const now = deps.now ?? Date.now;
  const fail = (status: number, error: string, extra: Record<string, unknown> = {}): ServerPublishResult =>
    ({ status, live: false, ready: false, body: { error, code: 'needs-server-hosting', ...extra } });

  const cap = await deps.serverCap({ ownerUid: input.ownerUid, workspaceId: input.workspaceId, isAdmin: input.isAdmin })
    .catch(() => ({ available: true, message: '' })); // an unreadable count fails open — see serverAppLimit
  if (!cap.available) return { status: 403, live: false, ready: false, body: { error: cap.message, code: 'server_app_limit' } };

  const claim = await deps.store.claim(input.workspaceId, input.ownerUid, now());
  if (!claim.claimed) {
    return {
      status: 409, live: false, ready: false,
      body: {
        error: 'This app is already being deployed — wait for that to finish; a second deploy was not started.',
        code: 'deploy-in-progress', deploymentId: claim.running.deploymentId, startedAt: claim.running.startedAt,
      },
    };
  }
  const tracked = new TrackedDeploy(claim.attempt, deps.store, now);
  console.log(deployEventLine(tracked.attempt));
  const failWith = async (status: number, category: DeployFailureCategory, message: string): Promise<ServerPublishResult> => {
    await tracked.move('failed', { category, message });
    return fail(status, message, { deploymentId: tracked.attempt.deploymentId });
  };

  try {
    const existing = await deps.existing(input.workspaceId).catch(() => null);
    const vaultSecrets = await deps.vault(input.ownerUid, input.workspaceId).catch(() => null);
    const token = await deps.token().catch(() => null);
    if (!token) return await failWith(503, 'unavailable', 'Hosting could not authenticate with Google Cloud just now. Nothing was changed.');

    const hosted = await deps.host({
      workspaceId: input.workspaceId, appName: input.appName, files: input.files, vaultSecrets, existing,
      onPhase: (phase) => tracked.move(phase), token,
    });
    if (!hosted.ok) {
      if (hosted.detail) deps.logDetail?.(`[publish→host] ${input.workspaceId} ${hosted.reason}: ${hosted.detail}`);
      return await failWith(hostFailureStatus(hosted.reason), hosted.reason, hosted.message);
    }

    await deps.record({
      workspaceId: input.workspaceId, userId: input.ownerUid, url: hosted.url,
      fileCount: Object.keys(input.files).length, service: hosted.service,
    });
    await tracked.move('live', { url: hosted.url, service: hosted.service, buildId: hosted.buildId, ready: hosted.ready });
    return {
      status: 200, live: true, ready: hosted.ready, service: hosted.service, url: hosted.url,
      body: {
        ok: true,
        url: hosted.url,
        deploymentId: tracked.attempt.deploymentId,
        // `ready` is Cloud Run's own word that a revision serves — never inferred from a 200.
        message: hosted.ready
          ? 'Your app is live — website and server together, hosted on NavBharatAI.'
          : 'Your app was deployed and its address is ready; it may take another moment to answer its first request.',
        ...(hosted.envNote ? { warning: hosted.envNote } : {}),
        ...(input.firstPublish ? { firstPublish: true } : {}),
      },
    };
  } catch (e) {
    deps.logDetail?.(`[publish→host] ${input.workspaceId} threw: ${e instanceof Error ? e.message : String(e)}`);
    return await failWith(502, 'internal', 'Hosting failed unexpectedly. Nothing was lost — your app is safe here; try publishing again.');
  } finally {
    await tracked.end();
  }
}
