// P-DEPLOY.1 — DORA Metrics Engine.
//
// Computes the four DORA metrics from recorded deploy + incident events:
//   1. Deployment Frequency  — deploys per day over the window
//   2. Change Lead Time      — median time from change to deploy (when lead time is known)
//   3. Change Failure Rate   — % of deploys that failed / caused an incident
//   4. MTTR                  — mean time to restore from an incident
// …plus the overall DORA performance tier (elite / high / medium / low).
//
// The calculators are PURE and unit-tested. The collector is an in-memory ring (best-effort
// Firestore persistence can layer on later). A real signal feeds it today: each production
// server-ready (a new Cloud Run revision going live) records a successful deploy — so
// deployment frequency reflects actual revisions. Metrics with no data are reported as
// null/0 honestly (never faked).

export interface DeployRecord {
  id: string;
  /** epoch ms when the deploy went live. */
  timestamp: number;
  success: boolean;
  /** ms from the change (commit) to this deploy, when known. */
  leadTimeMs?: number;
}

export interface IncidentRecord {
  id: string;
  /** epoch ms the incident began. */
  failedAt: number;
  /** epoch ms it was resolved; undefined while ongoing. */
  resolvedAt?: number;
}

export type DoraTier = 'elite' | 'high' | 'medium' | 'low';

export interface DoraSummary {
  windowMs: number;
  generatedAt: number;
  deploymentCount: number;
  deploymentFrequencyPerDay: number;
  changeFailureRatePct: number;
  medianLeadTimeMs: number | null;
  mttrMs: number | null;
  tier: DoraTier;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

function inWindow<T extends { timestamp?: number; failedAt?: number }>(items: T[], field: 'timestamp' | 'failedAt', now: number, windowMs: number): T[] {
  const cutoff = now - windowMs;
  return items.filter((i) => (i[field] as number) >= cutoff);
}

/** Deploys per day over the window. Pure. */
export function deploymentFrequencyPerDay(deploys: DeployRecord[], windowMs: number): number {
  if (windowMs <= 0) return 0;
  const days = windowMs / DAY_MS;
  return deploys.length / days;
}

/** % of deploys that failed (0 when no deploys). Pure. */
export function changeFailureRatePct(deploys: DeployRecord[]): number {
  if (deploys.length === 0) return 0;
  const failed = deploys.filter((d) => !d.success).length;
  return (failed / deploys.length) * 100;
}

/** Median lead time across deploys that have a known lead time, else null. Pure. */
export function medianLeadTimeMs(deploys: DeployRecord[]): number | null {
  const times = deploys.map((d) => d.leadTimeMs).filter((t): t is number => typeof t === 'number' && t >= 0).sort((a, b) => a - b);
  if (times.length === 0) return null;
  const mid = Math.floor(times.length / 2);
  return times.length % 2 ? times[mid] : Math.round((times[mid - 1] + times[mid]) / 2);
}

/** Mean time to restore across RESOLVED incidents, else null. Pure. */
export function mttrMs(incidents: IncidentRecord[]): number | null {
  const durations = incidents
    .filter((i) => typeof i.resolvedAt === 'number' && (i.resolvedAt as number) >= i.failedAt)
    .map((i) => (i.resolvedAt as number) - i.failedAt);
  if (durations.length === 0) return null;
  return Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
}

/**
 * Classify the overall DORA tier from the computed metrics, using the standard 2022 DORA
 * bands. Metrics with no data don't drag the tier down (treated as neutral). Pure.
 */
export function classifyTier(s: { deploymentFrequencyPerDay: number; medianLeadTimeMs: number | null; mttrMs: number | null; changeFailureRatePct: number }): DoraTier {
  const scores: number[] = []; // 4=elite 3=high 2=medium 1=low
  // Deployment frequency
  if (s.deploymentFrequencyPerDay >= 1) scores.push(4);          // on-demand (≥1/day)
  else if (s.deploymentFrequencyPerDay >= 1 / 7) scores.push(3); // weekly+
  else if (s.deploymentFrequencyPerDay >= 1 / 30) scores.push(2);// monthly+
  else scores.push(1);
  // Lead time (only if known)
  if (s.medianLeadTimeMs != null) {
    if (s.medianLeadTimeMs < DAY_MS) scores.push(4);
    else if (s.medianLeadTimeMs < 7 * DAY_MS) scores.push(3);
    else if (s.medianLeadTimeMs < 30 * DAY_MS) scores.push(2);
    else scores.push(1);
  }
  // MTTR (only if known)
  if (s.mttrMs != null) {
    if (s.mttrMs < HOUR_MS) scores.push(4);
    else if (s.mttrMs < DAY_MS) scores.push(3);
    else if (s.mttrMs < 7 * DAY_MS) scores.push(2);
    else scores.push(1);
  }
  // Change failure rate
  if (s.changeFailureRatePct <= 15) scores.push(4);
  else if (s.changeFailureRatePct <= 30) scores.push(2);
  else scores.push(1);

  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  if (avg >= 3.5) return 'elite';
  if (avg >= 2.5) return 'high';
  if (avg >= 1.5) return 'medium';
  return 'low';
}

/** Pure: compute the full DORA summary for a window ending at `now`. */
export function computeDora(deploys: DeployRecord[], incidents: IncidentRecord[], now: number, windowMs: number = 30 * DAY_MS): DoraSummary {
  const wd = inWindow(deploys, 'timestamp', now, windowMs);
  const wi = inWindow(incidents, 'failedAt', now, windowMs);
  const freq = deploymentFrequencyPerDay(wd, windowMs);
  const cfr = changeFailureRatePct(wd);
  const lead = medianLeadTimeMs(wd);
  const mttr = mttrMs(wi);
  return {
    windowMs,
    generatedAt: now,
    deploymentCount: wd.length,
    deploymentFrequencyPerDay: Math.round(freq * 1000) / 1000,
    changeFailureRatePct: Math.round(cfr * 10) / 10,
    medianLeadTimeMs: lead,
    mttrMs: mttr,
    tier: classifyTier({ deploymentFrequencyPerDay: freq, medianLeadTimeMs: lead, mttrMs: mttr, changeFailureRatePct: cfr }),
  };
}

/** In-memory collector singleton (bounded). Real signals feed it; summary() computes DORA. */
class DoraCollector {
  private deploys: DeployRecord[] = [];
  private incidents: IncidentRecord[] = [];
  private readonly cap = 1000;
  private seq = 0;

  recordDeploy(opts: { success?: boolean; leadTimeMs?: number; timestamp?: number } = {}): DeployRecord {
    const rec: DeployRecord = {
      id: `dep-${Date.now()}-${(this.seq++).toString(36)}`,
      timestamp: opts.timestamp ?? Date.now(),
      success: opts.success !== false,
      ...(typeof opts.leadTimeMs === 'number' ? { leadTimeMs: opts.leadTimeMs } : {}),
    };
    this.deploys.push(rec);
    if (this.deploys.length > this.cap) this.deploys.splice(0, this.deploys.length - this.cap);
    return rec;
  }

  /** Open an incident; returns its id (call resolveIncident later). */
  recordIncident(failedAt: number = Date.now()): string {
    const id = `inc-${Date.now()}-${(this.seq++).toString(36)}`;
    this.incidents.push({ id, failedAt });
    if (this.incidents.length > this.cap) this.incidents.splice(0, this.incidents.length - this.cap);
    return id;
  }

  resolveIncident(id: string, resolvedAt: number = Date.now()): void {
    const inc = this.incidents.find((i) => i.id === id);
    if (inc && inc.resolvedAt == null) inc.resolvedAt = resolvedAt;
  }

  summary(windowMs?: number, now: number = Date.now()): DoraSummary {
    return computeDora(this.deploys, this.incidents, now, windowMs);
  }

  /** Test helper. */
  reset(): void { this.deploys = []; this.incidents = []; this.seq = 0; }
}

export const doraMetrics = new DoraCollector();
