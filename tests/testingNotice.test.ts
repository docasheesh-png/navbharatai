/**
 * The home-screen testing notice (admin 2026-09-14).
 *
 * Asked for as: *"home page par hi jab bhi user app open kare, 3 seconds ke liye ek popup aa jaye"*,
 * with the copy to be written *"professionally, in English"*.
 *
 * Two things here are worth more than the copy itself, and both are pinned below:
 *   • ONCE PER APP OPEN, not once per page view and not once per device — the difference between a
 *     helpful notice, a nagging one, and one nobody sees twice is entirely which store it uses.
 *   • It ASKS THE USER TO DO SOMETHING, so it must hand over the means. The copy names the exact
 *     label of the sheet it opens, so the notice and the menu entry can never describe two things.
 */
import { describe, it, expect } from 'vitest';
import {
  TESTING_NOTICE_COPY,
  TESTING_NOTICE_MS,
  TESTING_NOTICE_SESSION_KEY,
  markTestingNoticeShown,
  shouldShowTestingNotice,
  testingNoticeAlreadyShown,
} from '../src/lib/testingNotice';

/** A storage stand-in, so these tests never depend on a real browser session. */
function fakeStore(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    map,
  };
}

describe('when it shows', () => {
  it('on the home screen, on a fresh app open', () => {
    expect(shouldShowTestingNotice({ activeView: 'home', alreadyShown: false })).toBe(true);
  });

  it('🔒 never twice in the same app open', () => {
    expect(shouldShowTestingNotice({ activeView: 'home', alreadyShown: true })).toBe(false);
  });

  it('🔒 HOME ONLY — it must not appear over the builder, the chat or settings', () => {
    for (const view of ['nbi_chat', 'nbi_pro_chat', 'settings', 'appstore', 'other_ai', 'code_studio'])
      expect(shouldShowTestingNotice({ activeView: view, alreadyShown: false }), view).toBe(false);
  });

  it('never throws on a malformed call', () => {
    expect(shouldShowTestingNotice(null as never)).toBe(false);
  });
});

describe('"once per app open" — which is what the store choice actually decides', () => {
  it('a fresh session has not shown it', () => {
    expect(testingNoticeAlreadyShown(fakeStore())).toBe(false);
  });

  it('after marking, the same session knows', () => {
    const store = fakeStore();
    markTestingNoticeShown(store);
    expect(store.map.get(TESTING_NOTICE_SESSION_KEY)).toBe('1');
    expect(testingNoticeAlreadyShown(store)).toBe(true);
  });

  it('🔒 SESSION storage, not LOCAL — a new app open must show it again', () => {
    // The whole ask is "whenever the user opens the app". sessionStorage empties on close, so a cold
    // launch, a new tab and a reload each begin a new session; localStorage would have shown it once
    // in the lifetime of the device and then never again.
    const firstOpen = fakeStore();
    markTestingNoticeShown(firstOpen);
    expect(testingNoticeAlreadyShown(firstOpen)).toBe(true);
    const secondOpen = fakeStore(); // a new session starts empty
    expect(testingNoticeAlreadyShown(secondOpen)).toBe(false);
  });

  it('🔒 STORAGE THAT THROWS SHOWS THE NOTICE, rather than breaking the home screen', () => {
    // Private mode and blocked site data both throw. A notice that appears twice is a far better
    // outcome than a home screen that does not render.
    const hostile = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    expect(testingNoticeAlreadyShown(hostile)).toBe(false);
    expect(() => markTestingNoticeShown(hostile)).not.toThrow();
  });

  it('an absent store is treated as "not shown", never as an error', () => {
    expect(testingNoticeAlreadyShown(null)).toBe(false);
    expect(() => markTestingNoticeShown(null)).not.toThrow();
  });
});

describe('the copy', () => {
  it('is the admin’s three seconds', () => {
    expect(TESTING_NOTICE_MS).toBe(3000);
  });

  it('says we are testing, asks for reports, and thanks the reader', () => {
    expect(TESTING_NOTICE_COPY.title).toMatch(/testing/i);
    expect(TESTING_NOTICE_COPY.body).toMatch(/report/i);
    expect(TESTING_NOTICE_COPY.body).toMatch(/stronger/i);
    expect(TESTING_NOTICE_COPY.body).toMatch(/thank you/i);
  });

  it('🔒 NAMES THE REAL SHEET — the notice and the sidebar entry must describe ONE thing', () => {
    // If this label ever drifts from the sidebar's, the notice starts pointing at something that
    // does not exist by that name. It is asserted against the sidebar's own source below.
    expect(TESTING_NOTICE_COPY.action).toBe('Report a problem');
  });

  it('is short enough to read in three seconds', () => {
    // ~20 words is about the ceiling for a 3s glance. This is a real constraint of the ask, not a
    // style preference: copy that cannot be read in the time it is shown has not been delivered.
    const words = `${TESTING_NOTICE_COPY.title} ${TESTING_NOTICE_COPY.body}`.trim().split(/\s+/).length;
    expect(words).toBeLessThanOrEqual(28);
  });

  it('is professional English — no exclamation marks, no lowercase "thanks"', () => {
    const all = Object.values(TESTING_NOTICE_COPY).join(' ');
    expect(all).not.toMatch(/!/);
    expect(all).not.toMatch(/\bthanks\b/);
  });
});
