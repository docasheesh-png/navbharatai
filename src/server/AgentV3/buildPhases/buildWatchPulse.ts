/**
 * WHETHER ANYONE WAS STILL CONNECTED WHEN A BUILD WAS LOST (failedbr #2557–#2561, Q-3323 / Q-3354, 2026-11-27).
 *
 * Five builds in a row ended "the server running it was lost" — #2557 and #2558 within 23 s of each other, so a whole
 * instance stopped, not one build. None of them recorded a memory band (serverMemoryPulse.ts), so memory is not the
 * leading suspect any more. The other suspect named in Q-3323 is Cloud Run's CPU allocation: `cloudbuild.yaml` does not pass
 * `--no-cpu-throttling`, and on request-based CPU a server with no open request may be throttled and then stopped while
 * a build is still running in the background. A build keeps running after the user's browser closes its stream (phone
 * locked, tab closed), and nothing on the report said when that happened.
 *
 * So the build's own tick records, once each way, when the last connected viewer left and when one came back. The next lost
 * build then shows whether its server died with nobody connected (throttling is the cause) or with the user still watching
 * (it is not). Evidence only: it never stops, slows or charges a build. Never throws.
 */
import { serverLoad } from '../../lib/serverLoad';

export const BUILD_UNWATCHED_CODE = 'BUILD_UNWATCHED';
export const BUILD_WATCHED_AGAIN_CODE = 'BUILD_WATCHED_AGAIN';

export interface WatchPulseState { unwatchedSince: number | null }
export interface WatchPulsePorts {
  /** How many live streams are attached to this build right now. */
  watching: () => number;
  /** Requests open on this server right now (any user's); the host allocates CPU while at least one is open. */
  inFlight?: () => number;
  record: (issue: { phase: 'build'; severity: 'info'; code: string; message: string; autoResolved: boolean }) => void;
}

/** Record when the last viewer left and when one came back. Returns the code recorded, or '' when nothing changed. */
export function noteBuildWatchers(state: WatchPulseState, ports: WatchPulsePorts, elapsedMs: number, now: number = Date.now()): string {
  try {
    const n = Number(ports.watching());
    if (!Number.isFinite(n)) return '';
    const s = Math.round(Math.max(0, elapsedMs) / 1000);
    if (n <= 0 && state.unwatchedSince === null) {
      state.unwatchedSince = now;
      let open = '';
      try { const f = Number((ports.inFlight ?? (() => serverLoad.snapshot().inFlightRequests))()); if (Number.isFinite(f)) open = ` (${f} request(s) open on this server)`; } catch { /* unknown */ }
      ports.record({
        phase: 'build', severity: 'info', code: BUILD_UNWATCHED_CODE, autoResolved: true,
        message: `${s} s in: no browser stream is attached to this build any more${open}; it keeps running on the server. `
          + 'Recorded because a server with no open request may have its CPU throttled or be stopped by the host: a build lost after this line, on a server with no open request, was most likely stopped for that reason.',
      });
      return BUILD_UNWATCHED_CODE;
    }
    if (n > 0 && state.unwatchedSince !== null) {
      const away = Math.round(Math.max(0, now - state.unwatchedSince) / 1000);
      state.unwatchedSince = null;
      ports.record({
        phase: 'build', severity: 'info', code: BUILD_WATCHED_AGAIN_CODE, autoResolved: true,
        message: `${s} s in: a browser is connected to this build again, after ${away} s with none.`,
      });
      return BUILD_WATCHED_AGAIN_CODE;
    }
    return '';
  } catch { return ''; }
}
