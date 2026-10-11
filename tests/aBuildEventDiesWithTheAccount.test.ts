/**
 * Q-784 — THE FOURTH REACHABILITY SHAPE: THE OWNER IS A WORKSPACE ID, IN A FIELD.
 *
 * 🔴 WHAT SURVIVED, AND WHY NOTHING COULD FIND IT. `build_events` is the bus's durable trail — one
 * document per published event, carrying the event type, the sender, a trimmed payload preview and the
 * `workspaceId`, which is `agentv3-{uid}-…` and therefore contains the person. It is written with
 * `.add()`, so the document id is random. Account deletion had exactly three queries:
 *
 *   · `deleteUserData` `'docId'`      — the id IS the uid. Here the id is random.
 *   · `deleteUserData` `{field}`      — a field EQUALS the uid. Here the field holds a workspace id,
 *                                       and one person has many of them.
 *   · `deleteUserWorkspaceData`       — a RANGE over the document ID. Here the id says nothing at all.
 *
 * So every build event of every app a person ever built outlived their account. Q-767 put a 90-day
 * window on the collection, which bounded it — but Privacy §9 publishes *thirty* days for personal data
 * after a deletion, so the window alone could not keep the promise. A range over the FIELD is the one
 * query that matches exactly those documents, and Firestore serves it from the single-field index it
 * keeps automatically.
 *
 * 🔒 AND IT REFUSES WHAT IT CANNOT DO SAFELY. The prefix is `agentv3-{uid}-`, so a uid containing `-`
 * makes `agentv3-a-b-` ambiguous between uid `a-b` and uid `a` with a suffix beginning `b-`. That range
 * is refused outright rather than made to work — the reasoning PR #3611 recorded and this reuses: a
 * compliance gap is recoverable, deleting a different person's data is not. Each matched document is
 * then checked anyway, with the workspace eraser's own predicate, because "the range should already
 * guarantee this" is not a safety property when the action is irreversible.
 */
import { describe, it, expect } from 'vitest';
import { planWorkspaceFieldErase } from '../src/server/lib/derivedIdErase';
import { eraseableWorkspaceId, planWorkspaceErase } from '../src/server/lib/workspaceDataErase';
import { USER_SCOPED_COLLECTIONS, RETENTION_POLICIES } from '../src/server/lib/DataRetentionManager';

const UID = 'abc123';

describe('planWorkspaceFieldErase — the range over the workspaceId FIELD (Q-784)', () => {
  it('is exactly the `agentv3-{uid}-` prefix range the document-id eraser uses', () => {
    const range = planWorkspaceFieldErase(UID)!;
    expect(range.startAt).toBe(`agentv3-${UID}-`);
    expect(range.endAt.startsWith(`agentv3-${UID}-`)).toBe(true);
    // Not a new definition of ownership — the SAME one, so the two erasers cannot disagree about
    // whose data a workspace id names.
    expect(range).toEqual(planWorkspaceErase(UID).range);
  });

  it("cannot reach a workspace belonging to a uid that merely starts with this one", () => {
    const range = planWorkspaceFieldErase('ab')!;
    const other = `agentv3-${UID}-main`;
    expect(other >= range.startAt && other <= range.endAt).toBe(false);
  });

  it('reaches every workspace of this user, whatever the suffix', () => {
    const range = planWorkspaceFieldErase(UID)!;
    for (const ws of [`agentv3-${UID}-main`, `agentv3-${UID}-app2`, `agentv3-${UID}-zzz-9`]) {
      expect(ws >= range.startAt && ws <= range.endAt, ws).toBe(true);
    }
  });

  it('🔒 REFUSES a uid containing the separator instead of sweeping an ambiguous range', () => {
    // `agentv3-a-b-` would match uid `a-b` AND uid `a` with a suffix starting `b-`. Over-deletion here
    // means deleting a stranger's build trail, which is not a recoverable mistake.
    expect(planWorkspaceFieldErase('a-b')).toBeNull();
    expect(planWorkspaceFieldErase('has-dash')).toBeNull();
  });

  it('refuses an empty, blank or absent uid', () => {
    for (const bad of ['', '   ', null, undefined]) {
      expect(planWorkspaceFieldErase(bad as string | null | undefined), String(bad)).toBeNull();
    }
  });

  it('refuses exactly the uids the workspace eraser refuses — never a wider set', () => {
    // If these two ever disagreed, one eraser would sweep a range the other declared unsafe.
    for (const uid of ['abc123', 'a-b', '', 'XY99', 'has-dash']) {
      const mine = planWorkspaceFieldErase(uid) !== null;
      const theirs = planWorkspaceErase(uid).range !== null && !uid.includes('-') && uid.trim() !== '';
      expect(mine, uid).toBe(theirs);
    }
  });

  it('the per-document verifier is the one the workspace eraser already applies', () => {
    expect(eraseableWorkspaceId(UID, `agentv3-${UID}-main`)).toBe(true);
    expect(eraseableWorkspaceId(UID, 'agentv3-someoneelse-main')).toBe(false);
    // A value inside the RANGE but not actually this user's is still refused — which is the whole
    // reason each document is checked rather than trusted.
    expect(eraseableWorkspaceId('ab', `agentv3-${UID}-main`)).toBe(false);
  });
});

describe('Q-784 — the wiring is real, not just a planner nobody calls', () => {
  const source = () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    return fs.readFileSync(path.resolve(__dirname, '../src/server/lib/derivedIdErase.ts'), 'utf8');
  };

  it('the cascade really sweeps build_events, and reports it as its own line', () => {
    const src = source();
    expect(src).toMatch(/deleteFieldRange\(\s*\n?\s*store, 'build_events', 'workspaceId', eventRange,/);
    expect(src).toMatch(/collection: 'build_events', documents: eventDocs/);
    // Verified per document, not merely matched by the range.
    expect(src).toMatch(/eraseableWorkspaceId\(uid, workspaceId\)/);
  });

  it('🔒 the page loop cannot spin on documents it refuses to delete', () => {
    // The sweep re-queries from the start of the range each page (deletions shrink the set, and a
    // cursor over a repeated field value can stall). Without the progress guard, a page in which every
    // document failed the verifier would be re-read until MAX_PAGES.
    expect(source()).toMatch(/if \(!progressed\) break;/);
  });

  it('build_events keeps BOTH obligations — the clock and the account', () => {
    // 90 days bounds what any user accumulates; the erase is what keeps §9's 30-day promise for a
    // person who left. Either alone is a half-answer, so neither may quietly replace the other.
    expect(RETENTION_POLICIES.find((p) => p.collection === 'build_events')?.ttlDays).toBe(90);
    // It is erased by the module, deliberately not by the registry — there is no field equal to a uid.
    expect(USER_SCOPED_COLLECTIONS.some((c) => c.collection === 'build_events')).toBe(false);
  });
});
