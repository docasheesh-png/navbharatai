import type * as admin from 'firebase-admin';

/**
 * Listing helpers that CANNOT require a Firestore composite index.
 *
 * ## Why this file exists
 *
 * `.where('uid', '==', x).orderBy('publishedAt', 'desc')` filters on one field and sorts on
 * another. Firestore serves that only from a COMPOSITE INDEX, which is not created automatically —
 * someone has to create it, per collection, per field pair, before the query is ever run. Until
 * then the query does not return fewer rows, it THROWS (`FAILED_PRECONDITION: The query requires an
 * index`).
 *
 * The failure is nasty for three reasons:
 *   1. It appears the FIRST time a real user exercises the path in production, never in dev or in
 *      tests, because the emulator and the unit tests do not enforce indexes.
 *   2. Call sites that wrap the query in a `catch` degrade to an EMPTY LIST, so the user is told
 *      "you have no apps" while their apps sit safely in the database. An empty list is a lie, and
 *      a lie is worse than an error.
 *   3. The repo used to carry a `firestore.indexes.json` that looked like it solved this and did
 *      not. It was never applied to anything: `firebase.json` had no `indexes` key, no pipeline ran
 *      `firebase deploy --only firestore:indexes`, and one of its six entries did not even match
 *      the query it claimed to serve (`ai_usage_logs` declared `timestamp`; the query orders by
 *      `createdAt`). Reasoning "the index is declared, so it exists" is how this bug survived
 *      several rounds of review — one call site's fallback comment literally read "once the index
 *      is live the fast path above is used", of a fast path that had never once succeeded. The file
 *      was deleted rather than wired up; see the note below for why wiring it would have been
 *      worse.
 *
 * ## If a collection ever genuinely outgrows the cap
 *
 * Then it wants a real composite index — but do NOT recreate an indexes file and deploy it from
 * this repo. `.firebaserc` names `navbharatai-3395f`, which is the **Hosting** project, while
 * Firestore lives in `gen-lang-client-0866594388`, database `navbharat-prod`. A
 * `firebase deploy --only firestore:indexes` from here would target the wrong project entirely and
 * silently appear to succeed. Create the index in the Firestore console of the correct project
 * FIRST, confirm it has finished building, and only then point a call site at an ordered query —
 * with a fallback, because the index can be deleted by anyone with console access at any time.
 *
 * ## The fix, and why it is a helper rather than a convention
 *
 * An equality filter alone is served by the automatic single-field index that every field gets for
 * free. So: filter in Firestore, sort in memory. That is what the functions below do, and the
 * signature is the point — there is NO parameter through which a caller can pass an `orderBy`, so a
 * call site written against this helper cannot reintroduce the bug even by accident. Fixing the
 * individual queries would have left the next one free to repeat it.
 *
 * ## The cost, stated honestly
 *
 * In-memory sorting means we fetch up to `fetchCap` documents and keep the newest `limit`. That is
 * correct only while a single filter value matches fewer than `fetchCap` documents — true for every
 * collection using this today (one document per published app or per purchase, not per row or per
 * event) and enforced by the cap rather than assumed. When a collection genuinely outgrows the cap,
 * the answer is a real composite index CREATED IN THE CONSOLE FIRST and then a call site moved off
 * this helper — not a silently raised cap, which would quietly turn "newest 50" into "50 arbitrary
 * ones".
 */

/**
 * How many documents a listing may pull before sorting them in memory.
 *
 * 500 is chosen against the constraint that matters: a Firestore read is billed per document, so
 * this is the per-listing read cost, and it must stay small enough that a hot listing page is not
 * expensive. It is also comfortably above the largest real single-filter result these collections
 * hold.
 */
export const INDEX_SAFE_FETCH_CAP = 500;

/** An equality filter: the field, and the exact value it must hold. */
export type EqFilter = readonly [field: string, value: unknown];

/**
 * Sort newest-first on a numeric epoch-millis field, tolerating documents that lack it.
 *
 * A missing or non-numeric timestamp sorts LAST rather than throwing or landing at the top: an old
 * record written before the field existed should not outrank today's, and it should not vanish.
 */
export function newestFirstBy<T>(rows: T[], sortField: string): T[] {
  const at = (row: T): number => {
    const v = (row as Record<string, unknown>)[sortField];
    return typeof v === 'number' && Number.isFinite(v) ? v : Number.NEGATIVE_INFINITY;
  };
  return [...rows].sort((a, b) => at(b) - at(a));
}

/**
 * Equality-filtered, newest-first listing that needs no composite index.
 *
 * `filters` are equality filters only — that restriction is what makes the query index-free, and it
 * is expressed in the type rather than in a comment someone can skip. Several of them are still
 * fine: Firestore serves a conjunction of equality filters by merging the automatic single-field
 * indexes. It is the ORDER BY on a different field that demands a composite index, and there is no
 * parameter here through which one can be supplied.
 *
 * `mapDoc` exists because some records are assembled from the document ID as well as its data (a
 * conversation's id is its doc id, not a field). It runs BEFORE the sort, so the mapped shape is
 * what `sortField` reads.
 */
export async function listEqNewestFirst<T>(
  collection: admin.firestore.CollectionReference | admin.firestore.Query,
  filters: readonly EqFilter[],
  sortField: string,
  limit: number,
  fetchCap: number = INDEX_SAFE_FETCH_CAP,
  mapDoc?: (id: string, data: admin.firestore.DocumentData) => T,
): Promise<T[]> {
  let q: admin.firestore.Query = collection as admin.firestore.Query;
  for (const [field, value] of filters) q = q.where(field, '==', value);
  const snap = await q.limit(Math.max(1, fetchCap)).get();
  const rows = snap.docs.map((d) => (mapDoc ? mapDoc(d.id, d.data()) : (d.data() as T)));
  return newestFirstBy(rows, sortField).slice(0, Math.max(1, limit));
}
