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

export interface ProviderSilenceMemory {
  /** Record that this rung produced nothing before we stopped waiting. */
  record(key: string, nowMs: number): void;
  /** When this rung's silence verdict ends (ms), or 0 when there is none in force. */
  until(key: string, nowMs: number): number;
  /** The rung answered — forget its silence. */
  clear(key: string): void;
}

export function silenceMemoryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_SILENCE_MEMORY ?? '').trim().toLowerCase() !== 'off';
}

export function silenceMemoryWindowMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(String(env.AGENTV3_SILENCE_MEMORY_SECONDS ?? '').trim());
  const s = Number.isFinite(n) && n > 0 ? Math.min(900, Math.max(30, n)) : 180;
  return Math.round(s * 1000);
}

export function createProviderSilenceMemory(windowMs: () => number = () => silenceMemoryWindowMs()): ProviderSilenceMemory {
  const at = new Map<string, number>();
  return {
    record(key, nowMs) { at.set(key, nowMs); },
    until(key, nowMs) {
      const t = at.get(key);
      if (t === undefined) return 0;
      const end = t + windowMs();
      if (end <= nowMs) { at.delete(key); return 0; }
      return end;
    },
    clear(key) { at.delete(key); },
  };
}

/** The process-wide memory the build route hands every runner it makes. */
export const sharedProviderSilenceMemory: ProviderSilenceMemory = createProviderSilenceMemory();
