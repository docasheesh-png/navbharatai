/**
 * User profile data store.
 *
 * Stores display name, bio, phone number, and photo URL (not binary data —
 * only a URL string so there is no Firebase Storage cost). Budget limits are
 * persisted here so they survive browser clears.
 *
 * Collection: `user_profiles`
 * Pattern: VITEST-skip, best-effort, admin SDK — mirrors UserCostStore.
 */
import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';

export interface UserProfile {
  userId: string;
  displayName: string;
  bio: string;
  phone: string;
  /** URL of the user's avatar — Google/GitHub photo URL or a manually pasted URL. */
  photoUrl: string;
  /** Monthly spend budget in INR. 0 = no limit set. */
  budgetLimitInr: number;
  updatedAt: number;
  createdAt: number;
}

export type ProfileUpdate = Partial<Pick<UserProfile, 'displayName' | 'bio' | 'phone' | 'photoUrl' | 'budgetLimitInr'>>;

class UserProfileStore {
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

  async get(userId: string): Promise<UserProfile | null> {
    const db = this.getDb();
    if (!db || !userId) return null;
    try {
      const snap = await db.collection('user_profiles').doc(userId).get();
      if (!snap.exists) return null;
      return snap.data() as UserProfile;
    } catch {
      return null;
    }
  }

  /** Create or update profile fields. Only supplied fields are changed. */
  async update(userId: string, fields: ProfileUpdate): Promise<void> {
    const db = this.getDb();
    if (!db || !userId) return;
    const now = Date.now();
    try {
      const ref = db.collection('user_profiles').doc(userId);
      const snap = await ref.get();
      if (snap.exists) {
        await ref.update({ ...fields, updatedAt: now });
      } else {
        const defaults: UserProfile = {
          userId,
          displayName: '',
          bio: '',
          phone: '',
          photoUrl: '',
          budgetLimitInr: 0,
          updatedAt: now,
          createdAt: now,
        };
        await ref.set({ ...defaults, ...fields, updatedAt: now, createdAt: now });
      }
    } catch { /* best-effort */ }
  }
}

export const userProfileStore = new UserProfileStore();
