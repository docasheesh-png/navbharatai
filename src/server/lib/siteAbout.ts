/**
 * THE ABOUT PAGE, SERVED FROM THE SERVER — so what the admin writes reaches everybody.
 *
 * 🔴 WHY (admin 2026-09-20: "sabhi user ko dikhna chahiye"). The About page's editable fields were
 * held in `localStorage` — `navbharat_about_v1` appeared at exactly two places in the whole repo,
 * one read and one write, with NO server route anywhere. So an admin edit was saved on that one
 * browser and reached NO user: everyone else saw the shipped default, and clearing site data threw
 * the edit away. The page had an "Admin Edit Mode Active" badge over a control that changed nothing
 * anyone else could see — the second absolute rule's "built but not really working" exactly.
 *
 * 🔒 THE OVERRIDE IS A PATCH, NEVER THE PAGE. The page's real content lives in `src/content/about.ts`
 * and ships with the code, like the Privacy Policy and Terms. This store holds only the handful of
 * fields an admin may want to change without a deploy. A Firestore that is unreachable, empty or
 * corrupt therefore degrades to the full shipped page — never to a blank screen.
 */

import { getServerDb, doc, getDoc, setDoc } from './serverDb';
import { sanitizeAboutOverrides, type AboutOverrides } from '../../content/about';

/** One document. The About page is a single page; a collection would imply a list that does not exist. */
const COLLECTION = 'site_content';
const DOC_ID = 'about';

export interface StoredAbout {
  overrides: AboutOverrides;
  updatedAt?: string;
}

/**
 * Read the admin's saved overrides.
 *
 * 🔒 NEVER THROWS. A failure here must not take the About page down: the caller falls back to the
 * shipped copy, which is a complete, correct page on its own.
 */
export async function readAboutOverrides(): Promise<AboutOverrides> {
  try {
    const db = getServerDb();
    if (!db) return {};
    const snap = await getDoc(doc(db as any, COLLECTION, DOC_ID));
    if (!snap.exists()) return {};
    const data = snap.data() as { overrides?: unknown } | undefined;
    return sanitizeAboutOverrides(data?.overrides);
  } catch {
    return {};
  }
}

/**
 * Save the admin's overrides. Returns whether the write really landed.
 *
 * ⚠️ Returns a BOOLEAN rather than void, for the reason the version store had to learn the same day:
 * a writer that swallows "there is no database" and reports nothing lets a caller say "saved" about a
 * write that never happened. The route tells the admin the truth either way.
 */
export async function writeAboutOverrides(input: unknown): Promise<boolean> {
  const overrides = sanitizeAboutOverrides(input);
  try {
    const db = getServerDb();
    if (!db) return false;
    await setDoc(doc(db as any, COLLECTION, DOC_ID), {
      overrides,
      updatedAt: new Date().toISOString(),
    });
    return true;
  } catch {
    return false;
  }
}
