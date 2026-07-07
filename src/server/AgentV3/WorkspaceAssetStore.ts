// AgentV3 — Durable workspace ASSET persistence (small binary assets survive sandbox recycling).
//
// Imported apps ship small binary assets — a logo, a favicon, icons, web fonts. The text-file
// store (WorkspaceFileStore) can't hold them: it is REPLACED after every build from a
// text-only sandbox scan (collectWorkspaceFiles skips binaries by NUL detection), so an asset
// put there would be silently dropped on the first build after import — exactly the half-state
// the project rules forbid. Assets also must NOT sit in the text-file map at all, or they would
// leak `data:` blobs into everything that reads that map (the in-browser preview, the deploy
// collector, the AI's file reads).
//
// So assets get their OWN durable store, keyed by workspaceId, holding each asset as a
// `data:<mime>;base64,…` string (one doc per asset to stay under Firestore's 1MB/doc limit).
// They are written to the live sandbox as REAL BYTES (via the actuator's writeBinaryFile) and
// re-materialized from here into any fresh/cold sandbox on restore. The text-file store is never
// touched. Pattern mirrors WorkspaceFileStore: firebase-admin, VITEST-skip, best-effort, never
// throws — a persistence failure never blocks or breaks a build.

import * as admin from 'firebase-admin';
import { firestoreDatabaseId } from '../lib/firestoreDb';
import { notePersistenceFailure } from '../lib/persistenceHealth';
import { parseDataUri } from './ProjectImport';

const COLLECTION = 'workspace_assets_v3';
/** Firestore's hard per-document limit is 1 MB; a base64 data URI for a ≤200KB asset is ~270KB. */
const MAX_ASSET_BYTES = 900 * 1024;
const BATCH = 400;

let _db: admin.firestore.Firestore | null = null;

function getDb(): admin.firestore.Firestore | null {
  if (process.env.VITEST) return null; // unit tests never hit real Firestore
  if (_db) return _db;
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    _db = admin.firestore(); // cache BEFORE settings() so a settings() throw can't disable the store (#873)
    try {
      _db.settings({ databaseId: firestoreDatabaseId(), ignoreUndefinedProperties: true });
    } catch {
      // Another store already configured this shared instance — same databaseId, safe to proceed.
    }
    return _db;
  } catch (e) {
    notePersistenceFailure('workspace_assets', 'init', e);
    return null;
  }
}

/** Deterministic, '/'-free Firestore doc id for an asset's workspace-relative path. */
function assetDocId(path: string): string {
  return Buffer.from(path, 'utf8').toString('base64url').slice(0, 1500);
}

/**
 * MERGE (upsert + UNION) a set of assets into the durable workspace asset store. Never drops an
 * existing asset — assets are only ever removed explicitly (a file the user deleted flows through
 * the text-file delete path, not here). Best-effort — never throws.
 */
export async function saveWorkspaceAssets(workspaceId: string, assets: Record<string, string>): Promise<void> {
  const db = getDb();
  if (!db) return;
  const entries = Object.entries(assets || {}).filter(([, c]) => typeof c === 'string' && Buffer.byteLength(c, 'utf8') <= MAX_ASSET_BYTES);
  if (entries.length === 0) return;
  try {
    const root = db.collection(COLLECTION).doc(workspaceId);
    const assetsCol = root.collection('assets');
    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = db.batch();
      for (const [path, dataUri] of entries.slice(i, i + BATCH)) {
        batch.set(assetsCol.doc(assetDocId(path)), { path, dataUri });
      }
      await batch.commit();
    }
    const meta = await root.get();
    const existing: string[] = meta.exists && Array.isArray(meta.data()?.paths) ? meta.data()!.paths : [];
    const union = Array.from(new Set([...existing, ...entries.map(([p]) => p)]));
    await root.set({ paths: union, count: union.length, savedAt: Date.now() }, { merge: true });
  } catch (e) {
    notePersistenceFailure('workspace_assets', 'write', e);
  }
}

/**
 * Load the durable assets for a workspace as { path: dataUri }. Returns {} when absent. Only paths
 * in the authoritative metadata list are returned. Never throws.
 */
export async function loadWorkspaceAssets(workspaceId: string): Promise<Record<string, string>> {
  const db = getDb();
  if (!db) return {};
  try {
    const root = db.collection(COLLECTION).doc(workspaceId);
    const meta = await root.get();
    if (!meta.exists) return {};
    const paths: string[] = Array.isArray(meta.data()?.paths) ? meta.data()!.paths : [];
    if (paths.length === 0) return {};
    const allowed = new Set(paths);
    const docs = await root.collection('assets').get();
    const out: Record<string, string> = {};
    for (const d of docs.docs) {
      const data = d.data();
      if (typeof data.path === 'string' && typeof data.dataUri === 'string' && allowed.has(data.path)) {
        out[data.path] = data.dataUri;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** The minimal actuator slice needed to write an asset's raw bytes into the sandbox. */
export interface BinaryFileSink {
  writeBinaryFile(workspaceId: string, filePath: string, base64: string): Promise<void>;
}

/**
 * Materialize `data:` assets into a sandbox as REAL bytes via the actuator's writeBinaryFile.
 * Bounded + best-effort: a single asset failing to write never blocks the rest (or the build).
 * Returns the number of assets actually written. Pure over the injected sink + asset map so it is
 * unit-testable without Firestore or a real sandbox.
 */
export async function materializeAssets(
  sink: BinaryFileSink,
  workspaceId: string,
  assets: Record<string, string>,
): Promise<number> {
  let written = 0;
  for (const [path, dataUri] of Object.entries(assets || {})) {
    const parsed = parseDataUri(dataUri);
    if (!parsed) continue;
    try {
      await sink.writeBinaryFile(workspaceId, path, parsed.base64);
      written++;
    } catch { /* one asset failing never blocks the rest — the app still runs, image just 404s */ }
  }
  return written;
}

/**
 * Load a workspace's durable assets and write them into its (fresh/cold) sandbox as real bytes.
 * The single call every restore path uses. Returns the count written; 0 when there are none.
 * Never throws.
 */
export async function restoreWorkspaceAssets(sink: BinaryFileSink, workspaceId: string): Promise<number> {
  try {
    const assets = await loadWorkspaceAssets(workspaceId);
    if (Object.keys(assets).length === 0) return 0;
    return await materializeAssets(sink, workspaceId, assets);
  } catch {
    return 0;
  }
}
