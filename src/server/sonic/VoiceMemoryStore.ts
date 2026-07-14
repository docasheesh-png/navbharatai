/**
 * Cross-session voice conversation memory for NavBharatAI Voice (admin 2026-07-14: "co-founder
 * memory" — the professional voice remembers you across calls, even from a different device).
 *
 * Stores a bounded rolling list of recent conversation turns per (user, professional), so a later
 * voice call can resume where the last one left off. Best-effort by design: if Firestore is
 * unavailable (or under test) every method degrades to a no-op / empty — memory never blocks or
 * breaks a live call. Only trimmed {role, content} text is stored; no audio, ever.
 *
 * Collection: `sonic_voice_memory` (doc id = memoryKey(userId, professionalId))
 * Pattern: VITEST-skip, best-effort, admin SDK — mirrors UserProfileStore.
 */
import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';
import type { SonicTurn } from './SonicBridge';
import { appendMemory, memoryKey } from './voiceMemory';

const COLLECTION = 'sonic_voice_memory';
const MEMORY_CAP = 30; // keep only the most recent 30 turns per (user, professional)

interface MemoryDoc {
  userId: string;
  professionalId: string;
  turns: SonicTurn[];
  updatedAt: number;
  createdAt: number;
}

class VoiceMemoryStore {
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

  /** The remembered turns for this user + professional (most recent last). Empty when none/unavailable. */
  async load(userId: string, professionalId?: string): Promise<SonicTurn[]> {
    const db = this.getDb();
    if (!db || !userId) return [];
    try {
      const snap = await db.collection(COLLECTION).doc(memoryKey(userId, professionalId)).get();
      if (!snap.exists) return [];
      const data = snap.data() as MemoryDoc | undefined;
      return Array.isArray(data?.turns) ? data!.turns : [];
    } catch {
      return [];
    }
  }

  /** Fold the turns spoken in this session into the stored rolling memory (append, dedup, cap). */
  async append(userId: string, professionalId: string | undefined, fresh: SonicTurn[]): Promise<void> {
    const db = this.getDb();
    if (!db || !userId || !fresh || fresh.length === 0) return;
    const now = Date.now();
    const ref = db.collection(COLLECTION).doc(memoryKey(userId, professionalId));
    try {
      const snap = await ref.get();
      const existing = snap.exists ? ((snap.data() as MemoryDoc | undefined)?.turns ?? []) : [];
      const turns = appendMemory(existing, fresh, MEMORY_CAP);
      if (snap.exists) {
        await ref.update({ turns, updatedAt: now });
      } else {
        await ref.set({ userId, professionalId: professionalId || 'default', turns, updatedAt: now, createdAt: now });
      }
    } catch { /* best-effort — memory must never break a call */ }
  }
}

export const voiceMemoryStore = new VoiceMemoryStore();
