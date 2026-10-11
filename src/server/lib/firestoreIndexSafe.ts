import * as admin from 'firebase-admin';

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
 * In-memory sorting means we fetch up to `fetchCap` documents and keep the newest `limit`. While a filter
 * value matches fewer than `fetchCap` documents that is one read per document and correct. When the first
 * page comes back FULL, the cap used to make "newest 50" quietly mean "50 arbitrary ones" (audit 2026-10-11,
 * D3: it did, for every user past 200 conversations). Now the helper reads every match in document-id order
 * (still index-free) and sorts those — more reads for that caller only, never a wrong answer — up to
 * INDEX_SAFE_SCAN_CEILING, past which it logs. A collection that reaches the ceiling wants a real composite
 * index CREATED IN THE CONSOLE FIRST and its call site moved off this helper.
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
  const cap = Math.max(1, fetchCap);
  const snap = await q.limit(cap).get();
  // A FULL first page means more documents match than were read, so an in-memory sort of that page is the
  // newest of an ARBITRARY subset — exactly what this file's header warned about (audit 2026-10-11, D3). Read
  // them all instead, in document-id order: ascending `__name__` with equality filters is served by the
  // automatic single-field indexes (DeploymentStore.listPage runs it in production), so it still needs no
  // composite index. Bounded by INDEX_SAFE_SCAN_CEILING, and logged when even that is reached.
  const docs = snap.docs.length >= cap ? await scanByDocumentId(q, cap) : snap.docs;
  const rows = docs.map((d) => (mapDoc ? mapDoc(d.id, d.data()) : (d.data() as T)));
  return newestFirstBy(rows, sortField).slice(0, Math.max(1, limit));
}

/**
 * The most documents one listing will read when its matches outgrow the fetch cap. Past this the result is
 * again a subset, and the log says so; a collection that reaches it wants a composite index created in the
 * console of the RIGHT project (see the header) and its call site moved off this helper.
 */
export const INDEX_SAFE_SCAN_CEILING = 5_000;

/** Every matching document, `pageSize` at a time in document-id order, up to the scan ceiling. */
async function scanByDocumentId(
  q: admin.firestore.Query,
  pageSize: number,
): Promise<admin.firestore.QueryDocumentSnapshot[]> {
  const out: admin.firestore.QueryDocumentSnapshot[] = [];
  let page = q.orderBy(admin.firestore.FieldPath.documentId()).limit(pageSize);
  for (;;) {
    const snap = await page.get();
    out.push(...snap.docs);
    if (snap.docs.length < pageSize) return out;
    if (out.length >= INDEX_SAFE_SCAN_CEILING) {
      console.warn(`[firestoreIndexSafe] a listing matched more than ${INDEX_SAFE_SCAN_CEILING} documents; newest-first is not guaranteed past that. It needs a composite index.`);
      return out;
    }
    page = q.orderBy(admin.firestore.FieldPath.documentId()).startAfter(snap.docs[snap.docs.length - 1]).limit(pageSize);
  }
}

/**
 * A stored time as epoch millis, for `newestFirstBy`: a number as-is, an ISO string parsed, a Firestore
 * Timestamp read. Anything else is `-Infinity`, which sorts last. PURE.
 */
export function epochMillis(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY; }
  if (v && typeof (v as { toMillis?: unknown }).toMillis === 'function') {
    const t = (v as { toMillis: () => number }).toMillis();
    return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
  }
  return Number.NEGATIVE_INFINITY;
}
