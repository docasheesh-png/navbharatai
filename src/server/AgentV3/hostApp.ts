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
  opts: {
    isAdmin: boolean;
    /**
     * Does this account hold an active hosting plan?
     *
     * 🔴 A SERVER APP RUNS ONLY ON A PLAN, and this parameter is what makes that true rather than
     * merely written down. Free publishing is real and stays real — five static apps on a CDN, on a
     * free NavBharatAI link — but a container runs continuously on machines NavBharatAI pays for, and
     * there is no free tier of that to fall back to. The agreement a buyer ticks now says so in as
     * many words ("Apps that need a server run only on a plan"), so the code owes the same answer.
     *
     * ⚠️ `undefined` means NOT CHECKED and is treated as NO PLAN for a non-admin. An unknown here
     * must never open a paid path — the opposite direction would host somebody's server for free on
     * the strength of a lookup that failed.
     */
    hasPlan?: boolean;
    env?: NodeJS.ProcessEnv;
  },
): Availability {
  const env = opts.env ?? process.env;
  if (!navBharatCloudEnabled(env)) {
    return { available: false, message: 'App hosting on NavBharatAI is not switched on yet.' };
  }
  if (!navBharatCloudPublic(env) && !opts.isAdmin) {
    return { available: false, message: 'App hosting on NavBharatAI is still being tested and is not open to everyone yet.' };
  }
  // The admin is exempt so the path can be tested before anyone can buy into it — the same exemption
  // the public flag above already makes, for the same reason.
  if (!opts.isAdmin && opts.hasPlan !== true) {
    return {
      available: false,
      message: 'Apps that need a server run on a hosting plan. Open Billing → Plans to start one — your app and its code are kept exactly as they are until then.',
    };
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
      reason: 'unavailable' | 'no-source' | 'too-large' | 'unpackable' | 'build-failed' | 'deploy-failed';
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
   * THE SIZE CEILING — see `hostedSourceWithinCap` for why this path had none while the static one
   * has had 50 MB since 2026-08-21. Checked on the PACKED archive, which is what Cloud Build is
   * actually handed, rather than on the loose files: gzip is the difference between refusing a large
   * app and refusing a large amount of repeated text.
   */
  const size = hostedSourceWithinCap(archive.data.byteLength, env);
  if (!size.ok) {
    return { ok: false, reason: 'too-large', message: size.message, detail: `${size.mb} MB packed, cap ${size.capMb} MB` };
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

/**
 * HOW MANY OF THIS OWNER'S APPS MAY RUN A SERVER — the gate behind `HostingTier.backendApps`.
 *
 * 🔴 WHY A SECOND CAP, WHEN `publishedAppCap` ALREADY EXISTS. That one bounds how many apps EXIST; it
 * says nothing about how many hold a container image and a Cloud Run service. Those are different
 * costs and only one of them is paid for by traffic: a static app is a file on a CDN, while a server
 * app carries an image in Artifact Registry whether or not a single visitor arrives. Without this,
 * a 30-app plan implies 30 servers, and the image storage alone outgrows the plan price with nobody
 * visiting at all — the one cost line that no traffic overage offsets.
 *
 * 🔒 RE-HOSTING AN APP THAT IS ALREADY A SERVER APP IS ALWAYS FREE. The cap is on how many run at
 * once, not on how often they are deployed; counting a redeploy would make the last app on a plan
 * un-updatable, which is the shape of bug that turns a limit into a trap.
 *
 * ⚠️ IT FAILS OPEN ON AN UNREADABLE COUNT, and that direction is deliberate and NOT the direction
 * `hasPlan` fails. An unknown PLAN must read as "no plan", because guessing yes gives away a paid
 * product. An unknown COUNT is different: guessing "at the cap" refuses a publish a paying customer
 * is entitled to, on the strength of a Firestore hiccup, while guessing "under it" costs at most one
 * extra idle service — which is nearly free, and self-corrects on the next deploy once the registry
 * reads. The expensive mistake is the visible one.
 *
 * PURE — no store, no clock, so every branch is tested without a network.
 */
export function serverAppLimit(input: {
  isAdmin: boolean;
  /** Workspace ids that already run a server for this owner. `null` = the registry could not be read. */
  liveServerWorkspaceIds: readonly string[] | null;
  /** The workspace being hosted right now. */
  workspaceId: string;
  /** The tier's `backendApps`. `null`/0 = no tier, which the plan gate above has already refused. */
  cap: number | null | undefined;
}): Availability {
  // The admin is exempt for the same reason the flags above exempt them: the path has to be testable
  // before anyone can buy into it.
  if (input.isAdmin) return { available: true, message: '' };

  const cap = Number(input.cap);
  if (!Number.isFinite(cap) || cap <= 0) return { available: true, message: '' };

  const live = input.liveServerWorkspaceIds;
  if (!Array.isArray(live)) return { available: true, message: '' }; // unreadable ⇒ open; see above

  // Already a server app ⇒ this is an update, and updates never spend the allowance.
  const already = live.some((id) => String(id) === String(input.workspaceId));
  if (already) return { available: true, message: '' };

  const used = new Set(live.map((id) => String(id))).size;
  if (used < cap) return { available: true, message: '' };

  return {
    available: false,
    message: `You already have ${used} app${used === 1 ? '' : 's'} running a server, which is your plan's limit of ${cap}. `
      + `Updating one you have already hosted is always free and does not count against this. To host a NEW one, `
      + `take a server off an app you no longer need, or move to a bigger plan in Billing → Plans. Apps without a `
      + `server do not count towards this at all.`,
  };
}

/**
 * THE SIZE CEILING ON A CONTAINER PUBLISH — the one the static path has had since 2026-08-21 and this
 * path never got.
 *
 * 🔴 HOW THE GAP EXISTS, because it is not an oversight anybody would spot by reading either file.
 * `enforceHostingQuota` bounds a publish at `maxDeployMb()` (50 MB, ships ON) — but only for a
 * FIRST-PARTY provider, and `FIRST_PARTY_PROVIDERS` is `['firebase', 'cloudflare']`. NavBharat Cloud
 * publishes under `navbharat-cloud`, so that function returns ALLOW on its very first branch and
 * **nothing downstream measures anything**. A static app cannot exceed 50 MB; a container app had no
 * ceiling at all.
 *
 * 🔑 WHY IT MATTERS MORE NOW THAN IT DID YESTERDAY. The tiers shipped on 2026-09-13 grant 10 and 30
 * SERVER apps. An unbounded source archive is three unbounded costs at once: Cloud Build minutes
 * (billed per minute), the container image in Artifact Registry (**the one cost no traffic overage
 * offsets, and nothing deletes**), and the bytes served to every visitor.
 *
 * ⚠️ IT IS NOT `maxDeployMb()`, DELIBERATELY, AND NOT BECAUSE A SEPARATE KEY IS TIDIER. The two bound
 * different things: that one measures a BUILT bundle (`dist/`), this one measures SOURCE, which is
 * what Cloud Build is handed. They are not comparable quantities, so making a container publish obey
 * a number tuned for built output would refuse legitimate apps for a reason nobody could act on.
 *
 * 🔒 AND `navbharat-cloud` WAS NOT ADDED TO `FIRST_PARTY_PROVIDERS` TO GET THIS, which would have been
 * the one-line version. That set also drives the monthly deploy count and the total-storage
 * accounting, so joining it would have silently changed two unrelated behaviours for every container
 * app — fixing one problem by creating two. A fix must never trade one problem for another.
 *
 * PURE, and generous on purpose: a real app's SOURCE is a few MB (no `node_modules` — they are
 * installed inside the image), so this bounds abuse and cannot reach use.
 */
export function maxHostedSourceMb(env: NodeJS.ProcessEnv = process.env): number {
  // ⚠️ EMPTY MEANS UNSET, NOT ZERO — `Number('')` is 0, which is finite and non-negative, so the
  // obvious implementation turns a key set with no value in Cloud Run into a silent, total removal of
  // the ceiling with nothing in the logs to explain it. Only a deliberate "0" disables it. The exact
  // trap `hostingStorageCapMb` documents, and the reason this is spelled out rather than inlined.
  const raw = String(env.NAVBHARAT_MAX_SOURCE_MB ?? '').trim();
  if (!raw) return 40;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 40;
}

/** Is this source archive small enough to host? PURE. `{ ok: true }` when the cap is disabled. */
export function hostedSourceWithinCap(
  archiveBytes: number,
  env: NodeJS.ProcessEnv = process.env,
): { ok: true } | { ok: false; message: string; mb: number; capMb: number } {
  const capMb = maxHostedSourceMb(env);
  if (!(capMb > 0)) return { ok: true };
  const bytes = Number(archiveBytes);
  // An unmeasurable size is NOT refused. A publish blocked by a number we could not compute is a
  // refusal nobody can act on, and the size is measured from a Buffer we already hold — so an
  // unreadable one means our own bug, not the user's app.
  if (!Number.isFinite(bytes) || bytes < 0) return { ok: true };
  const mb = bytes / (1024 * 1024);
  if (mb <= capMb) return { ok: true };
  return {
    ok: false,
    mb: Math.round(mb * 100) / 100,
    capMb,
    message: `Your app's source is ${mb.toFixed(1)} MB packed, over the ${capMb} MB limit for apps that run a `
      + `server. Large files — videos, datasets, images — should be served from storage rather than shipped `
      + `inside the app: they make every build slower and every visitor download more. Remove them and publish `
      + `again, and nothing about your app's code needs to change.`,
  };
}
