import { describe, it, expect } from 'vitest';
import { parseReferredAnswer, referredTotals, friendStatusLabel, FRIEND_STEPS_TOTAL } from '../src/lib/referredFriendsView';

/**
 * A SERVER BODY IS NOT THE ANSWER UNTIL IT IS CHECKED — a refusal is not "no friends yet".
 * And no ₹ is derived per friend: the totals count verifications, never multiply them.
 */
const friend = (over: Record<string, unknown> = {}) => ({
  label: 'am••••@mail.com', emailVerified: true, phoneVerified: true, githubLinked: false, completedCount: 2, referredAt: '2026-10-10T16:12:00Z', ...over,
});

describe('parseReferredAnswer', () => {
  it('accepts the real answer', () => {
    const a = parseReferredAnswer({ ok: true, enabled: true, count: 1, friends: [friend()] });
    expect(a?.friends).toHaveLength(1);
    expect(a?.friends[0]).toMatchObject({ label: 'am••••@mail.com', completedCount: 2, githubLinked: false });
  });

  it('REJECTS a refusal, a proxy page and a half-written body — they are not "no friends"', () => {
    for (const bad of [null, undefined, 'x', 7, [], {}, { error: 'nope' }, { ok: false, friends: [] }, { ok: true }, { ok: true, friends: 'x' }]) {
      expect(parseReferredAnswer(bad)).toBeNull();
    }
  });

  it('rewards-off is a state of its own, not an empty list', () => {
    expect(parseReferredAnswer({ ok: true, enabled: false, count: 0, friends: [] })).toMatchObject({ enabled: false, friends: [] });
  });

  it('drops an unreadable row rather than guessing it, and clamps the count to 0–3', () => {
    const a = parseReferredAnswer({ ok: true, friends: [friend(), { label: 'x' }, null, friend({ completedCount: 99 }), friend({ completedCount: -4 })] })!;
    expect(a.friends.map((f) => f.completedCount)).toEqual([2, FRIEND_STEPS_TOTAL, 0]);
  });

  it('names a missing label "A friend" and never shows an address field', () => {
    const a = parseReferredAnswer({ ok: true, friends: [friend({ label: '' , email: 'secret@mail.com' })] })!;
    expect(a.friends[0].label).toBe('A friend');
    expect(JSON.stringify(a)).not.toContain('secret@mail.com');
  });
});

describe('wording and totals', () => {
  it('says how many steps are left, in plain words', () => {
    expect(friendStatusLabel(parseReferredAnswer({ ok: true, friends: [friend({ completedCount: 2 })] })!.friends[0])).toBe('1 step left');
    expect(friendStatusLabel(parseReferredAnswer({ ok: true, friends: [friend({ completedCount: 1 })] })!.friends[0])).toBe('2 steps left');
    expect(friendStatusLabel(parseReferredAnswer({ ok: true, friends: [friend({ completedCount: 3 })] })!.friends[0])).toBe('All verifications complete');
  });

  it('totals add up: invited = completed + in progress', () => {
    const a = parseReferredAnswer({ ok: true, friends: [friend({ completedCount: 3 }), friend({ completedCount: 3 }), friend({ completedCount: 1 }), friend({ completedCount: 0 })] })!;
    expect(referredTotals(a.friends)).toEqual({ total: 4, completed: 2, pending: 2 });
  });
});
