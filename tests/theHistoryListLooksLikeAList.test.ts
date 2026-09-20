// "claude and gpt jaisa karo!! open chat button kyu banaya hai. hatao isko!!" (admin 2026-09-20,
// with Claude's and ChatGPT's own sidebars screenshotted beside ours)
//
// Ours had become a stack of cards: title + a `CUI:` id + a mode chip + an App/Chat badge + a full
// timestamp + the agent name + a big indigo **Open Chat** button — seven pieces of chrome to reach one
// conversation, three or four to a phone screen. Claude and ChatGPT show the title and nothing else.
//
// 🔑 The move that makes that possible is not minimalism, it is the GROUP HEADING: it carries the time
// for every row beneath it, so no row spends a line on its own date. That is what these tests lock —
// the grouping's boundaries, and the fact that the chrome really left rather than shrank.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { recencyLabel, groupSessionsByRecency, RECENCY_ORDER } from '../src/components/history/historyGroups';

/** Fixed clock: 2026-09-20, 18:00 local. Boundaries are LOCAL days, so the test builds local dates. */
const NOW = new Date(2026, 8, 20, 18, 0, 0).getTime();
const atLocal = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).toISOString();

describe('recencyLabel', () => {
  it('puts a still-open conversation under Ongoing — it has no "when" yet', () => {
    expect(recencyLabel({ profLive: true, lastUpdated: atLocal(2020, 0, 1) }, NOW)).toBe('Ongoing');
  });

  it('walks the day boundaries in the viewer’s own timezone', () => {
    expect(recencyLabel({ lastUpdated: atLocal(2026, 8, 20, 1) }, NOW)).toBe('Today');
    expect(recencyLabel({ lastUpdated: atLocal(2026, 8, 19, 23) }, NOW)).toBe('Yesterday');
    expect(recencyLabel({ lastUpdated: atLocal(2026, 8, 16) }, NOW)).toBe('Previous 7 days');
    expect(recencyLabel({ lastUpdated: atLocal(2026, 8, 1) }, NOW)).toBe('Previous 30 days');
    expect(recencyLabel({ lastUpdated: atLocal(2026, 5, 1) }, NOW)).toBe('Older');
  });

  it('accepts millis as well as an ISO string, because sessions carry both', () => {
    expect(recencyLabel({ lastUpdated: NOW }, NOW)).toBe('Today');
  });

  it('🔒 an UNKNOWN date is Older, never Today', () => {
    // A row with no timestamp is not new — it is a row whose date we do not know, and placing it at
    // the top would put it above conversations that genuinely are from today. Wrong toward "old"
    // costs one scroll; wrong toward "today" is a claim about the row that nothing supports.
    expect(recencyLabel({}, NOW)).toBe('Older');
    expect(recencyLabel({ lastUpdated: null }, NOW)).toBe('Older');
    expect(recencyLabel({ lastUpdated: 'not a date' }, NOW)).toBe('Older');
  });
});

describe('groupSessionsByRecency', () => {
  it('🔒 NEVER re-sorts — the caller’s order is already meaningful', () => {
    // sortMergedRows puts LIVE professional chats on top and the Firestore query is newest-first. A
    // sort here would silently overrule that and nothing would fail — the live chat would just stop
    // being first.
    const rows = [
      { id: 'c', lastUpdated: atLocal(2026, 8, 20, 9) },
      { id: 'a', lastUpdated: atLocal(2026, 8, 20, 17) },
      { id: 'b', lastUpdated: atLocal(2026, 8, 20, 13) },
    ];
    const [today] = groupSessionsByRecency(rows, NOW);
    expect(today.label).toBe('Today');
    expect(today.rows.map((r) => r.id)).toEqual(['c', 'a', 'b']);
  });

  it('returns only the groups that have rows, in the fixed order', () => {
    const groups = groupSessionsByRecency([
      { id: '1', lastUpdated: atLocal(2026, 5, 1) },
      { id: '2', profLive: true },
      { id: '3', lastUpdated: atLocal(2026, 8, 20) },
    ], NOW);
    expect(groups.map((g) => g.label)).toEqual(['Ongoing', 'Today', 'Older']);
    // An account with three conversations from today shows ONE heading, not six with five empty.
    expect(groupSessionsByRecency([{ id: '1', lastUpdated: NOW }], NOW)).toHaveLength(1);
  });

  it('is total', () => {
    expect(groupSessionsByRecency([], NOW)).toEqual([]);
    expect(groupSessionsByRecency(undefined as never, NOW)).toEqual([]);
    expect(RECENCY_ORDER[0]).toBe('Ongoing');
  });
});

describe('🔒 the chrome really left the row', () => {
  const view = readFileSync('src/components/HistoryView.tsx', 'utf8');
  /** Comments stripped — the comment at each site quotes what it removed, by name. */
  const code = view.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n')
    .map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');

  it('🔴 there is no "Open Chat" button anywhere', () => {
    expect(code).not.toContain('Open Chat');
    expect(code).not.toContain('LogIn');
  });

  it('the ROW is the button, so removing that control did not remove the way in', () => {
    // A row you can see but not tap would be worse than the button it replaced.
    expect(code).toContain('onClick={openRow}');
    expect(code).toContain('min-w-0 flex-1 flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left');
  });

  it('the per-row id, badges and timestamp are gone from the row', () => {
    expect(code).not.toContain('CUI: {session.uci');
    expect(code).not.toContain('ShieldCheck');
    expect(code).not.toContain('new Date(session.lastUpdated).toLocaleString()');
  });

  it('⚠️ but the id is still SEARCHABLE, so nothing became unfindable', () => {
    expect(code).toContain("(s.uci && s.uci.toLowerCase().includes(q))");
    expect(view).toContain('Search by title, CUI, or message...');
  });

  it('the group heading is what replaced the per-row date', () => {
    expect(code).toContain('groupSessionsByRecency(filteredSessions, Date.now())');
    expect(code).toContain('{group.label}');
  });

  it('🔒 DELETE still exists, and still confirms', () => {
    // Claude and ChatGPT both keep it; dropping a real capability to look like them would be a
    // regression wearing a redesign. And a destructive action on a one-line row must not be one tap.
    expect(code).toContain('setConfirmDeleteId(session.id)');
    expect(code).toContain('This cannot be undone.');
    expect(code).toContain('deleteRow(); setConfirmDeleteId(null);');
  });

  it('the blank-title fallback survived the rewrite', () => {
    // sessionShape.test.ts asserts this exact reader — it is the crash site that rule was written for.
    expect(code).toContain("messagesOf(session).find((m) => m.sender === 'user')");
  });

  it('the idle count is gone; the count while SEARCHING stays, because there it is the answer', () => {
    expect(code).not.toMatch(/\{filteredSessions\.length\} session/);
    expect(code).toContain("searchQuery.trim() !== '' && (");
    expect(code).toContain('result{filteredSessions.length !== 1');
  });
});

describe('🔒 the popup does not title itself twice', () => {
  const popup = readFileSync('src/components/history/HistoryPopup.tsx', 'utf8');
  const view = readFileSync('src/components/HistoryView.tsx', 'utf8');

  it('the sheet asks the view to drop its own heading', () => {
    expect(popup).toContain('embedded');
    expect(view).toContain('{!embedded && (');
  });

  it('and the TAB keeps its heading — it is a whole screen', () => {
    expect(view).toContain('Session History');
  });

  it('the sheet is themed, not painted GitHub-dark', () => {
    // It was `bg-[#0d1117]` with zinc borders: a black sheet over a white app on the Light theme.
    expect(popup).not.toContain('#0d1117');
    expect(popup).not.toContain('zinc-800');
    expect(popup).toContain('bg-surface border border-line');
  });
});
