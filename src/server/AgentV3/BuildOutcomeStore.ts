// AgentV3 — the durable half of "did the build actually work?" (see buildOutcomeSignals.ts).
//
// WHY A STORE AT ALL, when this codebase's rule is to avoid new storage. The signals do not arrive
// together. The build ends in one request; the user watches the preview over the next few minutes
// (several keep-alive pings); their complaint arrives in a later chat request; a Diagnose press is
// another; a publish is another still — possibly on a different Cloud Run instance. There is nothing
// existing that spans those, and holding them in process memory would mean the signal is lost by
// whichever instance happens to serve the next request. One small merged document per workspace is
// the honest minimum.
//
// Collection: `agentv3_build_outcome`
// Doc ID:     `<workspaceId>` — the LATEST build only. Older builds are already settled history in
//             diagnostics; this record exists to answer a question about the app the user is looking
//             at right now, and keeping one row per build would grow without ever being read.
//
// SAFETY: keyed by workspaceId, which is derived SERVER-SIDE from the verified Firebase identity
// (deriveWorkspaceId), so a caller can never reach another user's record. Mirrors SandboxStore
// exactly — VITEST-skip, best-effort, never throws, never blocks a build.

import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';

const COLLECTION = 'agentv3_build_outcome';

export interface BuildOutcomeRecord {
  workspaceId: string;
  /** The build these signals belong to. A new build RESETS the record — see `startBuild`. */
  buildId: string;
  /** Whether that build claimed success. Only a claimed success can be a silent failure. */
  buildOk: boolean;
  /** Epoch ms of the first and last preview keep-alive ping after the build. */
  previewFirstSeenAt?: number;
  previewLastSeenAt?: number;
  /** The user's next message asserted the app does not work. */
  complained?: boolean;
  /** They pressed Diagnose or Restart. */
  askedForRepair?: boolean;
  /** They published, packaged or connected a domain. */
  invested?: boolean;
  /** Set once the report has been pushed, so the same unhappy session cannot send it three times. */
  reportedAt?: number;
  updatedAt: number;
}

class BuildOutcomeStore {
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
   * A build just finished — start a fresh record for it.
   *
   * Deliberately a full OVERWRITE, not a merge. A merge would carry the previous build's complaint,
   * Diagnose press and reported-flag into the new build, so one bad build would poison every build
   * after it — reporting apps that were since fixed, and refusing to report the next genuine failure
   * because `reportedAt` was already set.
   */
  async startBuild(workspaceId: string, buildId: string, buildOk: boolean): Promise<void> {
    const db = this.getDb();
    if (!db || !workspaceId || !buildId) return;
    try {
      const rec: BuildOutcomeRecord = { workspaceId, buildId, buildOk, updatedAt: Date.now() };
      await db.collection(COLLECTION).doc(workspaceId).set(rec, { merge: false });
    } catch { /* best-effort — a quality signal must never affect a build */ }
  }

  /** The current record, or null. Never throws. */
  async get(workspaceId: string): Promise<BuildOutcomeRecord | null> {
    const db = this.getDb();
    if (!db || !workspaceId) return null;
    try {
      const snap = await db.collection(COLLECTION).doc(workspaceId).get();
      if (!snap.exists) return null;
      return (snap.data() as BuildOutcomeRecord) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Merge a signal into the current record and return the record as it now stands.
   *
   * Returns null when there is no record — that means no build has finished for this workspace, so
   * there is nothing to judge. Creating one here would invent a build that never happened.
   */
  async note(workspaceId: string, patch: Partial<BuildOutcomeRecord>): Promise<BuildOutcomeRecord | null> {
    const db = this.getDb();
    if (!db || !workspaceId) return null;
    try {
      const ref = db.collection(COLLECTION).doc(workspaceId);
      const snap = await ref.get();
      if (!snap.exists) return null;
      const merged = { ...(snap.data() as BuildOutcomeRecord), ...patch, updatedAt: Date.now() };
      await ref.set(merged, { merge: true });
      return merged;
    } catch {
      return null;
    }
  }

  /**
   * Claim the right to send this build's report, atomically.
   *
   * A transaction rather than read-then-write on purpose: the signals arrive on separate requests that
   * can land on different instances at the same moment (a complaint and a Diagnose press are one tap
   * apart), and two instances each reading "not reported yet" is exactly how the admin gets the same
   * report twice. Returns true only for the caller that actually set the flag.
   */
  async claimReport(workspaceId: string, buildId: string, now: number): Promise<boolean> {
    const db = this.getDb();
    if (!db || !workspaceId || !buildId) return false;
    try {
      const ref = db.collection(COLLECTION).doc(workspaceId);
      return await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return false;
        const rec = snap.data() as BuildOutcomeRecord;
        // The record may have been reset by a NEWER build between the judgement and this claim. Sending
        // the old build's report then would attach the wrong evidence to the wrong app.
        if (rec.buildId !== buildId) return false;
        if (typeof rec.reportedAt === 'number' && rec.reportedAt > 0) return false;
        tx.set(ref, { reportedAt: now, updatedAt: now }, { merge: true });
        return true;
      });
    } catch {
      return false;
    }
  }
}

export const buildOutcomeStore = new BuildOutcomeStore();

/** Kill switch. Default ON. `off` stops all recording and all automatic reports. */
export function buildOutcomeTrackingEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AGENTV3_OUTCOME_TRACKING !== 'off';
}

/**
 * How long the preview was watched, from the first and last ping. Pure.
 *
 * Returns null when we never saw it, and 0 when we saw exactly one ping — those are different facts,
 * and collapsing them is how "never measured" would start reading as "watched for no time at all".
 */
export function watchedMsFrom(rec: Pick<BuildOutcomeRecord, 'previewFirstSeenAt' | 'previewLastSeenAt'> | null | undefined): number | null {
  const first = Number(rec?.previewFirstSeenAt);
  const last = Number(rec?.previewLastSeenAt);
  if (!Number.isFinite(first) || first <= 0) return null;
  if (!Number.isFinite(last) || last < first) return 0;
  return last - first;
}
