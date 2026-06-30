import { readFile, writeFile, unlink, readdir, mkdir, rename } from 'fs/promises';
import { openSync, writeSync, fsyncSync, closeSync, mkdirSync } from 'fs';
import { join } from 'path';
import { Checkpoint } from './CheckpointTypes';
import * as admin from 'firebase-admin';
import { firestoreDatabaseId } from '../../lib/firestoreDb';

// P-DATA.2 — Durable checkpoint storage.
//
// Checkpoints (AutoRepair undo, deployment rollback, orchestrator restore) were written ONLY to local
// disk `.checkpoints`, which is EPHEMERAL on Cloud Run (min-instances=0): on scale-to-zero or instance
// recycle the whole undo/rollback history vanished. Now every checkpoint is also written through to
// Firestore, so it survives a restart, and load/list reconcile from Firestore when the local cache is
// cold (fresh instance). Local disk stays the fast write-through cache. Firestore is best-effort — a
// persistence failure never breaks the local path (mirrors WorkspaceFileStore; VITEST-skip).

const COLLECTION = 'appmaker_checkpoints';
/** Firestore's hard per-document limit is 1 MB; skip durable mirroring for a checkpoint bigger than this. */
const MAX_DOC_BYTES = 900 * 1024;

/** Deterministic, Firestore-safe doc id for a checkpoint id. Pure. */
export function checkpointStorageDocId(id: string): string {
  return Buffer.from(String(id), 'utf8').toString('base64url').slice(0, 1500);
}

/** Is this serialized checkpoint small enough to mirror to a single Firestore doc? Pure. */
export function fitsFirestoreDoc(content: string): boolean {
  return Buffer.byteLength(content, 'utf8') <= MAX_DOC_BYTES;
}

let _db: admin.firestore.Firestore | null = null;
function getDb(): admin.firestore.Firestore | null {
  if (process.env.VITEST) return null; // unit tests never hit real Firestore
  if (_db) return _db;
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    _db = admin.firestore();
    _db.settings({ databaseId: firestoreDatabaseId() });
    return _db;
  } catch {
    return null;
  }
}

export class CheckpointStorage {
    private storageRoot = join(process.cwd(), '.checkpoints');

    constructor() {
        mkdir(this.storageRoot, { recursive: true }).catch(() => {});
    }

    async save(id: string, data: Checkpoint): Promise<void> {
        // Ensure the storage dir exists BEFORE writing — the constructor's mkdir is async and may not
        // have completed on the first save (and the dir never exists on a fresh instance). Sync +
        // idempotent so the very first checkpoint never races into ENOENT.
        try { mkdirSync(this.storageRoot, { recursive: true }); } catch { /* already exists */ }
        const filePath = join(this.storageRoot, `${id}.json`);
        const tmpPath = join(this.storageRoot, `${id}.json.tmp`);
        const content = JSON.stringify(data);

        const fd = openSync(tmpPath, 'w');
        try {
            writeSync(fd, content);
            fsyncSync(fd);
        } finally {
            closeSync(fd);
        }

        await rename(tmpPath, filePath);

        const dirFd = openSync(this.storageRoot, 'r');
        try {
            fsyncSync(dirFd);
        } finally {
            closeSync(dirFd);
        }

        // Durable write-through (best-effort): survives Cloud Run scale-to-zero / instance recycle.
        const db = getDb();
        if (db && fitsFirestoreDoc(content)) {
            try {
                await db.collection(COLLECTION).doc(checkpointStorageDocId(id)).set({ id, content, savedAt: Date.now() });
            } catch { /* best-effort — local disk already has it */ }
        }
    }

    async load(id: string): Promise<Checkpoint> {
        const filePath = join(this.storageRoot, `${id}.json`);
        try {
            const content = await readFile(filePath, 'utf-8');
            return JSON.parse(content);
        } catch (localErr) {
            // Local cache cold (fresh instance) → fall back to the durable copy and repopulate the cache.
            const db = getDb();
            if (db) {
                try {
                    const snap = await db.collection(COLLECTION).doc(checkpointStorageDocId(id)).get();
                    const content = snap.exists ? (snap.data()?.content as string | undefined) : undefined;
                    if (typeof content === 'string') {
                        try { await writeFile(filePath, content, 'utf-8'); } catch { /* cache repopulation is best-effort */ }
                        return JSON.parse(content);
                    }
                } catch { /* fall through to the original error */ }
            }
            throw localErr;
        }
    }

    async delete(id: string): Promise<void> {
        const filePath = join(this.storageRoot, `${id}.json`);
        await unlink(filePath).catch(() => {});
        const db = getDb();
        if (db) {
            try { await db.collection(COLLECTION).doc(checkpointStorageDocId(id)).delete(); } catch { /* best-effort */ }
        }
    }

    async list(): Promise<Checkpoint[]> {
        const byId = new Map<string, Checkpoint>();
        // 1) Local cache (fast).
        try {
            const files = await readdir(this.storageRoot);
            for (const file of files) {
                if (!file.endsWith('.json')) continue;
                try {
                    const content = await readFile(join(this.storageRoot, file), 'utf-8');
                    const cp = JSON.parse(content) as Checkpoint;
                    const cid = (cp as { id?: string })?.id || file.replace(/\.json$/, '');
                    byId.set(cid, cp);
                } catch { /* skip a corrupt cache file */ }
            }
        } catch { /* no local dir yet */ }
        // 2) Reconcile from the durable store so a cold instance still sees the full history.
        const db = getDb();
        if (db) {
            try {
                const snap = await db.collection(COLLECTION).get();
                for (const d of snap.docs) {
                    const data = d.data();
                    const cid = typeof data?.id === 'string' ? data.id : d.id;
                    if (byId.has(cid)) continue; // local copy wins (freshest)
                    if (typeof data?.content === 'string') {
                        try { byId.set(cid, JSON.parse(data.content) as Checkpoint); } catch { /* skip */ }
                    }
                }
            } catch { /* best-effort — return whatever the local cache had */ }
        }
        return Array.from(byId.values());
    }
}
