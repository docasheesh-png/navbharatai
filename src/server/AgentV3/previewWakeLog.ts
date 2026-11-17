// AgentV3 — EVERY ATTEMPT TO WAKE A PREVIEW LEAVES A RECORD (admin 2026-11-17, layer 3 of "a preview is never
// blank").
//
// The admin opened a three-day-old game and the preview "1 second bhi nahi chala". The build report could not
// say why: wake attempts happen BETWEEN builds, from the preview pane, and nothing they did was kept. The
// next build then resumed the same machine in 0 seconds, so "the machine was dead" was not the answer either —
// and without the attempt's own record no one could say which step stopped it.
//
// So each wake (the preview-diagnose route) appends one bounded entry to the workspace's own sandbox record,
// and the next build writes the failed ones into its report. Five entries, short text, no secrets, no URLs.
// PURE — no I/O, no clock.

export interface WakeAttempt {
  /** Epoch ms the attempt finished. */
  at: number;
  ok: boolean;
  /** The last stage the wake reported before it finished (e.g. "Installing dependencies…"). */
  stage: string;
  /** The wake's own one-line reason. */
  reason: string;
  seconds: number;
}

export const WAKE_LOG_MAX = 5;
const TEXT_MAX = 200;

/** Short, single-line, with anything that looks like a URL or a key removed. */
export function cleanWakeText(value: unknown): string {
  return String(value ?? '')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\b(sk|e2b|key|token)[-_][A-Za-z0-9_-]{8,}/gi, '[secret]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TEXT_MAX);
}

function isAttempt(v: unknown): v is WakeAttempt {
  const a = v as WakeAttempt;
  return !!a && typeof a === 'object' && Number.isFinite(a.at) && typeof a.ok === 'boolean'
    && typeof a.stage === 'string' && typeof a.reason === 'string' && Number.isFinite(a.seconds);
}

/** The list with this attempt added, oldest dropped, malformed entries ignored. */
export function appendWakeAttempt(previous: unknown, attempt: WakeAttempt, max = WAKE_LOG_MAX): WakeAttempt[] {
  const kept = Array.isArray(previous) ? previous.filter(isAttempt) : [];
  const entry: WakeAttempt = {
    at: Math.round(attempt.at), ok: attempt.ok === true,
    stage: cleanWakeText(attempt.stage), reason: cleanWakeText(attempt.reason),
    seconds: Math.max(0, Math.round(Number(attempt.seconds) || 0)),
  };
  return [...kept, entry].slice(-Math.max(1, max));
}

/**
 * The report line for the failed wakes since `since` (the previous build), or null when there were none.
 * A successful wake is not a defect and is not reported.
 */
export function wakeHistoryLine(log: unknown, since: number): string | null {
  const failed = (Array.isArray(log) ? log.filter(isAttempt) : []).filter((a) => !a.ok && a.at > since);
  if (!failed.length) return null;
  const parts = failed.map((a) => `${new Date(a.at).toISOString().slice(0, 16).replace('T', ' ')} UTC after ${a.seconds}s at "${a.stage || 'start'}": ${a.reason || 'no reason given'}`);
  return `${failed.length} preview wake-up${failed.length === 1 ? '' : 's'} failed before this build — ${parts.join(' · ')}`;
}
