// "MAINE JO APK BANAYI THI, WOH KAHAN GAYI?" — a durable record of the apps a user has built.
//
// ADMIN REPORT 2026-08-17: "user ne apk banayi, ban gayi. usne download nahi ki, galti se back ho gaya.
// ab wapas woh dikh hi nahi rahi hai."
//
// THE FILE WAS NEVER LOST. It sits in the user's OWN GitHub repository, and GitHub keeps a build
// artifact for 14 days — a fact our own screen prints. What was lost is the WAY BACK TO IT: reading a
// build needs `owner` and `repo`, and those existed only in the component's state. One back gesture and
// the app could no longer name the repository it had just built into, so a finished app became
// unreachable while sitting perfectly intact a tap away.
//
// Nothing anywhere recorded that a build had happened — there was no collection to look in. That is the
// gap this closes: one small row per build, so "what have I built?" has an answer that survives a back
// button, a reload, a new phone, and a reinstall.
//
// ── WHAT THIS DELIBERATELY DOES NOT STORE ───────────────────────────────────────────────────────────
// No app bytes, and no GitHub token. The row is a POINTER — owner, repo, workflow, run — and every read
// still goes to GitHub with the user's own live token. Storing the artifact would duplicate something
// GitHub already holds and give us a copy of the user's app to look after; storing the token would turn
// a convenience index into a credential store. The pointer is the whole value: it is the one thing that
// was missing, and the one thing that costs nothing to keep.
//
// Mirrors ApiKeyStore: VITEST-skipped so tests never touch Firestore, best-effort throughout (never
// throws, never blocks a build), and every read is scoped to the owning user.
//
// ── ONE ROW PER APP, NOT PER BUILD RUN ──────────────────────────────────────────────────────────────
// The admin asked to see "sabhi apk jo user ne banayi hai" — their APPS, not their build history. A user
// who rebuilds the calculator four times wants the calculator once, pointing at the newest file; a list
// with four calculators is the same screen failing differently. So the row is keyed to (user, repo) and
// `runId` is a field that moves forward. It also removes a trap: a row written at trigger time has no
// run id yet, and keying on the id would make that row and its later self two separate entries.
//
// Collection: `app_builds`  ·  Doc ID: `${userId}_${owner}_${repo}`

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';

export interface AppBuildRecord {
  /** Stable id — deterministic, so re-recording the same run overwrites rather than duplicates. */
  id: string;
  userId: string;
  owner: string;
  repo: string;
  /** The build workflow file, e.g. `android-apk.yml` — needed to read the run back. */
  workflow: string;
  /** The newest run we know of for this app. Absent until a build has actually started. */
  runId?: string | null;
  /** What the user calls this app, for a list they can recognise. */
  appName: string;
  createdAt: number;
  /**
   * HOW THE LAST BUILD ENDED (2026-08-27, the APK-pipeline hardening). Until this field existed the
   * store knew a build was STARTED but never how it finished — so "most builds fail" was a feeling,
   * not a number, and every hardening round aimed by intuition. Recorded when a completed run is seen
   * (Phase C poll) and when the auto-fix classifies a failure. Absent = no completed run observed yet.
   */
  outcome?: 'success' | 'failure' | 'cancelled' | null;
  /** The classifier's RepairCode for the last failure — which named class actually fired. */
  failureCode?: string | null;
  /** When the outcome above was observed (server clock). */
  finishedAt?: number | null;
}

/** How many builds a listing returns. A user with hundreds does not need them all on one screen. */
export const MAX_BUILDS_LISTED = 50;

/**
 * The doc id for one APP.
 *
 * Deterministic and run-independent: every record of the same repository — the trigger, each poll, a
 * rebuild months later — lands on ONE document, which then carries the newest run. A list that shows
 * the same app four times is a list the user stops trusting.
 *
 * The sanitising is load-bearing rather than tidy: these values become a Firestore document id, and a
 * slash in a repo name would silently create a nested path. PURE.
 */
export function buildRecordId(userId: string, owner: string, repo: string): string {
  const safe = (s: string) => String(s ?? '').replace(/[^A-Za-z0-9._-]/g, '_');
  return [safe(userId), safe(owner), safe(repo)].join('_');
}

class AppBuildStore {
  private db: admin.firestore.Firestore | null = null;

  private getDb(): admin.firestore.Firestore | null {
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

  /**
   * Remember that this user built this app. Best-effort: a failure here must never break the build the
   * user is actually waiting on — the worst case is the old behaviour, one unreachable build.
   */
  async record(rec: Omit<AppBuildRecord, 'id'>): Promise<boolean> {
    const db = this.getDb();
    if (!db || !rec.userId || !rec.owner || !rec.repo) return false;
    try {
      const id = buildRecordId(rec.userId, rec.owner, rec.repo);
      await db.collection('app_builds').doc(id).set({ ...rec, id }, { merge: true });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Point an app's row at the run that produced a real file, WITHOUT touching anything else.
   *
   * Deliberately separate from `record`: that one writes the whole row, and a caller that only knows
   * the run id would have to invent values for the rest. With `merge: true` those invented values are
   * not ignored — they OVERWRITE. Reusing `record` here would have blanked the workflow (breaking the
   * list's ability to read the build back) and replaced a name the user chose with the repo name. A
   * partial update is the honest shape for partial knowledge.
   */
  async setLatestRun(userId: string, owner: string, repo: string, runId: string): Promise<boolean> {
    const db = this.getDb();
    if (!db || !userId || !owner || !repo || !runId) return false;
    try {
      const id = buildRecordId(userId, owner, repo);
      await db.collection('app_builds').doc(id).set({ runId: String(runId) }, { merge: true });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Record how a build ENDED — the other half of the honesty this store exists for. Partial update for
   * the same reason setLatestRun is: this caller knows the outcome and nothing else. `failureCode`
   * is only meaningful for a failure; a success explicitly CLEARS the previous failure's code so a
   * fixed app never keeps wearing its old diagnosis.
   */
  async setOutcome(
    userId: string, owner: string, repo: string,
    outcome: 'success' | 'failure' | 'cancelled',
    failureCode?: string,
  ): Promise<boolean> {
    const db = this.getDb();
    if (!db || !userId || !owner || !repo) return false;
    try {
      const id = buildRecordId(userId, owner, repo);
      await db.collection('app_builds').doc(id).set({
        outcome,
        failureCode: outcome === 'failure' ? (failureCode ?? null) : null,
        finishedAt: Date.now(),
      }, { merge: true });
      return true;
    } catch {
      return false;
    }
  }

  /** This user's builds, newest first. Scoped to the owner — never another account's apps. */
  async listForUser(userId: string): Promise<AppBuildRecord[]> {
    const db = this.getDb();
    if (!db || !userId) return [];
    try {
      const snap = await db.collection('app_builds').where('userId', '==', userId).get();
      const out: AppBuildRecord[] = [];
      snap.forEach((doc) => out.push(doc.data() as AppBuildRecord));
      return out.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).slice(0, MAX_BUILDS_LISTED);
    } catch {
      return [];
    }
  }

  /** Forget one build, but only if it belongs to `userId`. Returns true when a row was removed. */
  async forget(userId: string, id: string): Promise<boolean> {
    const db = this.getDb();
    if (!db || !userId || !id) return false;
    try {
      const ref = db.collection('app_builds').doc(id);
      const doc = await ref.get();
      // The doc id is guessable by construction, so ownership is checked from the STORED row rather
      // than from the id's shape — the same IDOR guard the secrets route needs for the same reason.
      if (!doc.exists || (doc.data() as AppBuildRecord)?.userId !== userId) return false;
      await ref.delete();
      return true;
    } catch {
      return false;
    }
  }
}

export const appBuildStore = new AppBuildStore();
