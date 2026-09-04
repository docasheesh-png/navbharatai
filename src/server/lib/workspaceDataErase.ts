// ERASING A USER'S BUILT APPS — the half of right-to-be-forgotten that was left open.
//
// `DataRetentionManager.deleteUserData` erases the platform's own user records across seven verified
// collections. It says so in its header: "both operating on the platform's OWN user data (not
// generated apps)". `PROGRESS.md` has carried the consequence as an OPEN root cause twice:
//
//     "built-app files stored outside those seven collections are not covered by the automated erase"
//
// So a user could delete their account and leave every app they ever built sitting in our Firestore.
// This module closes that, under the same discipline the retention manager set for itself: **nothing
// is added on a guess.** Every collection below was read at its own store before being listed here —
// its document id, and whether it hides a subcollection.
//
// ⚠️ FIRESTORE DOES NOT CASCADE. Deleting a document leaves its subcollections behind, fully intact
// and now unreachable. Four of these stores keep the actual bytes one level down (`files`, `assets`,
// `items`), so a naive parent-only delete would report success while leaving the user's source code,
// images and checkpoints in the database — an erase that LOOKS complete and is not. That is worse
// than not shipping one, because the promise on the deletion page would become false.

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';
import { workspacePrefixFor, ownedByVerifiedUid } from './workspaceIdentity';

/** A collection whose DOCUMENT ID is a workspace id, plus the subcollection holding its payload. */
export interface WorkspaceScopedCollection {
  collection: string;
  /** The subcollection under each workspace doc, when the real content lives one level down. */
  sub?: string;
}

/**
 * VERIFIED registry — every entry read at its own store, never inferred from its name.
 *
 *   workspace_files_v3        .doc(workspaceId).collection('files')   ← the app's source code
 *   workspace_assets_v3       .doc(workspaceId).collection('assets')  ← its images and fonts
 *   workspace_checkpoints_v3  .doc(workspaceId).collection('items')
 *   workspace_embeddings_v3   .doc(workspaceId).collection('files')
 *   workspace_memory_v3       .doc(workspaceId)
 *   workspace_diagnostics_v3  .doc(workspaceId)
 *   workspace_manual_edits_v3 .doc(workspaceId)
 *   project_plans_v3          .doc(workspaceId)
 *
 * A GreenGuard snapshot lives in `workspace_files_v3` under a suffixed key that shares the user's
 * prefix, so the range below sweeps it up too — which is right: it is a copy of their app.
 */
export const WORKSPACE_SCOPED_COLLECTIONS: readonly WorkspaceScopedCollection[] = [
  { collection: 'workspace_files_v3', sub: 'files' },
  { collection: 'workspace_assets_v3', sub: 'assets' },
  { collection: 'workspace_checkpoints_v3', sub: 'items' },
  { collection: 'workspace_embeddings_v3', sub: 'files' },
  { collection: 'workspace_memory_v3' },
  { collection: 'workspace_diagnostics_v3' },
  { collection: 'workspace_manual_edits_v3' },
  { collection: 'project_plans_v3' },
];

export type EraseRefusal = 'unusable-uid' | 'ambiguous-uid';

export interface ErasePlan {
  /** The documentId range that contains exactly this user's workspaces, or null when refused. */
  range: { startAt: string; endAt: string } | null;
  refusal?: EraseRefusal;
}

/** U+F8FF is a very high code point, so [prefix, prefix+U+F8FF] is exactly the prefix range. */
const RANGE_END_CHAR = String.fromCharCode(0xf8ff);

/**
 * The id range to erase for `uid` — or a REFUSAL, which is a real answer and not a failure.
 *
 * 🔴 THE AMBIGUITY THIS REFUSES, because getting it wrong deletes a different person's work.
 * A workspace id is `agentv3-{uid}-{sessionId}` and `workspacePrefixFor` ends the prefix with `-`,
 * which stops `agentv3-abc-` matching `agentv3-abcd-…`. It does NOT stop it matching
 * `agentv3-abc-d-…` — the workspaces of a DIFFERENT user whose uid is `abc-d`. `WORKSPACE_UID_RE`
 * permits `-`, so that user is constructible.
 *
 * Firebase Auth uids are 28 characters of [A-Za-z0-9] and contain no hyphen, so this cannot arise
 * with a real account. That is a reason to be confident, NOT a reason to skip the check: the whole
 * point of this module is that a wrong key is catastrophic and unrecoverable. So a hyphenated uid is
 * REFUSED and reported honestly — the caller says the apps could not be erased automatically, which a
 * human can then finish. Deleting a stranger's apps to satisfy a compliance box would be far worse
 * than admitting one case needs a person.
 *
 * PURE.
 */
export function planWorkspaceErase(uid: string | null | undefined): ErasePlan {
  const prefix = workspacePrefixFor(uid);
  if (!prefix) return { range: null, refusal: 'unusable-uid' };
  if (String(uid).includes('-')) return { range: null, refusal: 'ambiguous-uid' };
  return { range: { startAt: prefix, endAt: `${prefix}${RANGE_END_CHAR}` } };
}

/**
 * Is this workspace id genuinely this user's? Belt and braces over the range query.
 *
 * The range is already exact for a hyphen-free uid, so this can only ever agree — which is the point.
 * A range is a query the database evaluates; this is the platform's OWN strictest ownership policy
 * (`ownedByVerifiedUid`) applied to every id before anything is deleted. If the two ever disagreed,
 * the disagreement is the bug, and this is the side that must win. PURE.
 */
export function eraseableWorkspaceId(uid: string, workspaceId: string): boolean {
  return ownedByVerifiedUid(uid, workspaceId);
}

export interface WorkspaceEraseResult {
  collection: string;
  /** Workspace documents removed. */
  workspaces: number;
  /** Documents removed from the subcollection beneath them (the actual file/asset bytes). */
  documents: number;
  error?: string;
}
export interface WorkspaceEraseReport {
  uid: string;
  collections: WorkspaceEraseResult[];
  totalDeleted: number;
  /** Present when nothing was attempted, with the honest reason — see planWorkspaceErase. */
  refusal?: EraseRefusal;
}

/** How many workspace docs are swept per collection per pass, and how many subdocs per page. */
const WORKSPACE_PAGE = 200;
const SUBDOC_PAGE = 300;
/** Hard stop so a pathological collection can never spin forever inside a request. */
const MAX_PAGES = 500;

function db(): admin.firestore.Firestore | null {
  if (process.env.VITEST) return null; // unit tests never touch real Firestore
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    return getServerDb();
  } catch {
    return null;
  }
}

/**
 * Erase every built app belonging to `uid`.
 *
 * Best-effort PER COLLECTION, matching `deleteUserData`: one failing collection is recorded and the
 * rest still run, so a flaky index cannot leave the remainder of someone's data behind.
 *
 * ⚠️ SUBCOLLECTION FIRST, THEN THE PARENT. Reversed, a failure between the two would orphan the
 * payload with its parent already gone — unreachable, undeletable by this code on a retry, and still
 * on our disk. This order means a partial failure leaves a still-findable parent, so running it again
 * finishes the job.
 */
export async function deleteUserWorkspaceData(uid: string): Promise<WorkspaceEraseReport> {
  const plan = planWorkspaceErase(uid);
  if (!plan.range) return { uid, collections: [], totalDeleted: 0, refusal: plan.refusal };
  const store = db();
  if (!store) return { uid, collections: [], totalDeleted: 0 };

  const byId = admin.firestore.FieldPath.documentId();
  const collections: WorkspaceEraseResult[] = [];

  for (const entry of WORKSPACE_SCOPED_COLLECTIONS) {
    let workspaces = 0;
    let documents = 0;
    try {
      for (let page = 0; page < MAX_PAGES; page++) {
        const snap = await store.collection(entry.collection)
          .orderBy(byId).startAt(plan.range.startAt).endAt(plan.range.endAt)
          .limit(WORKSPACE_PAGE)
          .get();
        if (snap.empty) break;
        let progressed = false;
        for (const doc of snap.docs) {
          // The range should already guarantee this; the platform's own ownership policy is asked
          // anyway, because "should" is not a safety property when the action is irreversible.
          if (!eraseableWorkspaceId(uid, doc.id)) continue;
          if (entry.sub) documents += await deleteSubcollection(doc.ref, entry.sub);
          await doc.ref.delete();
          workspaces++;
          progressed = true;
        }
        // Nothing in this page was ours to delete, so another identical query returns the same page:
        // stop instead of looping on it.
        if (!progressed) break;
      }
      collections.push({ collection: entry.collection, workspaces, documents });
    } catch (e) {
      collections.push({ collection: entry.collection, workspaces, documents, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return {
    uid,
    collections,
    totalDeleted: collections.reduce((s, c) => s + c.workspaces + c.documents, 0),
  };
}

/** Delete every document in one workspace's subcollection, in pages. Returns how many went. */
async function deleteSubcollection(
  parent: admin.firestore.DocumentReference,
  name: string,
): Promise<number> {
  let removed = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const snap = await parent.collection(name).limit(SUBDOC_PAGE).get();
    if (snap.empty) break;
    const batch = parent.firestore.batch();
    for (const d of snap.docs) batch.delete(d.ref);
    await batch.commit();
    removed += snap.size;
    if (snap.size < SUBDOC_PAGE) break;
  }
  return removed;
}
