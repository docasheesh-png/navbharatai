// NAVBHARAT CLOUD — every server deploy is ONE recorded attempt, with ONE lifecycle, and never two at once
// (2026-10-06, adapted from an external "hosting foundation" spec; see docs/HOSTING_ARCHITECTURE.md).
//
// 🔴 WHAT WAS MISSING. A container publish ran Cloud Build and Cloud Run inside one HTTP request and wrote
// nothing until it finished. So:
//   • TWO CLICKS = TWO BUILDS. Nothing stopped a second Publish (a double tap, a retry after a dropped
//     connection, another tab, another instance) from starting a second Cloud Build of the same app — two
//     builds billed, two deploys racing to be the revision that serves.
//   • A DEPLOY THAT DIED SAID NOTHING. If the request was cut off mid-build (the client went away, the
//     instance was replaced) there was no record that a deploy had started, how far it got, or that it
//     never finished.
//   • NO HISTORY. The registry holds only the LATEST live deployment, so "what happened to my last three
//     deploys" had no answer anywhere.
//
// THE DESIGN — small on purpose, and reusing the shapes this repo already trusts:
//   • ONE state vocabulary with an explicit transition table (`HOSTED_DEPLOY_TRANSITIONS`). An invalid move
//     is refused by `nextDeployState`, never written.
//   • A per-workspace LEASE claimed in a Firestore transaction — `workspaceBuildLease.ts`'s pattern. A
//     second deploy while one is in flight gets the running attempt's id back instead of a second build.
//     A lease older than the longest possible deploy is stale and claimable: a crash never locks an app.
//   • An ATTEMPT record per deploy (`hosted_deploy_attempts/{deploymentId}`) with its event trail, so a
//     reconnecting client and the admin can both read what happened. A non-terminal attempt whose lease
//     went stale is reported as `abandoned` — never left saying "building" for ever.
//   • A structured event line per transition (`[hosting-event]`): ids, state, a reason CATEGORY. Never a
//     secret, never the provider's raw text.
//
// 🔒 FAILS OPEN, like the build lease: a store that cannot be read lets the deploy START (the old behaviour
// for the length of the outage) rather than locking every server app out of publishing.

import { randomBytes } from 'node:crypto';
import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';
import { processOwnerId } from '../lib/jobLease';
import { BUILD_TIMEOUT_SECONDS } from './containerBuild';

/** Every state a server deploy can be in. */
export const HOSTED_DEPLOY_STATES = ['queued', 'building', 'deploying', 'live', 'failed', 'abandoned'] as const;
export type HostedDeployState = typeof HOSTED_DEPLOY_STATES[number];

/**
 * The ONLY legal moves. `live`, `failed` and `abandoned` are terminal. `abandoned` is reachable from every
 * running state because an instance can die at any point; it is written by the next claimant (or read as
 * such) — never by the attempt itself.
 */
export const HOSTED_DEPLOY_TRANSITIONS: Readonly<Record<HostedDeployState, readonly HostedDeployState[]>> = {
  queued: ['building', 'failed', 'abandoned'],
  building: ['deploying', 'failed', 'abandoned'],
  deploying: ['live', 'failed', 'abandoned'],
  live: [],
  failed: [],
  abandoned: [],
};

export function isTerminalDeployState(s: HostedDeployState): boolean {
  return HOSTED_DEPLOY_TRANSITIONS[s].length === 0;
}

export function canTransitionDeploy(from: HostedDeployState, to: HostedDeployState): boolean {
  return (HOSTED_DEPLOY_TRANSITIONS[from] ?? []).includes(to);
}

/** Why a deploy failed, as a CATEGORY — the user's sentence travels separately, the provider's text never. */
export type DeployFailureCategory =
  | 'blocked' | 'unavailable' | 'no-source' | 'too-large' | 'unpackable' | 'build-failed' | 'deploy-failed' | 'internal';

export interface DeployEvent { state: HostedDeployState; at: number; category?: DeployFailureCategory }

/** One server deploy, as stored. Safe to return to the app's owner: it holds no secret and no provider text. */
export interface HostedDeployAttempt {
  deploymentId: string;
  workspaceId: string;
  userId: string;
  state: HostedDeployState;
  createdAt: number;
  updatedAt: number;
  events: DeployEvent[];
  url?: string;
  service?: string;
  buildId?: string;
  /** Cloud Run's own word that a revision is serving — never inferred. */
  ready?: boolean;
  category?: DeployFailureCategory;
  /** Our sentence for the owner. Never the provider's raw output. */
  message?: string;
}

/**
 * The longest a deploy can legitimately run: the build ceiling plus room for the Cloud Run deploy. A lease
 * older than this belongs to a deploy that is not coming back.
 */
export const DEPLOY_LEASE_STALE_MS = (BUILD_TIMEOUT_SECONDS + 10 * 60) * 1000;

/** A fresh attempt in `queued`. PURE. */
export function newDeployAttempt(input: { workspaceId: string; userId: string; now: number; deploymentId?: string }): HostedDeployAttempt {
  const deploymentId = input.deploymentId ?? `dep_${input.now.toString(36)}_${randomBytes(6).toString('hex')}`;
  return {
    deploymentId, workspaceId: input.workspaceId, userId: input.userId,
    state: 'queued', createdAt: input.now, updatedAt: input.now, events: [{ state: 'queued', at: input.now }],
  };
}

export class InvalidDeployTransition extends Error {
  constructor(public readonly from: HostedDeployState, public readonly to: HostedDeployState) {
    super(`A deploy cannot move from "${from}" to "${to}".`);
  }
}

/** Apply one move. Refuses an illegal one by THROWING — the caller's state is never silently changed. PURE. */
export function nextDeployState(
  a: HostedDeployAttempt,
  to: HostedDeployState,
  now: number,
  patch: Partial<Pick<HostedDeployAttempt, 'url' | 'service' | 'buildId' | 'ready' | 'category' | 'message'>> = {},
): HostedDeployAttempt {
  if (!canTransitionDeploy(a.state, to)) throw new InvalidDeployTransition(a.state, to);
  const event: DeployEvent = { state: to, at: now, ...(patch.category ? { category: patch.category } : {}) };
  return { ...a, ...patch, state: to, updatedAt: now, events: [...a.events, event].slice(-20) };
}

/** What the owner is shown: a running attempt past the stale line is `abandoned`, whatever was last written. PURE. */
export function effectiveDeployState(a: Pick<HostedDeployAttempt, 'state' | 'updatedAt' | 'createdAt'>, now: number): HostedDeployState {
  if (isTerminalDeployState(a.state)) return a.state;
  return now - Math.max(a.updatedAt || 0, a.createdAt || 0) > DEPLOY_LEASE_STALE_MS ? 'abandoned' : a.state;
}

/** The lease document, one per workspace. */
export interface DeployLease { deploymentId: string; owner: string; startedAt: number }

export type DeployClaim =
  | { claimed: true; attempt: HostedDeployAttempt; replaced?: string }
  | { claimed: false; running: { deploymentId: string; startedAt: number } };

/** May a new deploy start, given the current lease? PURE. */
export function decideDeployClaim(existing: DeployLease | null | undefined, now: number): 'claim' | 'busy' {
  if (!existing || typeof existing.startedAt !== 'number') return 'claim';
  return now - existing.startedAt > DEPLOY_LEASE_STALE_MS ? 'claim' : 'busy';
}

/** One structured line per transition. Ids, a state and a category — nothing a log reader could misuse. */
export function deployEventLine(a: Pick<HostedDeployAttempt, 'deploymentId' | 'workspaceId' | 'userId' | 'state' | 'category'>): string {
  return `[hosting-event] ${JSON.stringify({
    event: `DEPLOY_${a.state.toUpperCase()}`,
    deploymentId: a.deploymentId, workspaceId: a.workspaceId, userId: a.userId,
    ...(a.category ? { category: a.category } : {}),
  })}`;
}

// ── Storage ────────────────────────────────────────────────────────────────────────────────────────────

/** One doc per workspace while a deploy runs; deleted when it ends. */
export const HOSTED_DEPLOY_LEASE_COLLECTION = 'hosted_deploy_leases';
/** One doc per deploy attempt, with its event trail. Purged after 180 days (RETENTION_POLICIES). */
export const HOSTED_DEPLOY_ATTEMPTS_COLLECTION = 'hosted_deploy_attempts';

export interface DeployStore {
  /** Atomically claim the workspace, or report the deploy already running. Never throws. */
  claim(workspaceId: string, userId: string, now: number): Promise<DeployClaim>;
  save(a: HostedDeployAttempt): Promise<void>;
  /** Release the lease — only if it is still this attempt's. */
  release(workspaceId: string, deploymentId: string): Promise<void>;
}

function db(): admin.firestore.Firestore | null {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    return getServerDb() as admin.firestore.Firestore;
  } catch {
    return null;
  }
}

export const firestoreDeployStore: DeployStore = {
  async claim(workspaceId, userId, now) {
    const attempt = newDeployAttempt({ workspaceId, userId, now });
    const store = db();
    if (!store) return { claimed: true, attempt }; // fail open — see the header
    try {
      const leaseRef = store.collection(HOSTED_DEPLOY_LEASE_COLLECTION).doc(workspaceId);
      const result = await store.runTransaction(async (tx) => {
        const snap = await tx.get(leaseRef);
        const existing = snap.exists ? (snap.data() as DeployLease) : null;
        if (decideDeployClaim(existing, now) === 'busy' && existing) {
          return { claimed: false as const, running: { deploymentId: existing.deploymentId, startedAt: existing.startedAt } };
        }
        tx.set(leaseRef, { deploymentId: attempt.deploymentId, owner: processOwnerId(), startedAt: now } satisfies DeployLease);
        tx.set(store.collection(HOSTED_DEPLOY_ATTEMPTS_COLLECTION).doc(attempt.deploymentId), attempt);
        return { claimed: true as const, attempt, ...(existing?.deploymentId ? { replaced: existing.deploymentId } : {}) };
      });
      // A stale lease was taken over: its attempt never finished, so it is recorded as abandoned — the
      // reconciliation that stops a dead deploy from reading "building" for ever.
      if (result.claimed && result.replaced) {
        const ref = store.collection(HOSTED_DEPLOY_ATTEMPTS_COLLECTION).doc(result.replaced);
        const old = await ref.get().catch(() => null);
        const prev = old?.exists ? (old.data() as HostedDeployAttempt) : null;
        if (prev && canTransitionDeploy(prev.state, 'abandoned')) {
          const moved = nextDeployState(prev, 'abandoned', now);
          await ref.set(moved).catch(() => undefined);
          console.log(deployEventLine(moved));
        }
      }
      return result;
    } catch {
      return { claimed: true, attempt }; // fail open
    }
  },
  async save(a) {
    const store = db();
    if (!store) return;
    await store.collection(HOSTED_DEPLOY_ATTEMPTS_COLLECTION).doc(a.deploymentId).set(a).catch(() => undefined);
  },
  async release(workspaceId, deploymentId) {
    const store = db();
    if (!store) return;
    try {
      const ref = store.collection(HOSTED_DEPLOY_LEASE_COLLECTION).doc(workspaceId);
      await store.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (snap.exists && (snap.data() as DeployLease).deploymentId === deploymentId) tx.delete(ref);
      });
    } catch { /* a lease left behind goes stale on its own — see DEPLOY_LEASE_STALE_MS */ }
  },
};

/**
 * A running deploy, tracked: every move goes through `nextDeployState`, is saved, and is logged. A move the
 * table refuses is logged as a defect and NOT applied — the attempt stays truthful even if a caller errs.
 */
export class TrackedDeploy {
  constructor(public attempt: HostedDeployAttempt, private readonly store: DeployStore, private readonly now: () => number = Date.now) {}

  async move(to: HostedDeployState, patch: Parameters<typeof nextDeployState>[3] = {}): Promise<void> {
    try {
      this.attempt = nextDeployState(this.attempt, to, this.now(), patch);
    } catch (e) {
      console.error(`[hosting-event] refused transition for ${this.attempt.deploymentId}: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    console.log(deployEventLine(this.attempt));
    await this.store.save(this.attempt);
  }

  async end(): Promise<void> {
    await this.store.release(this.attempt.workspaceId, this.attempt.deploymentId);
  }
}
