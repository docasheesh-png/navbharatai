// A profile photo the user uploads from their phone or computer (admin 2026-10-01: "photo bhi laga sake!!!").
//
// Until now a profile picture was a URL pasted into Settings → Profile, so almost nobody had one, and the
// App Mart profile showed a letter. The photo is now an upload, taken in the browser down to a small square
// JPEG (`ProfileEditForm.tsx`), checked here, stored in Firestore under the public creator code, and served by
// `GET /api/app-mart/avatar/:creatorId` — so every surface that shows a person (comments, likers, profiles)
// gets a short https URL instead of a 30 KB data string per person.
//
// 🔒 IT IS PUBLIC, SO IT IS CHECKED BEFORE IT IS SAVED. App Mart shows this picture to strangers, and Google
// has already rejected an update of this app over one nude image. Each upload is shown to the vision chain
// (never Claude: the free providers first) with a one-word question; anything but a clear SAFE is refused,
// and a check that could not run refuses too — "try again in a moment" costs a user a minute, a nude
// avatar on a public profile can cost the app its Play listing.
//
// 🔒 AND ONLY PHOTOS WE CAN VOUCH FOR ARE SHOWN TO OTHER PEOPLE (`publicPhotoUrl`): our own uploaded avatar,
// or the picture the person's Google or GitHub sign-in provides. A URL pasted in Settings before this change
// is still the person's own (they see it), but it was never checked, so it is not shown to anyone else.

import * as admin from 'firebase-admin';
import { getServerDb } from './serverDb';
import { runVisionChain } from './visionChain';
import { safePhotoUrl } from './appMartSocialRules';

export const PROFILE_AVATARS_COLLECTION = 'profile_avatars';

/** The largest decoded image accepted. The browser sends ~320×320 JPEG, usually 15–40 KB. */
export const MAX_AVATAR_BYTES = 300 * 1024;

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type AvatarParse = { ok: true; mime: string; bytes: Buffer } | { ok: false; error: string };

/** A `data:image/…;base64,…` upload, checked by its real bytes, not by what it claims to be. PURE. */
export function parseAvatarUpload(raw: unknown): AvatarParse {
  const s = typeof raw === 'string' ? raw.trim() : '';
  const m = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(s);
  if (!m) return { ok: false, error: 'Choose a photo (JPEG, PNG or WebP).' };
  const mime = m[1].toLowerCase();
  if (!ALLOWED.has(mime)) return { ok: false, error: 'That kind of picture is not supported — use a JPEG, PNG or WebP photo.' };
  const bytes = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
  if (bytes.length === 0) return { ok: false, error: 'That photo is empty.' };
  if (bytes.length > MAX_AVATAR_BYTES) return { ok: false, error: 'That photo is too large. Please choose a smaller one.' };
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng = bytes.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isWebp = bytes.slice(0, 4).toString('latin1') === 'RIFF' && bytes.slice(8, 12).toString('latin1') === 'WEBP';
  const real = isJpeg ? 'image/jpeg' : isPng ? 'image/png' : isWebp ? 'image/webp' : '';
  if (!real) return { ok: false, error: 'That file is not a photo.' };
  return { ok: true, mime: real, bytes };
}

export const AVATAR_CHECK_PROMPT =
  'This picture is about to become a PUBLIC profile photo in an app store used by people of all ages. '
  + 'Reply with exactly one word. Reply UNSAFE if it shows nudity, exposed private parts, underwear-only or '
  + 'sexually suggestive posing, a sexual act, graphic violence or gore, or a hate symbol. Otherwise reply SAFE.';

/** The verdict in a vision reply. Anything that is not a clear SAFE is not safe. PURE. */
export function avatarVerdict(reply: string | null | undefined): 'safe' | 'unsafe' | 'unknown' {
  const t = String(reply ?? '').trim().toUpperCase();
  if (!t) return 'unknown';
  if (/\bUNSAFE\b/.test(t)) return 'unsafe';
  if (/^\W*SAFE\b/.test(t)) return 'safe';
  return 'unknown';
}

/** Ask the vision chain (no Claude). `unknown` when no provider answered. */
export async function checkAvatar(mime: string, bytes: Buffer): Promise<'safe' | 'unsafe' | 'unknown'> {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return 'unknown';
  const r = await runVisionChain([{ name: 'avatar', type: mime, base64: bytes.toString('base64') }], {
    prompt: AVATAR_CHECK_PROMPT, allowClaude: false, timeoutMs: 15_000,
  }).catch(() => null);
  return avatarVerdict(r?.text);
}

/** The platform's public origin — an <img> inside the phone app needs an absolute URL. PURE. */
export function publicOriginFor(env: NodeJS.ProcessEnv = process.env): string {
  const v = String(env.PUBLIC_BASE_URL ?? '').trim().replace(/\/+$/, '');
  return /^https:\/\/[^/\s]+$/.test(v) ? v : 'https://navbharatai.com';
}

/** The URL an uploaded avatar is served at; `v` changes on every upload so caches never show an old one. PURE. */
export function avatarUrl(creatorId: string, version: number, env: NodeJS.ProcessEnv = process.env): string {
  return `${publicOriginFor(env)}/api/app-mart/avatar/${creatorId}?v=${Math.max(0, Math.floor(version))}`;
}

/** Sign-in providers whose pictures are their own platform's responsibility. */
const PROVIDER_PHOTO_HOST = /(^|\.)googleusercontent\.com$|^avatars\.githubusercontent\.com$/;

/**
 * The picture other people may see: our own uploaded avatar, or a Google/GitHub sign-in picture. Anything
 * else — a URL pasted before uploads existed — is shown to nobody but its owner. PURE.
 */
export function publicPhotoUrl(raw: unknown, env: NodeJS.ProcessEnv = process.env): string {
  const s = safePhotoUrl(raw);
  if (!s) return '';
  try {
    const u = new URL(s);
    const ours = new URL(publicOriginFor(env));
    if (u.host === ours.host && /^\/api\/app-mart\/avatar\/[0-9a-z]{10}$/.test(u.pathname)) return s;
    if (PROVIDER_PHOTO_HOST.test(u.hostname)) return s;
  } catch { /* not a URL */ }
  return '';
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

export class AvatarStoreUnavailable extends Error {}

/** Save (replace) a person's avatar under their public creator code. Returns the version stamp. */
export async function saveAvatar(creatorId: string, uid: string, mime: string, bytes: Buffer): Promise<number> {
  const db = getDb();
  if (!db) throw new AvatarStoreUnavailable('no database');
  const version = Date.now();
  await db.collection(PROFILE_AVATARS_COLLECTION).doc(creatorId).set({ uid, mime, data: bytes.toString('base64'), version });
  return version;
}

export async function deleteAvatar(creatorId: string): Promise<void> {
  const db = getDb();
  if (!db) throw new AvatarStoreUnavailable('no database');
  await db.collection(PROFILE_AVATARS_COLLECTION).doc(creatorId).delete();
}

export async function loadAvatar(creatorId: string): Promise<{ mime: string; bytes: Buffer; version: number } | null> {
  const db = getDb();
  if (!db) return null;
  const snap = await db.collection(PROFILE_AVATARS_COLLECTION).doc(creatorId).get();
  const d = snap.exists ? snap.data() as { mime?: string; data?: string; version?: number } : null;
  if (!d?.data || !d.mime || !ALLOWED.has(d.mime)) return null;
  return { mime: d.mime, bytes: Buffer.from(d.data, 'base64'), version: Number(d.version) || 0 };
}
