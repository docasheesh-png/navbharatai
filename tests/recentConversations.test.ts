import { describe, it, expect } from 'vitest';
import {
  recentConversations, sessionRow, professionalRow, sortRecent, RECENT_LIMIT,
  type RecentConversation,
} from '../src/lib/recentConversations';
import { placeKey } from '../src/lib/lastPlace';
import type { HistoryIndexRow } from '../src/lib/historyIndex';

/**
 * The list on Home — "old session kis button ke piche hide na ho".
 *
 * The ORDERING is the part with teeth: three stores that share no clock (Free/Pro sessions carry a
 * `lastUpdated`, an ended professional carries `endedAt`, a LIVE professional carries nothing at
 * all), merged into one list a person is meant to recognise at a glance.
 */

const row = (over: Partial<HistoryIndexRow> = {}): HistoryIndexRow => ({
  id: 's1', title: 'Plan my week', lastUpdated: '2026-01-02T00:00:00Z', messageCount: 4, ...over,
});

describe('sessionRow — a saved conversation becomes a row', () => {
  it('a free session is tagged Free chat and opens the free surface', () => {
    const r = sessionRow(row())!;
    expect(r.kind).toBe('free');
    expect(r.view).toBe('nbi_chat');
    expect(r.tag).toBe('Free chat');
    expect(r.sessionId).toBe('s1');
    expect(r.title).toBe('Plan my week');
  });

  it('a Pro session and a Doctor session get their own surface and tag', () => {
    expect(sessionRow(row({ agent: 'navbharatai-pro' }))).toMatchObject({ kind: 'pro', view: 'nbi_pro_chat' });
    expect(sessionRow(row({ agent: 'sda' }))).toMatchObject({ kind: 'doctor', view: 'sda_chat' });
  });

  it('a legacy Vishwakarma session opens as Pro — its transcript stays reachable', () => {
    expect(sessionRow(row({ agent: 'vishwakarma_pro' }))).toMatchObject({ kind: 'pro', view: 'nbi_pro_chat' });
  });

  it('an EMPTY conversation is not offered — "continue" on nothing is a button that does nothing', () => {
    expect(sessionRow(row({ messageCount: 0 }))).toBeNull();
    expect(sessionRow(row({ messageCount: 1 }))).toBeNull();
    expect(sessionRow(row({ messageCount: undefined }))).toBeNull();
  });

  it('a row with no id cannot be opened, so it is not a row', () => {
    expect(sessionRow(row({ id: '' }))).toBeNull();
  });

  it('a placeholder title falls back to the surface name rather than showing "New Conversation"', () => {
    expect(sessionRow(row({ title: 'New Conversation' }))!.title).toBe('Free chat');
    expect(sessionRow(row({ title: 'Untitled' }))!.title).toBe('Free chat');
    expect(sessionRow(row({ title: '   ' }))!.title).toBe('Free chat');
  });

  it('a very long title is cut, and the whitespace in it is collapsed', () => {
    const r = sessionRow(row({ title: `${'x'.repeat(200)}` }))!;
    expect(r.title.length).toBeLessThanOrEqual(61);
    expect(sessionRow(row({ title: 'a\n\n  b' }))!.title).toBe('a b');
  });

  it('an unparseable timestamp is null, never 0 — it sorts last instead of pretending to be 1970', () => {
    expect(sessionRow(row({ lastUpdated: 'nonsense' }))!.at).toBeNull();
    expect(sessionRow(row({ lastUpdated: '' }))!.at).toBeNull();
  });
});

describe('professionalRow', () => {
  it('an ENDED conversation knows exactly when it ended', () => {
    const r = professionalRow({ id: 'lawyer_ai', name: 'Lawyer AI', preview: 'about my lease', endedAt: 500 }, {})!;
    expect(r).toMatchObject({ kind: 'professional', view: 'lawyer_ai', tag: 'Lawyer AI', at: 500, profEndedAt: 500 });
  });

  it('a LIVE one takes its time from the activity ledger — the only clock it has', () => {
    const r = professionalRow({ id: 'teacher_ai', name: 'Teacher AI', preview: 'photosynthesis' },
      { [placeKey('teacher_ai')]: 800 })!;
    expect(r.at).toBe(800);
    expect(r.profEndedAt).toBeUndefined();
  });

  it('🔒 with no ledger entry the time is NULL, not a fabricated one', () => {
    // A 0 would bury a real conversation for ever; a Date.now() would float an old one to the top.
    // The row renders "Ongoing", which is what it honestly is.
    expect(professionalRow({ id: 'teacher_ai', name: 'Teacher AI', preview: 'x' }, {})!.at).toBeNull();
  });

  it('an empty preview falls back to the professional’s name', () => {
    expect(professionalRow({ id: 'chef_ai', name: 'Chef AI', preview: '' }, {})!.title).toBe('Chef AI');
  });

  it('the live and the ended conversations of one professional are different rows', () => {
    const live = professionalRow({ id: 'chef_ai', name: 'Chef AI', preview: 'a' }, {})!;
    const ended = professionalRow({ id: 'chef_ai', name: 'Chef AI', preview: 'b', endedAt: 7 }, {})!;
    expect(live.key).not.toBe(ended.key);
  });
});

describe('sortRecent', () => {
  const r = (key: string, at: number | null): RecentConversation =>
    ({ key, kind: 'free', view: 'nbi_chat', title: key, tag: 'Free chat', at });

  it('newest first', () => {
    expect(sortRecent([r('a', 1), r('c', 3), r('b', 2)]).map((x) => x.key)).toEqual(['c', 'b', 'a']);
  });

  it('a conversation with no known time sorts LAST rather than being dropped', () => {
    expect(sortRecent([r('unknown', null), r('dated', 5)]).map((x) => x.key)).toEqual(['dated', 'unknown']);
  });

  it('does not mutate the caller’s array', () => {
    const input = [r('a', 1), r('b', 2)];
    sortRecent(input);
    expect(input.map((x) => x.key)).toEqual(['a', 'b']);
  });
});

describe('recentConversations — the merged list', () => {
  it('merges all three surfaces into one ordered list', () => {
    const out = recentConversations({
      sessions: [row({ id: 'free1', lastUpdated: '2026-01-01T00:00:00Z' })],
      professionals: [{ id: 'lawyer_ai', name: 'Lawyer AI', preview: 'lease', endedAt: Date.parse('2026-03-01T00:00:00Z') }],
      activity: {},
    });
    expect(out.map((r) => r.view)).toEqual(['lawyer_ai', 'nbi_chat']);
  });

  it('🔑 the ledger OVERRIDES a session’s own timestamp when it is newer', () => {
    // `lastUpdated` moves only when a message is written. Someone who opened a chat, read it and
    // left has genuinely been there most recently, and the list should say so.
    const out = recentConversations({
      sessions: [
        row({ id: 'read', lastUpdated: '2026-01-01T00:00:00Z' }),
        row({ id: 'written', lastUpdated: '2026-02-01T00:00:00Z' }),
      ],
      professionals: [],
      activity: { [placeKey('nbi_chat', 'read')]: Date.parse('2026-05-01T00:00:00Z') },
    });
    expect(out[0]?.sessionId).toBe('read');
  });

  it('…but never makes a conversation look OLDER than its own record', () => {
    const out = recentConversations({
      sessions: [row({ id: 'a', lastUpdated: '2026-06-01T00:00:00Z' })],
      professionals: [],
      activity: { [placeKey('nbi_chat', 'a')]: 1 },
    });
    expect(out[0]?.at).toBe(Date.parse('2026-06-01T00:00:00Z'));
  });

  it('caps the list, keeping the newest', () => {
    const many = Array.from({ length: RECENT_LIMIT + 5 }, (_, i) =>
      row({ id: `s${i}`, lastUpdated: new Date(2026, 0, i + 1).toISOString() }));
    const out = recentConversations({ sessions: many, professionals: [], activity: {} });
    expect(out).toHaveLength(RECENT_LIMIT);
    expect(out[0]?.sessionId).toBe(`s${RECENT_LIMIT + 4}`);
  });

  it('honours an explicit limit, and ignores a nonsensical one', () => {
    const many = Array.from({ length: 5 }, (_, i) => row({ id: `s${i}` }));
    expect(recentConversations({ sessions: many, professionals: [], activity: {}, limit: 2 })).toHaveLength(2);
    expect(recentConversations({ sessions: many, professionals: [], activity: {}, limit: 0 })).toHaveLength(5);
  });

  it('one conversation never appears twice', () => {
    const dup = row({ id: 'same' });
    expect(recentConversations({ sessions: [dup, { ...dup }], professionals: [], activity: {} })).toHaveLength(1);
  });

  it('empty in, empty out — Home then renders nothing at all', () => {
    expect(recentConversations({ sessions: [], professionals: [], activity: {} })).toEqual([]);
    expect(recentConversations({ sessions: [], professionals: [], activity: undefined as never })).toEqual([]);
  });

  it('every row carries what opening it needs', () => {
    const out = recentConversations({
      sessions: [row({ id: 'free1' })],
      professionals: [{ id: 'chef_ai', name: 'Chef AI', preview: 'dal', endedAt: 9 }],
      activity: {},
    });
    const free = out.find((r) => r.kind === 'free')!;
    const prof = out.find((r) => r.kind === 'professional')!;
    expect(free.sessionId).toBe('free1');
    expect(prof.view).toBe('chef_ai');
    expect(prof.profEndedAt).toBe(9);
    expect(new Set(out.map((r) => r.key)).size).toBe(out.length);
  });
});
