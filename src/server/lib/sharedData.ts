// Shared database + data API — the cheap product.
//
// A private Supabase project is a whole database we pay for even when it is idle. A new virtual
// machine is the same shape of bill. This product is neither: it is a namespace on the Firestore
// the platform already runs, and an API on the server the platform already runs. The user's price
// has to stay above that marginal cost, so the number of operations is capped and the API stops
// at the cap. Stopping is free for us. We do not sell a pack of extra operations, and we do not
// keep serving past the cap.
//
// The key is a public key for one app. It is stored only as a hash. The raw key is handed to the
// app's secret vault once, never written into the source file.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const SHARED_DATA_OPS_CAP = 20_000;
export const SHARED_DATA_MAX_DOCS = 2_000;
export const SHARED_DATA_MAX_BYTES = 8_000;
export const SHARED_DATA_MAX_LIST = 20;
export const SHARED_DATA_SHARDS = 8;
/** A create that has not been marked ready within this long may be replaced. A ready database may not. */
export const SHARED_DATA_START_LOCK_MS = 10 * 60 * 1000;

export const SHARED_COLLECTION_RE = /^[a-z][a-z0-9]{0,31}$/;
export const SHARED_RECORD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export type SharedScalar = string | number | boolean | null | SharedScalar[];

export interface SharedMeta {
  workspaceId: string;
  ownerUid: string;
  keyHash: string;
  publicRef: string;
  expiresAt: string;
  updatedAt: string;
  /** False while create / charge / save is still in flight. A ready database is not replaced. */
  ready: boolean;
  docCount: number;
}

export interface SharedRecord {
  collection: string;
  id: string;
  data: Record<string, SharedScalar>;
  updatedAt: string;
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(String(key)).digest('hex');
}

export function newApiKey(): string {
  return `nb_${randomBytes(32).toString('base64url')}`;
}

/** Stable id for the wallet proof. Not the key. */
export function publicRefFor(workspaceId: string): string {
  return `sd${createHash('sha256').update(workspaceId).digest('hex').slice(0, 16)}`;
}

export function newRecordId(): string {
  return `r${randomBytes(8).toString('hex')}`;
}

export function keysMatch(storedHash: string, givenHash: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(storedHash) || !/^[a-f0-9]{64}$/.test(givenHash)) return false;
  const a = Buffer.from(storedHash, 'hex');
  const b = Buffer.from(givenHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

function cleanValue(v: unknown, depth: number): { ok: true; value: SharedScalar } | { ok: false; error: string } {
  if (v === null) return { ok: true, value: null };
  if (typeof v === 'boolean') return { ok: true, value: v };
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return { ok: false, error: 'A number is not allowed. Nothing was saved.' };
    return { ok: true, value: v };
  }
  if (typeof v === 'string') {
    if (v.length > 2000) return { ok: false, error: 'A text field is too long. Nothing was saved.' };
    return { ok: true, value: v };
  }
  if (Array.isArray(v)) {
    if (depth > 0) return { ok: false, error: 'Nested lists are not stored. Nothing was saved.' };
    if (v.length > 20) return { ok: false, error: 'A list is too long. Nothing was saved.' };
    const out: SharedScalar[] = [];
    for (const item of v) {
      if (item !== null && typeof item === 'object') {
        return { ok: false, error: 'Nested objects are not stored. Nothing was saved.' };
      }
      const child = cleanValue(item, 1);
      if (!child.ok) return child;
      out.push(child.value);
    }
    return { ok: true, value: out };
  }
  return { ok: false, error: 'Nested objects are not stored. Nothing was saved.' };
}

export function sanitizeRecord(body: unknown): { ok: true; data: Record<string, SharedScalar> } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Send a JSON object. Nothing was saved.' };
  }
  const src = body as Record<string, unknown>;
  const keys = Object.keys(src);
  if (keys.length > 40) return { ok: false, error: 'Too many fields. Nothing was saved.' };
  const data: Record<string, SharedScalar> = {};
  for (const key of keys) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(key)) {
      return { ok: false, error: 'A field name is not allowed. Nothing was saved.' };
    }
    const cleaned = cleanValue(src[key], 0);
    if (!cleaned.ok) return cleaned;
    data[key] = cleaned.value;
  }
  if (Buffer.byteLength(JSON.stringify(data), 'utf8') > SHARED_DATA_MAX_BYTES) {
    return { ok: false, error: 'That record is too big. Nothing was saved.' };
  }
  return { ok: true, data };
}

export interface DecideInput {
  meta: SharedMeta | null;
  opsCount: number;
  nowMs: number;
  keyHash: string;
  op: 'list' | 'get' | 'create' | 'replace' | 'delete';
  collection: string;
  id: string | null;
  record: SharedRecord | null;
  /** How many documents this list will return. A list costs one operation per document, at least one. */
  listCount: number;
  data: Record<string, SharedScalar> | null;
}

export interface DecideResult {
  status: number;
  body: Record<string, unknown>;
  opsAdd: number;
  /** Null means the stored document count does not change. */
  docCount: number | null;
  /** Undefined means the record is not written. Null means it is deleted. */
  saveRecord: SharedRecord | null | undefined;
}

const DUMMY_HASH = hashApiKey('nbai-no-such-database');

/** Reject a missing, wrong, or expired key before any record is read. */
export function gateSharedCall(
  meta: SharedMeta | null,
  keyHash: string,
  nowMs: number,
): { ok: true } | { ok: false; status: number; error: string } {
  const presented = /^[a-f0-9]{64}$/.test(keyHash) ? keyHash : DUMMY_HASH;
  keysMatch(meta?.keyHash || DUMMY_HASH, presented);
  if (!meta) return { ok: false, status: 404, error: 'No database is switched on for this app. Nothing was changed.' };
  if (!keysMatch(meta.keyHash, presented)) {
    return { ok: false, status: 401, error: 'That key does not match this app. Nothing was changed.' };
  }
  const exp = Date.parse(meta.expiresAt);
  if (!meta.ready || !Number.isFinite(exp) || exp <= nowMs) {
    return { ok: false, status: 402, error: 'This database period has ended. Nothing more was charged. Start it again from Publish, or connect your own database, which stays free.' };
  }
  return { ok: true };
}

function refused(status: number, error: string): DecideResult {
  return { status, body: { ok: false, error }, opsAdd: 0, docCount: null, saveRecord: undefined };
}

/**
 * Whether this call may touch the database, and what it would write.
 * Pure. The store applies the result inside one transaction so two callers cannot both pass the cap.
 */
export function decideDataOp(input: DecideInput): DecideResult {
  if (!SHARED_COLLECTION_RE.test(input.collection)) {
    return refused(400, 'That collection name is not allowed. Nothing was changed.');
  }
  if ((input.op === 'get' || input.op === 'replace' || input.op === 'delete') && !SHARED_RECORD_ID_RE.test(input.id || '')) {
    return refused(400, 'That record id is not allowed. Nothing was changed.');
  }
  // Compare even when there is no database, so the missing and the wrong-key cases take the same hash work.
  const presented = /^[a-f0-9]{64}$/.test(input.keyHash) ? input.keyHash : DUMMY_HASH;
  keysMatch(input.meta?.keyHash || DUMMY_HASH, presented);
  if (!input.meta) return refused(404, 'No database is switched on for this app. Nothing was changed.');
  if (!keysMatch(input.meta.keyHash, presented)) {
    return refused(401, 'That key does not match this app. Nothing was changed.');
  }
  const exp = Date.parse(input.meta.expiresAt);
  if (!input.meta.ready || !Number.isFinite(exp) || exp <= input.nowMs) {
    return refused(402, 'This database period has ended. Nothing more was charged. Start it again from Publish, or connect your own database, which stays free.');
  }
  const cost = input.op === 'list' ? Math.max(1, input.listCount) : 1;
  if (input.opsCount + cost > SHARED_DATA_OPS_CAP) {
    return refused(429, 'This database has used the operations included in these 30 days. It will not take more, and nothing extra was charged.');
  }
  if (input.op === 'list') {
    return { status: 200, body: { ok: true }, opsAdd: cost, docCount: null, saveRecord: undefined };
  }
  if (input.op === 'get') {
    if (!input.record) return refused(404, 'That record was not found.');
    return {
      status: 200,
      body: { ok: true, id: input.record.id, record: input.record.data },
      opsAdd: 1,
      docCount: null,
      saveRecord: undefined,
    };
  }
  if (input.op === 'delete') {
    if (!input.record) return refused(404, 'That record was not found. Nothing was changed.');
    return {
      status: 200,
      body: { ok: true },
      opsAdd: 1,
      docCount: Math.max(0, input.meta.docCount - 1),
      saveRecord: null,
    };
  }
  if (input.op === 'replace' && !input.record) {
    return refused(404, 'That record was not found. Nothing was saved.');
  }
  if (!input.data) return refused(400, 'Send a JSON object. Nothing was saved.');
  const exists = input.record !== null;
  if (!exists && input.meta.docCount >= SHARED_DATA_MAX_DOCS) {
    return refused(409, 'This database is full. Nothing was saved and nothing extra was charged. Remove a record, or use your own database.');
  }
  const id = input.op === 'create' ? (input.id && SHARED_RECORD_ID_RE.test(input.id) ? input.id : newRecordId()) : (input.id as string);
  if (!SHARED_RECORD_ID_RE.test(id)) return refused(400, 'That record id is not allowed. Nothing was saved.');
  const record: SharedRecord = {
    collection: input.collection,
    id,
    data: input.data,
    updatedAt: new Date(input.nowMs).toISOString(),
  };
  return {
    status: 200,
    body: { ok: true, id },
    opsAdd: 1,
    docCount: exists ? input.meta.docCount : input.meta.docCount + 1,
    saveRecord: record,
  };
}

/** The file written into the app. It has no key in it. The key stays in the secret vault.
 *  The source lives in src/lib so the published-app caller is visible outside the server.
 */
export { dataClientSource } from '../../lib/nbaiDataClient';
