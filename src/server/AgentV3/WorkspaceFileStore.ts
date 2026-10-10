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
import { getServerDb } from '../lib/serverDb';
import { notePersistenceFailure } from '../lib/persistenceHealth';
import { workspacePrefixFor, isAppWorkspaceKey } from '../lib/workspaceIdentity';
import { toDurableFileKey, normalizeFileMapKeys } from '../lib/workspacePath';

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
/**
 * 🔴 AND THE GUARD WAS DEFEATED BY THE ONE FAILURE IT EXISTS TO SURVIVE (found 2026-09-17, sibling of
 * the workspace-memory erasure fixed in the same change).
 *
 * The caller read the existing index with `root.get().catch(() => null)` — which collapses *"there is
 * no document"* and *"the read FAILED"* into one answer — and then passed `existingPaths.length`,
 * i.e. **0**, into this function. `0 <= 3` returns `'replace'`, and the write that follows is
 * `{ merge: false }`. So a single transient Firestore blip during a VISUAL EDIT (which saves ONE
 * file) or the reviewer's critical-fix pass (~3 files) wiped the entire path index — the exact
 * *"49 files thi! 3 rah gayi kyu?!"* wipe this guard was written to prevent.
 *
 * `'unknown'` is therefore a THIRD input, not a number: we did not learn the existing size, so we may
 * not replace. Merging can never wipe; its only cost is that a genuine full rebuild leaves some stale
 * paths in the index, and `removeWorkspaceFiles` already handles those. The asymmetry is the whole
 * argument — a stale path is a tidy-up, a wiped index is the user's project gone.
 */
export function savePlanForFileSet(
  existingCount: number | 'unknown',
  newCount: number,
): 'replace' | 'merge' {
  if (existingCount === 'unknown') return 'merge';     // could not read — never overwrite what we cannot see
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
 * The LOCAL scripts an index.html loads (`<script src="/src/main.tsx">` → `src/main.tsx`), as
 * workspace-relative keys. Remote, protocol-relative and data: sources are not ours. PURE.
 */
export function localScriptPaths(html: string | null | undefined): string[] {
  if (!html) return [];
  const out = new Set<string>();
  const re = /<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const src = m[1].trim();
    if (!src || /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(src) || /^[a-z][a-z0-9+.-]*:/i.test(src)) continue;
    const key = toDurableFileKey(src.split(/[?#]/)[0].replace(/^\.?\/+/, ''));
    if (key) out.add(key);
  }
  return Array.from(out);
}

/** The conventional entry modules, carried when the index.html that names the real one cannot be read. */
const CONVENTIONAL_ENTRY_RE = /^src\/(?:main|index)\.(?:tsx|jsx|ts|js)$/;

/**
 * ENTRY-MODULE CARRY-FORWARD (admin report 2026-09-28: "No React entry module found" on a built app).
 * `essentialManifestsToCarry` keeps index.html alive across a partial replace, but not the module that
 * index.html LOADS. The scaffold seeds `src/main.tsx`, the model rarely rewrites it, so a replace with
 * this turn's writes kept index.html and dropped its entry: the saved app pointed at a file it no longer
 * had, and every cold restore and every render from the saved files was a broken app. An index.html
 * without its entry is never intended, so its entry is carried exactly like the manifest. PURE.
 *
 * `indexHtml` is the index.html the saved set will contain; `null` means it could not be read, and
 * then the conventional entry names are carried instead (carrying an unused entry breaks nothing).
 */
export function entryModulesToCarry(existingPaths: string[], incomingPaths: string[], indexHtml: string | null): string[] {
  const incoming = new Set(incomingPaths);
  const wanted = indexHtml == null ? null : new Set(localScriptPaths(indexHtml));
  return (existingPaths || []).filter((p) => !incoming.has(p) && (wanted ? wanted.has(p) : CONVENTIONAL_ENTRY_RE.test(p)));
}

/**
 * The paths of a stored index that a load would actually return: normalized, de-duplicated, and without
 * anything `toDurableFileKey` refuses. PURE.
 */
export function liveIndexPaths(paths: unknown): string[] {
  if (!Array.isArray(paths)) return [];
  const seen = new Set<string>();
  for (const p of paths) {
    if (typeof p !== 'string' || p.length === 0) continue;
    const key = toDurableFileKey(p);
    if (key !== null) seen.add(key);
  }
  return Array.from(seen);
}

export type WorkspaceSaveStatus = 'saved' | 'merged' | 'failed' | 'no-store' | 'nothing';

/**
 * Persist the current set of workspace source files. The `paths` metadata list is authoritative:
 * a file removed from `files` won't be returned by loadWorkspaceFiles even if its content doc
 * lingers. GUARDED: a drastically-smaller partial set is MERGED, never a wipe (savePlanForFileSet),
 * unless `opts.mode` is `'replace'` (a green snapshot must not become a hybrid of old and new).
 * Best-effort — never throws. The status is what a caller may claim: `'saved'` only when this
 * write replaced the index, `'merged'` when the shrink guard unioned instead.
 */
export async function saveWorkspaceFiles(
  workspaceId: string,
  files: Record<string, string>,
  opts?: { mode?: 'replace' },
): Promise<WorkspaceSaveStatus> {
  const normalized = normalizeFileMapKeys(files);
  const entries = Object.entries(normalized.files).filter(([, c]) => typeof c === 'string' && Buffer.byteLength(c, 'utf8') <= MAX_FILE_BYTES);
  if (entries.length === 0) return 'nothing'; // never overwrite a good saved set with nothing
  const db = getDb();
  if (!db) return 'no-store';
  try {
    const root = db.collection(COLLECTION).doc(workspaceId);
    // SHRINK GUARD (the "49 → 3 files" wipe): read the existing index BEFORE replacing it; a partial
    // set routes to mergeWorkspaceFiles (union) and the wipe is recorded visibly, never silent.
    // Green snapshots pass mode:'replace' and skip this — a hybrid last-known-good is not a restore point.
    // ⚠️ A FAILED READ IS NOT AN EMPTY INDEX. `.catch(() => null)` used to answer the same `null` for
    // both, and `[].length` then told the guard below there was nothing to protect. Distinguish them.
    let guardMeta: FirebaseFirestore.DocumentSnapshot | null = null;
    let guardRead: 'ok' | 'failed' = 'ok';
    try { guardMeta = await root.get(); } catch { guardRead = 'failed'; }
    // Only paths a load would return count as "the project" — an index polluted with installed
    // packages (autopsy e1c21ad8: 1,930 paths, ~1,900 of them a Python virtualenv) must not make every
    // real save look like a drastic shrink and route it to a merge that keeps the pollution for ever.
    const existingPaths: string[] = liveIndexPaths(guardMeta?.exists ? guardMeta.data()?.paths : undefined);
    const existingCount: number | 'unknown' = guardRead === 'ok' ? existingPaths.length : 'unknown';
    if (opts?.mode !== 'replace' && savePlanForFileSet(existingCount, entries.length) === 'merge') {
      notePersistenceFailure('workspace_files', 'write', new Error(`shrink-guard: a save of ${entries.length} path(s) would have wiped an index of ${existingCount} — merged instead`));
      const merged = await mergeWorkspaceFiles(workspaceId, files);
      return merged.status === 'failed' ? 'failed' : 'merged';
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
    // ...and the module that index.html loads (see entryModulesToCarry). The page is read from the
    // incoming set when it is there, else from its existing content doc (one read, by id).
    let indexHtml: string | null = normalized.files['index.html'] ?? null;
    if (indexHtml == null && existingPaths.includes('index.html')) {
      try {
        const doc = await filesCol.doc(fileDocId('index.html')).get();
        const c = doc.exists ? doc.data()?.content : undefined;
        indexHtml = typeof c === 'string' ? c : null;
      } catch { indexHtml = null; }
    }
    const entryCarry = indexHtml != null || existingPaths.includes('index.html')
      ? entryModulesToCarry(existingPaths, safe.paths, indexHtml)
      : [];
    const keep = [...carried, ...entryCarry];
    const finalPaths = keep.length > 0 ? Array.from(new Set([...safe.paths, ...keep])) : safe.paths;
    await root.set({ paths: finalPaths, count: finalPaths.length, savedAt: Date.now() }, { merge: false });
    return 'saved';
  } catch (e) {
    // Best-effort — a save failure never blocks a build — but it is the exact "reload pe data gayab"
    // trigger (e.g. free-tier daily write quota exhausted), so make it visible instead of silent.
    notePersistenceFailure('workspace_files', 'write', e);
    return 'failed';
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

/** What a merge achieved — the import reports it honestly instead of assuming (Q-735). */
export interface MergeResult {
  /** saved: every file indexed · partial: some · failed: none · no-store: no database here · nothing: empty input */
  status: 'saved' | 'partial' | 'failed' | 'no-store' | 'nothing';
  /** Paths now in the durable index from this merge. */
  indexed: number;
  /** Paths whose write could not be confirmed — not indexed, so a restore never points at a missing doc. */
  unconfirmed: string[];
  error?: string;
}

/** The four operations a merge needs — Firestore in production, a fake in tests. */
export interface MergeStore {
  commit(docs: ReadonlyArray<readonly [string, string]>): Promise<void>;
  /** The stored content of each path (undefined when absent or unreadable). */
  read(paths: readonly string[]): Promise<Map<string, string | undefined>>;
  readIndex(): Promise<string[]>;
  writeIndex(paths: string[]): Promise<void>;
}

/** Bytes per Firestore batch — well under the 10 MiB request limit, so one commit cannot outrun its deadline. */
export const MERGE_BATCH_BYTES = 4 * 1024 * 1024;

/** Split entries into batches bounded by count AND bytes. PURE. */
export function mergeBatches(entries: ReadonlyArray<readonly [string, string]>, maxDocs = BATCH, maxBytes = MERGE_BATCH_BYTES): Array<Array<readonly [string, string]>> {
  const out: Array<Array<readonly [string, string]>> = [];
  let cur: Array<readonly [string, string]> = [];
  let bytes = 0;
  for (const e of entries) {
    const b = Buffer.byteLength(e[1], 'utf8') + Buffer.byteLength(e[0], 'utf8');
    if (cur.length > 0 && (cur.length >= maxDocs || bytes + b > maxBytes)) { out.push(cur); cur = []; bytes = 0; }
    cur.push(e);
    bytes += b;
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * The merge itself, over an injected store.
 *
 * 🔴 THE IMPORT THAT WAS NEVER SAVED (autopsy d0b2fcd6, Q-735). 175 imported files were committed in one
 * batch; the commit took the client's full 60 s deadline and threw. The content docs had been written (the
 * next read of the subcollection took 6.6 s), but the throw skipped the index union, so the durable copy
 * still listed only our 11-file starter: the turn treated the user's app as the starter, a recycle would have
 * lost it, and a Publish would have shipped the starter. Nobody was told — the failure was swallowed twice.
 *
 * Now: batches are bounded by bytes; a batch that throws is CHECKED, not assumed — each of its paths is read
 * back and indexed only if the stored content is exactly what we wrote; and the caller is told what was saved.
 */
export async function mergeIntoStore(store: MergeStore, entries: ReadonlyArray<readonly [string, string]>, concurrency = MERGE_COMMIT_CONCURRENCY): Promise<MergeResult> {
  if (entries.length === 0) return { status: 'nothing', indexed: 0, unconfirmed: [] };
  const batches = mergeBatches(entries);
  const confirmed: string[] = [];
  const failed: Array<Array<readonly [string, string]>> = [];
  let lastError = '';
  for (let i = 0; i < batches.length; i += concurrency) {
    const slice = batches.slice(i, i + concurrency);
    const results = await Promise.allSettled(slice.map((b) => store.commit(b)));
    results.forEach((r, k) => {
      if (r.status === 'fulfilled') confirmed.push(...slice[k].map(([p]) => p));
      else { failed.push(slice[k]); lastError = String((r.reason as Error)?.message ?? r.reason).slice(0, 200); }
    });
  }
  const unconfirmed: string[] = [];
  for (const b of failed) {
    const stored = await store.read(b.map(([p]) => p)).catch(() => new Map<string, string | undefined>());
    for (const [p, c] of b) (stored.get(p) === c ? confirmed : unconfirmed).push(p);
  }
  if (confirmed.length === 0) return { status: 'failed', indexed: 0, unconfirmed, error: lastError };
  try {
    const existing = liveIndexPaths(await store.readIndex());
    await store.writeIndex(Array.from(new Set([...existing, ...confirmed])));
  } catch (e) {
    return { status: 'failed', indexed: 0, unconfirmed: entries.map(([p]) => p), error: String((e as Error)?.message ?? e).slice(0, 200) };
  }
  return { status: unconfirmed.length === 0 ? 'saved' : 'partial', indexed: confirmed.length, unconfirmed, ...(lastError ? { error: lastError } : {}) };
}

/**
 * MERGE a PARTIAL set of files into the durable workspace (upsert only the given files, UNION their
 * paths into the authoritative list). Unlike `saveWorkspaceFiles` (which REPLACES the path list and
 * would drop every unchanged file when given a partial set), this never forgets existing files — so
 * a single IDE edit can be persisted durably without wiping the rest of the project. Never throws; the
 * result says what was saved (see mergeIntoStore).
 */
export async function mergeWorkspaceFiles(workspaceId: string, partial: Record<string, string>): Promise<MergeResult> {
  const db = getDb();
  if (!db) return { status: 'no-store', indexed: 0, unconfirmed: [] };
  // PHANTOM-FILE GUARD — same rule as saveWorkspaceFiles. This is the path a zip/GitHub import and
  // every single IDE edit take, so it is the likeliest door for an absolute path to walk through.
  const entries = Object.entries(normalizeFileMapKeys(partial || {}).files)
    .filter(([, c]) => typeof c === 'string' && Buffer.byteLength(c, 'utf8') <= MAX_FILE_BYTES);
  if (entries.length === 0) return { status: 'nothing', indexed: 0, unconfirmed: [] };
  const root = db.collection(COLLECTION).doc(workspaceId);
  const filesCol = root.collection('files');
  const store: MergeStore = {
    commit: async (docs) => {
      const batch = db.batch();
      for (const [path, content] of docs) batch.set(filesCol.doc(fileDocId(path)), { path, content });
      await batch.commit();
    },
    read: async (paths) => {
      const out = new Map<string, string | undefined>();
      for (let i = 0; i < paths.length; i += 100) {
        const chunk = paths.slice(i, i + 100);
        const snaps = await db.getAll(...chunk.map((p) => filesCol.doc(fileDocId(p))));
        snaps.forEach((snap, k) => out.set(chunk[k], snap.exists && typeof snap.data()?.content === 'string' ? snap.data()!.content : undefined));
      }
      return out;
    },
    readIndex: async () => {
      const meta = await root.get();
      return meta.exists ? (meta.data()?.paths ?? []) : [];
    },
    writeIndex: async (paths) => {
      const safe = capPathsToDocLimit(paths);
      if (safe.capped > 0) notePersistenceFailure('workspace_files', 'write', new Error(`durable path index capped: ${safe.capped} of ${paths.length} paths exceeded the 1MB metadata-doc limit (files remain in the sandbox / git)`));
      await root.set({ paths: safe.paths, count: safe.paths.length, savedAt: Date.now() }, { merge: true });
    },
  };
  const result = await mergeIntoStore(store, entries);
  if (result.status === 'failed' || result.status === 'partial') {
    // Surface it (see saveWorkspaceFiles) — and the caller now gets the same truth back.
    notePersistenceFailure('workspace_files', 'write', new Error(`merge ${result.status}: ${result.unconfirmed.length} of ${entries.length} unconfirmed${result.error ? ` — ${result.error}` : ''}`));
  }
  return result;
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
  return (await loadWorkspaceFilesWithStatus(workspaceId)).files;
}

/**
 * Why the durable store answered with what it did (autopsy 4d538ca3, 2026-10-01). A second build read
 * **0 files** from a store the first build had just saved, and the report could not say whether the
 * store was empty or the read had failed: `loadWorkspaceFiles` returns `{}` for both, the same shape
 * the turn-start sandbox scan was fixed to stop using ("a scan that failed is not an empty sandbox").
 * `unreadable` is never `empty`; `no-store` is a process with no database (tests, local dev).
 */
export type DurableReadStatus = 'ok' | 'empty' | 'unreadable' | 'no-store';

export async function loadWorkspaceFilesWithStatus(
  workspaceId: string,
): Promise<{ files: Record<string, string>; status: DurableReadStatus; savedAt: number | null; error?: string }> {
  const db = getDb();
  if (!db) return { files: {}, status: 'no-store', savedAt: null };
  try {
    const root = db.collection(COLLECTION).doc(workspaceId);
    const meta = await root.get();
    if (!meta.exists) return { files: {}, status: 'empty', savedAt: null };
    const paths: string[] = Array.isArray(meta.data()?.paths) ? meta.data()!.paths : [];
    const savedAt = typeof meta.data()?.savedAt === 'number' ? meta.data()!.savedAt : null;
    if (paths.length === 0) return { files: {}, status: 'empty', savedAt };
    // HEAL ON READ, not by migration. The writers above stop NEW phantoms; every workspace that
    // already holds one (the admin's did — that is how this was found) would otherwise keep reporting
    // a duplicate entry point forever. Normalizing here fixes them all at once, with no backfill job
    // and no risk of a half-migrated store: the map a caller receives can only contain paths the
    // sandbox could resolve. Matching on the NORMALIZED path keeps the metadata list authoritative,
    // so a file the user deleted still stays deleted.
    const allowed = new Set(paths.map((p) => toDurableFileKey(p)).filter((p): p is string => p !== null));
    const docs = await root.collection('files').get();
    const out: Record<string, string> = {};
    const unindexed = new Map<string, string>();
    for (const d of docs.docs) {
      const data = d.data();
      if (typeof data.path !== 'string' || typeof data.content !== 'string') continue;
      const key = toDurableFileKey(data.path);
      if (key === null) continue;
      if (!allowed.has(key)) { unindexed.set(key, data.content); continue; }
      // A phantom and its real twin carry the same content in practice; when they do not, the doc that
      // sorts later wins, exactly as before this guard existed for a single key.
      out[key] = data.content;
    }
    const files = restoreDroppedEntryModules(out, unindexed);
    return { files, status: Object.keys(files).length > 0 ? 'ok' : 'empty', savedAt };
  } catch (err) {
    return { files: {}, status: 'unreadable', savedAt: null, error: String((err as Error)?.message ?? err).slice(0, 200) };
  }
}

/**
 * HEAL ON READ for indexes saved before the entry carry-forward existed. A replace dropped the entry
 * from the path list but never deleted its content doc, so the file is still here — only unlisted.
 * When the saved index.html loads a local script that is missing from the listed files but present as
 * an unlisted doc, it is returned. Nothing else unlisted is ever resurrected (a file the user deleted
 * stays deleted). PURE.
 */
export function restoreDroppedEntryModules(
  listed: Record<string, string>,
  unlisted: ReadonlyMap<string, string>,
): Record<string, string> {
  const html = listed['index.html'];
  if (typeof html !== 'string' || unlisted.size === 0) return listed;
  for (const p of localScriptPaths(html)) {
    if (!(p in listed) && unlisted.has(p)) listed[p] = unlisted.get(p) as string;
  }
  return listed;
}

/**
 * Read a FEW named files by path, without loading the whole workspace.
 *
 * WHY THIS EXISTS (2026-08-24). Deciding whether an app can be hosted on static hosting needs exactly
 * four manifests (`package.json`, `requirements.txt`, `pyproject.toml`, `Pipfile`) — and the only
 * durable reader available was `loadWorkspaceFiles`, which pulls EVERY file's content. On a status
 * poll that is an absurd cost for four documents, and it is the kind of cost that quietly makes a
 * correct feature too expensive to keep. `fileDocId` is deterministic, so the docs can be fetched by
 * id directly: at most `paths.length` reads, no listing, no metadata scan.
 *
 * Missing paths are simply absent from the result — a caller cannot tell "no such file" from "the read
 * failed", so this is only for callers whose behaviour on an empty answer is safe (see planDeployment,
 * which treats an unrecognised app as ordinary static files). Never throws.
 */
export async function loadWorkspaceFilesByPath(
  workspaceId: string,
  paths: readonly string[],
): Promise<Record<string, string>> {
  const db = getDb();
  if (!db || paths.length === 0) return {};
  const out: Record<string, string> = {};
  try {
    const filesCol = db.collection(COLLECTION).doc(workspaceId).collection('files');
    const snaps = await Promise.all(paths.map((p) => filesCol.doc(fileDocId(p)).get().catch(() => null)));
    for (const snap of snaps) {
      const data = snap?.exists ? snap.data() : null;
      if (data && typeof data.path === 'string' && typeof data.content === 'string') out[data.path] = data.content;
    }
  } catch { /* absent is the same as unreadable to every caller of this — see the note above */ }
  return out;
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
    // The path list, when present, is what a load returns; `count` is only what the last writer
    // stored, and an index written before e1c21ad8 counted a virtualenv's packages as project files.
    if (Array.isArray(data?.paths)) return liveIndexPaths(data!.paths).length;
    if (typeof data?.count === 'number' && data.count >= 0) return data.count;
    return 0;
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
    if (!Array.isArray(data?.paths)) return [];
    // Normalized + de-duplicated for the same reason loadWorkspaceFiles heals on read: this list is
    // what `countEditableSourceFiles` counts and what the rebuild guard weighs, so a phantom here
    // inflates the size of a project that does not contain it.
    const seen = new Set<string>();
    for (const p of data!.paths) {
      if (typeof p !== 'string' || p.length === 0) continue;
      const key = toDurableFileKey(p);
      if (key !== null) seen.add(key);
    }
    return Array.from(seen);
  } catch {
    return [];
  }
}

/**
 * When this workspace's files were last written durably (ms), or null when we cannot tell.
 *
 * Reads ONLY the metadata doc — the same one `countWorkspaceFiles` reads — so it is safe to call on
 * a polled endpoint. `savedAt` is rewritten by EVERY durable write path (save / merge / remove /
 * approved reset), which is what makes it a true "the app changed" stamp rather than a build marker.
 *
 * 🔒 Returns null — never 0, never Date.now() — for a workspace with no stamp or an unreadable store.
 * The caller compares it against a publish time, and a fabricated value would produce a confident
 * "your site is out of date" for an app that is perfectly current (see publishFreshness).
 */
export async function workspaceFilesSavedAt(workspaceId: string): Promise<number | null> {
  const db = getDb();
  if (!db) return null;
  try {
    const meta = await db.collection(COLLECTION).doc(workspaceId).get();
    if (!meta.exists) return null;
    const savedAt = meta.data()?.savedAt;
    return typeof savedAt === 'number' && Number.isFinite(savedAt) && savedAt > 0 ? savedAt : null;
  } catch {
    return null;
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
      // backup by mistake. A snapshot is a safety copy, never an app — and neither is the rolled-back
      // attempt or the route fingerprint beside it, which `isGreenSnapshotKey` alone let through.
      if (!isAppWorkspaceKey(d.id)) continue;
      apps.push({ workspaceId: d.id, fileCount, savedAt: typeof data.savedAt === 'number' ? data.savedAt : 0 });
    }
    apps.sort((a, b) => b.savedAt - a.savedAt);
    return apps;
  } catch {
    return [];
  }
}

/**
 * ONE PAGE of EVERY user's built apps, newest save first (admin Security → Built apps, 2026-09-18:
 * "sabhi users ki build app dikhni chahiye … 12-12 ke set me").
 *
 * Reads only the small metadata docs of `workspace_files_v3`, never file content, and never more than
 * a few pages' worth: the query is `orderBy('savedAt', 'desc')` resumed from a DOCUMENT SNAPSHOT
 * (`startAfter(snap)`), the one cursor form that is exact under this ordering without a composite
 * index. Green-guard snapshot keys and empty indexes share the collection and are skipped AFTER the
 * read, so a page may come back a little short; the loop refills it (bounded) rather than handing the
 * admin a page of nine and calling it twelve.
 *
 * `ok: false` means the store could not be read — NOT that there are no apps. The panel treats the
 * two differently, because "no built apps" on a moderation screen over a failed read is the exact lie
 * that screen exists to avoid.
 */
export async function listWorkspaceAppsPage(opts: { limit: number; afterDocId?: string | null }): Promise<{
  ok: boolean;
  apps: UserWorkspaceApp[];
  /** The raw last document id of the page, to resume from; null when the collection is exhausted. */
  nextAfterDocId: string | null;
}> {
  const db = getDb();
  if (!db) return { ok: false, apps: [], nextAfterDocId: null };
  const size = Math.max(1, Math.min(48, Math.floor(opts.limit) || 12));
  try {
    const col = db.collection(COLLECTION);
    let after: FirebaseFirestore.DocumentSnapshot | null = null;
    if (opts.afterDocId) {
      const snap = await col.doc(opts.afterDocId).get();
      if (!snap.exists) return { ok: true, apps: [], nextAfterDocId: null }; // the cursor's doc is gone: nothing to resume from
      after = snap;
    }
    const apps: UserWorkspaceApp[] = [];
    let lastId: string | null = null;
    let exhausted = false;
    // Refill at most three times: a page of twelve among a handful of snapshot keys fills on the first
    // read; a pathological stretch of empties is bounded rather than scanned to the end.
    for (let round = 0; round < 3 && apps.length < size && !exhausted; round++) {
      let q = col.orderBy('savedAt', 'desc').limit(size);
      if (after) q = q.startAfter(after);
      const snap = await q.get();
      if (snap.docs.length < size) exhausted = true;
      for (const d of snap.docs) {
        after = d;
        lastId = d.id;
        const data = d.data() || {};
        const fileCount = typeof data.count === 'number' ? data.count : (Array.isArray(data.paths) ? data.paths.length : 0);
        if (fileCount <= 0) continue;           // an emptied index is not an app
        if (!isAppWorkspaceKey(d.id)) continue; // a derived record (::green / ::attempt / ::greenmeta), never an app
        apps.push({ workspaceId: d.id, fileCount, savedAt: typeof data.savedAt === 'number' ? data.savedAt : 0 });
        if (apps.length >= size) break;
      }
      if (snap.docs.length === 0) break;
    }
    return { ok: true, apps, nextAfterDocId: exhausted && apps.length < size ? null : lastId };
  } catch {
    return { ok: false, apps: [], nextAfterDocId: null };
  }
}

/**
 * The metadata of a SET of workspaces in ONE `getAll` — the join the admin panel needs when the page
 * came from the publish registry (a status filter) rather than from this store. Missing docs are
 * simply absent from the map (an orphaned publish whose files were purged). Never throws.
 */
export async function getWorkspaceAppsMany(workspaceIds: string[]): Promise<Map<string, UserWorkspaceApp>> {
  const out = new Map<string, UserWorkspaceApp>();
  const db = getDb();
  const ids = [...new Set(workspaceIds.filter((id) => typeof id === 'string' && id.length > 0 && !id.includes('/')))].slice(0, 100);
  if (!db || ids.length === 0) return out;
  try {
    const snaps = await db.getAll(...ids.map((id) => db.collection(COLLECTION).doc(id)));
    for (const s of snaps) {
      if (!s.exists) continue;
      const data = s.data() || {};
      const fileCount = typeof data.count === 'number' ? data.count : (Array.isArray(data.paths) ? data.paths.length : 0);
      out.set(s.id, { workspaceId: s.id, fileCount, savedAt: typeof data.savedAt === 'number' ? data.savedAt : 0 });
    }
  } catch { /* best-effort — a store hiccup leaves the map short, never throws at the route */ }
  return out;
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

/**
 * Pure: split a current path list into what remains after removing `toRemove`, + the removed paths.
 *
 * Matching is on the NORMALIZED path, so `src/main.tsx` deletes a legacy entry stored as
 * `/home/user/workspace/src/main.tsx`. Without that, a phantom key (see toDurableFileKey) was
 * literally undeletable: the only spelling the store knew was one no caller would ever type. The
 * ORIGINAL string is what comes back in `removed`, because `fileDocId` must address the content doc
 * exactly as it was written.
 */
export function diffRemovedPaths(current: string[], toRemove: string[]): { remaining: string[]; removed: string[] } {
  const removeSet = new Set<string>();
  for (const p of toRemove || []) {
    if (typeof p !== 'string' || !p) continue;
    removeSet.add(p);
    const key = toDurableFileKey(p);
    if (key !== null) removeSet.add(key);
  }
  const remaining: string[] = [];
  const removed: string[] = [];
  for (const p of current || []) {
    const key = toDurableFileKey(p);
    (removeSet.has(p) || (key !== null && removeSet.has(key)) ? removed : remaining).push(p);
  }
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
