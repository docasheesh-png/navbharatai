/**
 * Split a Server-Sent-Events buffer into complete events — and, at the end of the stream, the last one too.
 *
 * 🔴 WHY THIS EXISTS (owner 2026-11-18, Test Chat Bot: "ab ye mitrify response band kar gaya" — HTTP 200, 3 s,
 * MITRIFY_INCOMPLETE_STREAM). The Mitrify and Qubax readers split events on a blank line and only then looked at them,
 * so an event the server ended the stream with but did not follow by a blank line — `data: [DONE]` as the very last
 * bytes, a common shape — was left in the buffer and never read. A complete answer was then reported as an incomplete
 * stream. Driving the real reader showed it: only `…[DONE]\n\n` passed; `[DONE]` without the blank line, `[DONE]\n`, and
 * a stream that ends after `finish_reason: "stop"` with no `[DONE]` all failed.
 *
 * The rule: complete events are the ones before a blank line; when the stream has ended, whatever remains is the final
 * event. A stream that was really cut off still fails — its last event carries no stop and no `[DONE]`. PURE.
 */
export function takeSseEvents(pending: string, atEnd: boolean): { events: string[]; rest: string } {
  let rest = pending.replace(/\r\n/g, '\n');
  const events: string[] = [];
  let boundary: number;
  while ((boundary = rest.indexOf('\n\n')) >= 0) {
    events.push(rest.slice(0, boundary));
    rest = rest.slice(boundary + 2);
  }
  if (atEnd && rest.trim()) { events.push(rest.replace(/\n+$/, '')); rest = ''; }
  return { events, rest };
}

/** The `data:` payload of one SSE event (several data lines join with a newline, as the spec says). PURE. */
export function sseData(event: string): { lines: string[]; payload: string } {
  const lines = event.split('\n').filter((line) => line.startsWith('data:'));
  return { lines, payload: lines.map((line) => line.slice(5).trimStart()).join('\n') };
}

/** True when an OpenAI-style chunk says an answer finished normally. PURE. */
export function chunkSaysStop(data: unknown): boolean {
  const choices = (data as { choices?: Array<{ finish_reason?: unknown }> } | null)?.choices;
  return Array.isArray(choices) && choices.some((c) => c?.finish_reason === 'stop');
}
