// 🗺️ THE USER'S MAP LIBRARY — the maps a person saved to reuse in another game (admin 2026-11-27, wave 2 part 2).
//
// WHAT IS STORED, per map: its name, its MAP PLAN (size, land, edge, water, roads, density, region, game type, time of day, and the SEED
// the world was built with — mapPlanData.ts) and its top-down preview grid (lib/mapPreview.ts). Nothing else: no game code, no files.
// Bounded: a name of at most 60 characters, a preview of at most 160 x 160 cells, at most MAX_MAPS_PER_USER maps per account.
//
// WHO MAY READ IT: the account that saved it. `uid` is written from the VERIFIED identity of the request (routes/mapLibrary.ts) and
// every read, use and delete compares against it; someone else's map answers exactly like a missing one.
//
// ERASED WITH THE ACCOUNT: `user_saved_maps` is in DataRetentionManager's USER_SCOPED_COLLECTIONS (field `uid`) and listed on the
// account-deletion page.
//
// Firestore in production; an in-process map when there is no database (tests, local dev) — the same "VITEST ⇒ no Firestore" rule
// every store here follows.

import * as admin from 'firebase-admin';
import { randomBytes } from 'crypto';
import { getServerDb } from './serverDb';
import { parseMapPreview, type MapPreview } from '../../lib/mapPreview';
import { checkedMapPlanData, type MapPlanData } from './athreeMap/mapPlanData';

export const SAVED_MAPS_COLLECTION = 'user_saved_maps';
export const MAX_MAPS_PER_USER = 50;
export const MAX_MAP_NAME = 60;

export interface SavedMap {
  id: string;
  uid: string;
  name: string;
  plan: MapPlanData;
  preview: MapPreview | null;
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

const memory = new Map<string, SavedMap>();

export function newSavedMapId(): string {
  return randomBytes(12).toString('hex');
}

export function isSavedMapId(id: unknown): id is string {
  return typeof id === 'string' && /^[a-f0-9]{24}$/.test(id);
}

/** A name a person typed → a clean one-line name of 1..60 characters, or null. */
export function cleanMapName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.normalize('NFKC').replace(/[\u0000-\u001f\u007f"<>`]/g, ' ').replace(/\s+/g, ' ').trim();
  return name && name.length <= MAX_MAP_NAME ? name : null;
}

const sameName = (a: string, b: string): boolean => a.normalize('NFKC').toLowerCase() === b.normalize('NFKC').toLowerCase();

/** A stored document → a saved map, or null when it is not one (a damaged row is skipped, never shown). */
function fromDoc(id: string, d: Record<string, unknown> | undefined): SavedMap | null {
  if (!d) return null;
  const plan = checkedMapPlanData(d.plan);
  const name = cleanMapName(d.name);
  if (!plan || !name || typeof d.uid !== 'string' || !d.uid) return null;
  return { id, uid: d.uid, name, plan, preview: d.preview ? parseMapPreview(d.preview) : null, createdAt: typeof d.createdAt === 'number' ? d.createdAt : 0 };
}

/** This account's saved maps, newest first. */
export async function listSavedMaps(uid: string): Promise<SavedMap[]> {
  if (!uid) return [];
  const db = getDb();
  let rows: SavedMap[];
  if (!db) rows = [...memory.values()].filter((m) => m.uid === uid);
  else {
    const snap = await db.collection(SAVED_MAPS_COLLECTION).where('uid', '==', uid).limit(MAX_MAPS_PER_USER * 2).get();
    rows = snap.docs.map((doc) => fromDoc(doc.id, doc.data() as Record<string, unknown>)).filter((m): m is SavedMap => m !== null && m.uid === uid);
  }
  return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_MAPS_PER_USER);
}

/** One of this account's maps, or null (missing, or someone else's — the two are not told apart). */
export async function getSavedMap(uid: string, id: string): Promise<SavedMap | null> {
  if (!uid || !isSavedMapId(id)) return null;
  const db = getDb();
  const m = db ? fromDoc(id, (await db.collection(SAVED_MAPS_COLLECTION).doc(id).get()).data() as Record<string, unknown> | undefined) : memory.get(id) ?? null;
  return m && m.uid === uid ? m : null;
}

export type SaveMapResult = { ok: true; map: SavedMap } | { ok: false; status: 400 | 409; error: string };

/** Save a map for this account. The plan is checked against the planner's own kinds; a name already in use is refused, not overwritten. */
export async function saveMap(uid: string, input: { name: unknown; plan: unknown; preview: unknown }, now = Date.now()): Promise<SaveMapResult> {
  const name = cleanMapName(input.name);
  if (!name) return { ok: false, status: 400, error: `Give the map a name of 1 to ${MAX_MAP_NAME} characters.` };
  const plan = checkedMapPlanData(input.plan);
  if (!plan) return { ok: false, status: 400, error: 'That map could not be read, so it was not saved.' };
  const preview = input.preview === null || input.preview === undefined ? null : parseMapPreview(input.preview);
  if (input.preview && !preview) return { ok: false, status: 400, error: 'That map picture could not be read, so the map was not saved.' };
  const mine = await listSavedMaps(uid);
  if (mine.some((m) => sameName(m.name, name))) return { ok: false, status: 409, error: `You already have a map called "${name}". Pick another name, or delete that one first.` };
  if (mine.length >= MAX_MAPS_PER_USER) return { ok: false, status: 409, error: `You can keep up to ${MAX_MAPS_PER_USER} maps. Delete one to save another.` };
  const map: SavedMap = { id: newSavedMapId(), uid, name, plan, preview, createdAt: now };
  const db = getDb();
  if (!db) memory.set(map.id, map);
  else await db.collection(SAVED_MAPS_COLLECTION).doc(map.id).set({ uid, name, plan, preview, createdAt: now });
  return { ok: true, map };
}

/** Delete one of this account's maps. False when it is missing or someone else's. */
export async function deleteSavedMap(uid: string, id: string): Promise<boolean> {
  const m = await getSavedMap(uid, id);
  if (!m) return false;
  const db = getDb();
  if (!db) memory.delete(id);
  else await db.collection(SAVED_MAPS_COLLECTION).doc(id).delete();
  return true;
}

/** Tests only. */
export function _resetSavedMapMemory(): void {
  memory.clear();
}
