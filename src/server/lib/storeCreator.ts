// Who made an App Mart app — the creator line on every instant-app card (admin 2026-09-27).
//
// Admin, with a screenshot of the Browse grid: *"app mart me yeh app kisne banayi hai, us user ka
// naam, id, kab publish ki iski date … yaha par likh kar aye"* — the name, an id and the publish date
// in the empty top-right corner of each card.
//
// 🔒 THE "ID" IS A PUBLIC CREATOR CODE, NEVER THE ACCOUNT UID. `PublicWebStoreApp` has said "No uid"
// since it was written, and that is not tidiness: the uid is the key every per-user document in this
// platform is stored under, so printing it on a public page hands every visitor a handle on the
// owner's account records. The code shown instead is a short SHA-256 of the uid — the same creator
// always gets the same code (so "these three apps are by one person" is visible), and it cannot be
// turned back into the uid, because a uid is a random 28-character value, not something guessable.
//
// 🔒 THE NAME NEVER FALLS BACK TO THE EMAIL. An email is private contact data; a creator who has no
// display name is shown as "NavBharatAI creator", which is true and exposes nothing.
//
// PURE except `resolveCreators`, which takes its lookups as dependencies so it is testable without
// Firebase, and keeps a short per-process cache because the Browse list asks about up to 60 apps and
// most of them share a handful of creators.

import { createHash } from 'node:crypto';
import * as admin from 'firebase-admin';
import { userProfileStore } from './UserProfileStore';

export interface CreatorInfo {
  /** Display name from the creator's profile or sign-in provider; never an email. */
  name: string;
  /** Short, stable, non-reversible public code for the creator (10 lowercase letters/digits). */
  id: string;
}

export const ANONYMOUS_CREATOR_NAME = 'NavBharatAI creator';
const MAX_NAME_CHARS = 40;
const CREATOR_ID_LENGTH = 10;

/** The public creator code for an account. Deterministic across instances; no secret needed. */
export function publicCreatorId(uid: string): string {
  const digest = createHash('sha256').update(`nbai-app-mart-creator:${uid}`).digest();
  // base-36 over the digest bytes, so the code is letters and digits only — easy to read out loud.
  let out = '';
  for (let i = 0; out.length < CREATOR_ID_LENGTH && i < digest.length; i++) out += (digest[i] % 36).toString(36);
  return out;
}

const EMAIL_SHAPE = /\S+@\S+\.\S+/;

/**
 * The name to print. Profile name first (what the user chose inside NavBharatAI), then the sign-in
 * provider's name. Anything email-shaped is refused — some providers put the address in the name.
 */
export function creatorDisplayName(profileName?: string | null, authName?: string | null): string {
  for (const candidate of [profileName, authName]) {
    const name = String(candidate ?? '').replace(/\s+/g, ' ').trim();
    if (name && !EMAIL_SHAPE.test(name)) return name.length > MAX_NAME_CHARS ? `${name.slice(0, MAX_NAME_CHARS - 1)}…` : name;
  }
  return ANONYMOUS_CREATOR_NAME;
}

export interface CreatorLookupDeps {
  profileName: (uid: string) => Promise<string | null | undefined>;
  authName: (uid: string) => Promise<string | null | undefined>;
  now?: () => number;
}

const CACHE_MS = 10 * 60_000;
const cache = new Map<string, { info: CreatorInfo; at: number }>();

/** Test seam. */
export function _resetCreatorCache(): void {
  cache.clear();
}

/**
 * Resolve every distinct uid once. A lookup that fails yields the anonymous name with the real code —
 * a missing name must never hide the card or the code, and must never throw into the listing route.
 */
export async function resolveCreators(uids: readonly string[], deps: CreatorLookupDeps): Promise<Map<string, CreatorInfo>> {
  const now = deps.now ?? Date.now;
  const out = new Map<string, CreatorInfo>();
  const todo = [...new Set(uids.filter(Boolean))];
  await Promise.all(todo.map(async (uid) => {
    const hit = cache.get(uid);
    if (hit && now() - hit.at < CACHE_MS) { out.set(uid, hit.info); return; }
    const profile = await deps.profileName(uid).catch(() => null);
    const auth = profile && String(profile).trim() ? null : await deps.authName(uid).catch(() => null);
    const info: CreatorInfo = { name: creatorDisplayName(profile, auth), id: publicCreatorId(uid) };
    cache.set(uid, { info, at: now() });
    out.set(uid, info);
  }));
  return out;
}

/** Production lookups: the profile document, then Firebase Auth. Both fail soft to null. */
export const realCreatorLookupDeps: CreatorLookupDeps = {
  profileName: async (uid) => (await userProfileStore.get(uid))?.displayName ?? null,
  authName: async (uid) => {
    if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    return (await admin.auth().getUser(uid)).displayName ?? null;
  },
};
