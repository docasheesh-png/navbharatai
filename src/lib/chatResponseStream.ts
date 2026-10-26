import { CHAT_ROUTE_UNAVAILABLE } from './chatRouteOutcome';
/** The actual Free-chat SSE/plain-text consumer. Error frames are terminal, not successful answers. */
export interface ChatStreamFailure { code: string; message: string; partial: boolean; }
export class ChatStreamTerminalError extends Error {
  constructor(readonly failure: ChatStreamFailure, readonly displayed = false) { super(failure.message); this.name = 'ChatStreamTerminalError'; }
}
export async function consumeChatResponseStream(body: ReadableStream<Uint8Array>, sse: boolean,
  update: (textOrStatus: string) => void): Promise<{ text: string; failure?: ChatStreamFailure }> {
  const reader = body.getReader(); const decoder = new TextDecoder();
  let text = ''; let status = ''; let buffer = ''; let terminal = false; let failure: ChatStreamFailure | undefined;
  const interrupted = (): ChatStreamFailure => ({ code: 'STREAM_INTERRUPTED', message: 'The connection ended before the reply was complete. Please retry when the service is available.', partial: text.length > 0 });
  try {
    streamLoop: while (true) {
      let next: ReadableStreamReadResult<Uint8Array>;
      try { next = await reader.read(); }
      catch {
        // A body can fail after successful headers and partial output. Preserve that output in the
        // same terminal result as truncated EOF, never leak a transport exception to a second bubble.
        failure = interrupted();
        break;
      }
      if (next.done) break;
      const raw = decoder.decode(next.value, { stream: true });
      if (!sse) text += raw;
      else {
        buffer += raw; const events = buffer.split(/\r?\n\r?\n/); buffer = events.pop() ?? '';
        for (const event of events) for (const line of event.split(/\r?\n/)) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') { terminal = true; break streamLoop; }
          let parsed: unknown; try { parsed = JSON.parse(payload); } catch { continue; }
          if (!parsed || typeof parsed !== 'object') continue;
          const frame = parsed as Record<string, unknown>;
          if (typeof frame.c === 'string') text += frame.c;
          else if (typeof frame.s === 'string' && frame.s && !text) status = frame.s;
          const gatewayFailure = gatewayChatFailure(frame);
          if (gatewayFailure || (typeof frame.error === 'string' && frame.error)) {
            failure = gatewayFailure ?? { message: String(frame.error), code: typeof frame.code === 'string' ? frame.code : 'STREAM_INTERRUPTED', partial: frame.partial === true };
            terminal = true; break streamLoop;
          }
        }
      }
      update(text || status);
    }
    if (!sse) text += decoder.decode();
    else if (!terminal) failure ??= interrupted();
    return { text, ...(failure ? { failure } : {}) };
  } finally {
    // An explicit error/DONE ends the operation even if the socket stays open.
    if (terminal) { try { void Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* observed cleanup */ } }
    try { reader.releaseLock(); } catch { /* cancellation can still own a pending read */ }
  }
}

/** Only explicit server terminal outcomes, never arbitrary provider-shaped JSON. */
export function gatewayChatFailure(value: unknown): ChatStreamFailure | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const data = value as Record<string, unknown>;
  // The global maintenance guard answers before chat/quota routing, without a route code. Preserve
  // that explicit state instead of treating its 503 as an ambiguous provider dispatch and hiding it.
  // statusUnavailable is DISTINCT from deliberate maintenance — do not relabel it as CHAT_MAINTENANCE.
  if (data.statusUnavailable === true) {
    const notice = [data.reply, data.error].find(value => typeof value === 'string' && value.trim());
    if (typeof notice === 'string') return { code: 'CHAT_STATUS_UNAVAILABLE', message: notice.slice(0, 2000), partial: false };
  }
  if (data.maintenance === true) {
    const notice = [data.reply, data.error].find(value => typeof value === 'string' && value.trim());
    if (typeof notice === 'string') return { code: 'CHAT_MAINTENANCE', message: notice.slice(0, 2000), partial: false };
  }
  if (typeof data.code !== 'string' || ![CHAT_ROUTE_UNAVAILABLE, 'CHAT_CAPACITY_EXHAUSTED', 'INFERENCE_GATEWAY_UNAVAILABLE', 'INFERENCE_GATEWAY_INTERRUPTED', 'STRICT_FREE_UNAVAILABLE', 'STRICT_FREE_INTERRUPTED', 'FREE_ANSWER_DAILY_LIMIT', 'FREE_ANSWER_BUSY', 'FREE_ANSWER_DUPLICATE', 'FREE_ANSWER_ATTEMPT_LIMIT', 'FREE_ANSWER_UNAVAILABLE'].includes(data.code)) return undefined;
  const message = typeof data.reply === 'string' ? data.reply : typeof data.error === 'string' ? data.error : typeof data.c === 'string' ? data.c : 'The selected AI service is unavailable. Please try again later.';
  return { code: data.code, message: message.slice(0, 2000), partial: data.partial === true };
}
