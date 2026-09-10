// NAVBHARAT CLOUD — the whole path, from the durable store to a live URL (ROADMAP §11, slice 1c).
//
// Three modules already do the pieces: sourceArchive packs the app, containerBuild turns it into an
// image, cloudRunHosting runs it. This joins them and — more importantly — decides when to REFUSE, so
// the route above it stays thin glue that cannot accidentally carry policy.
//
// 🔒 THE REFUSALS ARE THE FEATURE. Every step here can half-succeed in a way that produces a URL for
// something that is not the user's app: a file left out of the archive, a build that timed out while an
// older image still sits in the registry, a service created but not reachable. This deploy path has
// shipped each of those lies before under a different name, so each is refused explicitly and named.
//
// Gate first, in two flags, matching the pattern AGENTV3_ENABLED / AGENTV3_PAID_PUBLIC established:
// a master switch that keeps the whole thing inert, and a second that decides whether anyone but an
// admin can reach it.

import { parseEnvFlag } from '../lib/envFlag';
import { appsProject, appsRegion, serviceNameFor, deployAppToCloudRun } from './cloudRunHosting';
import { packWorkspaceArchive } from './sourceArchive';
import { appsImageRepo, buildStagingBucket, buildTag, buildAppContainer } from './containerBuild';
import { planBackendEnv, backendEnvNote } from './backendEnvVars';

/**
 * Master switch. OFF means NavBharat Cloud does not exist — no route, no calls, no cost.
 *
 * Reads the env it is HANDED rather than `process.env` directly, so the gate can be tested for every
 * combination without mutating global state — the same reason appsProject() takes one.
 */
export function navBharatCloudEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseEnvFlag(env.NAVBHARAT_CLOUD) ?? false;
}

/** Is hosting open to everyone, or still admin-only? Default admin-only. */
export function navBharatCloudPublic(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseEnvFlag(env.NAVBHARAT_CLOUD_PUBLIC) ?? false;
}

export interface Availability {
  available: boolean;
  /** Why not. '' when available. Written for whoever is blocked — an admin sees a setup step. */
  message: string;
}

/**
 * Can THIS caller host an app right now?
 *
 * Order matters: the flag first (an off feature should not leak that a project is misconfigured), then
 * who is asking, then whether the infrastructure exists. PURE, so the whole gate is tested without a
 * request. `isAdmin` must come from the server-VERIFIED identity — a client-claimed email deciding
 * access is the spoof this codebase already guards elsewhere.
 */
export function hostingAvailability(
  opts: { isAdmin: boolean; env?: NodeJS.ProcessEnv },
): Availability {
  const env = opts.env ?? process.env;
  if (!navBharatCloudEnabled(env)) {
    return { available: false, message: 'App hosting on NavBharatAI is not switched on yet.' };
  }
  if (!navBharatCloudPublic(env) && !opts.isAdmin) {
    return { available: false, message: 'App hosting on NavBharatAI is still being tested and is not open to everyone yet.' };
  }
  const project = appsProject(env);
  if (!project.projectId) return { available: false, message: project.message };
  return { available: true, message: '' };
}

export type HostAppOutcome =
  | {
      ok: true;
      url: string;
      service: string;
      /** True only when Cloud Run itself reports the revision serving — never inferred from a 200. */
      ready: boolean;
      buildId: string;
      /** What we could not give the app's environment, or '' when there is nothing worth saying. */
      envNote: string;
    }
  | {
      ok: false;
      reason: 'unavailable' | 'no-source' | 'unpackable' | 'build-failed' | 'deploy-failed';
      message: string;
      /** Provider detail for the ADMIN report only — never rendered to a user. */
      detail?: string;
    };

/**
 * Host an app: pack it, build it, run it, and report a URL only when there is genuinely one to report.
 *
 * NEVER throws. `now` and the sleep are injected so the whole path is testable without a clock or a
 * network.
 */
export async function hostAppOnNavBharatCloud(
  opts: {
    workspaceId: string;
    appName?: string | null;
    /** The app's files, from the durable store. */
    files: Record<string, string>;
    /** The user's saved secrets — planBackendEnv decides which of them the service may receive. */
    vaultSecrets?: Record<string, string> | null;
    /** A Google access token for the apps project. */
    token: string;
    env?: NodeJS.ProcessEnv;
    now?: number;
    maxWaitMs?: number;
    pollMs?: number;
  },
  fetchImpl: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<HostAppOutcome> {
  const env = opts.env ?? process.env;
  const project = appsProject(env);
  if (!project.projectId) return { ok: false, reason: 'unavailable', message: project.message };
  const region = appsRegion(env);

  const archive = packWorkspaceArchive(opts.files ?? {});
  if (archive.packed.length === 0) {
    return {
      ok: false,
      reason: 'no-source',
      message: 'There are no app files to host yet. Build your app first, then publish it.',
    };
  }
  /**
   * 🔒 A PARTIAL ARCHIVE IS NEVER SHIPPED. A source file missing from the build surfaces as an import
   * error against a file that plainly exists in the editor — one of the least debuggable failures we
   * could hand somebody. Refusing names the files instead.
   */
  if (archive.skipped.length > 0) {
    const names = archive.skipped.slice(0, 3).map((s) => s.path).join(', ');
    const more = archive.skipped.length > 3 ? ` and ${archive.skipped.length - 3} more` : '';
    return {
      ok: false,
      reason: 'unpackable',
      message: `Some of your app's files could not be packaged for hosting (${names}${more}), so nothing was `
        + 'deployed rather than shipping an app with pieces missing. Renaming those files usually fixes it.',
      detail: archive.skipped.map((s) => `${s.path}: ${s.reason}`).join('; '),
    };
  }

  const service = serviceNameFor(opts.workspaceId, opts.appName);
  const tag = buildTag(opts.now ?? Date.now(), opts.workspaceId);
  const built = await buildAppContainer({
    token: opts.token,
    projectId: project.projectId,
    region,
    bucket: buildStagingBucket(project.projectId, env),
    imageRepo: appsImageRepo(env),
    service,
    tag,
    archive: archive.data,
    maxWaitMs: opts.maxWaitMs,
    pollMs: opts.pollMs,
  }, fetchImpl, sleep);
  if (!built.ok) {
    return { ok: false, reason: 'build-failed', message: built.message, ...(built.detail ? { detail: built.detail } : {}) };
  }

  /**
   * The environment comes from planBackendEnv, which since 2026-09-07 sends ONLY the names the app's
   * own code reads and never a platform-control key. Reusing it here rather than re-deciding is the
   * point: there is one rule about what a deployed app may hold, and both hosts obey it.
   */
  const envPlan = planBackendEnv(opts.vaultSecrets ?? null, opts.files ?? {});
  const deployed = await deployAppToCloudRun({
    token: opts.token,
    projectId: project.projectId,
    region,
    workspaceId: opts.workspaceId,
    appName: opts.appName,
    image: built.image,
    envVars: envPlan.envVars,
  }, fetchImpl);
  if (!deployed.ok) return { ok: false, reason: 'deploy-failed', message: deployed.message };

  return {
    ok: true,
    url: deployed.url,
    service: deployed.service,
    ready: deployed.ready,
    buildId: built.buildId,
    envNote: backendEnvNote(envPlan),
  };
}
