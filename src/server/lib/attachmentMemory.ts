// A FILE SENT IN THIS CHAT IS STILL HERE ON THE NEXT MESSAGE — and never in any other chat (admin
// 2026-10-03, Q-201: "han, par memory leak na ho, ek chat ki baat dusre chat me na jaye!!").
//
// 🔴 WHY (autopsy a4be7fa2). The user sent a sheet of lottery results, then asked "check the draws in the
// first data table". The extracted text of an attachment lived only for the turn it came with, so the build
// looked for "the data table", found nothing, and could only ask for it again.
//
// 🔒 WHAT IS KEPT, AND THE FOUR LIMITS THAT ARE THE WHOLE DESIGN:
//  1. ONE CHAT. The key is the workspace id, which is the conversation id (#837) and carries the account's
//     uid; the record also stores the uid and a read with any other uid returns nothing. There is no
//     per-user index and no "recent files" list, so another chat has no way to ask for it.
//  2. DOCUMENTS ONLY, MASKED. The text of attached documents after `redactPII` (Aadhaar, PAN, phone, email,
//     IFSC are already masked before it is kept). Never picture bytes and never a photo's description.
//  3. SMALL AND SHORT-LIVED. At most `ATTACHMENT_MEMORY_MAX_BYTES` (50 KB) and `ATTACHMENT_MEMORY_TTL_MS`
//     (30 days); an older record is deleted on read. Only the LATEST attachment is kept: a new file replaces
//     the old one.
//  4. HANDED BACK ONLY WHEN THE CHAT ASKS FOR IT (`shouldRecallAttachment`): a later message with no file of
//     its own that talks about the data or the file, or a "yes" to an offer that was made about it. An
//     ordinary message in the same chat never carries it.
// Deleting the chat deletes it (`purgeWorkspace`), and unsending a message deletes it.
//
// Collection `agentv3_attachment_memory`, one document per workspace. Firestore in production; an
// in-process map in tests and local dev (the same "VITEST ⇒ no Firestore" rule every store here follows).

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';

const COLLECTION = 'agentv3_attachment_memory';

/** The most attachment text one chat keeps, in UTF-8 bytes. */
export const ATTACHMENT_MEMORY_MAX_BYTES = 50 * 1024;
/** How long it is kept. */
export const ATTACHMENT_MEMORY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface AttachmentMemoryRecord {
  uid: string;
  workspaceId: string;
  /** The masked document text, at most `ATTACHMENT_MEMORY_MAX_BYTES`. */
  text: string;
  /** The attached files' names, for the one line that tells the user which file is being used. */
  names: string[];
  savedAt: number;
  /** True when `text` was cut to fit. */
  truncated: boolean;
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

const memory = new Map<string, AttachmentMemoryRecord>();
const MEMORY_CAP = 500;

/** Cut `text` to at most `maxBytes` UTF-8 bytes without splitting a character. PURE. */
export function clampUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const s = String(text ?? '');
  if (Buffer.byteLength(s, 'utf8') <= maxBytes) return { text: s, truncated: false };
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (Buffer.byteLength(s.slice(0, mid), 'utf8') <= maxBytes) lo = mid; else hi = mid - 1;
  }
  let cut = s.slice(0, lo);
  // Never end on half of a surrogate pair.
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return { text: cut, truncated: true };
}

/** `AGENTV3_ATTACHMENT_MEMORY=off` keeps nothing and recalls nothing. Default ON. */
export function attachmentMemoryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_ATTACHMENT_MEMORY ?? '').trim().toLowerCase() !== 'off';
}

/** A uid this store will key on: a real account, never the anonymous bucket. PURE. */
export function rememberableUid(uid: unknown): uid is string {
  return typeof uid === 'string' && uid.length > 0 && uid !== 'anon' && !uid.startsWith('anon-');
}

/** Keep the latest attachment of this chat. Nothing is kept for an anonymous caller or an empty text. */
export async function saveAttachmentMemory(input: {
  uid: string;
  workspaceId: string;
  text: string;
  names: string[];
  now?: number;
}): Promise<boolean> {
  if (!rememberableUid(input.uid) || !input.workspaceId) return false;
  const trimmed = String(input.text ?? '').trim();
  if (!trimmed) return false;
  const { text, truncated } = clampUtf8(trimmed, ATTACHMENT_MEMORY_MAX_BYTES);
  const rec: AttachmentMemoryRecord = {
    uid: input.uid,
    workspaceId: input.workspaceId,
    text,
    names: (input.names ?? []).map((n) => String(n).slice(0, 200)).slice(0, 10),
    savedAt: input.now ?? Date.now(),
    truncated,
  };
  const db = getDb();
  if (!db) {
    memory.set(rec.workspaceId, rec);
    if (memory.size > MEMORY_CAP) memory.delete(memory.keys().next().value as string);
    return true;
  }
  await db.collection(COLLECTION).doc(rec.workspaceId).set(rec);
  return true;
}

/**
 * This chat's kept attachment, or null. Null for another account's uid, and for a record past its 30 days —
 * which is deleted on the way out.
 */
export async function loadAttachmentMemory(uid: string, workspaceId: string, now: number = Date.now()): Promise<AttachmentMemoryRecord | null> {
  if (!rememberableUid(uid) || !workspaceId) return null;
  const db = getDb();
  let rec: AttachmentMemoryRecord | null = null;
  if (!db) {
    rec = memory.get(workspaceId) ?? null;
  } else {
    const snap = await db.collection(COLLECTION).doc(workspaceId).get();
    if (snap.exists) {
      const d = snap.data() as Record<string, unknown>;
      rec = {
        uid: String(d.uid ?? ''),
        workspaceId,
        text: String(d.text ?? ''),
        names: Array.isArray(d.names) ? d.names.map(String) : [],
        savedAt: typeof d.savedAt === 'number' ? d.savedAt : 0,
        truncated: d.truncated === true,
      };
    }
  }
  if (!rec) return null;
  if (rec.uid !== uid || rec.workspaceId !== workspaceId) return null;
  if (now - rec.savedAt > ATTACHMENT_MEMORY_TTL_MS) {
    await deleteAttachmentMemory(workspaceId).catch(() => {});
    return null;
  }
  return rec.text ? rec : null;
}

/** Forget this chat's attachment (chat deleted, message unsent). */
export async function deleteAttachmentMemory(workspaceId: string): Promise<void> {
  if (!workspaceId) return;
  const db = getDb();
  if (!db) { memory.delete(workspaceId); return; }
  await db.collection(COLLECTION).doc(workspaceId).delete();
}

/** Words that point at a file or data sent earlier, in the languages users write to us in. */
const REFERS_TO_ATTACHMENT =
  /\b(?:data|dataset|datasheet|file|files|table|tables|sheet|sheets|spreadsheet|excel|xlsx|xls|csv|pdf|attachment|attached|document|documents|doc|docx|upload|uploaded|rows|columns|records|entries)\b|डेटा|डाटा|फाइल|फ़ाइल|शीट|टेबल|तालिका|सूची|డేటా|ఫైల్|పట్టిక|டேட்டா|தரவு|கோப்பு|অ্যাটাচ|ডেটা|ফাইল|ડેટા|ફાઇલ/i;

/** Does this message talk about the data or a file? PURE. */
export function refersToEarlierAttachment(message: string): boolean {
  return REFERS_TO_ATTACHMENT.test(String(message ?? ''));
}

/**
 * Should this turn be handed the chat's kept attachment? Only when it brought no file of its own, and it
 * either talks about the data/file or says yes to an offer made in this chat. PURE.
 */
export function shouldRecallAttachment(input: { message: string; hasAttachmentNow: boolean; offerAccepted: boolean }): boolean {
  if (input.hasAttachmentNow) return false;
  return input.offerAccepted || refersToEarlierAttachment(input.message);
}

/** Tests only. */
export function _resetAttachmentMemory(): void {
  memory.clear();
}
