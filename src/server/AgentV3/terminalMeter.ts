// The terminal's daily allowance is WALL-CLOCK per user — not the sum over open terminals.
//
// ── THE OVER-CHARGE THIS FIXES (found 2026-08-21, while designing multi-terminal for v5) ─────────
// Every attached terminal stream ran its OWN 30-second meter with its OWN `lastAccruedAt`, and each
// one added to the SAME per-user daily bucket. So with three terminals open, ten real minutes cost
// the user thirty minutes of their allowance.
//
// That is not a rounding quirk, it is a wrong price: all of a workspace's shells are PTYs inside ONE
// E2B sandbox, so the second and third terminal cost NavBharatAI nothing extra. Charging 3× for a 1×
// cost is the same class as the per-call markup bug (#2175) — a number that looks measured and is
// not. It also punishes exactly the workflow multi-terminal exists to enable (watch a dev server in
// one tab, run git in another).
//
// ── HOW IT IS MADE IMPOSSIBLE, NOT JUST FIXED ───────────────────────────────────────────────────
// One shared `lastAccruedAt` PER USER, consumed by whoever ticks first. The second terminal's tick
// then finds ~0 elapsed and adds nothing — double-counting cannot occur by construction rather than
// by every call site remembering to be careful. Re-attaching after the last terminal closed starts a
// fresh mark, so the gap while nothing was open is never billed either.
//
// Pure + injected clock: the arithmetic is a test, not something to observe on a real bill.

import { accrualSeconds } from './terminalQuota';

/** One user's live terminal streams and the mark the next accrual runs from. */
interface UserMeter {
  streams: Set<string>;
  /** Epoch ms the unbilled stretch starts at. Meaningless when `streams` is empty. */
  lastAccruedAt: number;
}

/** The registry. A Map so the server owns one instance; every function here is pure over it. */
export type MeterRegistry = Map<string, UserMeter>;

export function createMeterRegistry(): MeterRegistry {
  return new Map();
}

/** How many terminal streams this user currently has attached. */
export function openStreamCount(reg: MeterRegistry, uid: string): number {
  return reg.get(uid)?.streams.size ?? 0;
}

/**
 * Attach a stream. The FIRST one starts the clock; later ones join the stretch already running, so
 * opening a second terminal does not start a second bill.
 */
export function attachStream(reg: MeterRegistry, uid: string, streamId: string, nowMs: number): void {
  const m = reg.get(uid);
  if (!m || m.streams.size === 0) {
    // Fresh stretch. Never carry the mark across a gap when nothing was open — that time is not ours
    // to charge, and reusing a stale mark would bill a user for the hours their laptop was shut.
    reg.set(uid, { streams: new Set([streamId]), lastAccruedAt: nowMs });
    return;
  }
  m.streams.add(streamId);
}

/**
 * Seconds to charge this user now, advancing the shared mark. Returns 0 when nothing is attached or
 * no whole second has passed — and the mark only moves when something was actually charged, so
 * sub-second slivers accumulate instead of being repeatedly forgiven.
 */
export function accrueFor(reg: MeterRegistry, uid: string, nowMs: number): number {
  const m = reg.get(uid);
  if (!m || m.streams.size === 0) return 0;
  const seconds = accrualSeconds(m.lastAccruedAt, nowMs);
  if (seconds > 0) m.lastAccruedAt = nowMs;
  return seconds;
}

/**
 * Detach a stream, charging the stretch up to now first so closing a tab never forgives time. The
 * remaining terminals keep the same mark; when the last one goes the user's entry is dropped, which
 * is what makes the next attach start clean.
 */
export function detachStream(reg: MeterRegistry, uid: string, streamId: string, nowMs: number): number {
  const m = reg.get(uid);
  if (!m || !m.streams.has(streamId)) return 0;
  const seconds = accrueFor(reg, uid, nowMs);
  m.streams.delete(streamId);
  if (m.streams.size === 0) reg.delete(uid);
  return seconds;
}
