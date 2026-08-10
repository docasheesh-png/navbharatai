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
import { getServerDb } from '../lib/serverDb';
import { pool } from './WorkspaceFiles';

/**
 * How many asset writes may be in flight at once.
 *
 * Matches the sandbox-write concurrency used for source files: the constraint is identical (network
 * round-trips to the same sandbox), so a second, different number here would be an accident rather
 * than a decision. Env-overridable for the same reason it is there — the true optimum depends on
 * E2B's limits and wants measurement; what is certain is that 1 is wrong.
 */
const ASSET_WRITE_CONCURRENCY = Math.max(1, Math.min(32, Number(process.env.AGENTV3_ASSET_WRITE_CONCURRENCY) || 16));
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
    // Collision-free shared admin handle (getFirestore(app, dbId)) — no per-store .settings() race.
    _db = getServerDb();
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
  // ROOT CAUSE, measured (mitrify autopsy 2026-08-04, build cb03bdde): this awaited ONE
  // writeBinaryFile at a time. Every write is a NETWORK round-trip to the E2B sandbox, so an import
  // carrying 129 assets + 22 large images cost ~151 sequential round-trips — 100 SECONDS of the
  // 624-second build, spent doing nothing but waiting. The report shows it exactly: files landed at
  // 22s, and the import did not report success until 122s.
  //
  // This is the FOURTH instance of one bug class in this repo — serial awaits over a network — after
  // the sandbox landing (648s incident), the Firestore merge, and collectWorkspaceFiles (the
  // 13-minute per-turn stall). Same fix, same shared helper, so the class is closed here rather than
  // patched again: writes are latency-bound and independent, so concurrency is the entire win.
  //
  // Ordering between independent asset writes carries no meaning, and a failure is still per-asset
  // (one broken image must never block the rest), so this is safe by construction.
  const entries: Array<{ path: string; base64: string }> = [];
  for (const [path, dataUri] of Object.entries(assets || {})) {
    const parsed = parseDataUri(dataUri);
    if (parsed) entries.push({ path, base64: parsed.base64 });
  }

  let written = 0;
  await pool(entries, ASSET_WRITE_CONCURRENCY, async (e) => {
    try {
      await sink.writeBinaryFile(workspaceId, e.path, e.base64);
      written++;
    } catch { /* one asset failing never blocks the rest — the app still runs, image just 404s */ }
  });
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
