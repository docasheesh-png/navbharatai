import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { INDEX_SAFE_FETCH_CAP, newestFirstBy, listEqNewestFirst } from './firestoreIndexSafe';

/**
 * The composite-index bug class, pinned shut.
 *
 * A `.where(A, '==', x).orderBy(B)` chain on two different fields is served only by a composite
 * index. Nothing creates one automatically, `firestore.indexes.json` is not wired into
 * `firebase.json` and no pipeline applies it, and no session has console access — so in this
 * project that query does not return rows, it throws, the first time a real user runs it.
 *
 * The first instance broke the store's very first publish. The sweep that followed found five more
 * live ones and two silent ones (a `catch` that returned an empty list, so the user was told they
 * had nothing rather than that something failed). That is a class, not an incident, so the guard is
 * a source scan rather than six behavioural tests: it fails on the SHAPE, in any file, including
 * ones written after this test.
 */

const SERVER_ROOT = join(__dirname, '..');

function tsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { tsFiles(p, out); continue; }
    if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/**
 * Find `.where('field', '==', …)` immediately followed by `.orderBy('otherField')`.
 *
 * Deliberately narrow: it matches only the adjacent chain, which is the shape that actually breaks,
 * and it compares the two field names so a range plus an order on the SAME field — legal, served by
 * the single-field index, and used on purpose in DiagnosticsStore and SandboxStore — is not flagged.
 * A scan that cried wolf on the legal shape would be turned off within a week.
 */
const CHAIN = /\.where\(\s*['"]([\w.]+)['"]\s*,\s*['"]==['"][^)]*\)\s*\n?\s*\.orderBy\(\s*['"]([\w.]+)['"]/g;

/**
 * Strip comments before scanning.
 *
 * Every file that fixed this bug DESCRIBES the broken shape in a comment so the next reader knows
 * what not to write — including this helper's own header. Matching prose would make the guard fire
 * on the documentation of the fix, which is the fastest possible way to get a guard deleted.
 */
function codeOnly(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('composite-index queries cannot be reintroduced', () => {
  it('no server file chains an equality filter into an orderBy on a different field', () => {
    const offenders: string[] = [];
    for (const file of tsFiles(SERVER_ROOT)) {
      const src = codeOnly(readFileSync(file, 'utf8'));
      for (const m of src.matchAll(CHAIN)) {
        const [, whereField, orderField] = m;
        if (whereField === orderField) continue; // same field: single-field index serves it
        offenders.push(`${file.replace(SERVER_ROOT, 'src/server')}: where(${whereField}) + orderBy(${orderField})`);
      }
    }
    expect(
      offenders,
      `These queries need a composite index that this project has never deployed, so they THROW on \n` +
      `their first real use. Use listEqNewestFirst() from src/server/lib/firestoreIndexSafe.ts \n` +
      `instead — it filters in Firestore and sorts in memory, and takes no orderBy parameter.\n\n` +
      offenders.join('\n'),
    ).toEqual([]);
  });

  it('an indexes file may not exist unless firebase.json actually deploys it', () => {
    // The deleted `firestore.indexes.json` was config-shaped fiction: nothing referenced it, nothing
    // deployed it, and three call sites reasoned from it as though it were live. If someone re-adds
    // one, this fails until they wire it — at which point they will hit the real reason it cannot be
    // deployed from here (`.firebaserc` names the Hosting project, not the Firestore one).
    const repoRoot = join(SERVER_ROOT, '..', '..');
    let indexes = '';
    try { indexes = readFileSync(join(repoRoot, 'firestore.indexes.json'), 'utf8'); } catch { /* absent: good */ }
    if (!indexes) return;
    const firebaseJson = JSON.parse(readFileSync(join(repoRoot, 'firebase.json'), 'utf8')) as
      { firestore?: { indexes?: string } };
    expect(
      firebaseJson.firestore?.indexes,
      'firestore.indexes.json exists but firebase.json does not reference it, so it is never applied. ' +
      'Either wire it up (and read the project-mismatch warning in firestoreIndexSafe.ts first) or delete it.',
    ).toBeTruthy();
  });

  it('the known-good same-field range+order shape is not flagged', () => {
    // Guards the guard: if this ever starts matching, the scan has become a nuisance and someone
    // will delete it rather than fix it.
    const legal = `db.collection(C).orderBy('savedAt','desc').where('savedAt','>=',since)`;
    expect([...legal.matchAll(CHAIN)]).toEqual([]);
  });
});

describe('newestFirstBy', () => {
  it('sorts newest first', () => {
    const rows = [{ at: 1 }, { at: 3 }, { at: 2 }];
    expect(newestFirstBy(rows, 'at').map((r) => r.at)).toEqual([3, 2, 1]);
  });

  it('sorts rows missing the field LAST, and never drops them', () => {
    // A record written before the timestamp field existed must not outrank today's, and must not
    // disappear — a listing that silently loses rows is the failure this whole file exists to stop.
    const rows = [{ at: 5 }, { id: 'old' } as { at?: number; id?: string }, { at: 9 }];
    const sorted = newestFirstBy(rows as Array<{ at?: number; id?: string }>, 'at');
    expect(sorted).toHaveLength(3);
    expect(sorted[2]).toEqual({ id: 'old' });
  });

  it('does not mutate the caller array', () => {
    const rows = [{ at: 1 }, { at: 2 }];
    newestFirstBy(rows, 'at');
    expect(rows.map((r) => r.at)).toEqual([1, 2]);
  });
});

describe('listEqNewestFirst', () => {
  /** A Firestore query double that records exactly what was asked of it. */
  function fakeCollection(docs: Array<Record<string, unknown>>) {
    const calls = { where: [] as Array<[string, string, unknown]>, limit: 0, orderBy: 0 };
    const q = {
      where(field: string, op: string, value: unknown) {
        calls.where.push([field, op, value]);
        return q;
      },
      orderBy() { calls.orderBy++; return q; },
      limit(n: number) { calls.limit = n; return q; },
      async get() {
        const matching = docs.filter((d) => calls.where.every(([f, , v]) => d[f] === v));
        return { docs: matching.map((data) => ({ data: () => data })) };
      },
    };
    return { q, calls };
  }

  it('applies every filter as equality, caps the read, and never orders in the query', async () => {
    const { q, calls } = fakeCollection([
      { uid: 'a', at: 1 }, { uid: 'a', at: 3 }, { uid: 'b', at: 9 },
    ]);
    const rows = await listEqNewestFirst<{ uid: string; at: number }>(
      q as never, [['uid', 'a']], 'at', 10,
    );
    expect(rows.map((r) => r.at)).toEqual([3, 1]);
    expect(calls.where).toEqual([['uid', '==', 'a']]);
    expect(calls.orderBy).toBe(0); // the whole point: the query itself never sorts
    expect(calls.limit).toBe(INDEX_SAFE_FETCH_CAP);
  });

  it('supports several equality filters (Firestore merges single-field indexes for those)', async () => {
    const { q, calls } = fakeCollection([
      { uid: 'a', status: 'listed', at: 2 },
      { uid: 'a', status: 'draft', at: 5 },
    ]);
    const rows = await listEqNewestFirst<{ at: number }>(
      q as never, [['uid', 'a'], ['status', 'listed']], 'at', 10,
    );
    expect(rows.map((r) => r.at)).toEqual([2]);
    expect(calls.where).toHaveLength(2);
  });

  it('returns the NEWEST rows when more match than the caller asked for', async () => {
    // Sorting after the fetch is what makes a truncated listing "the newest 2" rather than
    // "2 arbitrary ones" — the property that makes in-memory sorting acceptable at all.
    const { q } = fakeCollection([{ at: 1 }, { at: 4 }, { at: 2 }, { at: 3 }]);
    const rows = await listEqNewestFirst<{ at: number }>(q as never, [], 'at', 2);
    expect(rows.map((r) => r.at)).toEqual([4, 3]);
  });

  it('honours an explicit fetch cap', async () => {
    const { q, calls } = fakeCollection([{ at: 1 }]);
    await listEqNewestFirst(q as never, [], 'at', 5, 42);
    expect(calls.limit).toBe(42);
  });
});
