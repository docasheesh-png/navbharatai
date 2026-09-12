/**
 * COMING BACK FROM GITHUB LANDS WHERE YOU LEFT.
 *
 * Connecting GitHub is a full page navigation (a popup is killed by every mobile browser), so the
 * Publish sheet does not survive it. The admin's flow asks for the user to be returned to NavBharatAI
 * and for the publish to carry on — returning was already true, carrying on was not: they landed on
 * the home screen with no sign that anything had happened.
 *
 * These cases pin the three properties that stop a remembered intent becoming an ambush.
 */
import { describe, it, expect } from 'vitest';
import {
  rememberPublishIntent, takePublishIntent, PUBLISH_INTENT_KEY, PUBLISH_INTENT_TTL_MS,
  type IntentStore,
} from '../src/lib/publishResume';

function memoryStore(): IntentStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}

/** A browser that refuses storage — a private window, or blocked site data. */
const hostileStore: IntentStore = {
  getItem: () => { throw new Error('blocked'); },
  setItem: () => { throw new Error('blocked'); },
  removeItem: () => { throw new Error('blocked'); },
};

describe('the intent survives the round trip', () => {
  it('written before leaving, read once on the way back', () => {
    const store = memoryStore();
    rememberPublishIntent(store, 'ws-1', 1_000);
    expect(takePublishIntent(store, 'ws-1', 2_000)).toBe(true);
  });
});

describe('the three properties that keep it from ambushing anyone', () => {
  it('🔒 ONE-SHOT — a second read never reopens the sheet again', () => {
    const store = memoryStore();
    rememberPublishIntent(store, 'ws-1', 1_000);
    expect(takePublishIntent(store, 'ws-1', 2_000)).toBe(true);
    expect(takePublishIntent(store, 'ws-1', 3_000)).toBe(false);
    expect(store.map.has(PUBLISH_INTENT_KEY)).toBe(false);
  });

  it('🔒 WORKSPACE-SCOPED — it cannot open over a different app', () => {
    const store = memoryStore();
    rememberPublishIntent(store, 'ws-1', 1_000);
    expect(takePublishIntent(store, 'ws-2', 2_000)).toBe(false);
    // …and a mismatch consumes it too: an intent from another app is already stale, and leaving it to
    // fire when the user switches back would open a sheet for a decision made ten minutes ago.
    expect(takePublishIntent(store, 'ws-1', 2_100)).toBe(false);
  });

  it('🔒 IT EXPIRES — an abandoned authorization does not fire next week', () => {
    const store = memoryStore();
    rememberPublishIntent(store, 'ws-1', 1_000);
    expect(takePublishIntent(store, 'ws-1', 1_000 + PUBLISH_INTENT_TTL_MS + 1)).toBe(false);

    const fresh = memoryStore();
    rememberPublishIntent(fresh, 'ws-1', 1_000);
    expect(takePublishIntent(fresh, 'ws-1', 1_000 + PUBLISH_INTENT_TTL_MS)).toBe(true);
  });
});

describe('nothing here may break a publish', () => {
  it('a storage that throws costs the resume and nothing else', () => {
    expect(() => rememberPublishIntent(hostileStore, 'ws-1')).not.toThrow();
    expect(takePublishIntent(hostileStore, 'ws-1')).toBe(false);
  });

  it('no storage at all, and no workspace, are both simply "no resume"', () => {
    expect(() => rememberPublishIntent(null, 'ws-1')).not.toThrow();
    expect(takePublishIntent(null, 'ws-1')).toBe(false);
    const store = memoryStore();
    rememberPublishIntent(store, '   ', 1_000);
    expect(store.map.size).toBe(0);
    expect(takePublishIntent(store, '', 1_000)).toBe(false);
  });

  it('junk in the slot is ignored, not thrown on', () => {
    const store = memoryStore();
    for (const junk of ['not json', '{}', 'null', '[]', '{"workspaceId":"ws-1"}', '{"at":1000}']) {
      store.map.set(PUBLISH_INTENT_KEY, junk);
      expect(takePublishIntent(store, 'ws-1', 2_000)).toBe(false);
    }
  });

  it('a clock that jumped backwards is not treated as a fresh intent', () => {
    const store = memoryStore();
    rememberPublishIntent(store, 'ws-1', 10_000);
    expect(takePublishIntent(store, 'ws-1', 5_000)).toBe(false);
  });
});
