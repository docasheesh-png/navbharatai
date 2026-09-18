// EVERY BUILT APP, TWELVE AT A TIME, EACH WITH A PREVIEW — the decisions behind the admin's
// Security → Built apps panel (admin 2026-09-18, verbatim):
//
//   1. "admin panel ki security me jitni bhi apps dikh rahi hai, chahe woh live hai ya offline —
//       sabhi ka preview chalna chahiye."
//   2. "is security wale option me sabhi users ki build app dikhni chahiye."
//   3. "ek dam se sara data load na ho, 12-12 ke set me load karwo."
//
// WHAT THE OLD PANEL READ, AND WHY IT COULD NOT ANSWER ANY OF THE THREE. It listed
// `agentv3_deployments` — a record exists there only once an app has been PUBLISHED — two hundred rows
// in one request, and the only "preview" was a link to the live URL, which an offline app does not
// have. So a user's app that was built and never published was invisible, an unpublished app had no
// way to be looked at, and the whole registry arrived at once.
//
// THE SOURCE OF TRUTH FOR "BUILT" IS THE DURABLE FILE STORE, NOT THE PUBLISH REGISTRY. Every Pro v5
// build persists its files under `workspace_files_v3/<workspaceId>` (WorkspaceFileStore), whether or
// not it is ever published — that is exactly the set the admin asked for. The publish registry and the
// sandbox record are ENRICHMENT joined per page (one batched read each), which is what keeps a page of
// twelve at three round trips instead of thirty-six.
//
// PREVIEW WITHOUT A MACHINE. An admin looking at somebody's app must never wake that user's sandbox —
// a resume costs real E2B minutes and the owner did not ask for it. So the preview has two sources and
// both are free: the SAVED COPY of the last green build when the sandbox record carries one
// (`snapshotUrl`, a real `dist/` on its own subdomain), else the IN-BROWSER RENDER of the durable files
// (the same `renderPreview` the user's own preview pane uses). Which one is shown is decided in
// `previewPlan` (src/lib/adminAppModeration.ts) so the screen can state it honestly.
//
// Everything here is PURE — no Firestore, no Express — so the page arithmetic, the query reading and
// the join can be tested without a database.
import type { DeploymentRecord } from './DeploymentStore';
import { isLiveDeployment } from './DeploymentStore';
import { isWorkspaceId, workspaceOwnerUid, WORKSPACE_UID_RE } from '../lib/workspaceIdentity';

/** "12-12 ke set me" — the admin's number, and the only page size the panel asks for. */
export const BUILT_APPS_PAGE_SIZE = 12;
/** A hard ceiling so a hand-edited query string cannot turn one page into the whole registry again. */
export const BUILT_APPS_MAX_PAGE = 48;

/** Clamp a requested page size to [1, BUILT_APPS_MAX_PAGE]; anything unreadable is the default. */
export function clampPageSize(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return BUILT_APPS_PAGE_SIZE;
  return Math.min(BUILT_APPS_MAX_PAGE, Math.floor(n));
}

/**
 * What the admin typed, read into a query the server can actually answer.
 *
 * A moderator works from a report, and a report names an app by whichever identifier the reporter had:
 * the workspace id, the owner's uid, or the public link. Each of those is a DIRECT lookup (one doc, one
 * prefix range, one equality) and must never degrade into "scroll and hope". A fragment of any of them
 * is NOT answerable server-side without a full scan — which is exactly the load-everything the admin
 * asked to stop — so it is returned as `text` and the screen filters the rows it already holds, saying
 * so.
 */
export type AppsQuery =
  | { mode: 'all' }
  | { mode: 'exact'; workspaceId: string }
  | { mode: 'owner'; uid: string }
  | { mode: 'url'; url: string }
  | { mode: 'text'; text: string };

export function parseAppsQuery(raw: unknown): AppsQuery {
  const q = typeof raw === 'string' ? raw.trim() : '';
  if (!q) return { mode: 'all' };
  if (isWorkspaceId(q) && !/\s/.test(q)) return { mode: 'exact', workspaceId: q };
  if (/^https?:\/\/\S+$/i.test(q)) return { mode: 'url', url: q.replace(/\/+$/, '') };
  // A Firebase uid is 28 URL-safe characters; a short word is a fragment, never an owner. The floor
  // is deliberately high so that typing "todo" never becomes a range query over a uid nobody has.
  if (q.length >= 20 && WORKSPACE_UID_RE.test(q)) return { mode: 'owner', uid: q };
  return { mode: 'text', text: q };
}

/**
 * The publish state of a BUILT app, judged from its registry record — including the two states the
 * old panel could not name: an app that was never published at all, and a status-only record that
 * was never a publish.
 *
 * 🔒 'live' requires a URL, not merely `status: 'active'`. `isLiveDeployment` is the ONE definition of
 * live in this repo (the history-menu dot keys off it), and a record with a status and no URL is the
 * ghost this change also stops being written — it must read as "not published", never as "Live".
 */
export type PublishState = 'live' | 'offline' | 'banned' | 'held' | 'paused' | 'never' | 'unknown';

export function publishStateOf(rec: Pick<DeploymentRecord, 'url' | 'status'> | null | undefined): PublishState {
  if (!rec) return 'never';
  if (isLiveDeployment(rec)) return 'live';
  const hasUrl = typeof rec.url === 'string' && rec.url.length > 0;
  switch (rec.status ?? 'active') {
    case 'active': return hasUrl ? 'live' : 'never'; // status without a URL is not a publish
    case 'unpublished': return 'offline';
    case 'taken_down': return 'banned';
    case 'held': return 'held';
    case 'plan_paused': return 'paused';
    default: return 'unknown';
  }
}

/** The durable metadata the file store holds per workspace (no file content). */
export interface BuiltAppMeta {
  workspaceId: string;
  fileCount: number;
  savedAt: number;
}

/** The slice of a sandbox record the panel needs — the saved copy, if there is one. */
export interface BuiltAppCopy {
  snapshotUrl?: string;
  snapshotAt?: number;
}

/** One row of the admin's list — everything the screen shows, and nothing it does not. */
export interface BuiltAppRow {
  workspaceId: string;
  /** The uid the workspace id claims as owner (null for an anon workspace). */
  ownerUid: string | null;
  /** From the registry record when there is one, else the id's own claim. */
  userId: string | null;
  fileCount: number;
  /** Last durable save (ms); 0 when unknown. */
  savedAt: number;
  publish: PublishState;
  /** Registry status as stored — the moderation buttons key off this, not off `publish`. */
  status: string | null;
  /** The public URL when the registry has one (live or not — an offline app keeps its old link). */
  url: string | null;
  /** Registry `updatedAt`, so the row can show when it was last published/unpublished. */
  publishedAt: number;
  /** The saved copy of the last green build, when the sandbox record carries one. */
  snapshotUrl: string | null;
  snapshotAt: number;
  /** The owner deleted the workspace while the app was live (registry flag). */
  orphaned: boolean;
}

/**
 * Join one workspace's three facts into one row. Any of the three may be missing: a built app with no
 * registry record was never published; a registry record with no metadata is an orphan whose files
 * were purged; a sandbox record without a copy has nothing to add.
 */
export function builtAppRow(
  meta: BuiltAppMeta | null,
  rec: DeploymentRecord | null | undefined,
  copy: BuiltAppCopy | null | undefined,
  workspaceId?: string,
): BuiltAppRow {
  const id = meta?.workspaceId || rec?.workspaceId || workspaceId || '';
  // `workspaceOwnerUid` READS the id's claim, and an anon workspace claims 'anon' — which is nobody.
  const rawClaim = workspaceOwnerUid(id);
  const claim = rawClaim && rawClaim !== 'anon' ? rawClaim : null;
  const snapshotUrl = typeof copy?.snapshotUrl === 'string' && /^https?:\/\//i.test(copy.snapshotUrl) ? copy.snapshotUrl : null;
  return {
    workspaceId: id,
    ownerUid: claim,
    userId: typeof rec?.userId === 'string' && rec.userId && rec.userId !== 'anon' ? rec.userId : claim,
    fileCount: Number.isFinite(meta?.fileCount) ? Number(meta!.fileCount) : 0,
    savedAt: Number.isFinite(meta?.savedAt) ? Number(meta!.savedAt) : 0,
    publish: publishStateOf(rec),
    status: rec ? String(rec.status ?? 'active') : null,
    url: typeof rec?.url === 'string' && rec.url ? rec.url : null,
    publishedAt: Number.isFinite(rec?.updatedAt) ? Number(rec!.updatedAt) : 0,
    snapshotUrl,
    snapshotAt: snapshotUrl && Number.isFinite(copy?.snapshotAt) ? Number(copy!.snapshotAt) : 0,
    orphaned: rec?.orphaned === true,
  };
}

/**
 * Join a PAGE. `metas` is the page (already in display order); the two maps are the batched reads for
 * exactly those ids. Rows keep the page's order — the store sorted them, the join must not.
 */
export function joinBuiltAppRows(
  metas: BuiltAppMeta[],
  deployments: Map<string, DeploymentRecord>,
  copies: Map<string, BuiltAppCopy>,
): BuiltAppRow[] {
  return metas.map((m) => builtAppRow(m, deployments.get(m.workspaceId), copies.get(m.workspaceId)));
}

/**
 * The cursor is the LAST DOCUMENT ID of the page, wrapped so the client treats it as opaque. Firestore
 * resumes from a document snapshot (`startAfter(snap)`), which is the one cursor form that is correct
 * under any ordering without a composite index — a value cursor on `savedAt` alone would skip ties.
 */
export function encodeCursor(docId: string | null | undefined): string | null {
  return docId ? Buffer.from(docId, 'utf8').toString('base64url') : null;
}

export function decodeCursor(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const id = Buffer.from(raw, 'base64url').toString('utf8');
    // A cursor names a workspace, and a workspace id is the only thing a page ever ends on.
    return isWorkspaceId(id) && !/[/\s]/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/**
 * Offset paging for the ONE mode that is already bounded: an owner's own apps come back as a whole
 * (a prefix range, at most 200), so the page is a slice and the cursor is the next offset.
 */
export function sliceOwnerPage<T>(all: T[], offsetRaw: unknown, size: number): { page: T[]; nextOffset: string | null } {
  const offset = Math.max(0, Math.floor(Number(offsetRaw) || 0));
  const page = all.slice(offset, offset + size);
  const next = offset + size;
  return { page, nextOffset: next < all.length ? String(next) : null };
}
