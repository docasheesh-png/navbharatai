/**
 * Where a published gallery app lives.
 *
 * ONE STORE, unlike the Nav App Store — and that is a deliberate consequence of the publish gate. An
 * APK is 5–50 MB so its bytes must go to Cloud Storage; a gallery entry is SOURCE with lockfiles,
 * dependencies, build output and binaries already excluded, which is tens of KB. That fits inside a
 * Firestore document, so the gallery needs no bucket, no new environment key, and no new failure mode
 * where the record exists but its bytes do not.
 *
 * 🔒 THE STATUS IS THE SAFETY MODEL, exactly as it is for the App Store. A published app is visible to
 * the public ONLY when an admin has explicitly set it to `approved`. Nothing in this file, and nothing
 * on the publish path, can produce `approved` on its own — a clean secret scan yields `pending`,
 * because the scan proves no key leaked, not that the code is something we want to host and hand to
 * other users to run.
 *
 * Everything degrades honestly: with no database configured, publishing reports that the gallery is
 * not accepting apps rather than accepting one it cannot keep.
 */

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';

const COLLECTION = 'gallery_apps';

export type GalleryStatus =
  | 'pending'    // scanned and accepted for review. The ONLY state publishing can produce.
  | 'approved'   // an admin looked and published it. The only state the public can see.
  | 'rejected'   // an admin refused it.
  | 'removed';   // taken down after publication.

export interface GalleryApp {
  id: string;
  /** Publisher. `uid` is the authorization key; the email is admin-only (see toPublic). */
  uid: string;
  authorEmail: string;
  authorName: string;

  title: string;
  description: string;
  /** Free-text tags, already normalised and capped. */
  tags: string[];

  status: GalleryStatus;
  publishedAt: number;
  /** Set when an admin acts, so a queue can show how long a decision took. */
  reviewedAt?: number;
  reviewedBy?: string;
  /** Why an admin rejected it — shown to the publisher, never invented. */
  reviewNote?: string;

  /** The published source. Already through the publish gate: no .env, no secrets, no binaries. */
  files: Record<string, string>;
  fileCount: number;
  bytes: number;
  /** Paths deliberately left out, so the listing can be honest about what a remix will not include. */
  excludedPaths: string[];

  /** How many times this app has been remixed. Real counter, incremented on a real remix. */
  remixCount: number;
  /** Set when this app was itself created by remixing another — attribution, not decoration. */
  remixedFrom?: string;
}

/** What a non-admin may see in a listing. Deliberately omits the source and the publisher's email. */
export interface PublicGalleryApp {
  id: string;
  title: string;
  description: string;
  tags: string[];
  authorName: string;
  publishedAt: number;
  fileCount: number;
  remixCount: number;
  remixedFrom?: string;
}

function db(): FirebaseFirestore.Firestore | null {
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    return getServerDb();
  } catch {
    return null;
  }
}

/** False when there is no database — the publish route then says so instead of failing obscurely. */
export function isGalleryConfigured(): boolean {
  return db() !== null;
}

export async function saveGalleryApp(app: GalleryApp): Promise<void> {
  const d = db();
  if (!d) throw new Error('no database');
  await d.collection(COLLECTION).doc(app.id).set(app);
}

export async function getGalleryApp(id: string): Promise<GalleryApp | null> {
  const d = db();
  if (!d) return null;
  const doc = await d.collection(COLLECTION).doc(id).get();
  return doc.exists ? (doc.data() as GalleryApp) : null;
}

export async function updateGalleryApp(id: string, patch: Partial<GalleryApp>): Promise<void> {
  const d = db();
  if (!d) throw new Error('no database');
  await d.collection(COLLECTION).doc(id).update(patch);
}

/** Apps in a given state, newest first. Serves both the admin queue and the public listing. */
export async function listGalleryApps(status: GalleryStatus, limit = 50): Promise<GalleryApp[]> {
  const d = db();
  if (!d) return [];
  const snap = await d.collection(COLLECTION)
    .where('status', '==', status)
    .orderBy('publishedAt', 'desc')
    .limit(Math.max(1, Math.min(limit, 200)))
    .get();
  return snap.docs.map((doc) => doc.data() as GalleryApp);
}

/** One publisher's own entries, whatever their state, so they can see where each one stands. */
export async function listGalleryAppsByUid(uid: string, limit = 50): Promise<GalleryApp[]> {
  const d = db();
  if (!d) return [];
  const snap = await d.collection(COLLECTION)
    .where('uid', '==', uid)
    .orderBy('publishedAt', 'desc')
    .limit(Math.max(1, Math.min(limit, 200)))
    .get();
  return snap.docs.map((doc) => doc.data() as GalleryApp);
}

/**
 * Count a remix.
 *
 * A real increment on a real remix — a displayed number that was not counted is a fabrication, and
 * this one is the gallery's only popularity signal. Best-effort: failing to record the count must
 * never fail the remix the user actually asked for.
 */
export async function incrementRemixCount(id: string): Promise<void> {
  const d = db();
  if (!d) return;
  try {
    await d.collection(COLLECTION).doc(id).update({
      remixCount: admin.firestore.FieldValue.increment(1),
    });
  } catch { /* the remix already succeeded; the counter is not worth failing it for */ }
}

/** Strip a record to what the public may see. The SOURCE is not in here — that needs an explicit fetch. */
export function toPublic(app: GalleryApp): PublicGalleryApp {
  return {
    id: app.id,
    title: app.title,
    description: app.description,
    tags: app.tags,
    authorName: app.authorName,
    publishedAt: app.publishedAt,
    fileCount: app.fileCount,
    remixCount: app.remixCount ?? 0,
    ...(app.remixedFrom ? { remixedFrom: app.remixedFrom } : {}),
  };
}

export const MAX_TITLE = 80;
export const MAX_DESCRIPTION = 500;
export const MAX_TAGS = 6;

/** Normalise publisher-supplied text. Length-capped and control-character free, never trusted raw. */
export function normalizeListing(input: { title?: unknown; description?: unknown; tags?: unknown }): {
  ok: true; title: string; description: string; tags: string[];
} | { ok: false; message: string } {
  // Control characters are stripped rather than rejected: they are almost always a paste artefact,
  // and failing a publish over an invisible character would be baffling.
  const clean = (v: unknown, max: number): string =>
    String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

  const title = clean(input.title, MAX_TITLE);
  if (title.length < 3) return { ok: false, message: 'Give your app a name of at least 3 characters.' };

  const description = clean(input.description, MAX_DESCRIPTION);
  if (description.length < 10) return { ok: false, message: 'Describe your app in at least 10 characters, so people know what it does.' };

  const rawTags = Array.isArray(input.tags) ? input.tags : [];
  const tags = [...new Set(rawTags.map((t) => clean(t, 24).toLowerCase()).filter((t) => t.length > 1))].slice(0, MAX_TAGS);

  return { ok: true, title, description, tags };
}
