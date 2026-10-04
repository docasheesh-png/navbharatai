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
// ✅ THE CHAIN IS DURABLE NOW (Q-130, 2026-10-04). It used to live only in this instance's memory, so an
// auto-continue that landed on another Cloud Run instance started a fresh chain — a free request could
// still run unattended for hours, one window per instance. `decideFreePauseDurable` keeps the chain in
// one Firestore record per workspace and counts the LARGER of that record and this instance's memory.
// Every failure (no database, a slow read, a write error) falls back to the memory count, which is the
// old behaviour — so this can only ever be as generous as before, never stop a build it should not.
//
// Pure except for the chain map (plain module state with injected time) and the injected durable store.

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

interface Chain { spentMs: number; touchedAt: number }
const chains = new Map<string, Chain>();
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

/** The words for a free pause that waits for the user. Branded, no vendor, no upsell. */
export function freePauseMessage(filesChangedSoFar: number): { narration: string; summary: string } {
  const n = Number.isFinite(filesChangedSoFar) && filesChangedSoFar > 0 ? Math.floor(filesChangedSoFar) : 0;
  const saved = n > 0 ? `${n} file${n === 1 ? '' : 's'} ${n === 1 ? 'is' : 'are'} saved` : 'nothing was lost';
  return {
    narration: `⏱️ This build used its time for this request, and ${saved}. Send "continue" and I will keep building from exactly where I stopped.`,
    summary: `⏱️ This build used its time for this request, and ${saved}. Send "continue" and I will keep building from exactly where I stopped.`,
  };
}

// ── The durable chain (Q-130) ────────────────────────────────────────────────────────────────────

/** Where a chain is kept between instances. Injected so tests never touch a database. */
export interface FreeChainStore {
  get(workspaceId: string): Promise<{ spentMs: number; touchedAt: number } | null>;
  set(workspaceId: string, chain: { spentMs: number; touchedAt: number }): Promise<void>;
  remove(workspaceId: string): Promise<void>;
}

/** How long a durable read may hold up the pause decision before the memory count answers alone. */
export const DURABLE_CHAIN_TIMEOUT_MS = 2_000;

function withinTimeout<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(undefined), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(undefined); });
  });
}

/** A new real request starts a new chain everywhere, not only in this instance. */
export async function noteFreeBuildStartDurable(
  workspaceId: string, prompt: string, store: FreeChainStore | null, now: number = Date.now(),
): Promise<void> {
  noteFreeBuildStart(workspaceId, prompt, now);
  if (!store || isContinuationMessage(prompt)) return;
  await withinTimeout(store.remove(workspaceId), DURABLE_CHAIN_TIMEOUT_MS);
}

/**
 * `decideFreePause`, counted across instances. The chain spent so far is the LARGER of the durable
 * record and this instance's memory (a record older than the forget window counts as none), the window
 * that just ended is added once, and the new total is written back. A store that is missing, slow or
 * failing leaves exactly the memory-only answer.
 */
export async function decideFreePauseDurable(
  workspaceId: string, windowMs: number, store: FreeChainStore | null, env: Env = process.env, now: number = Date.now(),
): Promise<FreePauseDecision> {
  const memoryBefore = chains.get(workspaceId)?.spentMs ?? 0;
  const durable = store ? await withinTimeout(store.get(workspaceId), DURABLE_CHAIN_TIMEOUT_MS) : undefined;
  const durableBefore = durable && now - durable.touchedAt <= CHAIN_FORGET_MS && Number.isFinite(durable.spentMs)
    ? Math.max(0, durable.spentMs) : 0;
  if (durableBefore > memoryBefore) chains.set(workspaceId, { spentMs: durableBefore, touchedAt: now });
  const decision = decideFreePause(workspaceId, windowMs, env, now);
  if (store) {
    const chain = chains.get(workspaceId);
    if (chain) await withinTimeout(store.set(workspaceId, { spentMs: chain.spentMs, touchedAt: chain.touchedAt }), DURABLE_CHAIN_TIMEOUT_MS);
  }
  return decision;
}

/** Test seam: forget every chain. */
export function resetFreeBuildChainsForTests(): void {
  chains.clear();
}
