// The client-side accumulation rules for B1's live app-log pane. Pure, so "what does the pane hold
// after N polls" is a unit test rather than something you have to reproduce by watching a real build.

/**
 * How much log the pane keeps in memory. A dev server under load can emit megabytes in a minute, and a
 * React state holding all of it would grow until the tab dies — which would be a worse bug than the one
 * this pane exists to expose. ~200k chars is a few thousand lines: far more scrollback than anyone reads,
 * far less than a leak.
 */
export const RUNTIME_LOG_BUFFER_CHARS = 200_000;

/**
 * Append a polled chunk, trimming the OLDEST content when the buffer overflows.
 *
 * Trims from the front, at a LINE boundary, so the top of the pane is never half a line — a truncated
 * first line reads as corrupted output, which is exactly the misdiagnosis this feature is meant to end.
 * Pure.
 */
export function appendLogChunk(prev: string, chunk: string, maxChars: number = RUNTIME_LOG_BUFFER_CHARS): string {
  const next = `${prev ?? ''}${chunk ?? ''}`;
  if (next.length <= maxChars) return next;
  const cut = next.slice(next.length - maxChars);
  const nl = cut.indexOf('\n');
  // If there is no newline at all in the retained window, keep it as-is rather than throwing the whole
  // buffer away — one very long line is still the user's output.
  return nl >= 0 && nl < cut.length - 1 ? cut.slice(nl + 1) : cut;
}

/**
 * What the pane should say when it has no lines to show. Never blank — a blank pane explains nothing.
 *
 * ⚠️ 'unknown' IS NOT A COSMETIC ADDITION (2026-08-24). The server used to turn a FAILED file count
 * into the number zero, and zero meant `not_started`, and this function renders that as "Nothing has
 * been built yet". So a store hiccup told a user their project did not exist — on a workspace they had
 * built. It is the most alarming sentence this product can show, produced by an error nobody saw.
 *
 * The server now distinguishes the three, so this must too. The message invites a retry rather than
 * explaining anything, because "we could not check just now" is genuinely all we know.
 */
export function runtimeLogEmptyMessage(
  status: 'idle' | 'live' | 'dormant' | 'not_started' | 'unknown',
  hasLog: boolean,
): string {
  if (status === 'unknown') return 'Could not check this workspace just now — try again in a moment.';
  if (status === 'not_started') return 'Nothing has been built yet — build an app and its logs appear here.';
  if (status === 'dormant') return 'Your app is not running right now. Send a message to bring it back online, then its logs appear here.';
  if (status === 'live' && !hasLog) return 'Your app is running but has not printed anything yet.';
  if (status === 'live') return 'No output yet.';
  return 'Connecting to your app…';
}
