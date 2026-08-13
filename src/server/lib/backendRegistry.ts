/**
 * backendRegistry — the server-only Firestore record of every MANAGED backend app.
 *
 * One doc per app in `managed_backends/{serviceId}` (serviceId is already unique per uid+app by
 * construction — see serviceNameFor). This collection is SERVER-ONLY like payment_transactions:
 * Firestore rules must keep `allow read, write: if false` — it stores the app's DATABASE_URL and
 * SESSION_SECRET, which exist only server-side. The subdomain router reads it per request (cached),
 * the deploy routes write it, nothing client-side ever touches it.
 *
 * Registry state is BOOKKEEPING, not truth: the deploy phase is always re-derived from Cloud Build/
 * Cloud Run (advanceManagedDeploy) — the registry only remembers ids and the last known outcome, so
 * a stale doc can never fake a live app.
 */

import { doc, getDoc, setDoc, collection, query, where, limit, getDocs, getServerDb } from './serverDb';

export type ManagedAppState = 'deploying' | 'active' | 'suspended' | 'deleted';

export interface ManagedAppRecord {
  serviceId: string;
  uid: string;
  appId: string;
  subdomain: string;
  region: string;
  /** Cloud Run URL once first seen ready (the router's proxy target). */
  url: string | null;
  state: ManagedAppState;
  /** Last deploy attempt — the poll advances from these, reality decides the phase. */
  buildId: string | null;
  image: string | null;
  tag: string | null;
  lastDeployError: string | null;
  /** Managed database (Neon). The URI lives ONLY here (server-only doc) and in the Cloud Run env. */
  neonProjectId: string | null;
  dbConnectionUri: string | null;
  /** Per-app session secret, generated once so redeploys never invalidate user sessions. */
  sessionSecret: string;
  createdAt: string;
  updatedAt: string;
}

const COLLECTION = 'managed_backends';

export async function readManagedApp(serviceId: string): Promise<ManagedAppRecord | null> {
  const db = getServerDb();
  if (!db) return null;
  try {
    const snap = await getDoc(doc(db, COLLECTION, serviceId));
    return snap.exists() ? (snap.data() as ManagedAppRecord) : null;
  } catch {
    return null;
  }
}

/** Upsert (full-doc set) — callers pass the complete record; partial drift is not a thing here. */
export async function writeManagedApp(record: ManagedAppRecord): Promise<boolean> {
  const db = getServerDb();
  if (!db) return false;
  try {
    await setDoc(doc(db, COLLECTION, record.serviceId), { ...record, updatedAt: new Date().toISOString() });
    return true;
  } catch {
    return false;
  }
}

export async function findManagedAppBySubdomain(subdomain: string): Promise<ManagedAppRecord | null> {
  const db = getServerDb();
  if (!db) return null;
  try {
    const q = query(collection(db, COLLECTION), where('subdomain', '==', subdomain), limit(1));
    const snap = await getDocs(q);
    const first = snap.docs[0];
    return first ? (first.data() as ManagedAppRecord) : null;
  } catch {
    return null;
  }
}

/** All of one user's managed apps (dashboard listing). Bounded — the managed tier caps apps per user. */
export async function listManagedAppsForUser(uid: string, max = 20): Promise<ManagedAppRecord[]> {
  const db = getServerDb();
  if (!db) return [];
  try {
    const q = query(collection(db, COLLECTION), where('uid', '==', uid), limit(max));
    const snap = await getDocs(q);
    return snap.docs.map((d: any) => d.data() as ManagedAppRecord).filter((r: ManagedAppRecord) => r.state !== 'deleted');
  } catch {
    return [];
  }
}
