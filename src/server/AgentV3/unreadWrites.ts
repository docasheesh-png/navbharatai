// A WRITE NOBODY READS THE ANSWER TO IS NOT STEERED (autopsy db07e0af, 2026-10-12).
//
// 🔴 WHAT HAPPENED. The fast lane handed three finished files to the full builder. Saving them went through the
// model's own write door, so every save ran the write-time typecheck and composed the steering notes — for a writer
// that never reads a tool result. The same one error (`Cannot find module '../data'`) was compiled four times in
// eight seconds, on the critical path between the lane's hand-off decision and the full builder's first call, and
// then a fifth time by the hand-off itself, the one whose answer is actually read.
//
// 🔑 THE CLASS: a platform writer (the fast lane, the post-build deterministic fixers) borrowing the MODEL's write
// door wholesale. The door's notes exist to steer a model while it holds the file. With no model behind the write
// they cost time, and the once-per-build notes (the touch-controls note, the upload-storage note) are spent on a
// writer that cannot read them — so the model that comes next is never told. A platform write still passes every
// GUARD of the door (path, destructive overwrite, secrets, parse) and its installs; only the notes are skipped.
//
// PURE apart from the async context.
import { AsyncLocalStorage } from 'node:async_hooks';

const unread = new AsyncLocalStorage<true>();

/** Run `fn` so every write under it is known to have no reader for its tool result. */
export function runAsUnreadWrites<T>(fn: () => Promise<T>): Promise<T> {
  return unread.run(true, fn);
}

/** Is the current write one whose tool result nobody reads? */
export function writesAreUnread(): boolean {
  return unread.getStore() === true;
}
