import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// THE INDEX MUST LAND ON THE DATABASE THE SERVER READS (admin report 2026-11-26).
// Q-3344 shipped `deploy --only firestore:indexes` on every merge, and Cloud Build reported that step
// SUCCESS — yet the admin Home still said "total revenue … NOT real (9 FAILED_PRECONDITION: The query
// requires an index)". The index link in that error names `databases/(default)` (its encoded name is 103
// bytes long, which is the `(default)` path; `navbharat-prod` would be 108), and an earlier production
// error (tests/theFixWasInThePartWeCutOff.test.ts) spells `databases/(default)` outright. The server picks
// its database from FIRESTORE_DATABASE_ID (src/server/lib/firestoreDb.ts), which Cloud Run sets; firebase.json
// named only `navbharat-prod`, so every deploy built the index on a database the live server never queries.
// The class: a deploy target chosen in one file while the runtime target is chosen by an env value in another.
// The fix ships the indexes to BOTH databases the server can be pointed at.

type FsEntry = { database?: string; rules?: string; indexes?: string };

function firestoreEntries(): FsEntry[] {
  const firebase = JSON.parse(readFileSync('firebase.json', 'utf8'));
  const fs = firebase.firestore;
  if (Array.isArray(fs)) return fs;
  // firebase-tools treats a single object without `database` as `(default)`.
  return fs ? [{ ...fs, database: fs.database || '(default)' }] : [];
}

describe('Admin analytics Firestore index deployment', () => {
  const indexes = JSON.parse(readFileSync('firestore.indexes.json', 'utf8'));
  const bundled = String(JSON.parse(readFileSync('firebase-applet-config.json', 'utf8')).firestoreDatabaseId || '(default)');

  it('🔴 the index manifest is deployed to the (default) database the live server reads', () => {
    const live = firestoreEntries().find((e) => e.database === '(default)');
    expect(live?.indexes).toBe('firestore.indexes.json');
  });

  it('and to the bundled config database, the fallback when FIRESTORE_DATABASE_ID is unset', () => {
    const fallback = firestoreEntries().find((e) => e.database === bundled);
    expect(fallback?.indexes).toBe('firestore.indexes.json');
  });

  it('security rules keep deploying to the database they always went to, and only there', () => {
    // Widening rules to another database is a separate decision: a deny-all ruleset on a database some
    // client still reads directly would break it. Indexes are additive; rules are not.
    const withRules = firestoreEntries().filter((e) => e.rules);
    expect(withRules.map((e) => e.database)).toEqual([bundled]);
    expect(withRules[0].rules).toBe('firestore.rules');
  });

  it('indexes the SUCCESS payment filter and amountPaid aggregation together', () => {
    const index = indexes.indexes.find((candidate: any) =>
      candidate.collectionGroup === 'payment_transactions'
      && candidate.queryScope === 'COLLECTION'
      && candidate.fields.some((field: any) => field.fieldPath === 'paymentStatus' && field.order === 'ASCENDING')
      && candidate.fields.some((field: any) => field.fieldPath === 'amountPaid' && field.order === 'ASCENDING'),
    );
    expect(index).toBeDefined();
  });
});
