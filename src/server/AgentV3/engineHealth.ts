/**
 * ENGINE HEALTH, FROM WHAT BUILDS RECORDED — the admin AI Engines page's "which engine is failing, and why".
 *
 * Owner 2026-11-17: "jo ai/provider use ho rahe hai, wahi dikhen chahiye, aur yeh live rahe, kon se provider fail
 * ho raha kyu fail ho raha likh kar aye, admin ko saf dikhe".
 *
 * 🔴 WHY IT IS BUILT FROM BUILD REPORTS, NOT FROM A COUNTER. The page's "Chat Router — Live" card is one server
 * instance's memory since its last deploy: it never sees the other instances and resets on every deploy, so it
 * cannot say which ENGINE is failing for users. Every build report already records, per engine, the turns it
 * delivered (`providerDelivery`) and its failures by cause (`providerFailures` / `providerFailureReasons`,
 * filled by `classifyProviderFailure` at the moment of failure). Those reports are stored for every instance,
 * so aggregating the last 24 hours of them answers the question for the whole platform. PURE: no I/O.
 *
 * 🔒 Nothing is invented. An engine with no recorded turn and no recorded failure is "no recent use", never
 * "healthy". A reason this module does not know is shown as the classifier wrote it.
 */
import type { ModelPerformanceSummary } from './modelPerformance';

export type EngineHealthStatus = 'working' | 'degraded' | 'failing' | 'idle';

export interface EngineHealth {
  /** The engine as builds report it, with any pool suffix removed: `GLM`, `KIMI`, `ENGINE_R1`, `SURPLUS`. */
  engine: string;
  /** Build turns this engine delivered in the window. */
  delivered: number;
  /** Failed calls in the window. */
  failures: number;
  /** Builds in the window in which this engine delivered or failed at least once. */
  builds: number;
  /** Failure causes, most frequent first, each with a plain-language sentence. */
  reasons: Array<{ code: string; count: number; text: string }>;
  /** When the newest build that recorded a failure of this engine started (ms), or null. */
  lastFailureAt: number | null;
  status: EngineHealthStatus;
}

export interface EngineHealthReport {
  windowHours: number;
  /** How many builds the window held, so "no failures" can be read against how much was looked at. */
  buildsRead: number;
  engines: EngineHealth[];
}

/** One plain sentence per `classifyProviderFailure` bucket, for an admin who is not an engineer. */
export const FAILURE_REASON_TEXT: Readonly<Record<string, string>> = Object.freeze({
  'rate-limit': 'Too many requests: the provider is rate-limiting this key (HTTP 429).',
  timeout: 'Timed out before the answer finished.',
  silent: 'Sent nothing back at all within the wait time.',
  crawl: 'Started answering, but far too slowly.',
  'output-budget': 'Spent its token allowance thinking and returned no usable answer.',
  auth: 'The API key was refused (wrong, expired or revoked key).',
  billing: 'Out of balance or credit on the provider account.',
  'model-unavailable': 'The requested model is not available on this key.',
  'bad-request': 'The provider rejected the request as invalid.',
  'context-length': 'The request was longer than the model accepts.',
  'server-error': 'The provider had a server error (HTTP 5xx).',
  network: 'Could not connect to the provider.',
  unknown: 'Failed for a reason the build did not classify.',
});

/** Admin-only display names for the neutral engine labels builds report (the White-Label Law allows vendor names here). */
export const ENGINE_DISPLAY_NAMES: Readonly<Record<string, string>> = Object.freeze({
  SURPLUS: 'Surplus', ENGINE_R1: 'Router One', ENGINE_BM: 'BluesMinds', ENGINE_MY: 'Moyi API',
  ENGINE_QX: 'Qubax', ENGINE_MF: 'Mitrify', GLM: 'Z.ai GLM', KIMI: 'Kimi', NEMOTRON: 'NVIDIA Nemotron',
  CLAUDE: 'Claude Sonnet', CLAUDE_HAIKU: 'Claude Haiku', CLAUDE_OPUS: 'Claude Opus', OPENAI: 'OpenAI',
});

/** The engine name without a pool suffix (`GLM#2` → `GLM`), upper-cased. */
export function engineFamily(name: string): string {
  return String(name ?? '').trim().toUpperCase().replace(/#\d+$/, '');
}

function reasonText(code: string): string {
  if (FAILURE_REASON_TEXT[code]) return FAILURE_REASON_TEXT[code];
  const other = /^other:\s*(.+)$/i.exec(code);
  return other ? `Error: ${other[1].slice(0, 200)}` : code.slice(0, 200);
}

/** Status from counts only. A recent success with failures is degraded; failures and no success is failing. */
export function engineStatus(delivered: number, failures: number): EngineHealthStatus {
  if (delivered === 0 && failures === 0) return 'idle';
  if (delivered === 0) return 'failing';
  if (failures === 0) return 'working';
  return failures > delivered ? 'failing' : 'degraded';
}

export interface EngineHealthInput {
  startedAt?: number | null;
  modelPerformance?: Pick<ModelPerformanceSummary, 'providerFailures' | 'providerDelivery'> | null;
}

/** Aggregate the builds already filtered to the window. Worst engines first. */
export function aggregateEngineHealth(entries: readonly EngineHealthInput[], windowHours: number): EngineHealthReport {
  const by = new Map<string, { delivered: number; failures: number; builds: number; reasons: Map<string, number>; lastFailureAt: number | null }>();
  const row = (engine: string) => {
    let r = by.get(engine);
    if (!r) { r = { delivered: 0, failures: 0, builds: 0, reasons: new Map(), lastFailureAt: null }; by.set(engine, r); }
    return r;
  };
  for (const entry of entries) {
    const perf = entry.modelPerformance;
    if (!perf) continue;
    const seen = new Set<string>();
    for (const [name, turns] of Object.entries(perf.providerDelivery ?? {})) {
      const n = Number(turns);
      if (!Number.isFinite(n) || n <= 0) continue;
      const engine = engineFamily(name);
      row(engine).delivered += n;
      seen.add(engine);
    }
    for (const f of perf.providerFailures ?? []) {
      const n = Number(f?.failures);
      if (!Number.isFinite(n) || n <= 0) continue;
      const engine = engineFamily(f.provider);
      const r = row(engine);
      r.failures += n;
      for (const [code, count] of Object.entries(f.byReason ?? {})) {
        const c = Number(count);
        if (Number.isFinite(c) && c > 0) r.reasons.set(code, (r.reasons.get(code) ?? 0) + c);
      }
      const at = Number(entry.startedAt);
      if (Number.isFinite(at) && at > 0 && (r.lastFailureAt === null || at > r.lastFailureAt)) r.lastFailureAt = at;
      seen.add(engine);
    }
    for (const engine of seen) row(engine).builds += 1;
  }
  const rank: Record<EngineHealthStatus, number> = { failing: 0, degraded: 1, working: 2, idle: 3 };
  const engines: EngineHealth[] = [...by.entries()].map(([engine, r]) => ({
    engine,
    delivered: r.delivered,
    failures: r.failures,
    builds: r.builds,
    reasons: [...r.reasons.entries()].sort((a, b) => b[1] - a[1]).map(([code, count]) => ({ code, count, text: reasonText(code) })),
    lastFailureAt: r.lastFailureAt,
    status: engineStatus(r.delivered, r.failures),
  })).sort((a, b) => rank[a.status] - rank[b.status] || b.failures - a.failures || b.delivered - a.delivered || a.engine.localeCompare(b.engine));
  return { windowHours, buildsRead: entries.length, engines };
}
