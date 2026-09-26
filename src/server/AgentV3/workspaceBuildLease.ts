// AgentV3 — ONE BUILD PER APP, ACROSS EVERY SERVER (autopsy 2026-09-26, "4D Future City Drive").
//
// 🔴 WHAT HAPPENED. A free user asked for a driving game. Their connection dropped three minutes in
// ("network error"), the app offered to fix it, and the retry started a SECOND build on the same
// app. A minute later "Failed to fetch" started a THIRD. All three ran at once in ONE sandbox:
//   • two `npm install`s collided in the same node_modules (ENOTEMPTY, a half-installed `three`);
//   • the third build deleted the first build's files while the first was still writing them;
//   • the first build's reviewer read files the third had written, and its saved copy went stale;
//   • the user was billed for both full builds of one game.
//
// 🔑 THE LOCK EXISTED — IN ONE SERVER'S MEMORY. `activeBuilds` / `runningBuilds` in routes/agentv3.ts
// are a Set and a Map inside one Node process. Cloud Run runs several instances behind a load
// balancer with no session affinity, so the retry after a dropped connection lands wherever the
// balancer sends it. On any other instance the Set is empty: no lock, no 409, a parallel build.
// The same gap made every "is it still running?" answer (/status, /attach, /stop) false on the wrong
// instance, which is why the client's watchdog concluded the build was dead and auto-continued
// with a new one.
//
// THE FIX: a durable LEASE per workspace in Firestore, claimed in a transaction when a turn takes the
// in-memory lock, kept alive by a heartbeat while that lock is held, and released the moment it is
// not. Another instance that finds a live lease held by a different process refuses to start a
// second build and tells the client to follow the one that is running.
//
// 🔒 THE LEASE MIRRORS THE IN-MEMORY LOCK BY CONSTRUCTION. There are seven places that release
// `activeBuilds` (chat replies, refusals, the watchdog finalizer, the finally, Stop, the reaper, the
// deploy drain). Adding a release call to each is the "remember it at every call site" pattern this
// repo has paid for repeatedly. Instead the holder watches the in-memory lock every second (a Set
// lookup — free) and releases the lease as soon as the lock is gone or has passed to a newer turn.
//
// 🔒 FAILS OPEN, deliberately the same as jobLease.ts. If Firestore cannot be reached, the claim
// succeeds and today's behaviour (the in-memory lock only) applies. Failing closed would let one
// database hiccup refuse every build on the platform; failing open costs, at worst, the bug this
// file fixes, and only for the length of the outage.
//
// 🔒 A DEAD HOLDER CANNOT TRAP AN APP. The heartbeat refreshes `heartbeatAt` every
// BUILD_LEASE_HEARTBEAT_MS; a lease whose heartbeat is older than BUILD_LEASE_TTL_MS is claimable.
// An instance killed mid-build (a deploy, a crash) therefore frees the app within the TTL.

/** Where leases live. One document per workspace, so two different apps never contend. */
export const BUILD_LEASE_COLLECTION = 'agentv3_build_leases';

/** How often a live holder refreshes its lease. */
export const BUILD_LEASE_HEARTBEAT_MS = 15_000;

/**
 * How long a lease survives without a heartbeat. Five missed beats: long enough that a slow
 * Firestore write or a GC pause never frees a live build, short enough that an instance killed by a
 * deploy frees the app in about a minute.
 */
export const BUILD_LEASE_TTL_MS = 75_000;

/** How often the holder checks whether the in-memory lock is still its own. In-memory only. */
export const BUILD_LEASE_WATCH_MS = 1_000;

/** A lease as stored. */
export interface WorkspaceBuildLease {
  /** The turn that holds it — a random id per request, never reused. */
  leaseId: string;
  /** The process that holds it (jobLease.ts `processOwnerId`). */
  owner: string;
  userId: string | null;
  startedAt: number;
  heartbeatAt: number;
  /** Set by /stop on an instance that does not hold the build; the holder aborts on its next beat. */
  stopRequestedAt?: number | null;
}

export type BuildLeaseDecision = 'claim' | 'held-elsewhere';

/** `off` is the no-deploy revert to the in-memory lock alone. Default ON. */
export function buildLeaseEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.AGENTV3_WORKSPACE_BUILD_LEASE ?? '').trim().toLowerCase() !== 'off';
}

/** Is this stored lease still held by a live process? PURE. */
export function leaseIsLive(existing: Partial<WorkspaceBuildLease> | null | undefined, nowMs: number, ttlMs = BUILD_LEASE_TTL_MS): boolean {
  if (!existing || typeof existing.owner !== 'string' || !existing.owner) return false;
  if (typeof existing.leaseId !== 'string' || !existing.leaseId) return false;
  const beat = Number(existing.heartbeatAt);
  // An unreadable heartbeat is treated as dead, never as held forever: a corrupt document must not
  // be able to lock an app permanently.
  if (!Number.isFinite(beat)) return false;
  return nowMs - beat <= ttlMs;
}

/**
 * May this process start a turn on this workspace? PURE.
 *
 * A lease held by THIS process is claimable: the in-memory lock in the same process has already
 * decided (409 or reclaim), and it knows things this document cannot, such as whether the old build
 * still has a watcher. Only a live lease held by ANOTHER process refuses.
 */
export function buildLeaseDecision(
  existing: Partial<WorkspaceBuildLease> | null | undefined,
  opts: { owner: string; nowMs: number; ttlMs?: number },
): BuildLeaseDecision {
  if (!leaseIsLive(existing, opts.nowMs, opts.ttlMs)) return 'claim';
  return existing!.owner === opts.owner ? 'claim' : 'held-elsewhere';
}

/** The Firestore surface this needs — narrowed so tests never touch a database. */
export interface BuildLeaseStore {
  runTransaction<T>(fn: (tx: {
    get(ref: unknown): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
    set(ref: unknown, value: Record<string, unknown>): void;
    update(ref: unknown, value: Record<string, unknown>): void;
    delete(ref: unknown): void;
  }) => Promise<T>): Promise<T>;
  collection(name: string): { doc(id: string): unknown };
}

export type ClaimResult =
  | { ok: true; degraded?: boolean }
  | { ok: false; heldSince: number };

/**
 * Claim the workspace for one turn. A transaction, because two instances deciding at the same
 * moment must not both win — a read-then-write would be a race with the exact shape of the bug.
 */
export async function claimBuildLease(
  store: BuildLeaseStore | null | undefined,
  opts: { workspaceId: string; leaseId: string; owner: string; userId: string | null; nowMs?: number },
): Promise<ClaimResult> {
  if (!store || !opts.workspaceId) return { ok: true, degraded: true };
  const nowMs = Number.isFinite(opts.nowMs) ? Number(opts.nowMs) : Date.now();
  try {
    const ref = store.collection(BUILD_LEASE_COLLECTION).doc(opts.workspaceId);
    return await store.runTransaction(async (tx): Promise<ClaimResult> => {
      const snap = await tx.get(ref);
      const existing = (snap.exists ? snap.data() : undefined) as Partial<WorkspaceBuildLease> | undefined;
      if (buildLeaseDecision(existing, { owner: opts.owner, nowMs }) === 'held-elsewhere') {
        return { ok: false, heldSince: Number(existing?.startedAt) || nowMs };
      }
      const lease: WorkspaceBuildLease = {
        leaseId: opts.leaseId, owner: opts.owner, userId: opts.userId,
        startedAt: nowMs, heartbeatAt: nowMs, stopRequestedAt: null,
      };
      tx.set(ref, { ...lease });
      return { ok: true };
    });
  } catch {
    // See the header: an unreachable store falls back to the in-memory lock, never to "refuse all".
    return { ok: true, degraded: true };
  }
}

export type HeartbeatResult = 'held' | 'stop-requested' | 'lost' | 'unknown';

/**
 * Refresh the lease if it is still this turn's. Reports a stop request so the holder can act on a
 * Stop pressed on another instance. `lost` means another turn owns it now; the holder stops beating.
 */
export async function heartbeatBuildLease(
  store: BuildLeaseStore | null | undefined,
  opts: { workspaceId: string; leaseId: string; nowMs?: number },
): Promise<HeartbeatResult> {
  if (!store || !opts.workspaceId) return 'unknown';
  const nowMs = Number.isFinite(opts.nowMs) ? Number(opts.nowMs) : Date.now();
  try {
    const ref = store.collection(BUILD_LEASE_COLLECTION).doc(opts.workspaceId);
    return await store.runTransaction(async (tx): Promise<HeartbeatResult> => {
      const snap = await tx.get(ref);
      const existing = (snap.exists ? snap.data() : undefined) as Partial<WorkspaceBuildLease> | undefined;
      if (!existing || existing.leaseId !== opts.leaseId) return 'lost';
      tx.update(ref, { heartbeatAt: nowMs });
      return Number(existing.stopRequestedAt) > 0 ? 'stop-requested' : 'held';
    });
  } catch {
    return 'unknown';
  }
}

/** Release the lease — only if it is still this turn's, so a late release never frees a newer build. */
export async function releaseBuildLease(
  store: BuildLeaseStore | null | undefined,
  opts: { workspaceId: string; leaseId: string },
): Promise<void> {
  if (!store || !opts.workspaceId) return;
  try {
    const ref = store.collection(BUILD_LEASE_COLLECTION).doc(opts.workspaceId);
    await store.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const existing = snap.exists ? snap.data() : undefined;
      if (existing && existing.leaseId === opts.leaseId) tx.delete(ref);
    });
  } catch { /* the TTL frees it — a missed release costs at most BUILD_LEASE_TTL_MS */ }
}

/** Read the live lease for a workspace, or null. Never throws. */
export async function readLiveBuildLease(
  store: BuildLeaseStore | null | undefined,
  workspaceId: string,
  nowMs = Date.now(),
): Promise<WorkspaceBuildLease | null> {
  if (!store || !workspaceId) return null;
  try {
    const ref = store.collection(BUILD_LEASE_COLLECTION).doc(workspaceId);
    return await store.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const existing = (snap.exists ? snap.data() : undefined) as Partial<WorkspaceBuildLease> | undefined;
      return leaseIsLive(existing, nowMs) ? (existing as WorkspaceBuildLease) : null;
    });
  } catch {
    return null;
  }
}

/**
 * Ask the holder on another instance to stop. Only a live lease held by a DIFFERENT process is
 * flagged; a lease this process holds is stopped through the in-memory registry instead.
 * Returns true when a request was recorded.
 */
export async function requestRemoteStop(
  store: BuildLeaseStore | null | undefined,
  opts: { workspaceId: string; owner: string; nowMs?: number },
): Promise<boolean> {
  if (!store || !opts.workspaceId) return false;
  const nowMs = Number.isFinite(opts.nowMs) ? Number(opts.nowMs) : Date.now();
  try {
    const ref = store.collection(BUILD_LEASE_COLLECTION).doc(opts.workspaceId);
    return await store.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const existing = (snap.exists ? snap.data() : undefined) as Partial<WorkspaceBuildLease> | undefined;
      if (buildLeaseDecision(existing, { owner: opts.owner, nowMs }) !== 'held-elsewhere') return false;
      tx.update(ref, { stopRequestedAt: nowMs });
      return true;
    });
  } catch {
    return false;
  }
}

/**
 * Keep a claimed lease alive for exactly as long as the caller's in-memory lock is held.
 *
 * `stillHeld()` is asked every BUILD_LEASE_WATCH_MS (a Set lookup). The first time it answers false
 * the lease is released and every timer stops. `onStopRequested` fires once when a Stop pressed on
 * another instance reaches this holder. Timers are unref'd so a forgotten holder can never keep the
 * process alive. Returns a stopper that releases at once.
 */
export function holdBuildLease(
  store: BuildLeaseStore | null | undefined,
  opts: {
    workspaceId: string;
    leaseId: string;
    stillHeld: () => boolean;
    onStopRequested?: () => void;
    heartbeatMs?: number;
    watchMs?: number;
  },
): () => void {
  let done = false;
  let stopSignalled = false;
  const unref = (t: { unref?: () => void } | undefined) => { try { t?.unref?.(); } catch { /* not every runtime has it */ } };
  const finish = (release: boolean) => {
    if (done) return;
    done = true;
    clearInterval(watch);
    clearInterval(beat);
    if (release) void releaseBuildLease(store, { workspaceId: opts.workspaceId, leaseId: opts.leaseId });
  };
  const watch = setInterval(() => {
    let held = false;
    try { held = opts.stillHeld(); } catch { held = false; }
    if (!held) finish(true);
  }, opts.watchMs ?? BUILD_LEASE_WATCH_MS);
  const beat = setInterval(() => {
    if (done) return;
    void heartbeatBuildLease(store, { workspaceId: opts.workspaceId, leaseId: opts.leaseId }).then((r) => {
      if (done) return;
      // Another turn owns the lease now: stop beating, and do not release — it is not ours.
      if (r === 'lost') { finish(false); return; }
      if (r === 'stop-requested' && !stopSignalled) {
        stopSignalled = true;
        try { opts.onStopRequested?.(); } catch { /* a stop request must never throw into a timer */ }
      }
    });
  }, opts.heartbeatMs ?? BUILD_LEASE_HEARTBEAT_MS);
  unref(watch as unknown as { unref?: () => void });
  unref(beat as unknown as { unref?: () => void });
  return () => finish(true);
}

/** The words a user reads when their app is already being built elsewhere. No vendor, no server. */
export const BUILD_HELD_ELSEWHERE_MESSAGE =
  'This app is still being built from your earlier message. Following that build live here instead of starting a second one.';
