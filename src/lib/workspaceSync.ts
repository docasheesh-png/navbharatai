// IDE ↔ v3.0 workspace sync (Phase S1 of the "one body, many organs" rebuild).
//
// When a user edits a file in Code Studio, that edit must reach the v3.0 workspace's DURABLE store
// (so v3.0 sees it and the File Guardian never reverts it). This module is the thin, safe glue:
//   • diffChangedFiles — pure: which files are new/changed vs the previous set,
//   • stripEcho — pure: drop files that just arrived FROM v3.0 (so a remote sync doesn't bounce back),
//   • makeWorkspaceSyncer — debounced + in-flight-coalesced scheduler around a best-effort sync fn,
//     so keystrokes don't thrash the network and there is never a sync feedback loop.
//
// No React, no network here — `sync` is injected. Pure cores are unit-tested.

export type FileMap = Record<string, string>;

/** Files in `next` that are NEW or whose content CHANGED vs `prev`. Deletions are handled elsewhere. Pure. */
export function diffChangedFiles(prev: FileMap | null | undefined, next: FileMap | null | undefined): FileMap {
  const out: FileMap = {};
  for (const [path, content] of Object.entries(next || {})) {
    if (typeof content !== 'string') continue;
    if (!prev || prev[path] !== content) out[path] = content;
  }
  return out;
}

/** Drop paths whose content equals what we last received FROM the remote (echo suppression). Pure. */
export function stripEcho(changed: FileMap, remote: FileMap | null | undefined): FileMap {
  if (!remote) return { ...changed };
  const out: FileMap = {};
  for (const [path, content] of Object.entries(changed)) {
    if (remote[path] !== content) out[path] = content;
  }
  return out;
}

export interface WorkspaceSyncer {
  /** Call on a local (IDE) file-set change; schedules a debounced durable sync of just the diff. */
  onLocalChange(prev: FileMap, next: FileMap): void;
  /** Record files that just arrived FROM v3.0 so they are not echoed back out. */
  noteRemote(files: FileMap): void;
  /** Are there local edits not yet pushed to v3.0 (pending or in-flight)? Used by the dirty guard. */
  hasPending(): boolean;
  /**
   * Force any pending edits to sync NOW (bypass the debounce) and resolve once the durable store has
   * them. Called BEFORE a v3.0 build starts so the build never runs on a stale file set while the user
   * has un-flushed edits — the Phase S3 conflict guard. Safe to call when nothing is pending (no-op).
   */
  flush(): Promise<void>;
  /** Cancel any pending sync (e.g. on unmount). */
  dispose(): void;
}

/**
 * A debounced, echo-suppressed, in-flight-coalesced syncer around a best-effort `sync(changed)` fn.
 * `debounceMs` (default 1200) batches rapid keystrokes; while a sync is in flight, further changes
 * accumulate and flush after it returns.
 */
export function makeWorkspaceSyncer(opts: { sync: (changed: FileMap) => Promise<void> | void; debounceMs?: number }): WorkspaceSyncer {
  const debounceMs = Math.max(0, opts.debounceMs ?? 1200);
  let pending: FileMap = {};
  const remote: FileMap = {};
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void runOnce(); }, debounceMs);
  };

  // Sync the current pending batch exactly once. If a sync is already running, chain after it so the
  // freshest pending set is flushed when it returns. Returns a promise that resolves when this round
  // (and any it chained) has drained — so flush() can await a real completion.
  const runOnce = (): Promise<void> => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (inFlight) return inFlight.then(() => runOnce()); // serialize — never two syncs at once
    const batch = stripEcho(pending, remote);
    pending = {};
    if (Object.keys(batch).length === 0) return Promise.resolve();
    const p = (async () => {
      try {
        await opts.sync(batch);
      } catch {
        /* best-effort — never surface a sync error to the editor */
      } finally {
        inFlight = null;
        if (Object.keys(pending).length > 0) schedule();
      }
    })();
    inFlight = p;
    return p;
  };

  return {
    onLocalChange(prev, next) {
      const changed = stripEcho(diffChangedFiles(prev, next), remote);
      const keys = Object.keys(changed);
      if (keys.length === 0) return;
      for (const k of keys) pending[k] = changed[k];
      schedule();
    },
    noteRemote(files) {
      if (!files) return;
      for (const [p, c] of Object.entries(files)) if (typeof c === 'string') remote[p] = c;
    },
    hasPending() {
      return Object.keys(pending).length > 0 || inFlight !== null;
    },
    async flush() {
      // Drain the pending set NOW (bypass the debounce) and wait for any in-flight sync to finish too,
      // so on return the durable store has every local edit. Loop until truly drained.
      do { await runOnce(); } while (Object.keys(pending).length > 0 || inFlight !== null);
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = {};
    },
  };
}
