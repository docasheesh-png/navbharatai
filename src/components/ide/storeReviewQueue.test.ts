import { describe, it, expect } from 'vitest';
import {
  mergeReviewQueue, pendingReviewCount, reviewStatusLabel, reviewActionsFor,
  type ReviewQueueApp,
} from './storeReviewQueue';

/**
 * ADMIN 2026-08-21: "app mart me, admin aprove kare uske bad, app waha se gayab na ho, 'aproved' likh
 * kar dikhti rahe."
 *
 * THE DEFECT: the review list fetched `status=pending` only. Approving an app therefore made it
 * disappear from the one screen that showed it — the admin could not see what they had approved, and
 * had no route back to it to take it down. The approval was real; the record of it was not.
 */
const app = (id: string, status: string): ReviewQueueApp => ({ id, status });

describe('mergeReviewQueue — an approved app STAYS on the review screen', () => {
  it('THE RULE: approved apps are listed alongside pending ones, not dropped', () => {
    const q = mergeReviewQueue([app('p1', 'pending')], [app('a1', 'approved')]);
    expect(q.map((a) => a.id)).toEqual(['p1', 'a1']);
  });

  it('pending comes FIRST — that is the work; approved follows as a record', () => {
    const q = mergeReviewQueue(
      [app('p1', 'pending'), app('p2', 'pending')],
      [app('a1', 'approved')],
    );
    expect(q.map((a) => a.id)).toEqual(['p1', 'p2', 'a1']);
  });

  it('de-duplicates by id, so an app approved BETWEEN the two calls appears once', () => {
    // The two fetches are independent. Without this the stale pending copy would render first and
    // offer Publish/Reject on an app that is already live.
    const q = mergeReviewQueue([app('x', 'pending')], [app('x', 'approved')]);
    expect(q).toHaveLength(1);
    expect(q[0].status).toBe('pending'); // first wins; the next load settles it
  });

  it('a failed call on either side degrades to the other list, never to an empty screen', () => {
    expect(mergeReviewQueue(null, [app('a1', 'approved')]).map((a) => a.id)).toEqual(['a1']);
    expect(mergeReviewQueue([app('p1', 'pending')], undefined).map((a) => a.id)).toEqual(['p1']);
    expect(mergeReviewQueue(null, null)).toEqual([]);
  });

  it('skips malformed records rather than rendering a card with no id', () => {
    const q = mergeReviewQueue([{ id: '', status: 'pending' }, app('ok', 'pending')], []);
    expect(q.map((a) => a.id)).toEqual(['ok']);
  });
});

describe('pendingReviewCount — the tab badge', () => {
  it('counts only what still needs a DECISION', () => {
    // Counting approved apps too would make the badge permanent, and a number that never reaches
    // zero stops meaning "there is work here".
    expect(pendingReviewCount([app('p1', 'pending'), app('a1', 'approved'), app('a2', 'approved')])).toBe(1);
    expect(pendingReviewCount([app('a1', 'approved')])).toBe(0);
    expect(pendingReviewCount([])).toBe(0);
  });
});

describe('what each card SAYS and OFFERS', () => {
  it('an approved app is labelled "Approved" — visibly, which is the whole ask', () => {
    expect(reviewStatusLabel('approved')).toBe('Approved');
    expect(reviewStatusLabel('pending')).toBe('Waiting');
  });

  it('an approved app offers only "remove" — Publish/Reject would be decisions already made', () => {
    expect(reviewActionsFor('approved')).toBe('remove');
    expect(reviewActionsFor('pending')).toBe('decide');
  });
});
