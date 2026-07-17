// Firestore persistence for semantic conversation memory (admin 2026-07-17).
//
// One document per (user, scope) — scope is the AI surface, e.g. a professional's id — holding a bounded
// array of embedded chunks. A single doc = ONE read on retrieve + ONE write on ingest (cheap, no
// subcollection fan-out), and the newest-`cap` pruning keeps it comfortably under Firestore's 1 MiB
// limit (quantized 768-float vectors × ~60 chunks ≈ well under the ceiling).
//
// Mirrors the EmbeddingStore/ProMemory pattern: firebase-admin, VITEST-skipped, best-effort, NEVER
// throws — a Firestore hiccup degrades memory to a no-op, it never breaks a chat.

import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';
import type { MemoryChunk } from './semanticMemory';
import { mergeChunks } from './semanticMemory';

const COLLECTION = 'conversation_memory_v1';

let _db: admin.firestore.Firestore | null = null;
function getDb(): admin.firestore.Firestore | null {
  if (process.env.VITEST) return null;
  if (_db) return _db;
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    _db = getServerDb();
    return _db;
  } catch {
    return null;
  }
}

/** Firestore-safe doc id for a (user, scope) pair. Pure. */
export function memoryDocId(userId: string, scope: string): string {
  const raw = `${userId}__${scope}`;
  return Buffer.from(raw, 'utf8').toString('base64url').slice(0, 1500);
}

/** Load a user's stored memory chunks for a scope (newest-first not guaranteed; caller scores them). Best-effort → []. */
export async function loadMemory(userId: string, scope: string): Promise<MemoryChunk[]> {
  if (!userId || !scope) return [];
  const db = getDb();
  if (!db) return [];
  try {
    const snap = await db.collection(COLLECTION).doc(memoryDocId(userId, scope)).get();
    const data = snap.exists ? snap.data() : null;
    const chunks = data?.chunks;
    if (!Array.isArray(chunks)) return [];
    return chunks.filter(
      (c: any) => c && typeof c.text === 'string' && Array.isArray(c.embedding) && (c.role === 'user' || c.role === 'assistant'),
    ) as MemoryChunk[];
  } catch {
    return [];
  }
}

/**
 * Append new chunks to a user's memory for a scope, dedupe + cap to the newest `cap`, and persist.
 * Read-modify-write on one doc; a rare concurrent-turn race can at worst drop a chunk (best-effort, fine).
 * Never throws.
 */
export async function appendMemory(userId: string, scope: string, incoming: MemoryChunk[], cap: number): Promise<void> {
  if (!userId || !scope || !Array.isArray(incoming) || incoming.length === 0) return;
  const db = getDb();
  if (!db) return;
  try {
    const ref = db.collection(COLLECTION).doc(memoryDocId(userId, scope));
    const snap = await ref.get();
    const existing = (snap.exists && Array.isArray(snap.data()?.chunks) ? snap.data()!.chunks : []) as MemoryChunk[];
    const merged = mergeChunks(existing, incoming, cap);
    await ref.set({ userId, scope, chunks: merged, updatedAt: Date.now() });
  } catch {
    /* best-effort — a failed write just means this turn isn't remembered semantically */
  }
}
