// AgentV3 — Durable workspace FILE persistence (so a build's source code never vanishes).
//
// The sandbox is ephemeral: if it is paused, garbage-collected, or a later message gets a fresh
// one, every file the agent wrote is gone — and there was nothing to restore them from (only the
// MEMORY snapshot was persisted, not the file CONTENT). That is the "files gayab ho gayi" bug.
//
// This store persists the actual file contents to Firestore, keyed by workspaceId, so:
//   • at the start of a build, a fresh/empty sandbox is re-seeded with the user's saved files;
//   • after a build, the produced files are saved.
// Files are stored one-per-document in a `files` subcollection to stay clear of the 1 MB
// document limit; a metadata doc holds the authoritative current path list (so a file the user
// deleted is not resurrected on the next restore).
//
// Pattern mirrors FirestoreWorkspaceMemoryStore: firebase-admin, VITEST-skip, best-effort, never
// throws — a persistence failure must never break or block a build.

import * as admin from 'firebase-admin';
import { firestoreDatabaseId } from '../lib/firestoreDb';
import { getServerDb } from '../lib/serverDb';
import { notePersistenceFailure } from '../lib/persistenceHealth';
import { isGreenSnapshotKey } from './GreenGuard';
import { workspacePrefixFor } from '../lib/workspaceIdentity';

const COLLECTION = 'workspace_files_v3';
/** Firestore's hard per-document limit is 1 MB; skip a single file larger than this. */
const MAX_FILE_BYTES = 900 * 1024;
/** Firestore batches allow up to 500 writes; stay under it. */
const BATCH = 400;
/** How many Firestore batch commits may be in flight at once during a merge (see mergeWorkspaceFiles). */
const MERGE_COMMIT_CONCURRENCY = Math.max(
  1,
  Math.min(16, Number(process.env.AGENTV3_MERGE_COMMIT_CONCURRENCY) || 6),
);

let _db: admin.firestore.Firestore | null = null;

function getDb(): admin.firestore.Firestore | null {
  if (process.env.VITEST) return null; // unit tests never hit real Firestore
  if (_db) return _db;
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    _db = getServerDb();
    return _db;
  } catch (e) {
    notePersistenceFailure('workspace_files', 'init', e);
    return null;
  }
}

/** Deterministic, '/'-free Firestore doc id for a workspace-relative file path. */
export function fileDocId(path: string): string {
  return Buffer.from(path, 'utf8').toString('base64url').slice(0, 1500);
}

/**
 * The authoritative `paths` list lives in ONE metadata doc, which Firestore caps at 1 MB. A very
 * large imported app (tens of thousands of files) could push the array past that and fail the WHOLE
 * durable write. So cap the list to a safe byte budget: keep as many paths as fit, report how many
 * were dropped. The dropped files' CONTENT docs still exist and the sandbox still has every file —
 * for a git-imported app the repo itself is the durable source — so this degrades gracefully instead
 * of failing. PURE + tested.
 */
export function capPathsToDocLimit(paths: string[], maxBytes = 950_000): { paths: string[]; capped: number } {
  const kept: string[] = [];
  let bytes = 40; // field overhead headroom
  for (const p of paths) {
    bytes += Buffer.byteLength(p, 'utf8') + 8; // string bytes + per-element array overhead
    if (bytes > maxBytes) break;
    kept.push(p);
  }
  return { paths: kept, capped: paths.length - kept.length };
}

/**
 * SHRINK GUARD — decide whether a save may REPLACE the authoritative path index or must MERGE.
 *
 * ROOT CAUSE (admin, 2026-07-07 — "49 files thi! 3 rah gayi kyu?!"): `saveWorkspaceFiles` REPLACES
 * the path index with exactly the given set, and several callers pass a PARTIAL set — the reviewer's
 * critical-fix pass saved only its ~3 fixed files after an import turn, and a visual edit saves ONE
 * file. Each such save silently WIPED every other file from the index: 49 files → 3, "sab gayab".
 * The class fix lives HERE, where the data enters (not at each call site): a save that would shrink
 * an established index to under half its size is treated as a partial update and MERGED instead —
 * so no current or FUTURE call site can ever wipe a project again. A genuine full rebuild writes a
 * comparable file count (replace allowed); genuine deletions go through removeWorkspaceFiles, which
 * is unaffected. PURE + unit-tested.
 */
export function savePlanForFileSet(existingCount: number, newCount: number): 'replace' | 'merge' {
  if (existingCount <= 3) return 'replace';            // empty/tiny index — nothing meaningful to protect
  if (newCount >= existingCount / 2) return 'replace'; // comparable size — a real full save
  return 'merge';                                      // drastic shrink — a partial set; never wipe
}

/**
 * A build's SCAFFOLD root manifests (package.json, index.html, framework configs) are seeded straight
 * into the sandbox by `ensureWorkspace` and BYPASS the write-tracking that feeds the durable saves.
 * They are preview-critical (package.json holds the deps + start command) and a build NEVER
 * intentionally deletes them mid-build. This is the exact allowlist of "never silently drop me".
 */
const ESSENTIAL_MANIFEST_RE =
  /^(?:package\.json|index\.html|tsconfig(?:\.[\w-]+)?\.json|jsconfig\.json|vite\.config\.[cm]?[jt]s|svelte\.config\.[cm]?js|next\.config\.[cm]?[jt]s|nuxt\.config\.[cm]?[jt]s|astro\.config\.[cm]?[jt]s|remix\.config\.[cm]?[jt]s|angular\.json)$/;

/** True for a workspace-ROOT preview-critical manifest (package.json etc.). Root-only by design. PURE. */
export function isEssentialManifest(path: string): boolean {
  return ESSENTIAL_MANIFEST_RE.test((path || '').replace(/^\.?\//, ''));
}

/**
 * ESSENTIAL-MANIFEST CARRY-FORWARD. `saveWorkspaceFiles` REPLACES the authoritative path list with
 * exactly the set it is given, and many callers pass only the AI-written files (`writtenFiles`) —
 * which never include the scaffold's root manifests. So an authoritative save would silently DROP
 * package.json from the durable index even though the sandbox still has it, and a later cold-sandbox
 * preview re-seeded from durable then reports "No package.json found" (the exact LearnLoop bug).
 *
 * A root manifest's absence from an incoming set is always an omission, never an intentional delete,
 * so any essential manifest present in the existing index but absent from the incoming set is carried
 * forward (its content doc already exists). If the AI DID rewrite the manifest it is in the incoming
 * set → not carried → the new content wins. PURE + tested.
 */
export function essentialManifestsToCarry(existingPaths: string[], incomingPaths: string[]): string[] {
  const incoming = new Set(incomingPaths);
  return (existingPaths || []).filter((p) => !incoming.has(p) && isEssentialManifest(p));
}

/**
 * Persist the current set of workspace source files. The `paths` metadata list is authoritative:
 * a file removed from `files` won't be returned by loadWorkspaceFiles even if its content doc
 * lingers. GUARDED: a drastically-smaller partial set is MERGED, never a wipe (savePlanForFileSet).
 * Best-effort — never throws.
 */
export async function saveWorkspaceFiles(workspaceId: string, files: Record<string, string>): Promise<void> {
  const db = getDb();
  if (!db) return;
  const entries = Object.entries(files).filter(([, c]) => typeof c === 'string' && Buffer.byteLength(c, 'utf8') <= MAX_FILE_BYTES);
  if (entries.length === 0) return; // never overwrite a good saved set with nothing
  try {
    const root = db.collection(COLLECTION).doc(workspaceId);
    // SHRINK GUARD (the "49 → 3 files" wipe): read the existing index BEFORE replacing it; a partial
    // set routes to mergeWorkspaceFiles (union) and the wipe is recorded visibly, never silent.
    const guardMeta = await root.get().catch(() => null);
    const existingPaths: string[] = guardMeta?.exists && Array.isArray(guardMeta.data()?.paths) ? guardMeta.data()!.paths : [];
    if (savePlanForFileSet(existingPaths.length, entries.length) === 'merge') {
      notePersistenceFailure('workspace_files', 'write', new Error(`shrink-guard: a save of ${entries.length} path(s) would have wiped an index of ${existingPaths.length} — merged instead`));
      await mergeWorkspaceFiles(workspaceId, files);
      return;
    }
    const filesCol = root.collection('files');
    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = db.batch();
      for (const [path, content] of entries.slice(i, i + BATCH)) {
        batch.set(filesCol.doc(fileDocId(path)), { path, content });
      }
      await batch.commit();
    }
    const safe = capPathsToDocLimit(entries.map(([p]) => p));
    if (safe.capped > 0) notePersistenceFailure('workspace_files', 'write', new Error(`durable path index capped: ${safe.capped} of ${entries.length} paths exceeded the 1MB metadata-doc limit (files remain in the sandbox / git)`));
    // ESSENTIAL-MANIFEST CARRY-FORWARD: an authoritative replace must never drop a scaffold root
    // manifest (package.json etc.) the AI-written partial set happens to omit — else the preview later
    // reports "No package.json found" despite the sandbox having it. The manifest's content doc already
    // exists (it was merged in at build start), so carrying the path forward restores it losslessly.
    const carried = essentialManifestsToCarry(existingPaths, safe.paths);
    const finalPaths = carried.length > 0 ? Array.from(new Set([...safe.paths, ...carried])) : safe.paths;
    await root.set({ paths: finalPaths, count: finalPaths.length, savedAt: Date.now() }, { merge: false });
  } catch (e) {
    // Best-effort — a save failure never blocks a build — but it is the exact "reload pe data gayab"
    // trigger (e.g. free-tier daily write quota exhausted), so make it visible instead of silent.
    notePersistenceFailure('workspace_files', 'write', e);
  }
}

/**
 * DELIBERATE GENERATION RESET (Fix 36c — HMS report 2026-07-07). The ONLY legitimate wipe of a
 * workspace's durable file index: when the user EXPLICITLY APPROVED a rebuild-from-scratch (the
 * Fix-28 confirmation gate), the OLD app's durable files must stop existing — otherwise the File
 * Guardian later "restores" the previous generation INTO the fresh build (the 63-old-files-over-
 * 48-new-files Frankenstein that produced hours of type-conflict thrash). Clears the path index
 * (count 0) but leaves per-file docs in place as orphans (cheap, and the git/GitHub history is the
 * real archive). Never callable from any automatic path — the caller must pass the literal consent
 * token so a bug can't wipe a project without the human Approve. Best-effort — never throws.
 */
export async function resetWorkspaceFilesForApprovedRebuild(workspaceId: string, consent: 'user-approved-rebuild'): Promise<void> {
  if (consent !== 'user-approved-rebuild') return;
  const db = getDb();
  if (!db) return;
  try {
    await db.collection(COLLECTION).doc(workspaceId).set({ paths: [], count: 0, savedAt: Date.now(), resetByApprovedRebuild: true }, { merge: false });
  } catch (e) {
    notePersistenceFailure('workspace_files', 'write', e);
  }
}

/**
 * MERGE a PARTIAL set of files into the durable workspace (upsert only the given files, UNION their
 * paths into the authoritative list). Unlike `saveWorkspaceFiles` (which REPLACES the path list and
 * would drop every unchanged file when given a partial set), this never forgets existing files — so
 * a single IDE edit can be persisted durably without wiping the rest of the project. This is what
 * makes a manual IDE edit survive sandbox recycling (the File Guardian then sees the fresh content,
 * not a stale durable copy). Best-effort — never throws.
 */
export async function mergeWorkspaceFiles(workspaceId: string, partial: Record<string, string>): Promise<void> {
  const db = getDb();
  if (!db) return;
  const entries = Object.entries(partial || {}).filter(([, c]) => typeof c === 'string' && Buffer.byteLength(c, 'utf8') <= MAX_FILE_BYTES);
  if (entries.length === 0) return;
  try {
    const root = db.collection(COLLECTION).doc(workspaceId);
    const filesCol = root.collection('files');
    // 1) Upsert ONLY the changed/added content docs.
    //
    // The commits run CONCURRENTLY (bounded). They used to be awaited one after another, so a large
    // import paid every batch's round trip end-to-end — the same "serial awaits over a network" class
    // that once made the sandbox landing take 648 seconds (see WorkspaceFiles.ts). Batches are
    // independent upserts of DISTINCT docs, so ordering between them carries no meaning and running
    // them together is safe by construction. Bounded so a huge import can't open unlimited sockets.
    const commits: Array<Promise<unknown>> = [];
    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = db.batch();
      for (const [path, content] of entries.slice(i, i + BATCH)) {
        batch.set(filesCol.doc(fileDocId(path)), { path, content });
      }
      commits.push(batch.commit());
      if (commits.length >= MERGE_COMMIT_CONCURRENCY) {
        await Promise.all(commits.splice(0, commits.length));
      }
    }
    if (commits.length) await Promise.all(commits);
    // 2) UNION the authoritative path list (never drop unchanged files).
    const meta = await root.get();
    const existing: string[] = meta.exists && Array.isArray(meta.data()?.paths) ? meta.data()!.paths : [];
    const union = Array.from(new Set([...existing, ...entries.map(([p]) => p)]));
    const safe = capPathsToDocLimit(union);
    if (safe.capped > 0) notePersistenceFailure('workspace_files', 'write', new Error(`durable path index capped: ${safe.capped} of ${union.length} paths exceeded the 1MB metadata-doc limit (files remain in the sandbox / git)`));
    await root.set({ paths: safe.paths, count: safe.paths.length, savedAt: Date.now() }, { merge: true });
  } catch (e) {
    // Best-effort — a merge failure never blocks anything — but surface it (see saveWorkspaceFiles).
    notePersistenceFailure('workspace_files', 'write', e);
  }
}

/**
 * GA-1 — FULL purge of a workspace's persisted files: delete every doc in the `files` subcollection
 * (in batches) AND the metadata doc, so deleting a project leaves NO orphaned file docs behind (the
 * shallow conversation delete used to orphan this whole subcollection forever). Best-effort; never
 * throws; a no-op when Firestore is unavailable (VITEST).
 */
export async function purgeWorkspaceFiles(workspaceId: string): Promise<void> {
  const db = getDb();
  if (!db || !workspaceId) return;
  try {
    const root = db.collection(COLLECTION).doc(workspaceId);
    const filesCol = root.collection('files');
    // Delete the subcollection in bounded batches (a subcollection is NOT removed by deleting its parent).
    for (let guard = 0; guard < 10_000; guard++) {
      const snap = await filesCol.limit(BATCH).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      if (snap.size < BATCH) break;
    }
    await root.delete();
  } catch (e) {
    notePersistenceFailure('workspace_files', 'write', e);
  }
}

/**
 * Load the last persisted file set for a workspace as { path: content }. Returns {} when absent.
 * Only paths in the authoritative metadata list are returned (so deleted files stay deleted).
 * Never throws.
 */
export async function loadWorkspaceFiles(workspaceId: string): Promise<Record<string, string>> {
  const db = getDb();
  if (!db) return {};
  try {
    const root = db.collection(COLLECTION).doc(workspaceId);
    const meta = await root.get();
    if (!meta.exists) return {};
    const paths: string[] = Array.isArray(meta.data()?.paths) ? meta.data()!.paths : [];
    if (paths.length === 0) return {};
    const allowed = new Set(paths);
    const docs = await root.collection('files').get();
    const out: Record<string, string> = {};
    for (const d of docs.docs) {
      const data = d.data();
      if (typeof data.path === 'string' && typeof data.content === 'string' && allowed.has(data.path)) {
        out[data.path] = data.content;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Cheap, metadata-only count of a workspace's persisted files — reads ONLY the metadata doc,
 * NOT every file's content (so it is safe on the hot path before a build). Used to make intent
 * classification workspace-aware: a non-empty workspace means a follow-up instruction should be
 * treated as an EDIT of the existing project, not a fresh rebuild. Returns 0 when absent / no
 * Firestore. Never throws.
 */
export async function countWorkspaceFiles(workspaceId: string): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  try {
    const meta = await db.collection(COLLECTION).doc(workspaceId).get();
    if (!meta.exists) return 0;
    const data = meta.data();
    if (typeof data?.count === 'number' && data.count >= 0) return data.count;
    return Array.isArray(data?.paths) ? data!.paths.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Cheap, metadata-only list of a workspace's persisted file PATHS — reads ONLY the metadata doc's
 * `paths` array, never per-file content (safe on the hot path, exactly like countWorkspaceFiles). The
 * durable single source of truth for what a project contains, independent of whether the EPHEMERAL
 * sandbox is currently warm or was recycled/cold. Returns [] when absent / no Firestore. Never throws.
 */
export async function listWorkspaceFilePaths(workspaceId: string): Promise<string[]> {
  const db = getDb();
  if (!db) return [];
  try {
    const meta = await db.collection(COLLECTION).doc(workspaceId).get();
    if (!meta.exists) return [];
    const data = meta.data();
    return Array.isArray(data?.paths)
      ? data!.paths.filter((p: unknown): p is string => typeof p === 'string' && p.length > 0)
      : [];
  } catch {
    return [];
  }
}

/** One durably-stored Pro v5 app owned by a user (metadata only — no file content read). */
export interface UserWorkspaceApp {
  workspaceId: string;
  fileCount: number;
  savedAt: number;
}

/**
 * List a user's Pro v5-built apps that have durable files — the source list for the Full-App Debugger
 * (admin request 2026-07-24). Every v5 workspace id is `agentv3-{uid}-{sessionId}`, so a documentId
 * PREFIX range query over the metadata docs returns exactly this user's apps (each metadata doc is a
 * root doc; the per-file `files` subcollection docs live one level down and are NOT returned). Reads
 * only the small metadata docs (count + savedAt), never file content. Newest-first. Returns [] when
 * absent / no Firestore. Never throws — a listing failure must never break the tool.
 */
export async function listUserWorkspaceApps(uid: string, limit = 50): Promise<UserWorkspaceApp[]> {
  const db = getDb();
  if (!db || !uid || !/^[A-Za-z0-9_-]{1,64}$/.test(uid)) return [];
  try {
    const prefix = workspacePrefixFor(uid);
    if (!prefix) return [];
    // U+F8FF is a very high code point, so [prefix, prefix+U+F8FF] is exactly the prefix range.
    const prefixEnd = `${prefix}${String.fromCharCode(0xf8ff)}`;
    const byId = admin.firestore.FieldPath.documentId();
    const snap = await db.collection(COLLECTION)
      .orderBy(byId)
      .startAt(prefix)
      .endAt(prefixEnd)
      .limit(Math.max(1, Math.min(limit, 200)))
      .get();
    const apps: UserWorkspaceApp[] = [];
    for (const d of snap.docs) {
      const data = d.data() || {};
      const fileCount = typeof data.count === 'number'
        ? data.count
        : (Array.isArray(data.paths) ? data.paths.length : 0);
      if (fileCount <= 0) continue; // an empty workspace is not a debuggable app
      // A last-known-good SNAPSHOT is stored under a suffixed key in this same collection (see
      // GreenGuard.greenWorkspaceKey — reusing this store is what keeps a snapshot safe from the 1 MB
      // document limit). It shares the user's `agentv3-<uid>-` prefix, so this prefix scan would list
      // it as a SECOND app with the same name — the user would see their app twice and could open the
      // backup by mistake. A snapshot is a safety copy, never an app.
      if (isGreenSnapshotKey(d.id)) continue;
      apps.push({ workspaceId: d.id, fileCount, savedAt: typeof data.savedAt === 'number' ? data.savedAt : 0 });
    }
    apps.sort((a, b) => b.savedAt - a.savedAt);
    return apps;
  } catch {
    return [];
  }
}

/**
 * Pure: the UNION of a project's file paths as seen by the (ephemeral) sandbox and the (durable)
 * WorkspaceFileStore. RC-1 root fix (admin 2026-07-06): the sandbox listing can be near-empty on a
 * recycled/cold sandbox — if it alone drove large-project detection and the edit prompt, the true
 * project size was under-seen (the "25 vs 1654 files" split the admin hit on the SAME repo across two
 * turns) → misrouted to the weak model and the agent saw a fraction of the codebase. Unioning with the
 * durable paths makes both see EVERY known file regardless of sandbox coldness. Deduped; order is
 * sandbox-first then durable-only, so a warm sandbox's tree is byte-stable (durable adds nothing new).
 */
export function reconcileProjectFileTree(
  sandboxPaths: string[] | null | undefined,
  durablePaths: string[] | null | undefined,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of [sandboxPaths, durablePaths]) {
    for (const p of list ?? []) {
      if (typeof p === 'string' && p.length > 0 && !seen.has(p)) { seen.add(p); out.push(p); }
    }
  }
  return out;
}

/** Pure: split a current path list into what remains after removing `toRemove`, + the removed paths. */
export function diffRemovedPaths(current: string[], toRemove: string[]): { remaining: string[]; removed: string[] } {
  const removeSet = new Set((toRemove || []).filter((p) => typeof p === 'string' && p));
  const remaining: string[] = [];
  const removed: string[] = [];
  for (const p of current || []) (removeSet.has(p) ? removed : remaining).push(p);
  return { remaining, removed };
}

/**
 * Remove specific files from the durable workspace set. The authoritative `paths` metadata is
 * updated so loadWorkspaceFiles no longer returns them — i.e. v5.0 genuinely "forgets" the deleted
 * files (a fresh / restored session won't have them, and the file-guardian won't resurrect them).
 * Handles delete-all (paths → []). Best-effort: also deletes the orphaned content docs. Returns the
 * number of paths removed from the authoritative list. No-op without Firestore; never throws.
 */
export async function removeWorkspaceFiles(workspaceId: string, pathsToRemove: string[]): Promise<number> {
  const db = getDb();
  if (!db) return 0;
  const targets = (pathsToRemove || []).filter((p) => typeof p === 'string' && p);
  if (targets.length === 0) return 0;
  try {
    const root = db.collection(COLLECTION).doc(workspaceId);
    const meta = await root.get();
    if (!meta.exists) return 0;
    const current: string[] = Array.isArray(meta.data()?.paths) ? meta.data()!.paths : [];
    const { remaining, removed } = diffRemovedPaths(current, targets);
    if (removed.length === 0) return 0;
    // Update the authoritative path list FIRST — this is what makes the files "gone" for restore.
    await root.set({ paths: remaining, count: remaining.length, savedAt: Date.now() }, { merge: true });
    // Best-effort: delete the now-orphaned content docs (batched).
    const filesCol = root.collection('files');
    for (let i = 0; i < removed.length; i += BATCH) {
      const batch = db.batch();
      for (const p of removed.slice(i, i + BATCH)) batch.delete(filesCol.doc(fileDocId(p)));
      await batch.commit();
    }
    return removed.length;
  } catch (e) {
    notePersistenceFailure('workspace_files', 'write', e);
    return 0;
  }
}
