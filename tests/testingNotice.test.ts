/**
 * The testing notice — a card pinned in Notifications, never a popup (admin 2026-09-27).
 *
 * First asked for as a 3-second home-screen popup (2026-09-14), then moved:
 * *"popup se hat kar notifications me kar do … same bas alag popup ki jagah notification me aye, jisse
 * user disturb na ho"*. The message and its button did not change; where it lives did.
 *
 * What is pinned here is the one new decision: how a new user FINDS a card that no longer covers the
 * screen. It counts as one unread notification until Notifications has been opened once on this
 * device, and never again after that.
 */
import { describe, it, expect } from 'vitest';
import {
  TESTING_NOTICE_COPY,
  TESTING_NOTICE_SEEN_KEY,
  markTestingNoticeSeen,
  testingNoticeSeen,
  unreadWithTestingNotice,
} from '../src/lib/testingNotice';

/** A storage stand-in, so these tests never depend on a real browser. */
function fakeStore(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    map,
  };
}

describe('the unread number the ☰ dot and the Notifications row show', () => {
  it('a new signed-in user sees one unread — the card — with an empty inbox', () => {
    expect(unreadWithTestingNotice({ inboxUnread: 0, signedIn: true, seen: false })).toBe(1);
  });

  it('it adds to real messages rather than replacing them', () => {
    expect(unreadWithTestingNotice({ inboxUnread: 3, signedIn: true, seen: false })).toBe(4);
  });

  it('🔒 once seen, it raises nothing — it is not a dot on every app open', () => {
    // A dot that came back on every launch would be the popup's nagging in a quieter form, which is
    // exactly what the admin asked to be rid of.
    expect(unreadWithTestingNotice({ inboxUnread: 0, signedIn: true, seen: true })).toBe(0);
    expect(unreadWithTestingNotice({ inboxUnread: 2, signedIn: true, seen: true })).toBe(2);
  });

  it('🔒 a signed-out visitor is never counted — there is no Notifications row to clear it', () => {
    expect(unreadWithTestingNotice({ inboxUnread: 0, signedIn: false, seen: false })).toBe(0);
  });

  it('a malformed inbox count is read as zero, never as NaN on the badge', () => {
    expect(unreadWithTestingNotice({ inboxUnread: Number.NaN, signedIn: true, seen: true })).toBe(0);
    expect(unreadWithTestingNotice({ inboxUnread: -4, signedIn: true, seen: false })).toBe(1);
  });
});

describe('"seen once on this device"', () => {
  it('a fresh device has not seen it', () => {
    expect(testingNoticeSeen(fakeStore())).toBe(false);
  });

  it('after marking, the device remembers', () => {
    const store = fakeStore();
    markTestingNoticeSeen(store);
    expect(store.map.get(TESTING_NOTICE_SEEN_KEY)).toBe('1');
    expect(testingNoticeSeen(store)).toBe(true);
  });

  it('🔒 STORAGE THAT THROWS READS AS SEEN — never a dot that nothing can clear', () => {
    // If storage is blocked, marking it seen can never succeed either, so "unseen" would pin a red
    // dot to the menu for ever. The card is still pinned in the panel either way.
    const hostile = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    expect(testingNoticeSeen(hostile)).toBe(true);
    expect(() => markTestingNoticeSeen(hostile)).not.toThrow();
  });
});

describe('the copy — unchanged by the move', () => {
  it('says we are testing, asks for reports, and thanks the reader', () => {
    expect(TESTING_NOTICE_COPY.title).toBe('NavBharatAI is in active testing');
    expect(TESTING_NOTICE_COPY.body).toMatch(/report/i);
    expect(TESTING_NOTICE_COPY.body).toMatch(/stronger/i);
    expect(TESTING_NOTICE_COPY.body).toMatch(/thank you/i);
  });

  it('🔒 NAMES THE REAL SHEET — the card and the sidebar entry must describe ONE thing', () => {
    expect(TESTING_NOTICE_COPY.action).toBe('Report a problem');
  });

  it('is professional English — no exclamation marks, no lowercase "thanks"', () => {
    const all = Object.values(TESTING_NOTICE_COPY).join(' ');
    expect(all).not.toMatch(/!/);
    expect(all).not.toMatch(/\bthanks\b/);
  });
});
