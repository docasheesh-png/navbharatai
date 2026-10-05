// The ONE way this server learns that a streaming client has gone (forensic audit 2026-10-04, Q-621).
//
// 🔴 WHY. Four streaming POST routes (chat, the build stream, the build re-attach, app-debug) listened
// for `req.on('close')`. On Node 22 / Express 5, a request's 'close' is emitted as soon as its BODY has
// been read — and `express.json()` reads it before any handler runs — so a listener a handler attaches
// later never fires at all, disconnect or not (measured: POST → only `res` 'close' fires on disconnect;
// GET → both). The effect: the chat's "cancel the upstream AI call when the client leaves" had never
// cancelled anything, heartbeats ran on until the stream ended, and a closed tab stayed subscribed to its
// build. `res` 'close' is the socket going away, for every method.
//
// PURE wiring; no state.

import type { Response } from 'express';

/**
 * Run `fn` once when the response's connection closes BEFORE the response finished — the client left.
 * A response that completed normally does not count.
 */
export function onClientGone(res: Response, fn: () => void): void {
  res.once('close', () => { if (!res.writableFinished) fn(); });
}

/** Run `fn` once when the response's connection closes for any reason (cleanup of timers, subscribers). */
export function onStreamClosed(res: Response, fn: () => void): void {
  res.once('close', fn);
}
