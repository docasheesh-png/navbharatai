import { describe, it, expect } from 'vitest';
import {
  LAST_PLACE_KEY, LAST_PLACE_MAX_AGE_MS, PLACE_ACTIVITY_KEY, PLACE_ACTIVITY_MAX,
  isResumableView, needsSignIn, readLastPlace, recordLastPlace, clearLastPlace,
  readPlaceActivity, touchPlaceActivity, placeKey, decideLanding,
  type KeyValueStore, type LastPlace,
} from '../src/lib/lastPlace';
import { AUTH_GATED_VIEWS } from '../src/lib/authGate';

/**
 * "wahi se start ho" — the memory that takes a person back to their conversation.
 *
 * These pin the RULES of the decision. The wiring into App.tsx is pinned separately in
 * `resumeWiring.test.ts`; how much of the conversation comes back is `freeChatResume.test.ts`.
 */

function memStore(initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => { data[k] = v; },
    removeItem: (k) => { delete data[k]; },
  };
}

/** A store that refuses every write — private mode, or a full quota. */
const refusingStore = (): KeyValueStore => ({
  getItem: () => null,
  setItem: () => { throw new Error('QuotaExceededError'); },
  removeItem: () => { throw new Error('nope'); },
});

const PROS = ['teacher_ai', 'lawyer_ai', 'sda_chat'];

describe('isResumableView — what counts as a place worth returning to', () => {
  it('the two chat surfaces and any registered professional', () => {
    expect(isResumableView('nbi_chat', PROS)).toBe(true);
    expect(isResumableView('nbi_pro_chat', PROS)).toBe(true);
    expect(isResumableView('teacher_ai', PROS)).toBe(true);
    expect(isResumableView('sda_chat', PROS)).toBe(true);
  });

  it('🔒 NOT `other_ai` — the reason the list is a registry and not a pattern', () => {
    // `other_ai` is the builder-TOOLS hub. Any `/_ai$/` test matches it, and the app would have
    // "resumed" people into a grid of tools they never opened.
    expect(isResumableView('other_ai', PROS)).toBe(false);
  });

  it('never a settings, marketing or admin screen', () => {
    for (const v of ['home', 'settings', 'admin', 'appstore', 'history', 'billing', 'preview']) {
      expect(isResumableView(v, PROS)).toBe(false);
    }
  });

  it('an empty or unknown view is not a place', () => {
    expect(isResumableView('', PROS)).toBe(false);
    expect(isResumableView('some_future_screen', PROS)).toBe(false);
  });
});

describe('recordLastPlace — the guard lives here, not at the call site', () => {
  it('stores a conversation', () => {
    const store = memStore();
    expect(recordLastPlace(store, { view: 'nbi_chat', sessionId: 's1', at: 1000 }, PROS)).toBe(true);
    expect(readLastPlace(store)).toEqual({ view: 'nbi_chat', sessionId: 's1', at: 1000 });
  });

  it('🔒 IGNORES a view that is not a conversation, however it is called', () => {
    // App.tsx records on EVERY view change. If this guard were at the call site, a screen added next
    // year would silently become somewhere the app can drop people into on launch.
    const store = memStore();
    expect(recordLastPlace(store, { view: 'settings', at: 1000 }, PROS)).toBe(false);
    expect(recordLastPlace(store, { view: 'admin', at: 1000 }, PROS)).toBe(false);
    expect(readLastPlace(store)).toBeNull();
  });

  it('refuses an undated place — one that cannot be aged out must not be landed on', () => {
    const store = memStore();
    expect(recordLastPlace(store, { view: 'nbi_chat', at: 0 }, PROS)).toBe(false);
    expect(recordLastPlace(store, { view: 'nbi_chat', at: Number.NaN }, PROS)).toBe(false);
  });

  it('a store that refuses writes returns false rather than throwing', () => {
    expect(recordLastPlace(refusingStore(), { view: 'nbi_chat', at: 1 }, PROS)).toBe(false);
    expect(recordLastPlace(null, { view: 'nbi_chat', at: 1 }, PROS)).toBe(false);
  });

  it('records the ledger time in the SAME call — two facts, one call site', () => {
    const store = memStore();
    recordLastPlace(store, { view: 'nbi_chat', sessionId: 's1', at: 5000 }, PROS);
    expect(readPlaceActivity(store)[placeKey('nbi_chat', 's1')]).toBe(5000);
  });

  it('omits an absent title and sessionId rather than writing undefined', () => {
    const store = memStore();
    recordLastPlace(store, { view: 'lawyer_ai', at: 10 }, PROS);
    expect(JSON.parse(store.data[LAST_PLACE_KEY]!)).toEqual({ view: 'lawyer_ai', at: 10 });
  });
});

describe('readLastPlace — a corrupt memory means "no memory", never a crash', () => {
  it('returns null for absent, unparseable and wrong-shaped records', () => {
    expect(readLastPlace(memStore())).toBeNull();
    expect(readLastPlace(memStore({ [LAST_PLACE_KEY]: 'not json' }))).toBeNull();
    expect(readLastPlace(memStore({ [LAST_PLACE_KEY]: 'null' }))).toBeNull();
    expect(readLastPlace(memStore({ [LAST_PLACE_KEY]: '{"at":5}' }))).toBeNull();
    expect(readLastPlace(memStore({ [LAST_PLACE_KEY]: '{"view":"","at":5}' }))).toBeNull();
    expect(readLastPlace(memStore({ [LAST_PLACE_KEY]: '{"view":"nbi_chat"}' }))).toBeNull();
    expect(readLastPlace(null)).toBeNull();
  });

  it('drops a field of the wrong type instead of carrying it through', () => {
    const store = memStore({ [LAST_PLACE_KEY]: '{"view":"nbi_chat","at":9,"sessionId":42,"title":{}}' });
    expect(readLastPlace(store)).toEqual({ view: 'nbi_chat', at: 9 });
  });
});

describe('clearLastPlace', () => {
  it('forgets the place, and survives a store that throws', () => {
    const store = memStore({ [LAST_PLACE_KEY]: '{"view":"nbi_chat","at":1}' });
    clearLastPlace(store);
    expect(readLastPlace(store)).toBeNull();
    expect(() => clearLastPlace(refusingStore())).not.toThrow();
    expect(() => clearLastPlace(null)).not.toThrow();
  });
});

describe('the activity ledger — the only cross-surface clock there is', () => {
  it('stamps and reads back', () => {
    const store = memStore();
    touchPlaceActivity(store, 'teacher_ai', 500);
    expect(readPlaceActivity(store)).toEqual({ teacher_ai: 500 });
  });

  it('🔒 never moves a stamp backwards — a second tab must not un-recent a conversation', () => {
    const store = memStore();
    touchPlaceActivity(store, 'teacher_ai', 900);
    touchPlaceActivity(store, 'teacher_ai', 100);
    expect(readPlaceActivity(store).teacher_ai).toBe(900);
  });

  it('keeps the newest entries when it overflows', () => {
    const store = memStore();
    for (let i = 1; i <= PLACE_ACTIVITY_MAX + 10; i++) touchPlaceActivity(store, `p${i}`, i * 1000);
    const ledger = readPlaceActivity(store);
    expect(Object.keys(ledger)).toHaveLength(PLACE_ACTIVITY_MAX);
    expect(ledger[`p${PLACE_ACTIVITY_MAX + 10}`]).toBeDefined();
    expect(ledger.p1).toBeUndefined();
  });

  it('an unreadable or non-object ledger reads as {}, never as an error', () => {
    expect(readPlaceActivity(memStore({ [PLACE_ACTIVITY_KEY]: 'oops' }))).toEqual({});
    expect(readPlaceActivity(memStore({ [PLACE_ACTIVITY_KEY]: '[1,2]' }))).toEqual({});
    expect(readPlaceActivity(memStore({ [PLACE_ACTIVITY_KEY]: '"x"' }))).toEqual({});
    expect(readPlaceActivity(null)).toEqual({});
  });

  it('drops entries that are not real times rather than keeping a 0 or a NaN', () => {
    const store = memStore({ [PLACE_ACTIVITY_KEY]: '{"a":0,"b":-5,"c":"x",\"d\":7}' });
    expect(readPlaceActivity(store)).toEqual({ d: 7 });
  });

  it('a refusing store loses the ordering and nothing else', () => {
    expect(() => touchPlaceActivity(refusingStore(), 'a', 1)).not.toThrow();
    expect(() => touchPlaceActivity(null, 'a', 1)).not.toThrow();
    expect(() => touchPlaceActivity(memStore(), '', 1)).not.toThrow();
  });

  it('placeKey addresses a chat by its session and a professional by itself', () => {
    expect(placeKey('nbi_chat', 's1')).toBe('nbi_chat#s1');
    expect(placeKey('teacher_ai')).toBe('teacher_ai');
  });
});

describe('decideLanding — where this launch should land', () => {
  const base = { hasDeepLink: false, signedIn: true, professionalIds: PROS, now: 10_000 };
  const place = (over: Partial<LastPlace> = {}): LastPlace => ({ view: 'nbi_chat', at: 9_000, ...over });

  it('returns the remembered conversation', () => {
    expect(decideLanding({ ...base, lastPlace: place({ sessionId: 's1' }) }))
      .toEqual({ view: 'nbi_chat', sessionId: 's1' });
  });

  it('🔒 AN EXPLICIT LINK ALWAYS WINS — a guess never overrides a statement', () => {
    // A share link, /admin, an OAuth return. Overriding these would have broken every shared URL in
    // the product the day this shipped.
    expect(decideLanding({ ...base, hasDeepLink: true, lastPlace: place() })).toBeNull();
  });

  it('no memory means today’s behaviour', () => {
    expect(decideLanding({ ...base, lastPlace: null })).toBeNull();
  });

  it('a place that is no longer a conversation is not landed on', () => {
    // e.g. a surface removed in a later release, still sitting in somebody's storage.
    expect(decideLanding({ ...base, lastPlace: place({ view: 'retired_screen' }) })).toBeNull();
  });

  it('🔒 a login-gated place is NOT landed on while signed out — never a login wall as frame one', () => {
    expect(decideLanding({ ...base, signedIn: false, lastPlace: place({ view: 'nbi_pro_chat' }) })).toBeNull();
    expect(decideLanding({ ...base, signedIn: false, lastPlace: place({ view: 'sda_chat' }) })).toBeNull();
    // …and an ungated one still is, so a signed-out person keeps their free conversation.
    expect(decideLanding({ ...base, signedIn: false, lastPlace: place({ view: 'nbi_chat' }) }))
      .toEqual({ view: 'nbi_chat' });
  });

  it('…and the memory is NOT consumed: signing in resumes exactly where they were', () => {
    const p = place({ view: 'nbi_pro_chat', sessionId: 'pro-1' });
    expect(decideLanding({ ...base, signedIn: false, lastPlace: p })).toBeNull();
    expect(decideLanding({ ...base, signedIn: true, lastPlace: p })).toEqual({ view: 'nbi_pro_chat', sessionId: 'pro-1' });
  });

  it('a place older than the window is left alone — a three-month-old chat reads as a bug', () => {
    const old = place({ at: 1 });
    expect(decideLanding({ ...base, lastPlace: old, now: LAST_PLACE_MAX_AGE_MS + 100 })).toBeNull();
    expect(decideLanding({ ...base, lastPlace: old, now: LAST_PLACE_MAX_AGE_MS })).not.toBeNull();
  });

  it('a device clock running AHEAD of ours still resumes — the clock is wrong, the chat is real', () => {
    expect(decideLanding({ ...base, lastPlace: place({ at: 1_000_000 }), now: 10_000 }))
      .toEqual({ view: 'nbi_chat' });
  });

  it('a custom window is honoured; a nonsensical one falls back to the default', () => {
    expect(decideLanding({ ...base, lastPlace: place({ at: 0.1 }), maxAgeMs: 10 })).toBeNull();
    expect(decideLanding({ ...base, lastPlace: place(), maxAgeMs: 0 })).not.toBeNull();
    expect(decideLanding({ ...base, lastPlace: place(), maxAgeMs: -5 })).not.toBeNull();
  });

  it('🔒 needsSignIn is the app’s ONE auth-gate list, not a second copy of it', () => {
    // Re-listing the gated views here would be correct today and stale the day one is added — and
    // the symptom would be the login wall this whole rule exists to prevent.
    for (const v of AUTH_GATED_VIEWS) expect(needsSignIn(v), v).toBe(true);
    expect(needsSignIn('nbi_pro_chat')).toBe(true);
    expect(needsSignIn('sda_chat')).toBe(true);
    expect(needsSignIn('nbi_chat')).toBe(false);
    expect(needsSignIn('teacher_ai')).toBe(false);
  });
});
