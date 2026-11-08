/**
 * Which login (email) each outside API account is registered under — set by the admin on Admin → Money → API
 * Providers (admin 2026-11-03: "kis provider me <email> use hua hai, woh bhi likh dena").
 *
 * 🔒 The code cannot know this — a provider's account email is not in its key — so it is the ADMIN's record,
 * typed once on the page and stored here. It is never guessed, never hard-coded into the repository (an email is
 * personal data), and never shown outside the verified-admin page.
 *
 * One doc per provider id in `admin_api_provider_accounts`: { accountEmail, updatedAt }. Clearing the field
 * deletes the doc. A provider id outside the directory is refused, so the collection can only ever hold rows the
 * page can show.
 */
import { getServerDb } from './serverDb';
import { API_PROVIDERS } from './apiProviderDirectory';

export const API_PROVIDER_ACCOUNTS_COLLECTION = 'admin_api_provider_accounts';
const MAX_EMAIL = 254;
const KNOWN = new Set(API_PROVIDERS.map((p) => p.id));

export class ApiProviderAccountInputError extends Error {}

/** A login is an email address, or empty (= clear). PURE. Returns the normalized value or throws. */
export function normalizeAccountEmail(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') throw new ApiProviderAccountInputError('The login must be text.');
  const v = raw.trim();
  if (v === '') return null;
  if (v.length > MAX_EMAIL || !/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/.test(v)) {
    throw new ApiProviderAccountInputError('Enter an email address, for example name@example.com — or leave it empty to clear it.');
  }
  return v.toLowerCase();
}

export function isKnownProviderId(id: unknown): id is string {
  return typeof id === 'string' && KNOWN.has(id);
}

/** Every saved login, by provider id. Storage failure throws — the caller says "unavailable", never "none set". */
export async function readApiProviderAccounts(): Promise<Record<string, string>> {
  const db = getServerDb();
  if (!db) throw new Error('Storage unavailable.');
  const snap = await db.collection(API_PROVIDER_ACCOUNTS_COLLECTION).get();
  const out: Record<string, string> = {};
  for (const doc of snap.docs) {
    const email = doc.data()?.accountEmail;
    if (KNOWN.has(doc.id) && typeof email === 'string' && email) out[doc.id] = email;
  }
  return out;
}

/** Save (or, with null, clear) one provider's login. */
export async function writeApiProviderAccount(id: unknown, rawEmail: unknown, now: () => number = Date.now): Promise<string | null> {
  if (!isKnownProviderId(id)) throw new ApiProviderAccountInputError('Unknown provider.');
  const email = normalizeAccountEmail(rawEmail);
  const db = getServerDb();
  if (!db) throw new Error('Storage unavailable.');
  const ref = db.collection(API_PROVIDER_ACCOUNTS_COLLECTION).doc(id);
  if (email === null) await ref.delete();
  else await ref.set({ accountEmail: email, updatedAt: now() });
  return email;
}
