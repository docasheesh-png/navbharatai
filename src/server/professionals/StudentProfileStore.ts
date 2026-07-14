/**
 * Persistent per-user student profiles for professionals with `memory: 'student_profile'`
 * (Teacher AI). The teacher takes a real introduction on day one and remembers the student
 * across sessions and devices (admin 2026-07-14).
 *
 * Best-effort by design: if Firestore is unavailable (or under test) every method degrades
 * to null / no-op — memory must never block or break a chat turn.
 *
 * Collection: `professional_student_profiles` (doc id = profileKey(userId, professionalId))
 * Pattern: VITEST-skip, best-effort, admin SDK — mirrors VoiceMemoryStore / UserProfileStore.
 */
import * as admin from 'firebase-admin';
import { getServerDb } from '../lib/serverDb';
import { profileKey, type StudentProfile } from './studentProfile';

const COLLECTION = 'professional_student_profiles';

interface ProfileDoc {
  userId: string;
  professionalId: string;
  profile: StudentProfile;
  updatedAt: number;
  createdAt: number;
}

class StudentProfileStore {
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

  /** The remembered profile for this user + professional. Null when none/unavailable. */
  async load(userId: string, professionalId: string): Promise<StudentProfile | null> {
    const db = this.getDb();
    if (!db || !userId) return null;
    try {
      const snap = await db.collection(COLLECTION).doc(profileKey(userId, professionalId)).get();
      if (!snap.exists) return null;
      const data = snap.data() as ProfileDoc | undefined;
      return data?.profile && typeof data.profile === 'object' ? data.profile : null;
    } catch {
      return null;
    }
  }

  /** Persist the (already merged + bounded) profile. Best-effort — never throws. */
  async save(userId: string, professionalId: string, profile: StudentProfile): Promise<void> {
    const db = this.getDb();
    if (!db || !userId) return;
    const now = Date.now();
    const ref = db.collection(COLLECTION).doc(profileKey(userId, professionalId));
    try {
      const snap = await ref.get();
      if (snap.exists) {
        await ref.update({ profile, updatedAt: now });
      } else {
        await ref.set({ userId, professionalId, profile, updatedAt: now, createdAt: now });
      }
    } catch { /* best-effort — memory must never break a chat turn */ }
  }
}

export const studentProfileStore = new StudentProfileStore();
