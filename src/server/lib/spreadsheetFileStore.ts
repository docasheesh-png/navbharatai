// Where an engine-made spreadsheet waits for its Download button (see `spreadsheetFile.ts`).
//
// WHAT IS STORED: the clamped sheet DATA as one JSON string, never the .xlsx bytes. Both formats are
// written from it at download time, so one record serves "Download .xlsx" and every "Download .csv",
// and a fix to the writer reaches files made before it. JSON as a STRING because Firestore refuses
// nested arrays, and rows are arrays of arrays.
//
// WHO MAY READ IT: the account that asked for it. `uid` is written from the VERIFIED identity of the
// request that made it, and the download routes compare against it (`routes/spreadsheetFiles.ts`).
//
// Collection `agentv3_sheet_files`. Firestore in production; an in-process map when there is no
// database (tests, local dev) — the same "VITEST ⇒ no Firestore" rule every store here follows. A write
// failure is reported to the caller, which then answers without a button rather than offering a file
// that does not exist.

import * as admin from 'firebase-admin';
import { randomBytes } from 'crypto';
import { getServerDb } from './serverDb';
import type { SheetFileMeta, SheetSpec } from './spreadsheetFile';

const COLLECTION = 'agentv3_sheet_files';

export interface SpreadsheetFileRecord {
  id: string;
  uid: string;
  workspaceId: string;
  title: string;
  fileBase: string;
  sheets: SheetSpec[];
  meta: SheetFileMeta[];
  createdAt: number;
}

let _db: admin.firestore.Firestore | null = null;
function getDb(): admin.firestore.Firestore | null {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
  if (_db) return _db;
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    _db = getServerDb();
    return _db;
  } catch {
    return null;
  }
}

const memory = new Map<string, SpreadsheetFileRecord>();
const MEMORY_CAP = 500;

/** 24 hex characters: unguessable, and safe as a document id and in a URL path. */
export function newSpreadsheetFileId(): string {
  return randomBytes(12).toString('hex');
}

export function isSpreadsheetFileId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-f0-9]{24}$/.test(id);
}

export async function saveSpreadsheetFile(rec: SpreadsheetFileRecord): Promise<void> {
  const db = getDb();
  if (!db) {
    memory.set(rec.id, rec);
    if (memory.size > MEMORY_CAP) memory.delete(memory.keys().next().value as string);
    return;
  }
  await db.collection(COLLECTION).doc(rec.id).set({
    id: rec.id,
    uid: rec.uid,
    workspaceId: rec.workspaceId,
    title: rec.title,
    fileBase: rec.fileBase,
    sheetsJson: JSON.stringify(rec.sheets),
    meta: rec.meta,
    createdAt: rec.createdAt,
  });
}

export async function getSpreadsheetFile(id: string): Promise<SpreadsheetFileRecord | null> {
  if (!isSpreadsheetFileId(id)) return null;
  const db = getDb();
  if (!db) return memory.get(id) ?? null;
  const snap = await db.collection(COLLECTION).doc(id).get();
  if (!snap.exists) return null;
  const d = snap.data() as Record<string, unknown>;
  let sheets: SheetSpec[] = [];
  try { sheets = JSON.parse(String(d.sheetsJson ?? '[]')) as SheetSpec[]; } catch { return null; }
  if (!Array.isArray(sheets) || sheets.length === 0) return null;
  return {
    id,
    uid: String(d.uid ?? ''),
    workspaceId: String(d.workspaceId ?? ''),
    title: String(d.title ?? ''),
    fileBase: String(d.fileBase ?? 'navbharatai-sheet'),
    sheets,
    meta: Array.isArray(d.meta) ? (d.meta as SheetFileMeta[]) : [],
    createdAt: typeof d.createdAt === 'number' ? d.createdAt : 0,
  };
}

/** Tests only. */
export function _resetSpreadsheetFileMemory(): void {
  memory.clear();
}
