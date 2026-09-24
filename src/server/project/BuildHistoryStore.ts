/**
 * Phase 2.1 — Git-native versioning: persist every successful build as a
 * numbered version checkpoint in Firestore.
 *
 * Every build (ok: true) writes one entry here. The frontend can list all
 * versions for a workspace and restore any of them — giving users "go back to
 * version 3" semantics without a real git server.
 *
 * Collection layout:
 *   build_history/{sessionId}              — workspace metadata doc
 *   build_history/{sessionId}/versions/{versionId}  — one doc per build
 *
 * Versions are capped at MAX_VERSIONS_PER_WORKSPACE per workspace (oldest
 * dropped). Each version doc is capped at MAX_VERSION_BYTES (Firestore 1MB
 * limit). Never throws — build must never be blocked by history writes.
 */
import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';
import { MAX_SAVED_VERSIONS } from '../../lib/versionRetention';
import { fitFilesPacked, unpackJson, utf8Bytes, compactStorageEnabled, MAX_PACKED_BYTES, type PackedEncoding } from '../lib/compactStore';

export interface VersionEntry {
  id: string;
  sessionId: string;
  commitMessage: string;
  createdAt: string;
  fileCount: number;
  isEdit: boolean;
  tier?: string;
  ok: boolean;
  /** Only present on get(), not on list() */
  files?: Record<string, string>;
  /**
   * How many files the version really HOLDS. Absent on versions written before 2026-09-24, which could
   * hold fewer than `fileCount` with nothing saying so.
   */
  storedFileCount?: number;
  /** Files that did not fit even compressed. 0 means the version is the whole app. */
  omittedFileCount?: number;
}

export type VersionMeta = Omit<VersionEntry, 'files'>;

/** The document as stored: legacy `files`, or the packed form. Never both. */
type StoredVersion = VersionEntry & { filesEnc?: PackedEncoding; filesPacked?: unknown };

/** Metadata fields only — what `list()` asks Firestore for, so a list never downloads fifty apps. */
const META_FIELDS = ['id', 'sessionId', 'commitMessage', 'createdAt', 'fileCount', 'isEdit', 'tier', 'ok', 'storedFileCount', 'omittedFileCount'] as const;

// THE CAP LIVES IN src/lib/versionRetention.ts, not here — the Time Machine PRINTS this number to the
// user ("your newest 50 versions are kept"), and a screen that states another module's constant is how
// a promise goes stale with nothing failing. One value, imported by the store that enforces it and the
// panel that promises it; `tests/theLimitOnScreenIsTheLimitEnforced.test.ts` holds them together.
const MAX_VERSIONS_PER_WORKSPACE = MAX_SAVED_VERSIONS;
const MAX_VERSION_BYTES = 900_000; // 900KB — safely under Firestore 1MB doc limit

/**
 * How a version's files are stored. PURE — exported for tests.
 *
 * 🔴 WHY (2026-09-24). This used to keep the first ~900 KB of an app and silently drop the rest, and
 * it measured that 900 KB in JavaScript CHARACTERS: a Hindi-heavy app is up to 3 bytes a character,
 * so its "900 KB" document could be 2.7 MB, the write threw, and the version was lost entirely. The
 * Time Machine then offered a restore of something that never existed, or nothing at all.
 *
 *   • it fits as plain text (measured in BYTES) ⇒ stored exactly as before, byte for byte. Most apps.
 *     This keeps the common path unchanged AND means a rollback of this code can still read them.
 *   • it does not ⇒ stored COMPRESSED (text packs 4–6×), so a multi-megabyte app is kept whole.
 *   • even compressed it does not fit ⇒ the longest prefix that fits, and the version RECORDS how many
 *     files were left out instead of pretending to be complete.
 *
 * `AGENTV3_COMPACT_STORAGE=off` is the no-deploy revert: never compress, byte-measured truncation.
 */
export function planVersionFiles(
  files: Record<string, string>,
  env: NodeJS.ProcessEnv = process.env,
):
  | { mode: 'plain'; files: Record<string, string>; omitted: string[] }
  | { mode: 'packed'; files: Record<string, string>; omitted: string[]; packed: ReturnType<typeof fitFilesPacked>['packed'] } {
  const entries = Object.entries(files ?? {}).filter(([p, c]) => typeof p === 'string' && typeof c === 'string');
  const plain: Record<string, string> = {};
  const omitted: string[] = [];
  let bytes = 0;
  for (const [path, content] of entries) {
    const size = utf8Bytes(path) + utf8Bytes(content);
    if (omitted.length === 0 && bytes + size <= MAX_VERSION_BYTES) {
      plain[path] = content;
      bytes += size;
    } else {
      omitted.push(path);
    }
  }
  if (omitted.length === 0) return { mode: 'plain', files: plain, omitted };
  if (!compactStorageEnabled(env)) {
    return { mode: 'plain', files: plain, omitted };
  }
  const fitted = fitFilesPacked(Object.fromEntries(entries), MAX_PACKED_BYTES);
  return { mode: 'packed', files: fitted.files, omitted: fitted.omitted, packed: fitted.packed };
}

/** Read a stored version's files, whichever form they were written in. Unreadable ⇒ null, never `{}`. */
export function readVersionFiles(data: StoredVersion): Record<string, string> | null {
  if (data.filesEnc) {
    try { return unpackJson<Record<string, string>>(data.filesEnc, data.filesPacked); } catch { return null; }
  }
  return data.files && typeof data.files === 'object' ? data.files : null;
}

class BuildHistoryStore {
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

  private versionsCol(db: admin.firestore.Firestore, sessionId: string) {
    return db.collection('build_history').doc(sessionId).collection('versions');
  }

  async save(
    sessionId: string,
    entry: {
      commitMessage: string;
      fileCount: number;
      files: Record<string, string>;
      isEdit: boolean;
      tier?: string;
      ok: boolean;
    },
  ): Promise<boolean> {
    // 🔴 RETURNS WHETHER THE VERSION REALLY LANDED (2026-09-20). It used to return `void` and swallow
    // everything — including `if (!db) return`, the case where Firestore is not configured at all. So
    // every caller's only honest statement was "we asked", and a build report that said "a version was
    // saved" was reporting an INTENTION as a fact. A writer that cannot tell anyone whether it wrote is
    // how the Time Machine came to be empty for months with nothing failing anywhere.
    //
    // Still never throws: a history write must not be able to cost a user the app they just paid for.
    const db = this.getDb();
    if (!db) return false;
    try {
      const col = this.versionsCol(db, sessionId);
      const id = `v_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const plan = planVersionFiles(entry.files);
      const doc: StoredVersion = {
        id,
        sessionId,
        commitMessage: entry.commitMessage,
        createdAt: new Date().toISOString(),
        fileCount: entry.fileCount,
        isEdit: entry.isEdit,
        tier: entry.tier,
        ok: entry.ok,
        storedFileCount: Object.keys(plan.files).length,
        // A caller may already have left files out before handing them over (a raw-size bound), so the
        // honest count is whichever is larger: what we dropped, or what we were told existed but never got.
        omittedFileCount: Math.max(plan.omitted.length, entry.fileCount - Object.keys(plan.files).length, 0),
        ...(plan.mode === 'packed'
          ? { filesEnc: plan.packed.enc, filesPacked: plan.packed.data }
          : { files: plan.files }),
      };
      // `tier` is optional and Firestore rejects an explicit `undefined`.
      if (doc.tier === undefined) delete doc.tier;
      if (plan.omitted.length > 0) {
        console.warn(`[BuildHistory] version for ${sessionId} left out ${plan.omitted.length} file(s) that did not fit even compressed`);
      }
      await col.doc(id).set(doc);
      // ⚠️ THE TRIM HAS ITS OWN try ON PURPOSE. Past this line the version EXISTS and is restorable;
      // retention is housekeeping. Folding the two together would report a saved version as unsaved
      // because an unrelated delete failed — the opposite lie from the one above, and just as bad.
      try {
        // Enforce MAX_VERSIONS_PER_WORKSPACE: drop the oldest if needed.
        const all = await col.orderBy('createdAt', 'asc').get();
        if (all.size > MAX_VERSIONS_PER_WORKSPACE) {
          const toDelete = all.docs.slice(0, all.size - MAX_VERSIONS_PER_WORKSPACE);
          const batch = db.batch();
          toDelete.forEach(d => batch.delete(d.ref));
          await batch.commit();
        }
      } catch { /* the version is saved; trimming can wait for the next one */ }
      return true;
    } catch { /* best-effort — never block the build */ }
    return false;
  }

  /** List version metadata for a workspace, newest first. No file payloads. */
  async list(sessionId: string): Promise<VersionMeta[]> {
    const db = this.getDb();
    if (!db) return [];
    try {
      // `select` asks for the metadata only. The list used to download every version's WHOLE file set
      // (up to fifty apps) just to throw it away — and with compressed versions that would also mean
      // shipping payloads nobody decodes.
      const snap = await this.versionsCol(db, sessionId)
        .select(...META_FIELDS)
        .orderBy('createdAt', 'desc')
        .limit(MAX_VERSIONS_PER_WORKSPACE)
        .get();
      return snap.docs.map(d => {
        const { files: _files, filesPacked: _p, filesEnc: _e, ...meta } = d.data() as StoredVersion;
        return meta as VersionMeta;
      });
    } catch {
      return [];
    }
  }

  /** Get a single version with full file payload. */
  async get(sessionId: string, versionId: string): Promise<VersionEntry | null> {
    const db = this.getDb();
    if (!db) return null;
    try {
      const doc = await this.versionsCol(db, sessionId).doc(versionId).get();
      if (!doc.exists) return null;
      const { files: _files, filesPacked: _p, filesEnc: _e, ...meta } = doc.data() as StoredVersion;
      const files = readVersionFiles(doc.data() as StoredVersion);
      // A version whose payload cannot be decoded is NOT an empty app — returning `{}` would let a
      // restore wipe the workspace. No files ⇒ callers treat it as not restorable.
      return files ? { ...meta, files } : { ...meta };
    } catch {
      return null;
    }
  }
}

export const buildHistoryStore = new BuildHistoryStore();
