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
    return await fetchAboutOverrides();
  } catch {
    return {};
  }
}

/** The raw read. THROWS on a store failure, so the page cache below can tell "empty" from "failed". */
async function fetchAboutOverrides(): Promise<AboutOverrides> {
  const db = getServerDb();
  if (!db) return {};
  const snap = await getDoc(doc(db as any, COLLECTION, DOC_ID));
  if (!snap.exists()) return {};
  const data = snap.data() as { overrides?: unknown } | undefined;
  return sanitizeAboutOverrides(data?.overrides);
}

/**
 * THE PUBLIC /about PAGE'S READ — cached, time-boxed, never failing (SEO verification 2026-10-18, P2-7).
 *
 * /about is a public, crawlable page. It used to do one Firestore read PER REQUEST with no timeout: a
 * crawl or a link going viral was one database read per hit, and a slow store held the page — and its
 * first byte, which is what a crawler and a slow phone wait on — for as long as the store took.
 *
 *   • A successful read is reused for ABOUT_CACHE_TTL_MS. The page is sent `max-age=600` anyway, so an
 *     admin edit already took up to ten minutes to reach a browser; and a save through this process
 *     (writeAboutOverrides) clears the cache at once.
 *   • A read slower than ABOUT_READ_TIMEOUT_MS stops being waited for: the page renders with the last
 *     good overrides, or the shipped copy if there are none. The slow read is not cancelled — if it
 *     lands, it refreshes the cache for the next visitor.
 *   • A failed read is never cached as "no overrides"; the next request tries again.
 */
export const ABOUT_CACHE_TTL_MS = 60_000;
export const ABOUT_READ_TIMEOUT_MS = 1_500;

let pageCache: { value: AboutOverrides; atMs: number } | null = null;
let inFlight: Promise<AboutOverrides> | null = null;
/** Bumped by every clear: a read that started BEFORE a save must not cache the pre-save value. */
let generation = 0;

export async function readAboutOverridesForPage(
  opts: { nowMs?: () => number; timeoutMs?: number; ttlMs?: number; fetch?: () => Promise<AboutOverrides> } = {},
): Promise<AboutOverrides> {
  const now = opts.nowMs ?? Date.now;
  const ttl = opts.ttlMs ?? ABOUT_CACHE_TTL_MS;
  const fallback = (): AboutOverrides => pageCache?.value ?? {};
  if (pageCache && now() - pageCache.atMs < ttl) return pageCache.value;
  try {
    // One read at a time: a burst of visitors shares a single in-flight read.
    let pending = inFlight;
    if (!pending) {
      const gen = generation;
      const read = (opts.fetch ?? fetchAboutOverrides)();
      const p: Promise<AboutOverrides> = read
        .then((value) => { if (gen === generation) pageCache = { value, atMs: now() }; return value; })
        .finally(() => { if (inFlight === p) inFlight = null; });
      p.catch(() => { /* a failed read is not cached; the next request retries */ });
      inFlight = p;
      pending = p;
    }
    const timeoutMs = opts.timeoutMs ?? ABOUT_READ_TIMEOUT_MS;
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<AboutOverrides>((resolve) => {
      timer = setTimeout(() => resolve(fallback()), timeoutMs);
      timer.unref?.();
    });
    try {
      return await Promise.race([pending, timedOut]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch {
    return fallback();
  }
}

/** Forget the cached page overrides — after a save, and between tests. */
export function clearAboutPageCache(): void {
  generation += 1;
  pageCache = null;
  inFlight = null;
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
    // The public /about page must show a fresh save from this process at once, not after the TTL.
    clearAboutPageCache();
    return true;
  } catch {
    return false;
  }
}
