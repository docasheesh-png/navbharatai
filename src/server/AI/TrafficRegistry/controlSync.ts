/**
 * Traffic Manager V2, P2: how each instance learns the control document (owner requirement 5 and improvement 2).
 *
 *  · LAST-KNOWN-GOOD. A failed or unreadable read keeps the document already applied; a storage blip never turns a
 *    switch back on. An older revision never replaces a newer one (a slow poll cannot undo an admin's change).
 *  · SAFE STARTUP. Before the first successful read the instance holds NO document, which means exactly today's
 *    behaviour (the env and the code decide). The approved plan said "legacy until the first read"; that would move
 *    every cold start off the gateway, a production routing change P2 must not make (requirement 9). The env OFF
 *    stays the instant backstop, and the first read is started at boot, so a saved emergency OFF applies within one
 *    read of start-up.
 *  · ADAPTIVE POLLING WITH JITTER. One document read per instance per interval: 15 s, growing ×1.5 per unchanged read
 *    up to 60 s, back to 15 s the moment the revision changes; every interval ±20% so instances never poll in step.
 *    A change saved through THIS instance applies here at once. Cost stays one small read per instance per 15–60 s
 *    whatever the traffic.
 */
import { getServerDb } from '../../lib/serverDb';
import type { ControlDoc } from './controlTypes';
import { TrafficControlStore } from './controlStore';

export const SYNC_BASE_MS = 15_000;
export const SYNC_MAX_MS = 60_000;
const JITTER = 0.2;

interface SyncState {
  doc: ControlDoc | null;
  lastReadAtMs: number | null;
  lastReadOk: boolean;
  intervalMs: number;
}
let state: SyncState = { doc: null, lastReadAtMs: null, lastReadOk: false, intervalMs: SYNC_BASE_MS };
let timer: ReturnType<typeof setTimeout> | null = null;

/** The document this instance enforces now (null = none saved, or not read yet). */
export function currentTrafficControl(): ControlDoc | null { return state.doc; }

export function trafficControlSyncStatus(): { revision: number; lastReadAtMs: number | null; lastReadOk: boolean; intervalMs: number } {
  return { revision: state.doc?.revision ?? 0, lastReadAtMs: state.lastReadAtMs, lastReadOk: state.lastReadOk, intervalMs: state.intervalMs };
}

/** Adopt a document if it is newer than the one held. Returns whether it changed anything. */
export function adoptTrafficControl(doc: ControlDoc | null): boolean {
  if (!doc) return false;
  if (state.doc && doc.revision <= state.doc.revision) return false;
  state = { ...state, doc };
  return true;
}

/** Next poll interval: back to base on a change, else ×1.5 up to the maximum. Jitter is applied when scheduling. */
export function nextInterval(prevMs: number, changed: boolean): number {
  return changed ? SYNC_BASE_MS : Math.min(SYNC_MAX_MS, Math.round(prevMs * 1.5));
}
export function jittered(ms: number, random: () => number = Math.random): number {
  return Math.round(ms * (1 - JITTER + random() * 2 * JITTER));
}

export async function syncTrafficControlOnce(read: () => Promise<ControlDoc | null> = defaultRead, now: () => number = Date.now): Promise<boolean> {
  try {
    const doc = await read();
    const changed = adoptTrafficControl(doc);
    state = { ...state, lastReadAtMs: now(), lastReadOk: true, intervalMs: nextInterval(state.intervalMs, changed) };
    return changed;
  } catch {
    // Keep the last-known-good document; poll again at the base interval so recovery is quick.
    state = { ...state, lastReadOk: false, intervalMs: SYNC_BASE_MS };
    return false;
  }
}

async function defaultRead(): Promise<ControlDoc | null> {
  const db = getServerDb();
  if (!db) throw new Error('storage unavailable');
  return new TrafficControlStore(db).read();
}

/** Start the per-instance loop once. Never blocks boot; a timer that is unref'd never holds the process open. */
export function startTrafficControlSync(read: () => Promise<ControlDoc | null> = defaultRead): void {
  if (timer) return;
  const tick = async () => {
    await syncTrafficControlOnce(read);
    timer = setTimeout(() => { void tick(); }, jittered(state.intervalMs));
    (timer as { unref?: () => void }).unref?.();
  };
  timer = setTimeout(() => { void tick(); }, 0);
  (timer as { unref?: () => void }).unref?.();
}

/** Test hook. */
export function __resetTrafficControlSyncForTests(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  state = { doc: null, lastReadAtMs: null, lastReadOk: false, intervalMs: SYNC_BASE_MS };
}
