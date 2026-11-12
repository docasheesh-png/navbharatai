// AgentV3 — durable record of a workspace's E2B sandbox id, so a RETURNING build can RESUME the same
// warm sandbox (files + node_modules + dev server already there) instead of paying a full cold
// create + restore + npm install on every turn.
//
// The E2BActuator already supports resume: getSandbox() calls Sandbox.connect(resumeSandboxId) with an
// auto-create fallback, and the idle sweep pauses inactive sandboxes (E2B persists a paused sandbox).
// The only missing piece was persisting the sandbox id across a Cloud Run instance restart. This store
// closes that gap.
//
// Collection: `agentv3_sandboxes`
// Doc ID:     `<workspaceId>` (one sandbox per workspace — the latest wins)
// Fields:     workspaceId, userId, sandboxId, updatedAt
//
// SAFETY — "a user only ever resumes their OWN sandbox":
//   The doc is keyed by workspaceId, and workspaceId is `agentv3-{uid}-{sessionId}` derived SERVER-SIDE
//   from the VERIFIED Firebase identity (deriveWorkspaceId). A caller can never produce a workspaceId
//   for a uid that isn't theirs, so get(workspaceId) can only ever return THIS user's sandbox. Combined
//   with the single-build-per-account lock (activeBuilds 409), two instances never resume the same
//   sandbox concurrently. Mirrors DeploymentStore: VITEST-skip, best-effort, never throws/blocks a build.
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getServerDb } from '../lib/serverDb';
import { isUsableRecipe, type PreviewRecipe } from './previewRevival';
import type { PauseCause } from './sandboxLifetime';
import type { SandboxSession } from './sandboxSessions';
import { dayKey } from './sandboxSessions';

export interface SandboxRecord {
  workspaceId: string;
  userId: string;
  sandboxId: string;
  updatedAt: number;
  /** Epoch ms the orphan reaper paused this sandbox, if it ever did. See sandboxReaper.ts. */
  pausedAt?: number;
  /**
   * WHICH sweep paused it — so the admin can see which mechanism actually ends machines instead of
   * inferring it from the bill (sandboxLifetime.ts). Absent on records paused before this existed,
   * and absent on a machine E2B paused at its own lifetime, which we never stamp at all.
   */
  pausedBy?: PauseCause;
  /**
   * One local observation selected by reported start time, not a provider lifetime or billing record.
   * Written at start and exact-ID end; clock skew, concurrent instances and failed writes can lose
   * observations. End describes local accounting, never proof of provider pause or global ownership.
   */
  session?: SandboxSession;
  /**
   * How to bring this preview back WITHOUT guessing — the command that actually started the dev
   * server and the port that actually rendered the app, captured the moment the preview first worked.
   *
   * It lives on THIS record, not in a second collection, on purpose: it shares the workspace's
   * lifetime exactly, it is read at precisely the moment a resume is being attempted, and one record
   * cannot drift out of step with itself. See previewRevival.ts for why it is captured at success
   * rather than derived at revival.
   */
  recipe?: PreviewRecipe;
  /**
   * A permanent, VM-free copy of the app as of its last green build — served when the sandbox is
   * genuinely gone (previewSnapshot.ts).
   *
   * It lives on THIS record for the same reason the recipe does: it shares the workspace's lifetime
   * exactly, it is read at precisely the moment a preview is being resolved, and one record cannot
   * drift out of step with itself.
   */
  snapshotUrl?: string;
  /** When that snapshot was taken — so the surface can say how old the copy is, rather than guess. */
  snapshotAt?: number;
  /**
   * The hash of the SOURCE the copy was built from (snapshotIdentity.ts) — what makes "is this copy
   * the app as it stands now?" a question of content rather than of clocks. Absent on copies taken
   * before it was recorded; readers then fall back to the clock rule.
   */
  snapshotFilesHash?: string;
  /**
   * The port this app SAYS it serves on, read from its own scripts/config (declaredPort.ts).
   *
   * Strictly weaker than `recipe.port`, which is a port we have SEEN serving — and stored anyway,
   * because a preview that has never once come up has no recipe at all, and that is precisely when the
   * door was falling through to a common-ports guess and landing on 3000 for an app on 5000.
   */
  declaredPort?: number;
}

export type SandboxRecoveryIdentity =
  | { state: 'found'; sandboxId: string }
  | { state: 'missing' }
  | { state: 'unavailable' };

// Session ordering is only reported client-clock order, never provider chronology or authority.
function validSession(value: unknown): value is SandboxSession {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const s = value as SandboxSession;
  return typeof s.sandboxId === 'string' && s.sandboxId.length > 0
    && typeof s.origin === 'string' && s.origin.length > 0
    && typeof s.reason === 'string' && s.reason.length > 0
    && Number.isFinite(s.startedAt) && s.startedAt > 0
    && Number.isFinite(s.busyMs) && s.busyMs >= 0
    && Number.isInteger(s.ops) && s.ops >= 0
    && (s.observationId === undefined || validObservationId(s.observationId))
    && (s.endedAt === undefined || (Number.isFinite(s.endedAt) && s.endedAt >= s.startedAt))
    && (s.endedBy === undefined || (s.endedAt !== undefined
      && ['idle-sweep', 'orphan-sweep', 'dropped'].includes(s.endedBy)));
}

function validObservationId(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export class SandboxStore {
  private db: admin.firestore.Firestore | null = null;
  // Advance over raw documents, including already-paused records. Starting at the same oldest
  // 50 rows forever let historical pauses hide every newer orphan from the cost sweep.
  private staleCursor: admin.firestore.QueryDocumentSnapshot | null = null;

  /** An explicit provider lets non-production callers exercise the same read decisions. */
  constructor(private readonly dbProvider?: () => admin.firestore.Firestore | null) {}

  private getDb(): admin.firestore.Firestore | null {
    if (this.dbProvider) {
      try { return this.dbProvider(); } catch { return null; }
    }
    if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
    try {
      if (!this.db) {
        if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
        this.db = getServerDb();
      }
      return this.db;
    } catch {
      return null;
    }
  }

  /** Record (or update) the sandbox id for a workspace so the next build can resume it. Best-effort. */
  async record(workspaceId: string, userId: string | null, sandboxId: string): Promise<void> {
    const db = this.getDb();
    if (!db || !workspaceId || !sandboxId) return;
    try {
      await db.collection('agentv3_sandboxes').doc(workspaceId).set(
        { workspaceId, userId: userId ?? 'anon', sandboxId, updatedAt: Date.now() },
        { merge: true },
      );
    } catch { /* best-effort — never block a build */ }
  }

  /**
   * Persist a newly created or resumed allocation without allowing a stale creator to replace
   * a newer sandbox. expectedSandboxId is the identity observed before connect/create: null means
   * the record had no allocation; a string means a failed-resume replacement or same-id resume.
   */
  async recordAllocation(
    workspaceId: string,
    userId: string | null,
    sandboxId: string,
    expectedSandboxId: string | null,
  ): Promise<boolean> {
    const db = this.getDb();
    if (!db || !workspaceId || !sandboxId) return false;
    try {
      const ref = db.collection('agentv3_sandboxes').doc(workspaceId);
      return await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const rawCurrent = snap.exists ? snap.data()?.sandboxId : undefined;
        const current = typeof rawCurrent === 'string' && rawCurrent.trim() ? rawCurrent.trim() : null;
        if (current !== expectedSandboxId) return false;
        const patch: Record<string, unknown> = { workspaceId, sandboxId, updatedAt: Date.now() };
        // A caller without verified user identity must preserve existing ownership metadata; writing
        // the fallback string 'anon' here would erase a real owner on every resumed allocation.
        if (userId) patch.userId = userId;
        tx.set(ref, patch, { merge: true });
        return true;
      });
    } catch { return false; /* the caller must not use an allocation it could not persist */ }
  }

  /**
   * Best-effort local observation, NOT a provider start or billing event. The counter is independent
   * and can differ from accepted observations. Neither write is awaited by app work.
   *
   * Wait only for the EXISTING initial identity-touch attempt; do not establish/repair identity here.
   * Replace the whole nested map so a new start cannot inherit an old end. The reported-start high
   * water mark rejects delayed smaller timestamps and ties, but clock skew can suppress observations
   * or invert physical order. This is not allocation authority or a cross-instance lifecycle fence.
   */
  async recordSessionStart(workspaceId: string, session: SandboxSession, afterIdentityTouch?: Promise<void>): Promise<void> {
    const db = this.getDb();
    if (!db || !workspaceId || !session?.sandboxId) return;
    const start = { ...session }; // Capture before waiting: operation accounting mutates the local row.
    const counter = async () => {
      await db.collection('agentv3_sandbox_starts').doc(dayKey(start.startedAt)).set(
        { day: dayKey(start.startedAt), counts: { [start.reason]: FieldValue.increment(1) } },
        { merge: true },
      );
    };
    const observation = async () => {
      await afterIdentityTouch?.catch(() => {});
      if (!validSession(start) || !validObservationId(start.observationId)
        || start.endedAt !== undefined || start.endedBy !== undefined) return;
      const ref = db.collection('agentv3_sandboxes').doc(workspaceId);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const row = snap.data();
        if (!snap.exists || row?.workspaceId !== workspaceId || row?.sandboxId !== start.sandboxId) return;
        const previous: unknown = row.session;
        if (previous !== undefined) {
          if (!validSession(previous) || previous.observationId === start.observationId
            || previous.startedAt >= start.startedAt) return;
        }
        tx.update(ref, { session: start });
      });
    };
    // The matching end chains only to the session transaction: a rejected counter must not release
    // it early, and a stuck counter must not delay it. Counter failures remain independent.
    void counter().catch(() => {});
    await observation().catch(() => {});
  }

  /** Finish only this exact local observation; never infer a provider pause or replace another row. */
  async recordSessionEnd(workspaceId: string, session: SandboxSession): Promise<void> {
    const db = this.getDb();
    if (!db || !workspaceId || !validSession(session) || !validObservationId(session.observationId)
      || session.endedAt === undefined || session.endedBy === undefined) return;
    const end = { ...session };
    try {
      const ref = db.collection('agentv3_sandboxes').doc(workspaceId);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const row = snap.data();
        if (!snap.exists || row?.workspaceId !== workspaceId || row?.sandboxId !== end.sandboxId) return;
        const current: unknown = row.session;
        if (!validSession(current) || current.observationId !== end.observationId
          || current.sandboxId !== end.sandboxId || current.startedAt !== end.startedAt
          || current.origin !== end.origin || current.reason !== end.reason
          || current.endedAt !== undefined) return;
        tx.update(ref, { session: end });
      });
    } catch { /* best-effort: a missing/failed/ambiguous write remains unknown */ }
  }

  /** The last `days` UTC days of start counters, newest first. Bounded; never throws. */
  async listDailyStarts(days = 14): Promise<Array<{ day: string; counts: Record<string, number> }>> {
    const db = this.getDb();
    if (!db) return [];
    try {
      const snap = await db.collection('agentv3_sandbox_starts')
        .orderBy('day', 'desc')
        .limit(Math.max(1, Math.min(90, days)))
        .get();
      return snap.docs
        .map((d) => d.data() as { day?: string; counts?: Record<string, number> })
        .filter((r) => r && typeof r.day === 'string' && r.counts && typeof r.counts === 'object')
        .map((r) => ({ day: r.day as string, counts: r.counts as Record<string, number> }));
    } catch {
      return [];
    }
  }

  /** Fetch the last known sandbox id for a workspace, or null if none / unavailable. */
  async get(workspaceId: string): Promise<string | null> {
    const db = this.getDb();
    if (!db || !workspaceId) return null;
    try {
      const snap = await db.collection('agentv3_sandboxes').doc(workspaceId).get();
      if (!snap.exists) return null;
      const rec = snap.data() as SandboxRecord;
      return typeof rec?.sandboxId === 'string' && rec.sandboxId ? rec.sandboxId : null;
    } catch {
      return null;
    }
  }

  /**
   * Creation must distinguish a successful read with no recorded id from an unknown read. A missing
   * id is only absence from this record, not proof that no machine exists. Metadata-only records are
   * valid because snapshot/port/session writers merge independently of the id writer.
   */
  async lookupRecoveryIdentity(workspaceId: string): Promise<SandboxRecoveryIdentity> {
    const db = this.getDb();
    if (!db || !workspaceId) return { state: 'unavailable' };
    try {
      const snap = await db.collection('agentv3_sandboxes').doc(workspaceId).get();
      if (!snap.exists) return { state: 'missing' };
      const rec = snap.data();
      if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return { state: 'unavailable' };
      const id: unknown = rec.sandboxId;
      if (id === undefined || id === null) return { state: 'missing' };
      if (typeof id !== 'string') return { state: 'unavailable' };
      const sandboxId = id.trim();
      return sandboxId ? { state: 'found', sandboxId } : { state: 'missing' };
    } catch {
      return { state: 'unavailable' };
    }
  }

  /**
   * Remember where this workspace's last VM-free snapshot lives.
   *
   * Merged, never overwritten: a snapshot must survive every later build that does not produce a new
   * one — the whole point is that it is there on the day the machine is not.
   * A new capture with unknown source identity must clear the previous capture's hash, even at the
   * same URL. This invalidates derived metadata only; it does not remove the saved artifact.
   */
  async saveSnapshot(workspaceId: string, url: string, at: number, filesHash?: string | null): Promise<void> {
    const db = this.getDb();
    if (!db || !workspaceId || !url) return;
    try {
      await db.collection('agentv3_sandboxes').doc(workspaceId).set(
        { workspaceId, snapshotUrl: url, snapshotAt: at, snapshotFilesHash: filesHash || FieldValue.delete(), updatedAt: Date.now() },
        { merge: true },
      );
    } catch { /* best-effort — a fallback copy must never be able to fail a build */ }
  }

  /**
   * Every record that carries a saved-copy URL, projected to just that URL. A single-field range on
   * `snapshotUrl` (the automatic index), bounded — see deadSnapshotCopies.ts. Never throws.
   */
  async listSnapshotRecords(limit = 2000): Promise<Array<{ workspaceId: string; snapshotUrl: string }>> {
    const db = this.getDb();
    if (!db) return [];
    try {
      const snap = await db.collection('agentv3_sandboxes')
        .where('snapshotUrl', '>', '')
        .select('snapshotUrl')
        .limit(Math.max(1, Math.min(5000, limit)))
        .get();
      return snap.docs
        .map((d) => ({ workspaceId: d.id, snapshotUrl: String(d.get('snapshotUrl') ?? '') }))
        .filter((r) => r.snapshotUrl.length > 0);
    } catch {
      return [];
    }
  }

  /**
   * Forget a saved copy whose host no longer exists — ONLY while the record still names exactly that
   * URL. A green build between the read and this write has saved a NEW copy, and clearing that one
   * would take a working copy away. Transactional for that reason. Returns whether it cleared.
   */
  async clearSnapshot(workspaceId: string, expectedUrl: string): Promise<boolean> {
    const db = this.getDb();
    if (!db || !workspaceId || !expectedUrl) return false;
    try {
      const ref = db.collection('agentv3_sandboxes').doc(workspaceId);
      return await db.runTransaction(async (tx) => {
        const cur = await tx.get(ref);
        if (!cur.exists || cur.get('snapshotUrl') !== expectedUrl) return false;
        tx.update(ref, {
          snapshotUrl: admin.firestore.FieldValue.delete(),
          snapshotAt: admin.firestore.FieldValue.delete(),
          snapshotFilesHash: admin.firestore.FieldValue.delete(),
          updatedAt: Date.now(),
        });
        return true;
      });
    } catch {
      return false;
    }
  }

  /** Every record that still points at exactly this copy URL — what a channel reclaim must clear. */
  async findBySnapshotUrl(url: string): Promise<string[]> {
    const db = this.getDb();
    if (!db || !url) return [];
    try {
      const snap = await db.collection('agentv3_sandboxes').where('snapshotUrl', '==', url).limit(20).get();
      return snap.docs.map((d) => d.id);
    } catch {
      return [];
    }
  }

  /** Remember the port this app declares. Merged — it must outlive builds that produce no preview. */
  async saveDeclaredPort(workspaceId: string, port: number): Promise<void> {
    const db = this.getDb();
    if (!db || !workspaceId || !Number.isInteger(port) || port <= 0) return;
    try {
      await db.collection('agentv3_sandboxes').doc(workspaceId).set(
        { workspaceId, declaredPort: port, updatedAt: Date.now() },
        { merge: true },
      );
    } catch { /* a port hint must never be able to fail a build */ }
  }

  /**
   * The whole record for a workspace, or null.
   *
   * Exists for the CROSS-INSTANCE keep-alive. Cloud Run runs several instances; a keep-alive ping from
   * a user's popped-out preview tab can land on any of them, while the idle sweep that would pause
   * that sandbox runs on whichever instance happens to hold it. An in-memory stamp on the wrong
   * instance protects nothing, so the ping writes the DURABLE record and the sweep reads it here
   * before pausing anything. Best-effort — a read failure yields null and today's behaviour.
   */
  async getRecord(workspaceId: string): Promise<SandboxRecord | null> {
    const db = this.getDb();
    if (!db || !workspaceId) return null;
    try {
      const snap = await db.collection('agentv3_sandboxes').doc(workspaceId).get();
      if (!snap.exists) return null;
      return (snap.data() as SandboxRecord) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * The records of a SET of workspaces in ONE `getAll` (mirrors DeploymentStore.getMany). The admin's
   * built-apps page joins twelve rows against their saved copies (`snapshotUrl`) and must not spend
   * twelve round trips doing it. Missing docs are absent from the map. Never throws.
   */
  async getMany(workspaceIds: Array<string | null | undefined>): Promise<Map<string, SandboxRecord>> {
    const out = new Map<string, SandboxRecord>();
    const db = this.getDb();
    const ids = [...new Set(workspaceIds.filter((id): id is string => typeof id === 'string' && id.length > 0 && !id.includes('/')))].slice(0, 100);
    if (!db || ids.length === 0) return out;
    try {
      const snaps = await db.getAll(...ids.map((id) => db.collection('agentv3_sandboxes').doc(id)));
      for (const s of snaps) {
        if (s.exists) out.set(s.id, s.data() as SandboxRecord);
      }
    } catch { /* best-effort — a short map, never a thrown page */ }
    return out;
  }

  /**
   * Store the revival recipe proven by a successful boot, and CONFIRM it by reading it back.
   *
   * The read-back is the whole point. "We wrote it" and "it is there" are different facts, and a
   * guarantee that was never verified is not a guarantee — it is a hope that shows up as a broken
   * preview days later, when the user can do nothing about it. Verifying here, while the app is still
   * running, is what makes the promise answerable at the only moment it can still be fixed.
   *
   * Returns whether the recipe is genuinely retrievable. Never throws — a storage failure is reported
   * as `false` and surfaced honestly by the caller, never swallowed into a false promise.
   */
  async saveRecipe(workspaceId: string, recipe: PreviewRecipe): Promise<boolean> {
    const db = this.getDb();
    if (!db || !workspaceId || !isUsableRecipe(recipe)) return false;
    try {
      await db.collection('agentv3_sandboxes').doc(workspaceId).set(
        { workspaceId, recipe, updatedAt: Date.now() },
        { merge: true },
      );
      // CONFIRM — the round trip, not the write, is the guarantee.
      return isUsableRecipe(await this.getRecipe(workspaceId));
    } catch {
      return false;
    }
  }

  /**
   * Retire a recipe that describes a PREVIOUS app (admin 2026-08-25 — the piano-instead-of-UPI-API
   * preview). A recipe is only ever REWRITTEN by a browser-verified render, which an API that answers
   * JSON never earns — so after the workspace's app changed, the old recipe stood forever, the door's
   * sweep led with the old port, found the old dev server genuinely answering there, and confidently
   * served the previous app. Deleting it is honest: better no recipe (the door sweeps from the
   * declared port) than a proven recipe for an app that no longer exists. `declaredPort` is replaced,
   * not deleted — the caller passes the port the CURRENT app just verified. Best-effort, never throws.
   */
  async supersedeRecipe(workspaceId: string, newDeclaredPort: number): Promise<void> {
    const db = this.getDb();
    if (!db || !workspaceId) return;
    try {
      await db.collection('agentv3_sandboxes').doc(workspaceId).set(
        {
          workspaceId,
          recipe: admin.firestore.FieldValue.delete(),
          ...(Number.isInteger(newDeclaredPort) && newDeclaredPort > 0 && newDeclaredPort < 65536
            ? { declaredPort: newDeclaredPort } : {}),
          updatedAt: Date.now(),
        },
        { merge: true },
      );
    } catch { /* best-effort — a stale recipe is a degraded preview, never a failed build */ }
  }

  /** The stored revival recipe, or null when there is none / it is unusable. */
  async getRecipe(workspaceId: string): Promise<PreviewRecipe | null> {
    const db = this.getDb();
    if (!db || !workspaceId) return null;
    try {
      const snap = await db.collection('agentv3_sandboxes').doc(workspaceId).get();
      if (!snap.exists) return null;
      const rec = (snap.data() as SandboxRecord)?.recipe;
      return isUsableRecipe(rec) ? rec : null;
    } catch {
      return null;
    }
  }

  /**
   * Refresh `updatedAt` for a workspace whose sandbox is being used RIGHT NOW, without touching the
   * rest of the record. This is what makes the timestamp mean "last activity" rather than "last build
   * finished" — the orphan reaper reads it to tell a running build apart from an abandoned VM. The
   * caller throttles (shouldTouchDurable), so this is roughly one write per build per few minutes.
   */
  async touch(workspaceId: string, sandboxId: string): Promise<void> {
    // A touch is an activity refresh, NOT an allocation write. A stale process may still
    // hold an old sandboxId after another instance has replaced the workspace allocation.
    // A merge-set here would overwrite that newer identity (or recreate a record after clear()).
    // Only advance updatedAt when the durable record still names this exact sandbox.
    await this.touchIfCurrent(workspaceId, sandboxId);
  }

  /** A heartbeat may refresh an existing allocation, never resurrect or replace its identity. */
  async touchIfCurrent(workspaceId: string, sandboxId: string): Promise<boolean> {
    const db = this.getDb();
    if (!db || !workspaceId || !sandboxId) return false;
    try {
      const ref = db.collection('agentv3_sandboxes').doc(workspaceId);
      return await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists || snap.data()?.sandboxId !== sandboxId) return false;
        tx.update(ref, { updatedAt: Date.now() });
        return true;
      });
    } catch { return false; }
  }

  /**
   * The sandboxes whose last activity predates `cutoffMs` — candidates for the orphan reaper.
   *
   * Reads the DURABLE record rather than any one instance's memory, which is the entire point: a
   * sandbox created by a Cloud Run instance that has since been recycled is invisible to that
   * instance's idle sweep, but it is still right here. Bounded by `limit` so one sweep can never turn
   * into an unbounded read.
   */
  async listStale(cutoffMs: number, limit = 50): Promise<SandboxRecord[]> {
    const db = this.getDb();
    if (!db || !Number.isFinite(cutoffMs)) return [];
    try {
      const pageSize = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.floor(limit))) : 50;
      let query = db.collection('agentv3_sandboxes')
        .where('updatedAt', '<', cutoffMs)
        .orderBy('updatedAt', 'desc')
        .limit(pageSize);
      if (this.staleCursor) query = query.startAfter(this.staleCursor);
      const snap = await query.get();
      // Snapshot cursors preserve both timestamp and document-id ordering, including ties. Start
      // with recent stale records after a restart; wrap only at exhaustion. A failed read keeps
      // progress unchanged. This remains one bounded page per sweep, never a collection scan.
      this.staleCursor = snap.docs.length === pageSize ? snap.docs[snap.docs.length - 1]! : null;
      return snap.docs.map((d) => ({ record: d.data() as SandboxRecord, id: d.id }))
        .filter(({ record, id }) => record && record.sandboxId && record.workspaceId === id)
        .map(({ record }) => record);
    } catch {
      return []; // a missing index or a Firestore blip must never break the sweep
    }
  }

  /**
   * Note that the reaper paused this sandbox. The record is KEPT, not deleted — the sandbox still
   * exists and a returning user resumes it by id; only the compute is stopped. The stamp is what
   * keeps the next sweep from trying to pause it again every two minutes forever.
   */
  async markPaused(workspaceId: string, by?: PauseCause): Promise<void> {
    const db = this.getDb();
    if (!db || !workspaceId) return;
    try {
      // 🔴 AN UPDATE, NOT A MERGE-SET (the DeploymentStore.setStatus class, hunted 2026-09-18). This is
      // the one writer here whose payload carries NO identity — no workspaceId, no sandboxId — so a
      // merge-set on a record that `clear()` deleted between the sweep's read and this stamp minted a
      // doc holding only `{ pausedAt }`: a sandbox record for no sandbox. `update()` refuses a missing
      // doc, and a missing record has nothing to mark.
      await db.collection('agentv3_sandboxes').doc(workspaceId)
        .update({ pausedAt: Date.now(), ...(by ? { pausedBy: by } : {}) });
    } catch { /* best-effort — a missing record has nothing to mark */ }
  }

  /** A sweep may settle only the exact allocation and activity it observed before pausing. */
  async markPausedIfUnchanged(record: SandboxRecord, by: PauseCause): Promise<boolean> {
    const db = this.getDb();
    if (!db || !record?.workspaceId || !record.sandboxId || !Number.isFinite(record.updatedAt) || record.updatedAt <= 0) return false;
    try {
      const ref = db.collection('agentv3_sandboxes').doc(record.workspaceId);
      return await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return false;
        const current = snap.data();
        if (current?.sandboxId !== record.sandboxId || current.updatedAt !== record.updatedAt) return false;
        tx.update(ref, { pausedAt: Date.now(), pausedBy: by });
        return true;
      });
    } catch { return false; }
  }

  /**
   * The most recently active sandbox records, newest first — the durable half of the Phase 0 handover
   * measurement (sandboxHandover.ts), which needs to know when each sandbox was last used and when a
   * pause path stopped it.
   *
   * ADMIN-ONLY and read-only: it feeds one admin card and touches nothing. Ordered by `updatedAt`,
   * which `listStale` above already orders by, so it reuses that single-field index and can never
   * FAILED_PRECONDITION on a missing composite one. Bounded like every other read here. Never throws.
   */
  async listRecent(limit = 200): Promise<SandboxRecord[]> {
    const db = this.getDb();
    if (!db) return [];
    try {
      const snap = await db.collection('agentv3_sandboxes')
        .orderBy('updatedAt', 'desc')
        .limit(Math.max(1, Math.min(500, limit)))
        .get();
      return snap.docs.map((d) => d.data() as SandboxRecord).filter((r) => r && r.workspaceId);
    } catch {
      return [];
    }
  }

  /** Forget a workspace's sandbox (e.g. after a connect that failed because it was reaped). Best-effort. */
  async clear(workspaceId: string): Promise<void> {
    const db = this.getDb();
    if (!db || !workspaceId) return;
    try {
      await db.collection('agentv3_sandboxes').doc(workspaceId).delete();
    } catch { /* best-effort */ }
  }
}

export const sandboxStore = new SandboxStore();

/**
 * Feature flag — warm sandbox RESUME (A3). ON by default (admin 2026-07-03): with min-instances=0 the
 * in-process sandbox cache is wiped on every cold start, so the cross-instance resume (reconnect to the
 * user's OWN paused sandbox via SandboxStore + Sandbox.connect) is what actually keeps node_modules +
 * a warm dev server across turns → instant edits instead of a cold rebuild.
 *
 * SAFE to default on: the resume id is keyed by workspaceId (`agentv3-{uid}-{sessionId}`), so a user
 * can only ever reconnect to their OWN sandbox — never another user's. And E2BActuator wraps
 * Sandbox.connect in a try/catch that falls back to a fresh Sandbox.create if the target was
 * killed/expired, so the worst case is byte-identical to today (a fresh sandbox). Disable with
 * AGENTV3_SANDBOX_RESUME=off for an instant rollback.
 */
export function sandboxResumeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AGENTV3_SANDBOX_RESUME !== 'off';
}
