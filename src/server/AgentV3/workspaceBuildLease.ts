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
// A store failure refuses a new build. This lease coordinates admission only: it does not stop
// commands already running, fence source writes, or prove a stale sandbox drained. Those remaining
// Phase 2 boundaries require a state-preserving execution design before automatic takeover is safe.
// Runtime IDs, preview origins and existing workspace source paths are unchanged here.

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
 * - otherwise ⇒ busy: a build is running on another instance, and starting a second one is the bug.
 * PURE.
 */
export function leaseClaimDecision(
  existing: Partial<WorkspaceBuildLease> | null | undefined,
  opts: { owner: string; nowMs: number; staleMs?: number },
): LeaseClaimDecision {
  if (!leaseIsLive(existing, opts.nowMs, opts.staleMs)) return 'claim';
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
  /** The store could not be reached. Stop cooperatively and retain the body hold while retrying. */
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
  | { ok: false; reason: 'busy' | 'unavailable'; holderHeartbeatAt: number };

/**
 * Claim before any build work. An unavailable/timed-out store is a retryable refusal, never authority.
 */
export async function claimWorkspaceBuild(
  store: BuildLeaseStore | null | undefined,
  opts: { workspaceId: string; token: string; owner: string; userId?: string | null; nowMs?: number },
): Promise<LeaseClaimResult> {
  if (!store || !opts.workspaceId || !opts.token) return { ok: false, reason: 'unavailable', holderHeartbeatAt: 0 };
  const nowMs = Number.isFinite(opts.nowMs) ? Number(opts.nowMs) : Date.now();
  const deadline = Date.now() + LEASE_CALL_TIMEOUT_MS;
  const attempt = (async (): Promise<LeaseClaimResult> => {
    const ref = store.collection(WORKSPACE_BUILD_LEASE_COLLECTION).doc(opts.workspaceId);
    return store.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const existing = (snap.exists ? snap.data() : undefined) as Partial<WorkspaceBuildLease> | undefined;
      if (leaseClaimDecision(existing ?? null, { owner: opts.owner, nowMs }) === 'busy') {
        return { ok: false as const, reason: 'busy' as const, holderHeartbeatAt: Number(existing?.heartbeatAt) || 0 };
      }
      const lease: WorkspaceBuildLease = { token: opts.token, owner: opts.owner, heartbeatAt: nowMs, userId: opts.userId ?? null };
      if (Date.now() >= deadline) throw new Error('Lease claim expired before commit');
      tx.set(ref, lease as unknown as Record<string, unknown>);
      return { ok: true as const, verified: true };
    });
  })();
  return bounded(attempt, { ok: false, reason: 'unavailable', holderHeartbeatAt: 0 });
}

/**
 * Why a renewal was not confirmed. DNA (failedbr 628 MP3 Converter, Hello #616, 2026-10-30): the build was
 * INTERRUPTED with OUTCOME_AUTHORITY_UNAVAILABLE and nothing recorded WHETHER Firestore timed out, threw,
 * or another owner really held the lease — so an infra blip and a real takeover looked identical.
 */
export type LeaseLossReason = 'timeout' | 'store-error' | 'other-owner' | 'missing' | 'stale' | 'no-store';
export interface LeaseRenewalDetail { renewal: LeaseRenewal; reason?: LeaseLossReason; attempts: number; error?: string }

async function renewOnce(store: BuildLeaseStore, opts: { workspaceId: string; token: string; nowMs?: number }): Promise<Omit<LeaseRenewalDetail, 'attempts'>> {
  const requestStartedAt = Date.now();
  // This exact timestamp is persisted and must also bound the caller's local authority. An ACK's
  // arrival time cannot grant a longer lease than the transaction actually wrote.
  const heartbeatAt = Number.isFinite(opts.nowMs) ? Number(opts.nowMs) : requestStartedAt;
  const deadline = requestStartedAt + LEASE_CALL_TIMEOUT_MS;
  const attempt = (async (): Promise<Omit<LeaseRenewalDetail, 'attempts'>> => {
    const ref = store.collection(WORKSPACE_BUILD_LEASE_COLLECTION).doc(opts.workspaceId);
    return store.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const existing = (snap.exists ? snap.data() : undefined) as Partial<WorkspaceBuildLease> | undefined;
      const currentTime = heartbeatAt + Math.max(0, Date.now() - requestStartedAt);
      if (Date.now() >= deadline) throw new Error('Lease renewal expired before commit');
      const stillLive = leaseIsLive(existing, currentTime) && currentTime < Number(existing?.heartbeatAt) + LEASE_STALE_MS;
      const verdict = stillLive ? leaseRenewalDecision(existing ?? null, opts.token) : 'lost';
      // A requested Stop does not prove the shared runtime drained. Keep its exact live token
      // renewed until the captured build has actually exited and releases the lease.
      if (verdict !== 'lost') tx.set(ref, { ...(existing as Record<string, unknown>), heartbeatAt });
      const reason: LeaseLossReason | undefined = verdict !== 'lost' ? undefined
        : !existing ? 'missing' : existing.token !== opts.token ? 'other-owner' : 'stale';
      return { renewal: verdict, reason };
    });
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([attempt, new Promise<Omit<LeaseRenewalDetail, 'attempts'>>((resolve) => {
      timer = setTimeout(() => resolve({ renewal: 'unknown', reason: 'timeout' }), LEASE_CALL_TIMEOUT_MS);
    })]);
  } catch (error) {
    return { renewal: 'unknown', reason: 'store-error', error: error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160) };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Transient-store retries inside ONE heartbeat (3 attempts × ≤4 s + jitter stays under the 20 s beat). */
export const LEASE_RENEW_ATTEMPTS = 3;
const jitter = (attempt: number) => 250 * attempt + Math.floor(Math.random() * 250);

/**
 * Renew, retrying ONLY an unconfirmed ('unknown': timeout / thrown store error) result with jitter.
 * A definite answer ('held' / 'stop-requested' / 'lost') is never retried. Never overwrites a lease
 * that is no longer ours. Every retry re-stamps `heartbeatAt` at its own start, so a late ACK cannot
 * grant more authority than the transaction actually wrote.
 */
export async function renewWorkspaceBuildDetailed(
  store: BuildLeaseStore | null | undefined,
  opts: { workspaceId: string; token: string; nowMs?: number; attempts?: number },
): Promise<LeaseRenewalDetail> {
  if (!store || !opts.workspaceId) return { renewal: 'unknown', reason: 'no-store', attempts: 0 };
  const max = Math.max(1, opts.attempts ?? LEASE_RENEW_ATTEMPTS);
  let last: Omit<LeaseRenewalDetail, 'attempts'> = { renewal: 'unknown' };
  for (let i = 1; i <= max; i++) {
    last = await renewOnce(store, { ...opts, nowMs: i === 1 ? opts.nowMs : Date.now() });
    if (last.renewal !== 'unknown') return { ...last, attempts: i };
    if (i < max) await new Promise((resolve) => setTimeout(resolve, jitter(i)));
  }
  return { ...last, attempts: max };
}

/** Renew this build's lease. Never overwrites a lease that is no longer ours. */
export async function renewWorkspaceBuild(
  store: BuildLeaseStore | null | undefined,
  opts: { workspaceId: string; token: string; nowMs?: number; attempts?: number },
): Promise<LeaseRenewal> {
  // Single attempt by default (imports and other callers keep their exact timing); the build heartbeat opts into retries.
  return (await renewWorkspaceBuildDetailed(store, { ...opts, attempts: opts.attempts ?? 1 })).renewal;
}

/**
 * Claim, but WAIT (bounded) for a draining previous run to release instead of refusing at once.
 * DNA (failedbr 629 → 628): a user's Continue arrived while the interrupted run was still draining its
 * lease and was refused / raced it. A live holder keeps renewing and stays 'busy' → honest 409 after
 * the wait; a releasing one frees the doc within seconds and Continue proceeds.
 */
export async function claimWorkspaceBuildAwaitingRelease(
  store: BuildLeaseStore | null | undefined,
  opts: { workspaceId: string; token: string; owner: string; userId?: string | null; nowMs?: number; waitMs?: number; pollMs?: number },
  claim: typeof claimWorkspaceBuild = claimWorkspaceBuild,
): Promise<LeaseClaimResult> {
  const waitUntil = Date.now() + Math.max(0, opts.waitMs ?? 12_000);
  let nowMs = opts.nowMs;
  for (;;) {
    const result = await claim(store, { ...opts, nowMs });
    // Only a live holder ('busy') is waited for; 'unavailable' stays an immediate honest 503.
    if (result.ok || result.reason !== 'busy' || Date.now() >= waitUntil || !store) return result;
    await new Promise((resolve) => setTimeout(resolve, (opts.pollMs ?? 1_500) + Math.floor(Math.random() * 300)));
    nowMs = Date.now();
    if (Date.now() >= waitUntil) return claim(store, { ...opts, nowMs });
  }
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
 * Is a build holding this workspace right now, on ANY instance? For a caller that must not change the app's
 * files underneath a running build (a version restore — Q-128). `null` when the store could not say; the
 * caller decides what an unknown means. Bounded like every other lease call.
 */
export async function workspaceBuildIsLive(
  store: BuildLeaseStore | null | undefined,
  workspaceId: string,
  nowMs: number = Date.now(),
): Promise<boolean | null> {
  if (!store || !workspaceId) return null;
  const attempt = (async (): Promise<boolean | null> => {
    const ref = store.collection(WORKSPACE_BUILD_LEASE_COLLECTION).doc(workspaceId);
    return store.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      return leaseIsLive((snap.exists ? snap.data() : undefined) as Partial<WorkspaceBuildLease> | undefined, nowMs);
    });
  })();
  return bounded(attempt, null);
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
