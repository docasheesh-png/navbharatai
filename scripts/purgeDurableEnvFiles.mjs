/**
 * Remove live env files from the durable workspace store (TD-1).
 *
 * DRY-RUN by default. Never prints file content.
 *
 *   node scripts/purgeDurableEnvFiles.mjs --project <gcpProjectId>
 *
 * Write mode needs BOTH --apply and NBAI_PURGE_APPROVED=owner-approved-YYYY-MM-DD.
 * Without both, this exits 2 and writes nothing. Do not run write mode until the
 * owner has read the dry-run output (D-3).
 */

import { Buffer } from 'node:buffer';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ENV_ALLOWED = /^\.env\.(example|sample|template)$/i;
const COLLECTION = 'workspace_files_v3';

/** Keep in sync with src/server/lib/workspacePath.ts isSecretEnvPath. */
export function isSecretEnvPath(relPath) {
  const base = String(relPath ?? '').split('/').pop() ?? '';
  return (base === '.env' || base.startsWith('.env.')) && !ENV_ALLOWED.test(base);
}

/** Keep in sync with WorkspaceFileStore.fileDocId. */
export function fileDocId(p) {
  return Buffer.from(p, 'utf8').toString('base64url').slice(0, 1500);
}

export function approvalOk(envValue) {
  return typeof envValue === 'string' && /^owner-approved-\d{4}-\d{2}-\d{2}$/.test(envValue);
}

/**
 * @param {Array<{ id: string, paths?: string[], sizes?: Record<string, number> }>} docs
 * @returns {Array<{ workspaceId: string, path: string, contentBytes: number, fileDocId: string }>}
 */
export function planPurge(docs) {
  const actions = [];
  for (const doc of docs || []) {
    const paths = Array.isArray(doc.paths) ? doc.paths : [];
    for (const path of paths) {
      if (typeof path !== 'string' || !isSecretEnvPath(path)) continue;
      const contentBytes = doc.sizes && typeof doc.sizes[path] === 'number' ? doc.sizes[path] : 0;
      actions.push({ workspaceId: doc.id, path, contentBytes, fileDocId: fileDocId(path) });
    }
  }
  return actions;
}

/**
 * @param {{ projectId: string, apply: boolean, env: NodeJS.ProcessEnv, db: { pageWorkspaceDocs: Function, applyRemoval?: Function }, log?: Function, writeReport?: Function }} opts
 */
export async function runPurge({ projectId, apply, env, db, log = console.log, writeReport }) {
  if (!projectId) {
    log('Missing --project <gcpProjectId>.');
    return 2;
  }
  if (apply && !approvalOk(env?.NBAI_PURGE_APPROVED)) {
    log('Refusing to write. Pass --apply AND set NBAI_PURGE_APPROVED=owner-approved-YYYY-MM-DD. Nothing was changed.');
    return 2;
  }
  const docs = [];
  let cursor;
  for (;;) {
    const page = await db.pageWorkspaceDocs({ limit: 300, startAfter: cursor });
    const batch = Array.isArray(page?.docs) ? page.docs : [];
    docs.push(...batch);
    if (!page?.next) break;
    cursor = page.next;
  }
  const actions = planPurge(docs);
  let bytes = 0;
  for (const a of actions) {
    log(`${a.workspaceId}\t${a.path}\t${a.contentBytes}`);
    bytes += a.contentBytes;
  }
  const workspaces = new Set(actions.map((a) => a.workspaceId)).size;
  log(`totals\tworkspaces\t${workspaces}\tfiles\t${actions.length}\tbytes\t${bytes}`);
  if (!apply) return 0;
  const report = [];
  for (const a of actions) {
    if (typeof db.applyRemoval !== 'function') {
      log('Write mode has no applyRemoval. Nothing was changed.');
      return 2;
    }
    await db.applyRemoval(a);
    report.push({ workspaceId: a.workspaceId, path: a.path, contentBytes: a.contentBytes });
  }
  const name = `purge-report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  if (writeReport) await writeReport(name, report);
  else writeFileSync(name, JSON.stringify({ actions: report }, null, 2));
  log(`wrote ${name}`);
  return 0;
}

export function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const i = argv.indexOf('--project');
  const projectId = i >= 0 ? String(argv[i + 1] ?? '') : '';
  return { apply, projectId };
}

async function openFirestore(projectId) {
  const mod = await import('firebase-admin');
  const admin = mod.default && typeof mod.default.initializeApp === 'function' ? mod.default : mod;
  if (!admin.apps || admin.apps.length === 0) {
    admin.initializeApp({ projectId });
  }
  const firestore = admin.firestore();
  const FieldPath = admin.firestore.FieldPath;
  return {
    async pageWorkspaceDocs({ limit, startAfter }) {
      let q = firestore.collection(COLLECTION).orderBy(FieldPath.documentId()).limit(limit);
      if (startAfter) q = q.startAfter(startAfter);
      const snap = await q.get();
      if (snap.empty) return { docs: [], next: null };
      const docs = [];
      for (const d of snap.docs) {
        const data = d.data() || {};
        const paths = Array.isArray(data.paths) ? data.paths : [];
        const sizes = {};
        for (const p of paths) {
          if (typeof p !== 'string' || !isSecretEnvPath(p)) continue;
          const file = await d.ref.collection('files').doc(fileDocId(p)).get();
          const content = file.exists ? file.get('content') : '';
          sizes[p] = typeof content === 'string' ? Buffer.byteLength(content, 'utf8') : 0;
        }
        docs.push({ id: d.id, paths, sizes });
      }
      const next = snap.size < limit ? null : snap.docs[snap.docs.length - 1];
      return { docs, next };
    },
    async applyRemoval(action) {
      const root = firestore.collection(COLLECTION).doc(action.workspaceId);
      await firestore.runTransaction(async (tx) => {
        const snap = await tx.get(root);
        const paths = Array.isArray(snap.get('paths')) ? snap.get('paths').slice() : [];
        const remaining = paths.filter((p) => p !== action.path);
        tx.set(root, { paths: remaining, count: remaining.length }, { merge: true });
        tx.delete(root.collection('files').doc(action.fileDocId || fileDocId(action.path)));
      });
    },
  };
}

export async function cli(argv, env, deps = {}) {
  const { apply, projectId } = parseArgs(argv);
  const db = deps.db ?? await openFirestore(projectId);
  return runPurge({
    projectId,
    apply,
    env,
    db,
    log: deps.log,
    writeReport: deps.writeReport,
  });
}

function isDirectRun() {
  const entry = process.argv[1];
  return !!entry && import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  cli(process.argv, process.env).then((code) => process.exit(code));
}
