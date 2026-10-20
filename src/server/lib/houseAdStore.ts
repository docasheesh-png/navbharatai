// The Firestore half of the admin's house ads (`src/lib/houseAds.ts` holds the rules).
//
// 🔑 TWO COLLECTIONS, ON PURPOSE. The ad (name, text, link, places, dates, on/off) is small and is read by
// every list; the picture is up to 300 KB. Kept in one document, the public list — which each instance
// refreshes every minute — would read every picture of every ad each time. So the picture lives in its own
// document under the SAME id, is read only when somebody's browser asks for it, and is served as a real image
// (`GET /api/ads/image/:id`) with a cache lifetime instead of being carried inside every JSON list.
//
// 🔒 WRITE ORDER IS THE INTEGRITY RULE. Create and edit write the PICTURE first and the ad second; delete
// removes the ad first and the picture second. So an ad document can never point at a picture that is not
// there, and the worst a crash leaves behind is an orphan picture nobody can see.
//
// 🔒 AN IMAGE IS CHECKED BY ITS BYTES, not by the label the browser put on it. The data URL's mime type is
// only a claim; the first bytes must be the signature of that very format. SVG is not on the allowed list at
// all — it can carry script, and an ad has no need for it.

import crypto from 'crypto';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs } from './serverDb';
import { SharedReadCache, BoundedCache } from './boundedCache';
import { parseDataUrl, base64Bytes } from './imageDataUrl';
import {
  HOUSE_AD_IMAGE_MAX_BYTES, HOUSE_AD_IMAGE_MIMES, HOUSE_AD_MAX_COUNT,
  isHouseAdPlacement, parseHouseAdInput, pickHouseAd,
  type HouseAdInput, type HouseAdPlacement, type HouseAdView, type ServedHouseAd,
} from '../../lib/houseAds';

export const HOUSE_ADS_COLLECTION = 'house_ads';
export const HOUSE_AD_IMAGES_COLLECTION = 'house_ad_images';

/** The stored ad document: everything except the picture. */
interface StoredHouseAd {
  id: string;
  name: string;
  description: string;
  linkUrl: string | null;
  placements: HouseAdPlacement[];
  enabled: boolean;
  startsAt: number | null;
  endsAt: number | null;
  /** Changes whenever the picture does, so the image URL changes and a browser re-fetches it. */
  imageVersion: number;
  createdAt: number;
  updatedAt: number;
}

export const imageUrlFor = (id: string, version: number) => `/api/ads/image/${encodeURIComponent(id)}?v=${version}`;

/** `ad_` + 12 hex characters: no PII, unguessable enough that a disabled ad's picture is not enumerable. */
export const AD_ID_RE = /^ad_[0-9a-f]{12}$/;
const newAdId = () => `ad_${crypto.randomBytes(6).toString('hex')}`;

// ── Picture check ─────────────────────────────────────────────────────────────────────────────

export type ImageCheck = { ok: true; mime: string; bytes: number; base64: string } | { ok: false; error: string };

/** Does the decoded start of the file carry the signature of the format the data URL claims? */
function signatureMatches(mime: string, head: Buffer): boolean {
  if (mime === 'image/jpeg') return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (mime === 'image/png') return head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'image/webp') return head.length >= 12 && head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP';
  return false;
}

export function checkAdImage(dataUrl: string): ImageCheck {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return { ok: false, error: 'The picture could not be read. Upload a JPG, PNG or WebP image.' };
  if (!(HOUSE_AD_IMAGE_MIMES as readonly string[]).includes(parsed.mimeType)) {
    return { ok: false, error: 'The picture must be a JPG, PNG or WebP image.' };
  }
  const bytes = base64Bytes(parsed.base64);
  if (bytes > HOUSE_AD_IMAGE_MAX_BYTES) {
    return { ok: false, error: `The picture is too large (the limit is ${Math.round(HOUSE_AD_IMAGE_MAX_BYTES / 1024)} KB).` };
  }
  const head = Buffer.from(parsed.base64.slice(0, 24), 'base64');
  if (!signatureMatches(parsed.mimeType, head)) {
    return { ok: false, error: 'That file is not really an image of the type it claims to be.' };
  }
  return { ok: true, mime: parsed.mimeType, bytes, base64: parsed.base64 };
}

// ── Reads ─────────────────────────────────────────────────────────────────────────────────────

const toView = (s: StoredHouseAd): HouseAdView => ({
  id: s.id,
  name: s.name,
  description: s.description,
  linkUrl: s.linkUrl,
  placements: s.placements,
  enabled: s.enabled,
  startsAt: s.startsAt,
  endsAt: s.endsAt,
  imageUrl: imageUrlFor(s.id, s.imageVersion),
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

/**
 * Read one stored document back into its exact shape — or null when it is not a valid ad. A hand-edited or
 * half-written document is NO ad, never a half-drawn one on somebody's screen.
 */
function readStored(id: string, raw: unknown): StoredHouseAd | null {
  const d = (raw && typeof raw === 'object' ? raw : null) as Record<string, any> | null;
  if (!d || typeof d.name !== 'string' || !d.name || typeof d.description !== 'string' || !d.description) return null;
  if (typeof d.enabled !== 'boolean' || typeof d.imageVersion !== 'number') return null;
  const placements = Array.isArray(d.placements) ? d.placements.filter(isHouseAdPlacement) : [];
  const timeOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    id,
    name: d.name,
    description: d.description,
    linkUrl: typeof d.linkUrl === 'string' ? d.linkUrl : null,
    placements,
    enabled: d.enabled,
    startsAt: timeOrNull(d.startsAt),
    endsAt: timeOrNull(d.endsAt),
    imageVersion: d.imageVersion,
    createdAt: typeof d.createdAt === 'number' ? d.createdAt : 0,
    updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : 0,
  };
}

async function readAll(db: any): Promise<StoredHouseAd[]> {
  const snap = await getDocs(collection(db, HOUSE_ADS_COLLECTION));
  const out: StoredHouseAd[] = [];
  for (const d of snap.docs) {
    const s = readStored(d.id, d.data());
    if (s) out.push(s);
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

/** Admin: every ad, newest first. */
export async function listHouseAds(db: any): Promise<HouseAdView[]> {
  return (await readAll(db)).map(toView);
}

/**
 * The public list: ONE read per minute per instance, shared by every request. A change the admin makes is
 * seen at once on this instance (`forget`) and within a minute on the others — which is also how long a
 * switched-off ad can still be shown, and the admin page says so.
 */
const publicAds = new SharedReadCache<StoredHouseAd[]>({ maxEntries: 2, ttlMs: 60_000 });
export const forgetPublicAds = () => publicAds.forget();

/** The ad one placement shows right now, or null. Never throws: no ad is the honest answer to any failure. */
export async function servedAdFor(
  db: any, placement: HouseAdPlacement, nowMs: number = Date.now(), rand: () => number = Math.random,
): Promise<ServedHouseAd | null> {
  const ads = await publicAds.get('all', () => readAll(db));
  const ad = pickHouseAd(ads, placement, nowMs, rand);
  if (!ad) return null;
  return { id: ad.id, name: ad.name, description: ad.description, linkUrl: ad.linkUrl, imageUrl: imageUrlFor(ad.id, ad.imageVersion) };
}

// ── The picture ───────────────────────────────────────────────────────────────────────────────

const imageCache = new BoundedCache<string, { mime: string; bytes: Buffer }>({ maxEntries: 20, ttlMs: 10 * 60_000 });

export async function readAdImage(db: any, id: string): Promise<{ mime: string; bytes: Buffer } | null> {
  if (!AD_ID_RE.test(id)) return null;
  const hit = imageCache.get(id);
  if (hit) return hit;
  const snap = await getDoc(doc(db, HOUSE_AD_IMAGES_COLLECTION, id));
  if (!snap.exists()) return null;
  const d = snap.data() as Record<string, any>;
  if (typeof d.mime !== 'string' || typeof d.base64 !== 'string') return null;
  // Re-check on the way OUT as well: a document written by anything but this module is not trusted.
  const check = checkAdImage(`data:${d.mime};base64,${d.base64}`);
  if (!check.ok) return null;
  const value = { mime: check.mime, bytes: Buffer.from(check.base64, 'base64') };
  imageCache.set(id, value);
  return value;
}

// ── Writes ────────────────────────────────────────────────────────────────────────────────────

export type WriteResult<T = { id: string }> = { ok: true; value: T } | { ok: false; status: 400 | 404 | 409; error: string };

export async function createHouseAd(db: any, body: unknown, nowMs: number): Promise<WriteResult> {
  const parsed = parseHouseAdInput(body, { requireImage: true });
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const v: HouseAdInput = parsed.value;
  const image = checkAdImage(v.imageDataUrl as string);
  if (!image.ok) return { ok: false, status: 400, error: image.error };
  if ((await readAll(db)).length >= HOUSE_AD_MAX_COUNT) {
    return { ok: false, status: 409, error: `You already have ${HOUSE_AD_MAX_COUNT} ads. Delete one before adding another.` };
  }
  const id = newAdId();
  // Picture FIRST, ad second: an ad is never visible without its picture.
  await setDoc(doc(db, HOUSE_AD_IMAGES_COLLECTION, id), { mime: image.mime, base64: image.base64, bytes: image.bytes, updatedAt: nowMs });
  const stored: StoredHouseAd = {
    id, name: v.name, description: v.description, linkUrl: v.linkUrl, placements: v.placements,
    enabled: v.enabled, startsAt: v.startsAt, endsAt: v.endsAt, imageVersion: nowMs, createdAt: nowMs, updatedAt: nowMs,
  };
  await setDoc(doc(db, HOUSE_ADS_COLLECTION, id), stored);
  imageCache.delete(id);
  forgetPublicAds();
  return { ok: true, value: { id } };
}

export async function updateHouseAd(db: any, id: string, body: unknown, nowMs: number): Promise<WriteResult> {
  if (!AD_ID_RE.test(id)) return { ok: false, status: 404, error: 'That ad does not exist.' };
  const parsed = parseHouseAdInput(body, { requireImage: false });
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };
  const v = parsed.value;
  const ref = doc(db, HOUSE_ADS_COLLECTION, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { ok: false, status: 404, error: 'That ad does not exist.' };
  const patch: Record<string, unknown> = {
    name: v.name, description: v.description, linkUrl: v.linkUrl, placements: v.placements,
    enabled: v.enabled, startsAt: v.startsAt, endsAt: v.endsAt, updatedAt: nowMs,
  };
  if (v.imageDataUrl) {
    const image = checkAdImage(v.imageDataUrl);
    if (!image.ok) return { ok: false, status: 400, error: image.error };
    await setDoc(doc(db, HOUSE_AD_IMAGES_COLLECTION, id), { mime: image.mime, base64: image.base64, bytes: image.bytes, updatedAt: nowMs });
    patch.imageVersion = nowMs;
    imageCache.delete(id);
  }
  await updateDoc(ref, patch);
  forgetPublicAds();
  return { ok: true, value: { id } };
}

export async function deleteHouseAd(db: any, id: string): Promise<WriteResult> {
  if (!AD_ID_RE.test(id)) return { ok: false, status: 404, error: 'That ad does not exist.' };
  const ref = doc(db, HOUSE_ADS_COLLECTION, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { ok: false, status: 404, error: 'That ad does not exist.' };
  // Ad FIRST, picture second: the worst a crash leaves is an orphan picture nobody can reach.
  await deleteDoc(ref);
  await deleteDoc(doc(db, HOUSE_AD_IMAGES_COLLECTION, id));
  imageCache.delete(id);
  forgetPublicAds();
  return { ok: true, value: { id } };
}
