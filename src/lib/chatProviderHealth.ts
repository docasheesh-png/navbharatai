/**
 * The status a Chat Router card shows (Admin → AI Engines → Chat Router — Live). PURE.
 *
 * 🔴 WHY (admin 2026-11-04, screenshot of the panel): GLM read "Healthy" with 3 requests and 3 errors. The badge
 * only knew two facts — on cooldown, or ever ran — so a provider failing every call it got was painted green, and
 * a circuit another server had opened read as "Not used yet". The status now reads every fact the server sends:
 * the circuit, the cooldown, the error count and the in-flight count. "Not used yet" stays what it is — no calls
 * on this server since it started — because no data is not the same as healthy.
 */
export interface ChatProviderStat {
  cooldownUntil?: number; circuitState?: string; consecutiveFailures?: number;
  inFlight?: number; avgLatencyMs?: number; errorCount?: number; requestCount?: number;
}
export type HealthTone = 'danger' | 'warn' | 'neutral' | 'ok' | 'busy';
export interface ChatProviderHealth { label: string; tone: HealthTone; detail: string | null }

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function chatProviderHealth(stat: ChatProviderStat, now: number): ChatProviderHealth {
  const requests = n(stat.requestCount);
  const errors = Math.min(n(stat.errorCount), requests);
  const cooldownMs = n(stat.cooldownUntil) - now;
  const failedLine = requests > 0 && errors > 0 ? `${errors} of ${requests} calls failed on this server` : null;
  if (stat.circuitState === 'open' || cooldownMs > 0) {
    return { label: cooldownMs > 0 ? `Paused ${Math.ceil(cooldownMs / 1000)}s` : 'Circuit open', tone: 'danger',
      detail: failedLine ?? 'Paused after failures (possibly seen by another server) — calls skip it until it recovers' };
  }
  if (requests === 0) {
    return stat.circuitState === 'half_open'
      ? { label: 'Recovering', tone: 'warn', detail: 'It failed earlier (possibly on another server); the next call tests it' }
      : { label: 'Not used yet', tone: 'neutral', detail: 'No calls on this server since it started — no data, not a fault' };
  }
  if (errors / requests >= 0.5) return { label: 'Failing', tone: 'danger', detail: failedLine };
  if (errors > 0) return { label: 'Degraded', tone: 'warn', detail: failedLine };
  if (stat.circuitState === 'half_open') return { label: 'Recovering', tone: 'warn', detail: 'Testing again after an earlier failure' };
  if (n(stat.inFlight) > 0) return { label: 'Busy', tone: 'busy', detail: null };
  return { label: 'Healthy', tone: 'ok', detail: null };
}

/** Average latency is measured on successful calls; with none, there is no number to show. */
export function chatProviderLatencyText(stat: ChatProviderStat): string {
  const ok = n(stat.requestCount) - Math.min(n(stat.errorCount), n(stat.requestCount));
  return ok > 0 && n(stat.avgLatencyMs) > 0 ? `${Math.round(n(stat.avgLatencyMs))}ms` : '—';
}
