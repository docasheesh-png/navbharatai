// Live runtime logs for the user's OWN running app (ROADMAP §8B item B1).
//
// WHY: the dev server already writes everything it prints to DEV_SERVER_LOG_PATH inside the sandbox, and
// the ENGINE already reads it — E2BActuator tails 80 lines of it to diagnose a failed boot. The user
// never sees a byte of it. So when their backend throws on every request, the app "just doesn't work"
// and there is nothing to look at; the only lever is asking for another build. This is a SURFACE for a
// stream that already exists, not a new capability — which is exactly why it is the cheapest big win in
// §8B.
//
// Everything here is PURE (a command builder, a parser, a window decision) so the rules are unit-tested
// instead of being buried in the 12k-line route — the same reason streamingFirstPaint.ts was extracted.

import { DEV_SERVER_LOG_PATH } from './sandbox/EngineerAI/actuators/devServerHost';

/**
 * Most bytes we will pull in one poll. The sandbox caps `commands.run` stdout at 64 KB and TRUNCATES
 * past it (the screenshot tool learned this the hard way — a base64 image blew the cap and corrupted the
 * JSON), so this stays comfortably under with room for the markers.
 */
export const RUNTIME_LOG_MAX_BYTES = 48_000;

/** Markers the parser keys on. Emitted BEFORE the data, so log content can never be mistaken for one. */
const SIZE_MARK = 'NBAI_LOGSIZE:';
const DATA_MARK = 'NBAI_LOGDATA:';
const MISSING_MARK = 'NBAI_LOGMISSING';

/**
 * Build the one-shot command that returns the log's current size and the bytes after `offset`.
 *
 * The shell does the rotation math itself (`if offset > size then offset = 0`) so a log that was
 * truncated or replaced under us cannot make `tail -c +N` silently return nothing forever — the very
 * failure mode that would look like "the app stopped logging" when it had actually restarted.
 *
 * `tail -c +N` is 1-BASED, hence `offset + 1`. The second `tail -c` caps the window, so a poller that
 * has been away for ten minutes gets the most recent bytes rather than a truncated head of the gap.
 */
export function buildRuntimeLogCommand(offset: number, logPath: string = DEV_SERVER_LOG_PATH, maxBytes: number = RUNTIME_LOG_MAX_BYTES): string {
  const o = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
  const cap = Math.max(1, Math.floor(maxBytes));
  return [
    `f=${logPath}`,
    `if [ ! -f "$f" ]; then echo '${MISSING_MARK}'; else`,
    `s=$(wc -c < "$f" | tr -d ' ')`,
    `o=${o}`,
    `if [ "$o" -gt "$s" ]; then o=0; fi`,
    `echo "${SIZE_MARK}$s"`,
    `echo '${DATA_MARK}'`,
    `tail -c +$((o+1)) "$f" | tail -c ${cap}`,
    `fi`,
  ].join('; ');
}

export interface RuntimeLogWindow {
  /** False when the dev server has never written a log — a real "nothing has run yet", not an error. */
  hasLog: boolean;
  /** The log text after the caller's offset (already capped). */
  text: string;
  /** Byte offset to send on the next poll. */
  nextOffset: number;
  /** The log shrank since the last poll — the server restarted. Say so; a silent jump reads as a bug. */
  restarted: boolean;
  /** Output was produced faster than it was polled, so some bytes were skipped. Never hide this. */
  skipped: boolean;
}

/**
 * Parse the command's stdout into a window. Never throws — an unparseable response degrades to
 * "no log yet" rather than inventing content, because a fabricated log line is worse than an empty pane.
 */
export function parseRuntimeLogOutput(stdout: string, requestedOffset: number, maxBytes: number = RUNTIME_LOG_MAX_BYTES): RuntimeLogWindow {
  const out = String(stdout ?? '');
  const empty: RuntimeLogWindow = { hasLog: false, text: '', nextOffset: 0, restarted: false, skipped: false };
  if (!out || out.includes(MISSING_MARK)) return empty;

  const sizeAt = out.indexOf(SIZE_MARK);
  const dataAt = out.indexOf(DATA_MARK);
  if (sizeAt < 0 || dataAt < 0 || dataAt < sizeAt) return empty;

  const size = Number.parseInt(out.slice(sizeAt + SIZE_MARK.length, out.indexOf('\n', sizeAt)).trim(), 10);
  if (!Number.isFinite(size) || size < 0) return empty;

  // Everything after the marker LINE is log content, verbatim — including its leading newlines, which
  // are real output, so only the single newline that terminates the marker itself is removed.
  let text = out.slice(dataAt + DATA_MARK.length);
  if (text.startsWith('\n')) text = text.slice(1);

  const asked = Number.isFinite(requestedOffset) && requestedOffset > 0 ? Math.floor(requestedOffset) : 0;
  const restarted = asked > size;
  const from = restarted ? 0 : asked;
  const skipped = size - from > maxBytes;

  return { hasLog: true, text, nextOffset: size, restarted, skipped };
}

/**
 * The one line the UI shows above a window that is not continuous. Returns '' when nothing was lost —
 * so the pane stays clean on the normal path and only speaks when it has something true to say.
 */
export function runtimeLogGapNotice(w: Pick<RuntimeLogWindow, 'restarted' | 'skipped'>): string {
  if (w.restarted) return 'The server restarted — this is the log from the new run.';
  if (w.skipped) return 'The app logged faster than this view could read; older lines were skipped.';
  return '';
}
