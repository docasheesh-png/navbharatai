// IS THE FREE IMAGE PROVIDER'S ANONYMOUS DOOR OPEN? (2026-09-30, admin: "image banne band ho gaye hai")
//
// 🔴 WHAT HAPPENED. The free tier handed the BROWSER a link to the provider's anonymous endpoint
// (`IMAGE_GEN_CLIENT_FETCH`, 2026-09-21). The provider then closed that endpoint: every generation needs
// an account key, and a request without one is answered 401. Nothing on our side changed, and every free
// picture failed at once with "NavBharatAI's engine could not make that image right now".
//
// 🔑 WHY IT WAS A DEAD END AND NOT A FALLBACK. Once the server has returned a link, the ladder that
// follows a free-provider failure (a try from our side, then the metered paid rungs) never runs. #3396
// taught the NEW client to come back with `freeFailed`; the phone apps are BUNDLED, so every installed
// build keeps the old client and simply shows the error. The server is the only place that reaches them.
//
// So the server asks the question itself, before it hands out a link: is the anonymous door open?
//  - Every 401 / 402 / 403 the door gives — to our own fetch, to our probe, or reported back by a new
//    client — closes it for `CLOSED_FOR_MS`. A closed door is skipped: no link is minted and no
//    anonymous fetch is made, so the request goes straight to the metered paid rungs and even an old
//    client receives the picture bytes.
//  - A probe (one tiny anonymous request, at most every `PROBE_EVERY_MS`) is what lets the server find
//    out on its own. The first probe on an instance is awaited, bounded; later ones refresh in the
//    background so no user waits on them.
//  - 🔒 Only an AUTH answer closes the door. A timeout, a 429, a 5xx or a network error is "could not
//    tell" and leaves the door as it was: a slow provider is not a closed one, and our own egress
//    failing must never move every free user onto the paid rungs.
//
// `IMAGE_GEN_ANON_PROBE=off` stops the probe (the door then closes only on real failures).

/** An anonymous answer that means "you need a key" (401), "no budget" (402) or "not allowed" (403). */
export const AUTH_FAILURE = /\bHTTP\s*40[123]\b/;

export const CLOSED_FOR_MS = 30 * 60_000;
export const PROBE_EVERY_MS = 10 * 60_000;
export const FIRST_PROBE_WAIT_MS = 4_000;

/** The probe asks for the smallest picture the provider makes; a closed door answers before drawing. */
export const PROBE_URL = 'https://image.pollinations.ai/prompt/dot?width=64&height=64&nologo=true&private=true&safe=true&seed=1&model=flux';

export interface DoorState {
  closedUntil: number;
  reason: string | null;
  probedAt: number;
  probing: Promise<void> | null;
}

export function newDoorState(): DoorState {
  return { closedUntil: 0, reason: null, probedAt: 0, probing: null };
}

const shared = newDoorState();

/** True when a failure reason is the door refusing us, not the door being slow. PURE. */
export function isAuthFailure(reason: string | null | undefined): boolean {
  return AUTH_FAILURE.test(String(reason ?? ''));
}

/** Record what the anonymous door answered. Only an auth refusal closes it. PURE on `state`. */
export function noteAnonymousResult(reason: string | null | undefined, now = Date.now(), state: DoorState = shared): boolean {
  if (!isAuthFailure(reason)) return false;
  const first = state.closedUntil <= now;
  state.closedUntil = now + CLOSED_FOR_MS;
  state.reason = String(reason).slice(0, 80);
  if (first) console.warn(`[IMAGE_GEN] the free provider refused an anonymous request (${state.reason}) — free pictures go to the paid engines until it answers again. Set POLLINATIONS_API_KEY to use the provider with an account.`);
  return true;
}

/** Whether a link to the anonymous door is worth handing out right now. PURE on `state`. */
export function anonymousDoorOpen(now = Date.now(), state: DoorState = shared): boolean {
  return state.closedUntil <= now;
}

/** What the admin diagnostic says about the door, or null while it is open. PURE on `state`. */
export function anonymousDoorNote(now = Date.now(), state: DoorState = shared): string | null {
  if (anonymousDoorOpen(now, state)) return null;
  return `free provider: anonymous access refused (${state.reason ?? 'auth'}) — set POLLINATIONS_API_KEY`;
}

export function probeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.IMAGE_GEN_ANON_PROBE || '').trim().toLowerCase() !== 'off';
}

type FetchLike = (url: string, init?: { signal?: AbortSignal; method?: string }) => Promise<{ status: number; body?: { cancel?: () => unknown } | null }>;

/** One probe. Records an auth refusal; anything else is "could not tell". Never throws. */
export async function probeAnonymousDoor(
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
  state: DoorState = shared,
  now: () => number = Date.now,
  timeoutMs = 8_000,
): Promise<void> {
  state.probedAt = now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(PROBE_URL, { signal: ctl.signal });
    try { await r.body?.cancel?.(); } catch { /* the bytes are not wanted */ }
    if (isAuthFailure(`HTTP ${r.status}`)) noteAnonymousResult(`HTTP ${r.status}`, now(), state);
    else if (r.status >= 200 && r.status < 300) state.closedUntil = 0; // the door answered: open again
  } catch { /* timeout / network: could not tell */ } finally {
    clearTimeout(timer);
  }
}

/**
 * Before a free picture: make sure the door's state is not older than `PROBE_EVERY_MS`. The first probe
 * on this instance is awaited for at most `FIRST_PROBE_WAIT_MS`; a later refresh runs in the background.
 * Returns whether the door is open afterwards. Never throws.
 */
export async function checkAnonymousDoor(
  opts: { fetchImpl?: FetchLike; state?: DoorState; now?: () => number; env?: NodeJS.ProcessEnv; firstWaitMs?: number } = {},
): Promise<boolean> {
  const state = opts.state ?? shared;
  const now = opts.now ?? Date.now;
  if (!probeEnabled(opts.env)) return anonymousDoorOpen(now(), state);
  const stale = now() - state.probedAt >= PROBE_EVERY_MS;
  if (stale && !state.probing) {
    const neverProbed = state.probedAt === 0;
    state.probing = probeAnonymousDoor(opts.fetchImpl, state, now).finally(() => { state.probing = null; });
    if (neverProbed) {
      await Promise.race([state.probing, new Promise((r) => setTimeout(r, opts.firstWaitMs ?? FIRST_PROBE_WAIT_MS))]);
    }
  }
  return anonymousDoorOpen(now(), state);
}

/** Test hook. */
export function resetAnonymousDoor(state: DoorState = shared): void {
  Object.assign(state, newDoorState());
}
