// ERASING A USER'S BUILD SNAPSHOTS — the part of account deletion that lives OUTSIDE Firestore (Q-795).
//
// Every green build saves a static copy of the app — a "snapshot" — so the preview opens instantly next
// time. It lives in ONE of two places, both keyed by the workspace id alone: the published-apps bucket under
// `s-<hash>` (`snapshotSubdomain`) or a Firebase Hosting channel `sn-…` (`snapshotChannelId`). Account
// deletion erased every Firestore store of the user's workspaces and left these copies of their apps on our
// hosting for ever (PROGRESS L65640: "a workspace that is deleted leaves its copy behind … the snapshot path
// has no owner-deletion hook"). The admin's decision of 2026-10-11 on Q-119: "zaroor theek ho" (DPDP).
//
// ⚠️ IT MUST RUN BEFORE THE FIRESTORE ERASE. The snapshot keys are derived from the workspace ids, and the
// only place those ids are listed is the stores `deleteUserWorkspaceData` is about to delete. Run it after,
// and it finds no ids, deletes nothing and reports success — the "an erase that LOOKS complete and is not"
// failure every eraser in this repo is written against.
//
// Published apps (`a-…` bucket objects, `v3-…` channels) are NOT touched here: a published app can have
// been bought on App Mart, and what happens to it when its author leaves is a separate decision.

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';
import { planWorkspaceErase, eraseableWorkspaceId } from './workspaceDataErase';
import { snapshotSubdomain } from '../AgentV3/bucketOnlyPublish';
import { snapshotChannelId } from '../AgentV3/previewSnapshot';

/**
 * Stores whose DOCUMENT ID is a workspace id and which every workspace that could own a snapshot appears in.
 * A snapshot is made by a build, so the build's files (`workspace_files_v3`) and its sandbox record
 * (`agentv3_sandboxes`, which carries the snapshot URL) between them name every such workspace. Read, never
 * deleted, here.
 */
export const SNAPSHOT_WORKSPACE_SOURCES = ['agentv3_sandboxes', 'workspace_files_v3'] as const;

export interface SnapshotTarget {
  workspaceId: string;
  /** The bucket key a bucket snapshot is stored under. */
  bucketSub: string;
  /** The Firebase Hosting channel a channel snapshot is served from. */
  channelId: string;
}

/** The two snapshot locations of each workspace, de-duplicated. PURE. */
export function snapshotTargets(workspaceIds: Iterable<string>): SnapshotTarget[] {
  const seen = new Set<string>();
  const out: SnapshotTarget[] = [];
  for (const id of workspaceIds) {
    const ws = String(id ?? '').trim();
    if (!ws || seen.has(ws)) continue;
    seen.add(ws);
    out.push({ workspaceId: ws, bucketSub: snapshotSubdomain(ws), channelId: snapshotChannelId(ws) });
  }
  return out;
}

export interface SnapshotEraseDeps {
  /** Every workspace id of `uid` (already filtered by ownership). */
  listWorkspaceIds: (uid: string) => Promise<string[]>;
  removeBucket: (sub: string) => Promise<{ attempted: boolean; deleted: boolean; error?: string }>;
  /** True when the channel is gone (deleted or never existed). */
  deleteChannel: (channelId: string) => Promise<boolean>;
}

export interface SnapshotEraseReport {
  uid: string;
  workspaces: number;
  bucketRemoved: number;
  channelsRemoved: number;
  /** One line per location that could NOT be confirmed removed — never silently counted as done. */
  failures: string[];
  refusal?: string;
}

/**
 * Remove every snapshot of every workspace of `uid`. Best-effort per location: one failure is recorded and
 * the rest still run, and nothing here can throw into the account deletion the user asked for.
 */
export async function eraseUserSnapshots(uid: string, deps: SnapshotEraseDeps): Promise<SnapshotEraseReport> {
  const report: SnapshotEraseReport = { uid, workspaces: 0, bucketRemoved: 0, channelsRemoved: 0, failures: [] };
  const plan = planWorkspaceErase(uid);
  if (!plan.range) return { ...report, refusal: plan.refusal };
  let ids: string[] = [];
  try {
    ids = (await deps.listWorkspaceIds(uid)).filter((id) => eraseableWorkspaceId(uid, id));
  } catch (e) {
    report.failures.push(`could not list workspaces: ${e instanceof Error ? e.message : String(e)}`);
    return report;
  }
  const targets = snapshotTargets(ids);
  report.workspaces = targets.length;
  for (const t of targets) {
    try {
      const r = await deps.removeBucket(t.bucketSub);
      if (r.deleted) report.bucketRemoved++;
      else if (r.attempted) report.failures.push(`bucket ${t.bucketSub}: ${r.error ?? 'not removed'}`);
    } catch (e) {
      report.failures.push(`bucket ${t.bucketSub}: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      if (await deps.deleteChannel(t.channelId)) report.channelsRemoved++;
      else report.failures.push(`channel ${t.channelId}: not removed`);
    } catch (e) {
      report.failures.push(`channel ${t.channelId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return report;
}

/** The live dependencies: Firestore for the ids, the bucket and Firebase Hosting for the removal. */
export function liveSnapshotEraseDeps(): SnapshotEraseDeps {
  return {
    listWorkspaceIds: async (uid) => {
      if (process.env.VITEST) return [];
      const plan = planWorkspaceErase(uid);
      if (!plan.range) return [];
      if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
      const store = getServerDb();
      if (!store) throw new Error('data store unavailable');
      const byId = admin.firestore.FieldPath.documentId();
      const ids = new Set<string>();
      for (const collection of SNAPSHOT_WORKSPACE_SOURCES) {
        // Ids only: `select()` with no fields reads no document bodies.
        const snap = await store.collection(collection)
          .orderBy(byId).startAt(plan.range.startAt).endAt(plan.range.endAt)
          .select().limit(2000).get();
        for (const doc of snap.docs) ids.add(doc.id);
      }
      return [...ids];
    },
    removeBucket: async (sub) => (await import('../AgentV3/bucketPublish')).removePublishFromBucket(sub),
    deleteChannel: async (channelId) => {
      const { FirebaseHostingDeployer } = await import('../AgentV3/Deployment');
      return new FirebaseHostingDeployer().deleteChannelById(channelId);
    },
  };
}
