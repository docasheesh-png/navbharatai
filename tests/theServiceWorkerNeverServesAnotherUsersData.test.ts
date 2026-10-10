/**
 * UI-5 / UI-6 — the service worker must not keep another account's API reads, and a
 * navigation that misses the (intentionally uncached) app shell must try the network again.
 *
 * The worker is loaded into a vm, the way a browser would run public/sw.js, against fakes
 * for `self`, `caches` and `fetch`. The assertions are the behaviors, not a copy of the source.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

type Listener = (event: unknown) => void;

interface Harness {
  deleted: string[];
  opened: string[];
  matched: unknown[];
  fetchCalls: Array<{ input: unknown; init: unknown }>;
  cacheNames: Set<string>;
  setFetch(fn: (input: unknown, init?: unknown) => Promise<unknown>): void;
  dispatch(type: string, event: unknown): void;
}

function loadServiceWorker(): Harness {
  const listeners: Record<string, Listener[]> = {};
  const deleted: string[] = [];
  const opened: string[] = [];
  const matched: unknown[] = [];
  const fetchCalls: Array<{ input: unknown; init: unknown }> = [];
  const cacheNames = new Set<string>(['navbharat-v4', 'navbharat-api-v1', 'navbharat-api-v2']);
  let fetchImpl: (input: unknown, init?: unknown) => Promise<unknown> = async () => ({
    ok: true,
    type: 'basic',
    clone() { return this; },
  });

  const caches = {
    async keys() { return [...cacheNames]; },
    async delete(name: string) {
      deleted.push(name);
      const had = cacheNames.has(name);
      cacheNames.delete(name);
      return had;
    },
    async open(name: string) {
      opened.push(name);
      cacheNames.add(name);
      return {
        async addAll() {},
        async put() {},
        async match() { return undefined; },
      };
    },
    async match(key: unknown) {
      matched.push(key);
      return undefined;
    },
  };

  const self = {
    addEventListener(type: string, fn: Listener) {
      (listeners[type] ||= []).push(fn);
    },
    skipWaiting() { return Promise.resolve(); },
    clients: { claim: () => Promise.resolve() },
  };

  const ctx = vm.createContext({
    self,
    caches,
    fetch(input: unknown, init?: unknown) {
      fetchCalls.push({ input, init });
      return fetchImpl(input, init);
    },
    URL,
    Response,
    console,
  });
  vm.runInContext(readFileSync(join(__dirname, '../public/sw.js'), 'utf8'), ctx, { filename: 'public/sw.js' });

  return {
    deleted,
    opened,
    matched,
    fetchCalls,
    cacheNames,
    setFetch(fn) { fetchImpl = fn; },
    dispatch(type, event) {
      for (const fn of listeners[type] || []) fn(event);
    },
  };
}

function fetchEvent(url: string, init: { method?: string; mode?: string } = {}) {
  const request = {
    url,
    method: init.method ?? 'GET',
    mode: init.mode ?? 'same-origin',
  };
  let response: Promise<unknown> | undefined;
  const event = {
    request,
    respondWith(p: Promise<unknown>) { response = p; },
    waitUntil(p: Promise<unknown>) { response = p; },
  };
  return {
    event,
    handled: () => response !== undefined,
    response: () => response,
  };
}

const ORIGIN = 'https://navbharatai.com';

describe('the service worker never serves another user\'s API data', () => {
  it('(a) caches the conversations list exactly, not a conversation under it', async () => {
    const sw = loadServiceWorker();
    const fresh = { ok: true, type: 'basic', marker: 'fresh', clone() { return this; } };
    sw.setFetch(async () => fresh);

    const nested = fetchEvent(`${ORIGIN}/api/agentv3/conversations/abc`);
    sw.dispatch('fetch', nested.event);
    expect(nested.handled()).toBe(false);
    expect(sw.opened).not.toContain('navbharat-api-v2');

    const list = fetchEvent(`${ORIGIN}/api/agentv3/conversations`);
    sw.dispatch('fetch', list.event);
    expect(list.handled()).toBe(true);
    expect(await list.response()).toBe(fresh);
    expect(sw.opened).toContain('navbharat-api-v2');

    // Trailing slash is the same path; a child path is not. status follows the same rule.
    const slashed = fetchEvent(`${ORIGIN}/api/agentv3/conversations/`);
    sw.dispatch('fetch', slashed.event);
    expect(slashed.handled()).toBe(true);

    const statusChild = fetchEvent(`${ORIGIN}/api/agentv3/status/extra`);
    sw.dispatch('fetch', statusChild.event);
    expect(statusChild.handled()).toBe(false);

    const status = fetchEvent(`${ORIGIN}/api/agentv3/status`);
    sw.dispatch('fetch', status.event);
    expect(status.handled()).toBe(true);
    await status.response();
  });

  it('(b) retries the navigation when the app shell document is not cached', async () => {
    const sw = loadServiceWorker();
    const second = { ok: true, marker: 'second-fetch' };
    let n = 0;
    sw.setFetch(async () => {
      n += 1;
      if (n === 1) throw new Error('offline');
      return second;
    });

    const nav = fetchEvent(`${ORIGIN}/chat`, { mode: 'navigate' });
    sw.dispatch('fetch', nav.event);
    expect(nav.handled()).toBe(true);
    expect(await nav.response()).toBe(second);
    expect(sw.fetchCalls).toHaveLength(2);
    expect(sw.fetchCalls[0].init).toEqual({ cache: 'no-cache' });
    expect(sw.matched).toEqual(['/']);
  });

  it('(c) activate deletes the v1 API cache and keeps v2', async () => {
    const sw = loadServiceWorker();
    const ev = fetchEvent(`${ORIGIN}/`);
    sw.dispatch('activate', ev.event);
    await ev.response();
    expect(sw.deleted).toContain('navbharat-api-v1');
    expect(sw.deleted).not.toContain('navbharat-api-v2');
    expect(sw.cacheNames.has('navbharat-api-v1')).toBe(false);
    expect(sw.cacheNames.has('navbharat-api-v2')).toBe(true);
    expect(sw.cacheNames.has('navbharat-v4')).toBe(true);
  });
});
