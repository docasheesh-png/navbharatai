// App Mart "For You" — the browser half: remembers the switch, keeps a per-session seed (so the feed is
// stable while you scroll, fresh next visit), and batches engagement events (≤1 request per 15 s, or a
// sendBeacon when the tab hides). Nothing personal leaves the device except "app X was opened / for N s".
import { SORT_STORAGE_KEY, parseSortMode, type SortMode, type RawEvent } from '../../../lib/appMartForYou';
import { authedHeaders } from '../../../lib/authHeaders';

export function readSortPref(): SortMode {
  try { return parseSortMode(localStorage.getItem(SORT_STORAGE_KEY)); } catch { return 'foryou'; }
}
export function writeSortPref(m: SortMode): void {
  try { localStorage.setItem(SORT_STORAGE_KEY, m); } catch { /* private mode */ }
}

const SEED_KEY = 'appmart.seed.v1';
export function sessionSeed(): string {
  try {
    let s = sessionStorage.getItem(SEED_KEY);
    if (!s) { s = Math.random().toString(36).slice(2, 12); sessionStorage.setItem(SEED_KEY, s); }
    return s;
  } catch { return 'global'; }
}

const OPENED_KEY = 'appmart.opened.v1';
const OPENED_MAX = 200;
/** True if this device opened the app before (repeat use). Records the open. Ids only, capped, local. */
export function markOpened(appId: string): boolean {
  try {
    const list: string[] = JSON.parse(localStorage.getItem(OPENED_KEY) || '[]');
    const seen = list.includes(appId);
    const next = [appId, ...list.filter((x) => x !== appId)].slice(0, OPENED_MAX);
    localStorage.setItem(OPENED_KEY, JSON.stringify(next));
    return seen;
  } catch { return false; }
}

const queue: RawEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_MS = 15_000;
const URL = '/api/app-mart/events';

export function logAppMartEvent(e: RawEvent): void {
  queue.push(e);
  if (queue.length >= 40) { void flushAppMartEvents(); return; }
  if (!timer) timer = setTimeout(() => { timer = null; void flushAppMartEvents(); }, FLUSH_MS);
}

export async function flushAppMartEvents(beacon = false): Promise<void> {
  if (timer) { clearTimeout(timer); timer = null; }
  if (queue.length === 0) return;
  const events = queue.splice(0, 50);
  const body = JSON.stringify({ events });
  try {
    // A beacon carries no auth header → counts toward global trending only. That is the fair price of
    // not losing the last events when the tab closes.
    if (beacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon(URL, new Blob([body], { type: 'application/json' }));
      return;
    }
    const headers = { 'Content-Type': 'application/json', ...(await authedHeaders().catch(() => ({}))) } as Record<string, string>;
    await fetch(URL, { method: 'POST', headers, body, keepalive: true });
  } catch { /* signals only */ }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flushAppMartEvents(true); });
}
