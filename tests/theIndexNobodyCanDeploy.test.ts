/**
 * The index nobody can deploy — admin server-log capture, 2026-09-20.
 *
 * The admin's Server-logs panel carried `DIAGNOSTICS_READ_FAILED` eight times across three days
 * (18–20 Sep), every row the same:
 *
 *     9 FAILED_PRECONDITION: The query requires an index. You can create it here:
 *     https://console.firebase.google.com/v1/r/project/gen-lang-client-0866594388/firestore/
 *     indexes?create_composite=Clpwcm9qZWN0cy9…
 *
 * The 2026-09-17 fix made that LINK survive truncation, so the remedy became reachable. It did not
 * ask what the index was FOR. Decoding the link answers it, and the answer is a defect in our code
 * rather than a missing click:
 *
 *     queryScope = COLLECTION · collection `history` · fields = [ __name__ DESCENDING ]
 *
 * Exactly one query shape produces that, and this repo had two of them:
 * `.orderBy(documentId(), 'desc')` in `listDiagnosticsHistoryInner` and, since 2026-09-18, in
 * `listRecentBuildReports` — whose own comment asserted *"it orders by documentId(), exactly as
 * listDiagnosticsHistory does, so it needs NO Firestore index"*. The belief was copied, so the
 * failure was too.
 *
 * 🔑 Firestore indexes every collection by `__name__` ASCENDING. A DESCENDING `__name__` sort as the
 * only order is not covered, and `firestoreIndexSafe.ts` already records why this project can never
 * answer that with an index: nothing here deploys one, and `.firebaserc` names the Hosting project
 * rather than the Firestore one. So the query could only ever fail — which it did, on every call,
 * for as long as it existed.
 *
 * What it cost, and why the logs were the only place it showed: both readers are honest about a
 * failed read, so nothing lied. The whole-session build report fell back to a single turn and said
 * so, and the admin build-cost card fell back to `latest-per-workspace` and said so. A feature that
 * shipped on 2026-09-18 to show one row per BUILD had therefore never once run.
 *
 * The class guard lives with its class, in `src/server/lib/firestoreIndexSafe.test.ts`: the scan
 * there now fails on this second shape in any server file, including files written later.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newestFirstHistoryIds } from '../src/server/AgentV3/DiagnosticsStore';

/** Document ids are `String(report.startedAt)` — epoch milliseconds. */
const OLDEST = '1758200000000';
const MIDDLE = '1758300000000';
const NEWEST = '1758400000000';

describe('the newest builds are chosen in memory, not by a sort Firestore cannot serve', () => {
  it('returns the newest first, whatever order Firestore handed them back in', () => {
    // The ASCENDING scan that replaces the descending query returns oldest-first.
    expect(newestFirstHistoryIds([OLDEST, MIDDLE, NEWEST], 3)).toEqual([NEWEST, MIDDLE, OLDEST]);
    expect(newestFirstHistoryIds([NEWEST, OLDEST, MIDDLE], 3)).toEqual([NEWEST, MIDDLE, OLDEST]);
  });

  it('a limit keeps the NEWEST, which is the whole point', () => {
    // 🔴 This is why the ascending scan is unbounded. A `.limit(n)` applied by Firestore to an
    // ascending scan would keep the OLDEST n — the exact opposite of what every caller wants.
    expect(newestFirstHistoryIds([OLDEST, MIDDLE, NEWEST], 2)).toEqual([NEWEST, MIDDLE]);
    expect(newestFirstHistoryIds([OLDEST, MIDDLE, NEWEST], 1)).toEqual([NEWEST]);
  });

  it('compares numerically, not lexicographically', () => {
    // Same-length epoch-ms ids sort identically either way; different lengths do not. A ten-digit
    // id is older than a thirteen-digit one, and a string compare would put it first.
    expect(newestFirstHistoryIds(['9999999999', NEWEST], 2)).toEqual([NEWEST, '9999999999']);
  });

  it('never drops an unrecognised id, and never lets one outrank a real build', () => {
    const out = newestFirstHistoryIds([MIDDLE, 'legacy-entry', NEWEST], 3);
    expect(out).toHaveLength(3);
    expect(out.slice(0, 2)).toEqual([NEWEST, MIDDLE]);
    expect(out[2]).toBe('legacy-entry');
  });

  it('keeps a stable order among ids it cannot rank', () => {
    expect(newestFirstHistoryIds(['a', 'b', 'c'], 3)).toEqual(['a', 'b', 'c']);
  });

  it('handles the empty and zero-limit cases without inventing a read', () => {
    expect(newestFirstHistoryIds([], 20)).toEqual([]);
    expect(newestFirstHistoryIds([NEWEST], 0)).toEqual([]);
    expect(newestFirstHistoryIds([NEWEST], -5)).toEqual([]);
  });
});

describe('🔒 the query that could only ever fail is gone from both readers', () => {
  const SOURCE = join(process.cwd(), 'src/server/AgentV3/DiagnosticsStore.ts');
  /** Comments quote the broken shape deliberately, as evidence. Only live code counts. */
  const code = readFileSync(SOURCE, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');

  it('no descending document-id sort survives', () => {
    expect(code).not.toContain("documentId(), 'desc'");
    expect(code).not.toContain('__name__');
  });

  it('both readers go through the one shared, index-free reader', () => {
    // Two call sites, one helper — so a third cannot inherit the belief the second copied.
    expect(code.split('newestHistoryRefs(').length - 1).toBeGreaterThanOrEqual(3); // 1 definition + 2 uses
  });
});
