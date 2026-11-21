// UNSUBSCRIBE FROM NOTIFICATION EMAILS (admin 2026-11-21: "user ko jo mail bheji ja rahi hai, usme unsubscribe
// button hai? nahi hai, to working button add karo").
//
// WHICH MAIL THIS COVERS. The platform emails a user about their own things: their published site went down or
// came back (siteUptimeSweep.ts), their database was paused (supabasePauseWatch.ts), their app was approved in
// the store (storeApprovalNotify.ts). Each of those now carries an unsubscribe link and the standard
// `List-Unsubscribe` / `List-Unsubscribe-Post` headers, so Gmail and Yahoo show their own one-click button too.
//
// WHICH MAIL IT DELIBERATELY DOES NOT. The App Lock code (routes/appLock.ts) is a security code the person asked
// for a moment ago. Letting them "unsubscribe" from it would only stop them from setting their own PIN. Admin
// monitor alerts go to the admin, not to users.
//
// HOW A LINK IS TRUSTED. The link carries the uid, the category and an HMAC over both, keyed from the platform's
// existing secret (SECRET_ENCRYPTION_KEY / SECRET_KEY_V1, already required in production). Nobody can
// unsubscribe someone else by editing the uid, and no login is needed — a link in an email must work from any
// device. Opening the link (GET) changes nothing, because mail scanners open links on their own; the button on
// that page (POST) does the change. The RFC 8058 one-click POST from a mail client is honoured directly.
//
// WHAT IS STORED. `email_preferences/{uid}`: which categories the person stopped. No address, no reason.

import crypto from 'crypto';
import { getServerDb } from './serverDb';
import { publicOrigin } from './siteAnalytics';

export const EMAIL_PREFERENCES_COLLECTION = 'email_preferences';

export type EmailCategory = 'site-status' | 'database-status' | 'store-updates';

/** What each category is called on the unsubscribe page and in the email footer. */
export const EMAIL_CATEGORY_LABEL: Readonly<Record<EmailCategory, string>> = {
  'site-status': 'alerts when your published site goes down or comes back',
  'database-status': 'alerts when your app database is paused',
  'store-updates': 'updates about your apps in the NavBharatAI App Store',
};

export function isEmailCategory(v: unknown): v is EmailCategory {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(EMAIL_CATEGORY_LABEL, v);
}

/**
 * The signing key, or null when none can be used. Production refuses to sign with a key that lives in source,
 * exactly as secrets.ts refuses to encrypt with one; a missing key then means "send no link", which the senders
 * treat as "send no email" rather than mailing someone with no way out.
 */
export function unsubscribeSigningKey(env: NodeJS.ProcessEnv = process.env): Buffer | null {
  const raw = (env.SECRET_KEY_V1 || env.SECRET_ENCRYPTION_KEY || '').trim();
  if (!raw) {
    if (env.NODE_ENV === 'production') return null;
    return crypto.createHash('sha256').update('navbharatai-dev-unsubscribe').digest();
  }
  return crypto.createHmac('sha256', raw).update('email-unsubscribe:v1').digest();
}

/** The token for one person and one category. PURE. */
export function unsubscribeToken(uid: string, category: EmailCategory, key: Buffer): string {
  return crypto.createHmac('sha256', key).update(`${uid}\n${category}`).digest('base64url');
}

/** Does this token belong to this uid and category? Constant-time. PURE. */
export function verifyUnsubscribeToken(uid: unknown, category: unknown, token: unknown, key: Buffer | null): boolean {
  if (!key || typeof uid !== 'string' || !uid || uid.length > 200 || !isEmailCategory(category) || typeof token !== 'string') return false;
  const expected = Buffer.from(unsubscribeToken(uid, category, key));
  const given = Buffer.from(token);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/** The link for one person and one category, or null when no key can sign it. PURE. */
export function unsubscribeUrl(uid: string, category: EmailCategory, key: Buffer | null, origin: string = publicOrigin()): string | null {
  if (!key || !uid) return null;
  const q = new URLSearchParams({ u: uid, c: category, t: unsubscribeToken(uid, category, key) });
  return `${origin}/api/email/unsubscribe?${q.toString()}`;
}

export interface UnsubscribeMail {
  /** Appended to the body: what this mail is about, and the link to stop it. */
  footerLine: string;
  /** RFC 2369 + RFC 8058 headers: the mail client's own one-click unsubscribe button. */
  headers: Record<string, string>;
}

/** The footer line and headers for a mail in this category, or null when no link can be signed. PURE. */
export function unsubscribeMail(uid: string, category: EmailCategory, key: Buffer | null, origin?: string): UnsubscribeMail | null {
  const url = unsubscribeUrl(uid, category, key, origin);
  if (!url) return null;
  return {
    footerLine: `You get this email for ${EMAIL_CATEGORY_LABEL[category]}. Unsubscribe: ${url}`,
    headers: { 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  };
}

export interface EmailPreferenceBackend {
  read(uid: string): Promise<unknown>;
  write(uid: string, category: EmailCategory, unsubscribed: boolean): Promise<void>;
}

function firestoreBackend(): EmailPreferenceBackend | null {
  const db = getServerDb();
  if (!db) return null;
  const col = db.collection(EMAIL_PREFERENCES_COLLECTION);
  return {
    read: async (uid) => (await col.doc(uid).get()).data(),
    write: async (uid, category, unsubscribed) => {
      await col.doc(uid).set({ unsubscribed: { [category]: unsubscribed }, updatedAt: Date.now() }, { merge: true });
    },
  };
}

/** Did this stored document stop this category? PURE. */
export function preferenceStops(data: unknown, category: EmailCategory): boolean {
  const u = (data as { unsubscribed?: Record<string, unknown> } | undefined)?.unsubscribed;
  return !!u && u[category] === true;
}

/**
 * May this person be emailed in this category? FALSE when they unsubscribed, and also when the preference
 * cannot be read — mailing someone who said stop is the worse mistake, and the in-app notification still goes.
 */
export async function mayEmail(uid: string, category: EmailCategory, backend: () => EmailPreferenceBackend | null = firestoreBackend): Promise<boolean> {
  try {
    const b = backend();
    if (!b) return false;
    return !preferenceStops(await b.read(uid), category);
  } catch {
    return false;
  }
}

/** Record the person's choice. Throws when it cannot be stored, so the page never claims a change it did not make. */
export async function setEmailPreference(uid: string, category: EmailCategory, unsubscribed: boolean, backend: () => EmailPreferenceBackend | null = firestoreBackend): Promise<void> {
  const b = backend();
  if (!b) throw new Error('Preferences storage is unavailable.');
  await b.write(uid, category, unsubscribed);
}

/**
 * Everything a sender needs before it mails one person: whether it may, and the footer line and headers to
 * add. `null` means do not send (unsubscribed, unreadable preference, or no key to sign a way out).
 */
export async function prepareNotificationEmail(uid: string, category: EmailCategory, deps: { key?: Buffer | null; backend?: () => EmailPreferenceBackend | null } = {}): Promise<UnsubscribeMail | null> {
  const mail = unsubscribeMail(uid, category, deps.key === undefined ? unsubscribeSigningKey() : deps.key);
  if (!mail) return null;
  return (await mayEmail(uid, category, deps.backend)) ? mail : null;
}
