// LIVE FILE SYNC — the client half: keep the Files tab and Code Studio showing the app as it is
// being written, not as it was before the build started.
//
// The server half (src/server/AgentV3/liveFileSync.ts) explains WHY the content travels on a request
// rather than on the event stream. This file is the pure decision core of the client side: which
// changed paths are worth reading, how a burst of writes becomes one request, and — the part that is
// easy to get subtly wrong — how a reply that arrived late is prevented from overwriting a newer
// one.
//
// 🔴 THE RACE THIS EXISTS TO CLOSE. A build edits `src/App.tsx` at t1; we ask for it; while that read
// is in the air the build edits it AGAIN at t2. The reply carries the t1 body. Applying it would
// show stale content — and, because the t2 event has already been consumed, nothing would ever
// correct it. So a path that changes again WHILE its read is out is re-queued, and the reply is
// still applied (it is never wrong to show a version the build really wrote) and then immediately
// superseded by the next read. The queue, not a timestamp, is what makes this exact: content has no
// version we can compare, but "did this path change again since we asked?" is a fact we hold.
//
// Everything here is pure and synchronous. Timers, fetches and React state live in the panel.
//
// ⚠️ ONE LIMIT, STATED RATHER THAN LEFT TO BE DISCOVERED. A path the SERVER could not read (it was
// deleted a moment after it was written, or the read itself hiccuped) is settled, not re-queued: the
// alternative re-asks for a genuinely deleted file for the rest of the build. That file keeps the
// body the surface already had until the next write to it or the end-of-build load — which is still
// strictly better than before this existed, when every file did. A failed REQUEST is different and
// IS re-queued (requeueFailedBatch), because that one blip would otherwise strand a whole batch.

/**
 * Directories whose contents are never shown or synced. The same rule the panel already applies to
 * the whole-workspace load — a live sync must not start pulling `node_modules` one file at a time
 * just because something in it was touched.
 */
const LIVE_SYNC_EXCLUDE = /^(node_modules\/|\.git\/|dist\/|build\/|\.next\/|__pycache__\/)/;

/**
 * How long a burst of writes is allowed to accumulate before one request goes out, and how many
 * paths that request may name.
 *
 * The window is a CEILING on request rate, not a trailing debounce: the timer is armed by the first
 * change and never reset by later ones, so a build writing continuously still refreshes every
 * `LIVE_SYNC_WINDOW_MS` instead of never (a resetting debounce starves exactly the case this
 * feature exists for). Whatever does not fit in one batch stays queued and goes out on the next
 * window, so the cost stays proportional to what actually changed.
 */
export const LIVE_SYNC_WINDOW_MS = 700;
export const LIVE_SYNC_BATCH_MAX = 24;

/** Paths worth reading back. Pure. */
export function syncablePath(path: unknown): boolean {
  if (typeof path !== 'string' || !path) return false;
  return !LIVE_SYNC_EXCLUDE.test(path);
}

/**
 * The queue of paths whose content the surfaces do not yet have.
 *
 * `pending` and `inFlight` are separate on purpose — see the race note above. A path may be in BOTH
 * at once, which is exactly the "it changed again while we were asking" case.
 */
export interface LiveSyncQueue {
  /** Paths awaiting a read, in first-seen order. */
  readonly pending: readonly string[];
  /** Paths a read is currently out for. */
  readonly inFlight: readonly string[];
}

export const EMPTY_LIVE_SYNC_QUEUE: LiveSyncQueue = { pending: [], inFlight: [] };

/**
 * Record that a path was created, edited or deleted.
 *
 * A DELETE is not queued for reading: there is nothing to read, and asking would return a skip that
 * says nothing. It is removed from both halves of the queue instead, so an in-flight read for a file
 * that has since been deleted can no longer put it back on screen. Pure.
 */
export function noteChangedPath(q: LiveSyncQueue, path: string, kind: 'create' | 'modify' | 'delete'): LiveSyncQueue {
  if (!syncablePath(path)) return q;
  if (kind === 'delete') {
    return {
      pending: q.pending.filter((p) => p !== path),
      inFlight: q.inFlight.filter((p) => p !== path),
    };
  }
  if (q.pending.includes(path)) return q; // already queued — one read will carry the latest body
  return { pending: [...q.pending, path], inFlight: q.inFlight };
}

/**
 * Take up to `max` paths to read now. Returns the batch and the queue with those paths moved from
 * `pending` to `inFlight`.
 *
 * `max` is a per-request bound, not a per-build one: whatever is left stays pending and goes out on
 * the next tick, so a 60-file batch is three requests rather than one oversized one. Pure.
 */
export function takeSyncBatch(q: LiveSyncQueue, max: number): { queue: LiveSyncQueue; batch: string[] } {
  const limit = Math.max(1, Math.floor(max));
  const batch = q.pending.slice(0, limit);
  if (batch.length === 0) return { queue: q, batch };
  return {
    queue: {
      pending: q.pending.slice(batch.length),
      // A path already in flight is not added twice; it is simply still in flight.
      inFlight: [...q.inFlight, ...batch.filter((p) => !q.inFlight.includes(p))],
    },
    batch,
  };
}

/**
 * A read for `batch` has come back (or failed). Clears those paths from `inFlight`.
 *
 * ⚠️ It deliberately does NOT touch `pending`. A path re-queued while its read was in the air is
 * sitting in `pending`, and clearing it here would drop the very re-read the race note describes.
 * Pure.
 */
export function settleSyncBatch(q: LiveSyncQueue, batch: readonly string[]): LiveSyncQueue {
  if (batch.length === 0) return q;
  const done = new Set(batch);
  return { pending: q.pending, inFlight: q.inFlight.filter((p) => !done.has(p)) };
}

/**
 * A read FAILED — put its paths back so the surfaces still catch up.
 *
 * Without this a transient network blip would leave those files stale for the rest of the build with
 * nothing to retry them: the events that named them were consumed when they were queued. Paths
 * already re-queued are not duplicated, and a path deleted in the meantime is not resurrected
 * (it is no longer in `inFlight`, so it is not among the ones returned). Pure.
 */
export function requeueFailedBatch(q: LiveSyncQueue, batch: readonly string[]): LiveSyncQueue {
  const stillWanted = batch.filter((p) => q.inFlight.includes(p) && !q.pending.includes(p));
  return {
    pending: [...q.pending, ...stillWanted],
    inFlight: q.inFlight.filter((p) => !batch.includes(p)),
  };
}

/**
 * Merge freshly-read bodies into the cached file map.
 *
 * UPSERT ONLY — a path the server did not return is left exactly as it was. That is what makes a
 * mid-build read safe: a file the read could not reach (deleted, unreadable, over the size cap) must
 * never be turned into an empty file or dropped from a surface, because "we could not read it" is
 * not "it is gone".
 *
 * `protectedPaths` are files the user is editing by hand right now; see the panel for why the
 * build's version of those is held rather than applied. Pure.
 */
export function applyLiveFiles(
  prev: Record<string, string> | null,
  incoming: Record<string, string> | null | undefined,
  protectedPaths?: ReadonlySet<string>,
): Record<string, string> | null {
  const entries = Object.entries(incoming || {}).filter(
    ([p, c]) => typeof c === 'string' && syncablePath(p) && !protectedPaths?.has(p),
  );
  if (entries.length === 0) return prev;
  const next: Record<string, string> = { ...(prev || {}) };
  for (const [p, c] of entries) next[p] = c;
  return next;
}

/** Remove a deleted path from the cached map. Returns the same object when there is nothing to remove. Pure. */
export function applyLiveDelete(prev: Record<string, string> | null, path: string): Record<string, string> | null {
  if (!prev || !(path in prev)) return prev;
  const next = { ...prev };
  delete next[path];
  return next;
}

/** The shape this module needs from the reducer's file list. Structural, so no import is required. */
export interface FileEntryLike {
  readonly path: string;
}

/**
 * Which paths got a NEW `file_changed` event, and which disappeared, between two renders of the
 * reducer's file list.
 *
 * 🔑 IT COMPARES OBJECT IDENTITY, AND THAT IS THE WHOLE TRICK. `FileChange` carries only `{ path,
 * kind }`, so a file modified twice produces two VALUE-IDENTICAL entries and a value comparison
 * would see the second write as "no change" — the file would keep its first body for the rest of the
 * build. But the reducer re-appends the event's own object (`applyFileChange` does
 * `[...without, change]`), and every SSE event is parsed into a fresh object, so a path whose entry
 * is a DIFFERENT OBJECT than last time is a path that was just written again. That is a fact the
 * client already holds; the alternative was a second write log beside the one the reducer keeps.
 *
 * A path that vanished from the list was deleted (`applyFileChange` drops deletes), which is how a
 * deletion reaches the surfaces without a separate event subscription.
 *
 * ⚠️ `prev === null` (a first render, or the list being replaced wholesale by a restore) reports
 * every path as changed and nothing as deleted. Re-reading everything then is correct — we have no
 * basis for believing any cached body — and refusing to report deletions is the safe direction: a
 * file that is genuinely gone is removed by the next real event or by the end-of-build load, while a
 * file wrongly removed here would vanish from the user's Files tab mid-build. Pure.
 */
export function diffFileEntries(
  prev: readonly FileEntryLike[] | null,
  next: readonly FileEntryLike[],
): { changed: string[]; deleted: string[] } {
  const changed: string[] = [];
  const deleted: string[] = [];
  if (!prev) {
    for (const entry of next) if (syncablePath(entry?.path)) changed.push(entry.path);
    return { changed, deleted };
  }
  const before = new Map<string, FileEntryLike>();
  for (const entry of prev) if (entry?.path) before.set(entry.path, entry);
  const stillHere = new Set<string>();
  for (const entry of next) {
    if (!syncablePath(entry?.path)) continue;
    stillHere.add(entry.path);
    if (before.get(entry.path) !== entry) changed.push(entry.path);
  }
  for (const path of before.keys()) {
    if (!stillHere.has(path) && syncablePath(path)) deleted.push(path);
  }
  return { changed, deleted };
}
