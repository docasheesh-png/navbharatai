// A RUNG THAT WAS SILENT A MINUTE AGO IS STILL SILENT NOW (autopsy eb58abaf, 2026-10-17).
//
// Two build reports in a row (778d7c58, then eb58abaf) opened on glm-4.7-flashx and sat 15 s in front of
// a provider that never sent its first word. Inside ONE build the ladder already learns this (the crawl
// bench); ACROSS builds it forgot it, so every new build paid the same 15 s to re-prove a fact the
// platform had measured a moment earlier. This is that memory: per process, per rung (family::model —
// never a single key, because silence is the vendor's SERVICE, not one key's quota), for a short window.
//
// 🔒 WHAT IT MAY DO: let a NEW build open past a rung that was silent for another build within the
// window — exactly as the in-build crawl bench would have, and with the same once-more re-probe when the
// window ends. It never empties a ladder (the runner only skips when a later rung exists), never adds a
// call, and never runs two providers in parallel (no cost-doubling hedge — that remains a decision).
// `AGENTV3_SILENCE_MEMORY=off` turns it off with no deploy; `AGENTV3_SILENCE_MEMORY_SECONDS` sets the
// window (default 180, clamped 30–900).

// 🔴 AND IT REMEMBERED NOTHING THAT MATTERED (autopsy ca99778e, 2026-10-17 15:38Z — the 3rd silent opener
// in a row). The memory above shipped and the next build sat the same 15 s anyway. Measured, not guessed:
// the previous silent build (eb58abaf) was 06:53Z, 8¾ HOURS earlier, on an instance a deploy has since
// replaced. The memory lived in ONE process's RAM and for 180 s, so it could only ever help a build that
// started on the same Cloud Run instance within three minutes of the last silence — which no report had.
//
// 🔑 THE CLASS: a provider-health fact stored where the next build cannot read it. Two structural changes:
//   1. DURABLE — every silence is also written (fire-and-forget, one tiny doc) to Firestore
//      `agentv3ProviderHealth/silence`, and every instance hydrates from it in the background (at most every
//      20 s, raced at 1.5 s, never awaited by a build). A deploy or a second instance no longer forgets.
//   2. ADAPTIVE — the window grows with repetition: base × 2^(n−1) for n silences in the last 24 h, capped at
//      30 min (`AGENTV3_SILENCE_MEMORY_MAX_SECONDS`). One blip costs a provider 3 min; a pattern costs it more.
//      An answer lifts the verdict at once but keeps the history, so the NEXT silence is judged as a repeat.
// Still never empties a ladder and never adds a call. `AGENTV3_SILENCE_MEMORY_DURABLE=off` keeps it local.

export interface ProviderSilenceMemory {
  /** Record that this rung produced nothing before we stopped waiting. */
  record(key: string, nowMs: number): void;
  /** When this rung's silence verdict ends (ms), or 0 when there is none in force. */
  until(key: string, nowMs: number): number;
  /** The rung answered — lift its silence verdict (the history stays, so a repeat is judged as one). */
  clear(key: string, nowMs?: number): void;
  /** Pull other instances' silences in, in the background. Never throws, never blocks a build. */
  refresh?(nowMs?: number): Promise<void>;
}

/** Where the silences of every instance meet. Injectable so tests never touch Firestore. */
export interface SilenceHistoryStore {
  load(): Promise<Record<string, number[]>>;
  append(key: string, atMs: number, keepAfterMs: number): Promise<void>;
}

export function silenceMemoryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_SILENCE_MEMORY ?? '').trim().toLowerCase() !== 'off';
}

export function silenceMemoryDurableEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_SILENCE_MEMORY_DURABLE ?? '').trim().toLowerCase() !== 'off';
}

export function silenceMemoryWindowMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(String(env.AGENTV3_SILENCE_MEMORY_SECONDS ?? '').trim());
  const s = Number.isFinite(n) && n > 0 ? Math.min(900, Math.max(30, n)) : 180;
  return Math.round(s * 1000);
}

/** The longest a repeated silence can keep a rung opened past (ms). Default 30 min, clamped 3–120 min. */
export function silenceMemoryMaxWindowMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(String(env.AGENTV3_SILENCE_MEMORY_MAX_SECONDS ?? '').trim());
  const s = Number.isFinite(n) && n > 0 ? Math.min(7200, Math.max(180, n)) : 1800;
  return Math.round(s * 1000);
}

/** Silences older than this no longer count as a repeat. */
export const SILENCE_HISTORY_MS = 24 * 60 * 60 * 1000;
/** At most this many silences are kept per rung (the window saturates long before). */
export const MAX_SILENCES_KEPT = 8;
/** How often an instance re-reads the shared history. */
export const SILENCE_REFRESH_EVERY_MS = 20_000;
/** A refresh that takes longer than this is abandoned (the build never waits for it anyway). */
export const SILENCE_REFRESH_TIMEOUT_MS = 1500;

/**
 * How long the LATEST silence keeps a rung opened past, given `n` silences in the history window. PURE.
 * n=1 → base (180 s), n=2 → 2×, n=3 → 4×, … capped at `maxMs`.
 */
export function adaptiveSilenceWindowMs(n: number, baseMs: number, maxMs: number): number {
  if (!(n >= 1)) return 0;
  const grown = baseMs * Math.pow(2, Math.min(16, Math.floor(n) - 1));
  return Math.max(baseMs, Math.min(maxMs, grown));
}

function pruned(list: readonly number[], nowMs: number): number[] {
  const kept = [...new Set(list.filter((t) => Number.isFinite(t) && t > nowMs - SILENCE_HISTORY_MS && t <= nowMs + 60_000))].sort((a, b) => a - b);
  return kept.slice(-MAX_SILENCES_KEPT);
}

export interface SilenceMemoryOptions {
  windowMs?: () => number;
  maxWindowMs?: () => number;
  store?: SilenceHistoryStore | null;
  now?: () => number;
}

export function createProviderSilenceMemory(opts: SilenceMemoryOptions | (() => number) = {}): ProviderSilenceMemory {
  const o: SilenceMemoryOptions = typeof opts === 'function' ? { windowMs: opts } : opts;
  const windowMs = o.windowMs ?? (() => silenceMemoryWindowMs());
  const maxWindowMs = o.maxWindowMs ?? (() => silenceMemoryMaxWindowMs());
  const clock = o.now ?? (() => Date.now());
  const store = o.store ?? null;
  const history = new Map<string, number[]>();
  /** When the rung last answered — a silence before this is not in force (but still counts as history). */
  const okAt = new Map<string, number>();
  let lastRefresh = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<void> | null = null;

  const refresh = async (nowMs: number = clock()): Promise<void> => {
    if (!store) return;
    if (inFlight) return inFlight;
    if (nowMs - lastRefresh < SILENCE_REFRESH_EVERY_MS) return;
    lastRefresh = nowMs;
    inFlight = (async () => {
      try {
        const remote = await Promise.race([
          store.load(),
          new Promise<Record<string, number[]>>((resolve) => setTimeout(() => resolve({}), SILENCE_REFRESH_TIMEOUT_MS)),
        ]);
        for (const [key, list] of Object.entries(remote ?? {})) {
          if (!Array.isArray(list)) continue;
          history.set(key, pruned([...(history.get(key) ?? []), ...list.map(Number)], nowMs));
        }
      } catch { /* a health memory must never fail a build */ }
      finally { inFlight = null; }
    })();
    return inFlight;
  };

  return {
    record(key, nowMs) {
      history.set(key, pruned([...(history.get(key) ?? []), nowMs], nowMs));
      if (store) {
        try { void store.append(key, nowMs, nowMs - SILENCE_HISTORY_MS).catch(() => {}); } catch { /* best-effort */ }
      }
    },
    until(key, nowMs) {
      if (store && nowMs - lastRefresh >= SILENCE_REFRESH_EVERY_MS) void refresh(nowMs);
      const list = pruned(history.get(key) ?? [], nowMs);
      if (list.length === 0) { history.delete(key); return 0; }
      history.set(key, list);
      const last = list[list.length - 1];
      if ((okAt.get(key) ?? Number.NEGATIVE_INFINITY) >= last) return 0;
      const end = last + adaptiveSilenceWindowMs(list.length, windowMs(), Math.max(windowMs(), maxWindowMs()));
      return end > nowMs ? end : 0;
    },
    clear(key, nowMs) { okAt.set(key, nowMs ?? clock()); },
    refresh,
  };
}

const HEALTH_COLLECTION = 'agentv3ProviderHealth';
const HEALTH_DOC = 'silence';

/** A Firestore field name for a rung key ("kimi::kimi-k2.7" has characters a field path would split on). */
export function silenceFieldFor(key: string): string {
  return String(key).replace(/[^A-Za-z0-9_-]/g, (c) => `_${c.charCodeAt(0).toString(16)}_`);
}

/**
 * The Firestore store — one small doc, `{ rungs: { <field>: { key, at: number[] } } }`. Null under tests or
 * without a database. Loaded lazily so this module stays a leaf for the runner and its tests.
 */
export function firestoreSilenceHistoryStore(): SilenceHistoryStore | null {
  if (process.env.VITEST) return null;
  const db = async () => {
    const mod = await import('../lib/serverDb');
    return mod.getServerDb();
  };
  return {
    async load() {
      const d = await db();
      if (!d) return {};
      const snap = await d.collection(HEALTH_COLLECTION).doc(HEALTH_DOC).get();
      const rungs = (snap.exists ? (snap.data()?.rungs ?? {}) : {}) as Record<string, { key?: unknown; at?: unknown }>;
      const out: Record<string, number[]> = {};
      for (const v of Object.values(rungs)) {
        if (typeof v?.key === 'string' && Array.isArray(v.at)) out[v.key] = v.at.map(Number).filter(Number.isFinite);
      }
      return out;
    },
    async append(key, atMs, keepAfterMs) {
      const d = await db();
      if (!d) return;
      const ref = d.collection(HEALTH_COLLECTION).doc(HEALTH_DOC);
      const field = silenceFieldFor(key);
      // Read-modify-write without a transaction on purpose: two instances racing lose at most one timestamp of a
      // best-effort health hint, and a transaction would add latency and contention for nothing.
      const snap = await ref.get();
      const prev = (snap.exists ? snap.data()?.rungs?.[field]?.at : null) as unknown;
      const at = [...(Array.isArray(prev) ? prev.map(Number) : []), atMs]
        .filter((t) => Number.isFinite(t) && t > keepAfterMs)
        .sort((a, b) => a - b)
        .slice(-MAX_SILENCES_KEPT);
      await ref.set({ rungs: { [field]: { key, at } }, updatedAt: atMs }, { merge: true });
    },
  };
}

/** The process-wide memory the build route hands every runner it makes. */
export const sharedProviderSilenceMemory: ProviderSilenceMemory = createProviderSilenceMemory({
  store: silenceMemoryDurableEnabled() ? firestoreSilenceHistoryStore() : null,
});
