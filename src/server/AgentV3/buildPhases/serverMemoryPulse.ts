/**
 * THE SERVER'S MEMORY, ON THE REPORT OF A BUILD THAT MAY DIE (failedbr #2521–#2530, Q-3354, 2026-11-25).
 *
 * Seven builds in one evening ended "the server running it was lost", and not one of their reports said how much memory
 * the instance was using: the only place the exit reason lives is Cloud Run's log, which no session can read. An instance
 * killed for memory dies without running any JS, so the evidence has to be on the report BEFORE it dies — the throttled
 * in-progress saves carry whatever was recorded. So the build's own two-minute tick records the instance's memory as an
 * info line each time it crosses a higher band (60 %, 75 %, 90 % of the container's limit), with the absolute bytes when
 * the limit is unknown — once per band, never a line per tick. Evidence only: it never stops, slows or charges a build.
 * Never throws.
 */
import { serverLoad, type ServerLoadSnapshot } from '../../lib/serverLoad';

export const MEMORY_BANDS = [60, 75, 90] as const;
/** With no known limit, record at these absolute sizes instead (MiB). */
export const MEMORY_BANDS_MB = [1024, 2048, 3072] as const;
export const SERVER_MEMORY_CODE = 'SERVER_MEMORY_HIGH';

export interface MemoryPulseState { band: number }
export interface MemoryPulsePorts {
  record: (issue: { phase: 'build'; severity: 'info' | 'warning'; code: string; message: string; autoResolved: boolean }) => void;
  snapshot?: () => Pick<ServerLoadSnapshot, 'memoryRssBytes' | 'memoryLimitBytes' | 'memoryPercent' | 'inFlightRequests'>;
}

const mb = (b: number): number => Math.round(b / (1024 * 1024));

/** Record the instance's memory when it has crossed a higher band than this build last recorded. Returns the band (0 = none). */
export function noteServerMemory(state: MemoryPulseState, ports: MemoryPulsePorts, elapsedMs: number): number {
  try {
    const s = (ports.snapshot ?? (() => serverLoad.snapshot()))();
    const rss = Number(s.memoryRssBytes);
    if (!Number.isFinite(rss) || rss <= 0) return 0;
    const pct = typeof s.memoryPercent === 'number' && Number.isFinite(s.memoryPercent) ? s.memoryPercent : null;
    const bands: readonly number[] = pct !== null ? MEMORY_BANDS : MEMORY_BANDS_MB;
    const value = pct !== null ? pct : mb(rss);
    let band = 0;
    for (const b of bands) if (value >= b) band = b;
    if (band <= state.band) return 0;
    state.band = band;
    const limit = typeof s.memoryLimitBytes === 'number' && s.memoryLimitBytes > 0 ? ` of its ${mb(s.memoryLimitBytes)} MiB limit (${pct}%)` : ' (its limit is unknown)';
    ports.record({
      phase: 'build', severity: pct !== null && pct >= 90 ? 'warning' : 'info', code: SERVER_MEMORY_CODE, autoResolved: true,
      message: `${Math.round(elapsedMs / 1000)} s in: the server running this build is using ${mb(rss)} MiB${limit}, with ${s.inFlightRequests} request(s) in flight. `
        + 'Recorded so a build that is lost afterwards shows how close its server was to its memory limit.',
    });
    return band;
  } catch { return 0; }
}
