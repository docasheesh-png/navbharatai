// ONE BUILD PER WORKSPACE — ACROSS EVERY SERVER INSTANCE (autopsy eed79815, 2026-09-26).
//
// The build lock (`activeBuilds` / `runningBuilds` in routes/agentv3.ts) lives in ONE process's memory.
// A user whose connection dropped five minutes into a build pressed "Fix this error and continue"; the
// retry reached a DIFFERENT Cloud Run instance, which had never heard of the first build, and started a
// second one in the same workspace — the same sandbox, the same files, the same node_modules. Then a
// third. For fourteen minutes two builds wrote over each other's App.tsx, ran `npm install` into one
// directory at once (half-extracted packages, ENOTEMPTY on every retry), and one deleted the other's
// files as "leftovers". Both reported success; the user was billed for both.
//
// The proof it was cross-instance and not the in-process reclaim: that reclaim ABORTS the old build, and
// the first build ran fifty more model calls to a green finish. Nothing aborted it, because nothing on
// the second instance knew it existed.
//
// 🔒 THE DESIGN IS `jobLease.ts`'s, applied to builds: a Firestore document per workspace, claimed in a
// transaction, kept alive by a heartbeat, released when the build ends. SCALE-PLAN §2 named exactly
// this class ("per-instance memory that pretends to be global") with the trigger "duplicated work across
// instances" — which is what this report is. It needs no Redis: one small document per building
// workspace, written every 20 seconds while a build runs, deleted when it ends.
//
// 🔒 IT FAILS OPEN, like `jobLease.ts` and unlike `webRiskBudget.ts`, and deliberately so: a lease the
// store cannot read lets the build START. Failing closed would turn one Firestore blip into "nobody on
// the platform can build"; failing open costs, at worst, today's behaviour for the length of the blip.
//
// 🔒 A STALE LEASE IS CLAIMABLE. An instance that crashes mid-build stops heartbeating, and after
// `LEASE_STALE_MS` its lease stops blocking anybody — a crash can never lock a user out of their app.
//
// PURE decisions + a thin transactional I/O layer, so the rules are testable without a database.

/** A lease as it is stored. */
export interface WorkspaceBuildLease {
  /** A random token for THIS build attempt — never the user id, which two attempts share. */
  token: string;
  /** The process that holds it (`processOwnerId()` from jobLease.ts). */
  owner: string;
  heartbeatAt: number;
  userId?: string | null;
  /** Set by a Stop pressed on ANOTHER instance; the holder aborts on its next heartbeat. */
  stopRequested?: boolean;
}

/** Collection name. One document per workspace id — no cross-workspace contention by construction. */
export const WORKSPACE_BUILD_LEASE_COLLECTION = 'agentv3_build_leases';

/** How often a running build renews its lease. */
export const LEASE_HEARTBEAT_MS = 20_000;

/**
 * How long a lease survives without a heartbeat. Four missed beats: long enough that a slow event loop
 * or a single failed write does not free a live build's workspace, short enough that a crashed instance
 * blocks the user for about a minute and a half at most.
 */
export const LEASE_STALE_MS = 90_000;

export type LeaseClaimDecision = 'claim' | 'busy';

/**
 * May a NEW build claim this workspace?
 *
 * - no lease, an unreadable one, or a stale one ⇒ claim;
 * - a lease held by THIS process ⇒ claim. This process's own in-memory lock has already decided whether
 *   a build is running here (the route checks it first), so a lease this process holds without a live
 *   build is a leftover from an exit path that did not release it — it must never block its own owner;
 * - otherwise ⇒ busy: a build is running on another instance, and starting a second one is the bug.
 * PURE.
 */
export function leaseClaimDecision(
  existing: Partial<WorkspaceBuildLease> | null | undefined,
  opts: { owner: string; nowMs: number; staleMs?: number },
): LeaseClaimDecision {
  if (!leaseIsLive(existing, opts.nowMs, opts.staleMs)) return 'claim';
  if (existing?.owner === opts.owner) return 'claim';
  return 'busy';
}

/**
 * Is this lease held by a build that is still heartbeating? An unreadable heartbeat counts as stale: a
 * corrupt document must never lock a workspace forever. PURE.
 */
export function leaseIsLive(existing: Partial<WorkspaceBuildLease> | null | undefined, nowMs: number, staleMs?: number): boolean {
  if (!existing || typeof existing.token !== 'string' || !existing.token) return false;
  const beat = Number(existing.heartbeatAt);
  const window = Number.isFinite(staleMs) && (staleMs as number) > 0 ? (staleMs as number) : LEASE_STALE_MS;
  return Number.isFinite(beat) && nowMs - beat <= window;
}

/** What a heartbeat found. PURE vocabulary. */
export type LeaseRenewal =
  /** Still ours; renewed. */
  | 'held'
  /** Still ours, and somebody pressed Stop on another instance — abort the build. */
  | 'stop-requested'
  /** No longer ours (it lapsed and a newer build took the workspace) — this build must stop writing. */
  | 'lost'
  /** The store could not be reached. Keep building; the next beat tries again. */
  | 'unknown';

/** PURE: the renewal outcome for a document read inside the heartbeat transaction. */
export function leaseRenewalDecision(existing: Partial<WorkspaceBuildLease> | null | undefined, token: string): Exclude<LeaseRenewal, 'unknown'> {
  if (!existing || existing.token !== token) return 'lost';
  return existing.stopRequested === true ? 'stop-requested' : 'held';
}

/** The Firestore surface this needs — narrowed so tests never touch a database. */
export interface BuildLeaseStore {
  runTransaction<T>(fn: (tx: {
    get(ref: unknown): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
    set(ref: unknown, value: Record<string, unknown>): void;
    delete(ref: unknown): void;
  }) => Promise<T>): Promise<T>;
  collection(name: string): { doc(id: string): unknown };
}

/** Bound on every lease call, so a slow store can never hold a build request hostage. */
export const LEASE_CALL_TIMEOUT_MS = 4_000;

async function bounded<T>(p: Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p, new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), LEASE_CALL_TIMEOUT_MS); })]);
  } catch {
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type LeaseClaimResult =
  | { ok: true; verified: boolean }
  | { ok: false; holderHeartbeatAt: number };

/**
 * Claim the workspace for a new build. `verified: false` means the store could not be reached and the
 * build was let through (fail-open — see the header).
 */
export async function claimWorkspaceBuild(
  store: BuildLeaseStore | null | undefined,
  opts: { workspaceId: string; token: string; owner: string; userId?: string | null; nowMs?: number },
): Promise<LeaseClaimResult> {
  if (!store || !opts.workspaceId) return { ok: true, verified: false };
  const nowMs = Number.isFinite(opts.nowMs) ? Number(opts.nowMs) : Date.now();
  const attempt = (async (): Promise<LeaseClaimResult> => {
    const ref = store.collection(WORKSPACE_BUILD_LEASE_COLLECTION).doc(opts.workspaceId);
    return store.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const existing = (snap.exists ? snap.data() : undefined) as Partial<WorkspaceBuildLease> | undefined;
      if (leaseClaimDecision(existing ?? null, { owner: opts.owner, nowMs }) === 'busy') {
        return { ok: false as const, holderHeartbeatAt: Number(existing?.heartbeatAt) || 0 };
      }
      const lease: WorkspaceBuildLease = { token: opts.token, owner: opts.owner, heartbeatAt: nowMs, userId: opts.userId ?? null };
      tx.set(ref, lease as unknown as Record<string, unknown>);
      return { ok: true as const, verified: true };
    });
  })();
  return bounded(attempt, { ok: true, verified: false });
}

/** Renew this build's lease. Never overwrites a lease that is no longer ours. */
export async function renewWorkspaceBuild(
  store: BuildLeaseStore | null | undefined,
  opts: { workspaceId: string; token: string; nowMs?: number },
): Promise<LeaseRenewal> {
  if (!store || !opts.workspaceId) return 'unknown';
  const nowMs = Number.isFinite(opts.nowMs) ? Number(opts.nowMs) : Date.now();
  const attempt = (async (): Promise<LeaseRenewal> => {
    const ref = store.collection(WORKSPACE_BUILD_LEASE_COLLECTION).doc(opts.workspaceId);
    return store.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const existing = (snap.exists ? snap.data() : undefined) as Partial<WorkspaceBuildLease> | undefined;
      const verdict = leaseRenewalDecision(existing ?? null, opts.token);
      if (verdict !== 'lost') tx.set(ref, { ...(existing as Record<string, unknown>), heartbeatAt: nowMs });
      return verdict;
    });
  })();
  return bounded(attempt, 'unknown');
}

/** Release this build's lease — only if it is still ours. Best-effort; a failure just lets it go stale. */
export async function releaseWorkspaceBuild(
  store: BuildLeaseStore | null | undefined,
  opts: { workspaceId: string; token: string },
): Promise<void> {
  if (!store || !opts.workspaceId) return;
  const attempt = (async (): Promise<void> => {
    const ref = store.collection(WORKSPACE_BUILD_LEASE_COLLECTION).doc(opts.workspaceId);
    await store.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const existing = (snap.exists ? snap.data() : undefined) as Partial<WorkspaceBuildLease> | undefined;
      if (existing && existing.token === opts.token) tx.delete(ref);
    });
  })();
  await bounded(attempt, undefined);
}

/**
 * Ask the build holding this workspace — on whatever instance — to stop. Returns whether a live lease
 * was found and flagged. The holder sees the flag on its next heartbeat (≤ LEASE_HEARTBEAT_MS).
 */
export async function requestWorkspaceBuildStop(
  store: BuildLeaseStore | null | undefined,
  opts: { workspaceId: string; nowMs?: number },
): Promise<boolean> {
  if (!store || !opts.workspaceId) return false;
  const nowMs = Number.isFinite(opts.nowMs) ? Number(opts.nowMs) : Date.now();
  const attempt = (async (): Promise<boolean> => {
    const ref = store.collection(WORKSPACE_BUILD_LEASE_COLLECTION).doc(opts.workspaceId);
    return store.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const existing = (snap.exists ? snap.data() : undefined) as Partial<WorkspaceBuildLease> | undefined;
      // Only a LIVE lease is worth flagging; a stale one belongs to no running build.
      if (!leaseIsLive(existing, nowMs)) return false;
      tx.set(ref, { ...(existing as Record<string, unknown>), stopRequested: true });
      return true;
    });
  })();
  return bounded(attempt, false);
}

/**
 * The user-facing refusal when a build is already running on another instance. Branded, no vendor
 * names, and it states the two facts the user needs: the earlier build is still working (so their work
 * is not lost), and how to get their message through.
 */
export const BUILD_RUNNING_ELSEWHERE_MESSAGE =
  'Your earlier build for this app is still running — it keeps going even when the connection drops. ' +
  'Reopen this chat in a moment to see it, or press ⏹ Stop and then send your message again.';

/** The machine-readable code on that refusal, so a client can offer Stop instead of a dead end. */
export const BUILD_RUNNING_ELSEWHERE_CODE = 'BUILD_RUNNING_ELSEWHERE';
