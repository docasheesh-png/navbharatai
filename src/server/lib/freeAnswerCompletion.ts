import type { Response } from 'express';

/** Settlement is not allowed to turn a completed provider call into an unbounded HTTP request. */
export const FREE_ANSWER_SETTLEMENT_MS = 5_000;

export async function confirmedFreeAnswerSettlement(settlement: Promise<boolean>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Observe rejection even when the deadline wins. A late result never publishes a second terminal.
    return await Promise.race([
      settlement.catch(() => false),
      new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), FREE_ANSWER_SETTLEMENT_MS); }),
    ]);
  } finally { clearTimeout(timer); }
}

/**
 * An admitted Free turn owns one terminal response. JSON is written by Express through end(body);
 * SSE callers put DONE/error in end(frame), leaving ordinary chunks/heartbeats unbuffered.
 * The handler must return after end(), not await its callback: publication follows handler cleanup.
 * This is deliberately NOT installed on the paid-wallet path, whose delivery/refund policy differs.
 */
export function stageFreeAnswerCompletion(res: Response, unavailableMessage = 'NavBharatAI is temporarily unable to respond. Please try again shortly.') {
  const originalEnd = res.end;
  const originalWrite = res.write;
  const endedDescriptor = Object.getOwnPropertyDescriptor(res, 'writableEnded');
  const initiallyEnded = res.writableEnded;
  let pending: unknown[] | undefined;
  let restored = false;
  let published = false;
  let streamed = false;
  const rejectedCallback = (args: unknown[]) => {
    const callback = args.at(-1);
    if (typeof callback === 'function') queueMicrotask(() => callback(new Error('Free answer response already completed')));
  };
  res.end = function (...args: unknown[]) {
    if (pending || published) { rejectedCallback(args); return res; }
    pending = [...args];
    // A producer cannot mutate deferred bytes while durable settlement is in progress.
    if (pending[0] instanceof Uint8Array) pending[0] = Buffer.from(pending[0]);
    return res;
  } as Response['end'];
  res.write = function (...args: unknown[]) {
    if (pending || published) { rejectedCallback(args); return false; }
    streamed = true;
    return originalWrite.apply(res, args as Parameters<Response['write']>);
  } as Response['write'];
  // Keep route guards truthful without pretending the socket has finished. A disconnect during
  // settlement must still be observed by onClientGone and retain the existing uncertainty policy.
  Object.defineProperty(res, 'writableEnded', { configurable: true, get: () => !!pending || initiallyEnded });
  const restore = () => {
    if (restored) return;
    restored = true;
    res.end = originalEnd;
    res.write = originalWrite;
    if (endedDescriptor) Object.defineProperty(res, 'writableEnded', endedDescriptor);
    else delete (res as unknown as Record<string, unknown>).writableEnded;
  };
  return {
    publish() {
      if (published) return;
      published = true;
      restore();
      if (res.destroyed || res.writableEnded) { if (pending) rejectedCallback(pending); return; }
      if (pending) originalEnd.apply(res, pending as Parameters<Response['end']>);
    },
    fail(partial: boolean) {
      if (published) return;
      published = true;
      restore();
      if (pending) rejectedCallback(pending);
      if (res.destroyed || res.writableEnded) return;
      const message = unavailableMessage;
      const body = { code: 'FREE_ANSWER_UNAVAILABLE', error: message, reply: message };
      if (res.headersSent) {
        // Admitted streaming routes are SSE. Never emit their staged successful DONE on failure.
        originalEnd.call(res, `data: ${JSON.stringify({ ...body, partial: partial && streamed })}\n\n`, 'utf8');
      } else {
        res.removeHeader?.('Content-Length');
        res.removeHeader?.('ETag');
        res.status(503).json(body);
      }
    },
    restore,
  };
}
