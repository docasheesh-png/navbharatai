// How long a FREE build may hold a sandbox (admin 2026-09-30: "han, free build time-limit wala PR banao").
//
// A free (Weak-tier) build is the one E2B spend nobody pays for: the machine bills per wall-clock hour
// and NavBharatAI absorbs every minute of it (ROADMAP Tier 2). It used to get exactly the paid budget:
//
//   • a 30-minute window (60 for a "deep" prompt), and
//   • when the window ran out, a RESUMABLE pause that the client auto-continues for as long as each
//     window adds a file (up to 8 windows), plus 2 more windows with no progress at all.
//
// So one free request could hold a machine for four hours (eight on a deep prompt) with nobody pressing
// anything. The window alone was never the bill; the unattended chain was.
//
// 🔒 TWO LIMITS, BOTH SERVER-SIDE:
//   1. WINDOW — a free build's wall-clock cap is min(paid cap, AGENTV3_FREE_BUILD_SECONDS). Applied to
//      `effectiveBuildSeconds`, the one number every budget in the route derives from (the watchdog,
//      the runner's own stop, the correction reserve, the reviewer's headroom, the ETA), so they cannot
//      disagree. Never ABOVE the paid cap, so the orphan reaper's window (paid cap + 10 min) stays safe.
//   2. UNATTENDED CHAIN — the watchdog pause is marked `resumable` only while this workspace's free
//      windows since the user's last real request total less than AGENTV3_FREE_BUILD_AUTO_SECONDS.
//      After that the pause is NOT resumable: the work is saved, the user is told so, and one message
//      ("continue") buys one more window. Every further window then needs a person.
//
// It is server-side on purpose: the auto-continue decision lives in the client, and the phone apps are
// BUNDLED, so a client change would reach them only through a new store build. The server decides
// whether a pause is resumable; every client already obeys that.
//
// ✅ THE CHAIN IS SHARED ACROSS INSTANCES (queue Q-130, 2026-10-04). It used to live only in this
// instance's memory, so an auto-continue that landed on another Cloud Run instance started a fresh
// allowance. `noteFreeBuildStartShared` / `decideFreePauseShared` now read and write a durable copy
// (`FreeBuildChainStore.ts`) and take the LARGER of the two counts. A store that cannot be read falls back
// to the memory count — the old, more generous behaviour — so a failure can never stop a build early.
//
// Pure except for the chain map, which is plain module state with injected time.

import { isContinuationMessage } from './ProjectPlan';

/** A free build's window when the env is unset: 25 minutes. An assumption, not a measurement. */
export const FREE_BUILD_SECONDS_DEFAULT = 1500;
/** The shortest window an operator may set: a real build needs install + dev server + a check. */
export const FREE_BUILD_SECONDS_MIN = 300;
/** How long a free request may run unattended, across windows, when unset: two default windows. */
export const FREE_BUILD_AUTO_SECONDS_DEFAULT = 3000;

type Env = Record<string, string | undefined>;

/**
 * Read a seconds value. `off` ⇒ null (no free limit — the paid behaviour). Blank or unreadable ⇒ the
 * default, never "no limit": a limit on spend must not be switched off by a typo.
 */
function readSeconds(raw: string | undefined, fallback: number, min: number): number | null {
  const t = (raw ?? '').trim().toLowerCase();
  if (t === 'off') return null;
  if (t === '') return fallback;
  const n = Number(t.replace(/s$/, ''));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(min, Math.floor(n));
}

/** The free window in seconds, or null when the operator turned the free limit off. */
export function freeBuildWindowSeconds(env: Env = process.env): number | null {
  return readSeconds(env.AGENTV3_FREE_BUILD_SECONDS, FREE_BUILD_SECONDS_DEFAULT, FREE_BUILD_SECONDS_MIN);
}

/** How long a free request may run unattended, or null for no limit (the client's own bounds only). */
export function freeBuildAutoSeconds(env: Env = process.env): number | null {
  return readSeconds(env.AGENTV3_FREE_BUILD_AUTO_SECONDS, FREE_BUILD_AUTO_SECONDS_DEFAULT, FREE_BUILD_SECONDS_MIN);
}

export interface FreeWindowDecision {
  /** The build's wall-clock cap after the free limit, in seconds. */
  seconds: number;
  /** True when the free limit made the window shorter than the paid one. */
  capped: boolean;
  /** What the window would have been for a paid build. */
  paidSeconds: number;
}

/**
 * Apply the free window to a build's (already depth-scaled) cap. A paid build, a free limit that is
 * off, and a disabled watchdog (0) are all returned unchanged: an operator who switched the watchdog
 * off made that choice for every build, and this module does not quietly reintroduce one.
 */
export function freeBuildWindow(paidSeconds: number, isFreeBuild: boolean, env: Env = process.env): FreeWindowDecision {
  const unchanged = { seconds: paidSeconds, capped: false, paidSeconds };
  if (!isFreeBuild || !(paidSeconds > 0)) return unchanged;
  const cap = freeBuildWindowSeconds(env);
  if (cap === null || cap >= paidSeconds) return unchanged;
  return { seconds: cap, capped: true, paidSeconds };
}

// ── The unattended chain ─────────────────────────────────────────────────────────────────────────

/** One workspace's unattended free time since the user's last real request. */
export interface FreeChain { spentMs: number; touchedAt: number }
type Chain = FreeChain;
const chains = new Map<string, Chain>();

/** Where the chain is kept so every instance sees it. Every method fails open (see FreeBuildChainStore). */
export interface FreeChainStore {
  load(workspaceId: string): Promise<FreeChain | null>;
  save(workspaceId: string, chain: FreeChain): Promise<void>;
  clear(workspaceId: string): Promise<void>;
}
/** A record nobody has touched for this long is dropped, so the map cannot grow for ever. */
const CHAIN_FORGET_MS = 6 * 60 * 60 * 1000;

function prune(now: number): void {
  for (const [k, c] of chains) if (now - c.touchedAt > CHAIN_FORGET_MS) chains.delete(k);
}

/**
 * Called when a free build starts. A real request (anything that is not "continue" / "resume" / …)
 * begins a new chain; a continuation keeps counting the chain it continues.
 */
export function noteFreeBuildStart(workspaceId: string, prompt: string, now: number = Date.now()): void {
  prune(now);
  if (!isContinuationMessage(prompt)) chains.delete(workspaceId);
}

export interface FreePauseDecision {
  /** True ⇒ the pause may be auto-continued. False ⇒ it waits for the user. */
  resumable: boolean;
  /** Unattended time this chain has used, including the window that just ended. */
  spentSeconds: number;
  /** The chain's allowance, or null when there is none. */
  allowanceSeconds: number | null;
}

/**
 * Called when a free build's window ends at the watchdog without a finished app. Adds the window to the
 * chain and says whether the pause may still be auto-continued.
 */
export function decideFreePause(workspaceId: string, windowMs: number, env: Env = process.env, now: number = Date.now()): FreePauseDecision {
  prune(now);
  const allowance = freeBuildAutoSeconds(env);
  const prev = chains.get(workspaceId);
  const spentMs = (prev?.spentMs ?? 0) + Math.max(0, windowMs);
  chains.set(workspaceId, { spentMs, touchedAt: now });
  const spentSeconds = Math.round(spentMs / 1000);
  if (allowance === null) return { resumable: true, spentSeconds, allowanceSeconds: null };
  return { resumable: spentMs < allowance * 1000, spentSeconds, allowanceSeconds: allowance };
}

/**
 * `noteFreeBuildStart`, shared across instances: a real request also clears the durable chain, so the next
 * window — on whichever instance — starts from zero. Best-effort; never throws.
 */
export async function noteFreeBuildStartShared(workspaceId: string, prompt: string, store: FreeChainStore, now: number = Date.now()): Promise<void> {
  noteFreeBuildStart(workspaceId, prompt, now);
  if (!isContinuationMessage(prompt)) await bounded(store.clear(workspaceId), undefined);
}

/** How long a store call may take before the shared functions carry on without it. */
export const FREE_CHAIN_STORE_TIMEOUT_MS = 2_500;

/** Resolve to the work's value, or `fallback` when it fails or takes longer than the store timeout. */
function bounded<T>(work: Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), FREE_CHAIN_STORE_TIMEOUT_MS); });
  return Promise.race([work.catch(() => fallback), late]).finally(() => { if (timer) clearTimeout(timer); });
}

/**
 * `decideFreePause`, shared across instances: the chain so far is the LARGER of this instance's count and
 * the durable one (a continuation may have run anywhere), the window is added, and the result is written
 * back before the pause is announced — so the client's auto-continue, wherever it lands, reads it.
 */
export async function decideFreePauseShared(
  workspaceId: string, windowMs: number, store: FreeChainStore, env: Env = process.env, now: number = Date.now(),
): Promise<FreePauseDecision> {
  prune(now);
  // Each store call is bounded HERE, and the window is added exactly once below whatever the store does —
  // so a slow or failing store can never count a window twice (which would stop a build early).
  const durable = await bounded(store.load(workspaceId), null);
  if (durable && now - durable.touchedAt <= CHAIN_FORGET_MS) {
    const mine = chains.get(workspaceId);
    if (!mine || durable.spentMs > mine.spentMs) chains.set(workspaceId, { spentMs: durable.spentMs, touchedAt: now });
  }
  const decision = decideFreePause(workspaceId, windowMs, env, now);
  const chain = chains.get(workspaceId);
  if (chain) await bounded(store.save(workspaceId, { ...chain }), undefined);
  return decision;
}

/** The words for a free pause that waits for the user. Branded, no vendor, no upsell. */
export function freePauseMessage(filesChangedSoFar: number): { narration: string; summary: string } {
  const n = Number.isFinite(filesChangedSoFar) && filesChangedSoFar > 0 ? Math.floor(filesChangedSoFar) : 0;
  const saved = n > 0 ? `${n} file${n === 1 ? '' : 's'} ${n === 1 ? 'is' : 'are'} saved` : 'nothing was lost';
  return {
    narration: `⏱️ This build used its time for this request, and ${saved}. Send "continue" and I will keep building from exactly where I stopped.`,
    summary: `⏱️ This build used its time for this request, and ${saved}. Send "continue" and I will keep building from exactly where I stopped.`,
  };
}

/** Test seam: forget every chain. */
export function resetFreeBuildChainsForTests(): void {
  chains.clear();
}
