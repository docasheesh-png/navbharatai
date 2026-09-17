import { describe, it, expect } from 'vitest';
import {
  lastAdminMessageAt,
  lastActivityAt,
  hasUnreadAdminReply,
  unreadReportCount,
  sortReportsByActivity,
  type ReportMessage,
  type UserReport,
} from '../src/lib/userReport';

/**
 * THE UNREAD DOT — one rule, three screens.
 *
 * 🔴 What was wrong before (admin 2026-09-17). The report sheet showed a green "Reply" chip whenever
 * `messages.filter(m => m.from === 'admin').length > 0`. That says *"a reply arrived at some point"*,
 * never *"a reply is NEW"* — so it could not clear, because nothing anywhere recorded that the person
 * had read anything. A badge that never goes out is decoration, and people stop seeing it in a day.
 *
 * These tests pin the rule the sidebar entry, the "Old reports" choice and the single conversation all
 * read from — they must never disagree, because a dot that leads to a list with no dot teaches people
 * to ignore dots.
 */

const msg = (from: 'admin' | 'user', at: number): ReportMessage => ({ from, text: 'x', at });

const rep = (over: Partial<UserReport> = {}): UserReport => ({
  id: 'r1', reporterUid: 'u1', target: { kind: 'app' }, message: 'it broke',
  hasScreenshot: false, context: {}, at: 1_000, status: 'open',
  ...over,
} as UserReport);

describe('lastAdminMessageAt — when did NavBharatAI last write', () => {
  it('finds the LATEST admin message, not the first, and ignores the user’s own', () => {
    expect(lastAdminMessageAt([msg('admin', 10), msg('user', 50), msg('admin', 30)])).toBe(30);
  });

  it('is null when only the user has written, or when nothing has', () => {
    expect(lastAdminMessageAt([msg('user', 10), msg('user', 20)])).toBeNull();
    expect(lastAdminMessageAt([])).toBeNull();
    expect(lastAdminMessageAt(undefined)).toBeNull();
  });

  it('a corrupt timestamp is skipped rather than treated as time zero', () => {
    // A NaN sorting as 0 would silently make a real reply look older than everything.
    expect(lastAdminMessageAt([{ from: 'admin', text: 'x', at: NaN } as ReportMessage, msg('admin', 5)])).toBe(5);
    expect(lastAdminMessageAt([{ from: 'admin', text: 'x', at: NaN } as ReportMessage])).toBeNull();
  });
});

describe('hasUnreadAdminReply — the rule every dot is computed from', () => {
  it('a reply AFTER the last open is unread', () => {
    expect(hasUnreadAdminReply(rep({ messages: [msg('admin', 500)], reporterReadAt: 400 }))).toBe(true);
  });

  it('a reply BEFORE the last open is read, and the dot goes out', () => {
    expect(hasUnreadAdminReply(rep({ messages: [msg('admin', 300)], reporterReadAt: 400 }))).toBe(false);
  });

  it('opening at the exact moment of the reply counts as read — no dot for a message already on screen', () => {
    expect(hasUnreadAdminReply(rep({ messages: [msg('admin', 400)], reporterReadAt: 400 }))).toBe(false);
  });

  it('the user’s OWN messages never make their own report unread', () => {
    expect(hasUnreadAdminReply(rep({ messages: [msg('user', 900)], reporterReadAt: 400 }))).toBe(false);
  });

  it('a report with no reply at all is never unread', () => {
    expect(hasUnreadAdminReply(rep({ messages: [], reporterReadAt: 400 }))).toBe(false);
    expect(hasUnreadAdminReply(rep({ reporterReadAt: 400 }))).toBe(false);
  });

  it('🔒 a LEGACY report (no read stamp) is treated as READ — the first dot must never be a false one', () => {
    // The other reading — "never opened ⇒ unread" — would light the sidebar up for every past user on
    // deploy day, including for replies they read months ago in the old sheet.
    expect(hasUnreadAdminReply(rep({ messages: [msg('admin', 500)] }))).toBe(false);
    expect(hasUnreadAdminReply(rep({ messages: [msg('admin', 500)], reporterReadAt: undefined }))).toBe(false);
  });

  it('…and it self-corrects: once opened, the NEXT reply does raise a dot', () => {
    const opened = rep({ messages: [msg('admin', 500)], reporterReadAt: 600 });
    expect(hasUnreadAdminReply(opened)).toBe(false);
    const replied = { ...opened, messages: [...(opened.messages ?? []), msg('admin', 700)] };
    expect(hasUnreadAdminReply(replied)).toBe(true);
  });

  it('an unreadable read stamp is treated as legacy, never as time zero', () => {
    // NaN > anything is false, so it would accidentally behave; a later refactor comparing the other
    // way would flip every old conversation to unread at once. Pinned so it cannot.
    expect(hasUnreadAdminReply(rep({ messages: [msg('admin', 500)], reporterReadAt: NaN }))).toBe(false);
  });
});

describe('unreadReportCount — the number behind the sidebar dot', () => {
  it('counts only the conversations that really carry a new reply', () => {
    expect(unreadReportCount([
      rep({ id: 'a', messages: [msg('admin', 500)], reporterReadAt: 400 }), // unread
      rep({ id: 'b', messages: [msg('admin', 300)], reporterReadAt: 400 }), // read
      rep({ id: 'c', messages: [msg('user', 900)], reporterReadAt: 400 }),  // own message
      rep({ id: 'd', messages: [msg('admin', 900)] }),                      // legacy
      rep({ id: 'e', messages: [msg('admin', 800)], reporterReadAt: 100 }), // unread
    ])).toBe(2);
  });

  it('an empty inbox is zero, never a phantom dot', () => {
    expect(unreadReportCount([])).toBe(0);
  });
});

describe('sortReportsByActivity — the inbox order the admin asked for', () => {
  it('the conversation with the newest reply comes FIRST, whatever order it was filed in', () => {
    // Admin, verbatim: "sabse upar woh chat ho, jis chat me admin ka latest reply hai".
    const old = rep({ id: 'old', at: 100, messages: [msg('admin', 9_000)] });
    const recent = rep({ id: 'recent', at: 5_000, messages: [] });
    expect(sortReportsByActivity([recent, old]).map((r) => r.id)).toEqual(['old', 'recent']);
  });

  it('falls back to when it was filed when a report has no messages', () => {
    const a = rep({ id: 'a', at: 100 });
    const b = rep({ id: 'b', at: 900 });
    expect(sortReportsByActivity([a, b]).map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('a message the USER sent also lifts the conversation — it is the one they are thinking about', () => {
    const mine = rep({ id: 'mine', at: 100, messages: [msg('user', 8_000)] });
    const other = rep({ id: 'other', at: 5_000 });
    expect(sortReportsByActivity([other, mine]).map((r) => r.id)).toEqual(['mine', 'other']);
  });

  it('🔒 does not mutate the caller’s array', () => {
    const input = [rep({ id: 'a', at: 1 }), rep({ id: 'b', at: 2 })];
    const before = input.map((r) => r.id);
    sortReportsByActivity(input);
    expect(input.map((r) => r.id)).toEqual(before);
  });

  it('an empty list sorts to an empty list', () => {
    expect(sortReportsByActivity([])).toEqual([]);
  });
});

describe('lastActivityAt — the ordering key', () => {
  it('is the newest of the report and every message on it', () => {
    expect(lastActivityAt(rep({ at: 100, messages: [msg('user', 50), msg('admin', 700)] }))).toBe(700);
    expect(lastActivityAt(rep({ at: 900, messages: [msg('admin', 50)] }))).toBe(900);
    expect(lastActivityAt(rep({ at: 900 }))).toBe(900);
  });
});
