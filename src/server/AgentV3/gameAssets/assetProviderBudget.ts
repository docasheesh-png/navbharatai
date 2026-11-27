import { BoundedCache } from '../../lib/boundedCache';

/**
 * ONE REQUEST A SECOND PER ORIGIN — AND A SHORT, FAIR QUEUE INSTEAD OF A REFUSAL (Q-3471, failedbr #2523, admin option A
 * 2026-11-27). The politeness to the providers is unchanged: an origin is asked at most once per `ASSET_PROVIDER_SPACING_MS`,
 * and a server cooldown (429/503 Retry-After) is never shortened. What changed is what happens to the request that arrives
 * while the origin is busy. It used to be refused as soon as more than ONE was waiting, so two preparers that share an
 * origin (the 3D assets and the sounds, both on raw.githubusercontent.com) could not run side by side without losing
 * models and sounds on a cold cache (measured: three at once failed; parallel sound fetches once lost 17 of 18). The seed
 * therefore ran them one after the other — 35 s of #2523's 74 s before the first model call.
 *
 * Now a request waits its turn, first come first served, as long as its turn comes within `ASSET_PROVIDER_MAX_WAIT_MS`.
 * One that would wait longer — a long Retry-After, a backlog past the bound — gets the same honest "Provider rate limit"
 * as before, at once; a waiter whose turn is pushed past its deadline by a cooldown that arrives later gets it then.
 * A cancelled waiter leaves the queue, so the ones behind it move up and no slot is wasted. The queue is bounded by the
 * deadline (at most MAX_WAIT / SPACING waiters per origin) and FIFO, so no request starves behind later ones.
 */
export const ASSET_PROVIDER_SPACING_MS = 1000;
export const ASSET_PROVIDER_MAX_WAIT_MS = 8000;
/** setTimeout's ceiling; a longer delay would overflow to ~1 ms. */
const MAX_TIMER_MS = 2_147_483_647;

interface Waiter { deadline: number; signal: AbortSignal; grant(): void; refuse(error: Error): void; onAbort(): void }
interface OriginLane { notBefore: number; waiters: Waiter[]; timer?: ReturnType<typeof setTimeout> }

// Keyed by download ORIGIN, not by asset: the reviewed catalogue uses a handful of origins (≤ 4 per entry), plus the fixed
// metadata API, so the bound is never reached in practice. Bounded state has no TTL that could silently expire a
// provider's longer Retry-After interval.
const lanes = new BoundedCache<string, OriginLane>({ maxEntries: 512 });

function laneFor(origin: string): OriginLane {
  let lane = lanes.get(origin);
  if (!lane) { lane = { notBefore: 0, waiters: [] }; lanes.set(origin, lane); }
  return lane;
}

const rateLimited = () => new Error('Provider rate limit');

/** Refuse, in order, every waiter whose turn (at the spacing, behind the ones kept) would land past its deadline. */
function refuseLateWaiters(lane: OriginLane, now: number): void {
  let turn = Math.max(lane.notBefore, now);
  const kept: Waiter[] = [];
  for (const w of lane.waiters) {
    if (turn > w.deadline) { w.signal.removeEventListener('abort', w.onAbort); w.refuse(rateLimited()); continue; }
    kept.push(w); turn += ASSET_PROVIDER_SPACING_MS;
  }
  lane.waiters = kept;
}

function schedule(lane: OriginLane): void {
  if (lane.timer) { clearTimeout(lane.timer); lane.timer = undefined; }
  if (!lane.waiters.length) return;
  const wait = Math.min(MAX_TIMER_MS, Math.max(0, lane.notBefore - Date.now()));
  lane.timer = setTimeout(() => pump(lane), wait);
  lane.timer.unref?.();
}

function pump(lane: OriginLane): void {
  lane.timer = undefined;
  const now = Date.now();
  if (now < lane.notBefore) { schedule(lane); return; } // a cooldown arrived meanwhile, or the timer fired early
  const head = lane.waiters.shift();
  if (head) {
    head.signal.removeEventListener('abort', head.onAbort);
    if (now > head.deadline) head.refuse(rateLimited());
    else { lane.notBefore = now + ASSET_PROVIDER_SPACING_MS; head.grant(); }
  }
  schedule(lane);
}

/**
 * Permission to send one request to `origin`. `undefined` = send now; a Promise = wait for it (it rejects "Provider request
 * cancelled" when `signal` aborts, "Provider rate limit" when the turn cannot come within the deadline). Throws "Provider
 * rate limit" at once when the wait would exceed `ASSET_PROVIDER_MAX_WAIT_MS`.
 */
export function assetProviderPermit(origin: string, signal: AbortSignal): Promise<void> | undefined {
  signal.throwIfAborted();
  const now = Date.now(); const lane = laneFor(origin);
  if (!lane.waiters.length && lane.notBefore <= now) { lane.notBefore = now + ASSET_PROVIDER_SPACING_MS; return undefined; }
  const turn = Math.max(lane.notBefore, now) + lane.waiters.length * ASSET_PROVIDER_SPACING_MS;
  if (turn - now > ASSET_PROVIDER_MAX_WAIT_MS) throw rateLimited();
  return new Promise<void>((resolve, reject) => {
    const waiter: Waiter = {
      deadline: now + ASSET_PROVIDER_MAX_WAIT_MS, signal, grant: resolve, refuse: reject,
      onAbort: () => {
        const i = lane.waiters.indexOf(waiter);
        if (i < 0) return;
        lane.waiters.splice(i, 1);
        if (!lane.waiters.length) schedule(lane);
        reject(new Error('Provider request cancelled'));
      },
    };
    signal.addEventListener('abort', waiter.onAbort, { once: true });
    lane.waiters.push(waiter);
    if (!lane.timer) schedule(lane);
  });
}

/** Never shorten a valid server cooldown; excessive numeric values fail closed for this process. */
export function assetRetryDeadline(value: string | null, now = Date.now()): number {
  let deadline = now + 60_000;
  if (value && /^\d+$/.test(value)) {
    const seconds = Number(value);
    deadline = now + Math.max(1, seconds) * 1000;
  } else if (value && /[A-Za-z]/.test(value)) {
    const date = Date.parse(value);
    if (Number.isFinite(date)) deadline = Math.max(now + 1000, date);
  }
  return Number.isSafeInteger(deadline) ? deadline : Number.MAX_SAFE_INTEGER;
}

export function recordAssetProviderResponse(origin: string, response: Response): void {
  if (response.status !== 429 && response.status !== 503) return;
  const lane = laneFor(origin);
  lane.notBefore = Math.max(lane.notBefore, assetRetryDeadline(response.headers.get('retry-after')));
  // The cooldown pushes the queue back: whoever can no longer be served by their deadline is told now, not in 8 s.
  refuseLateWaiters(lane, Date.now());
  schedule(lane);
}
