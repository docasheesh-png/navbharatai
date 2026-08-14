// AgentV3 — STREAMING FIRST PAINT: show the user their app the moment its files exist.
//
// THE WAIT THIS REMOVES. On the fast lane the generated files are final long before the build is:
// the verify + repair loop still has to run, and then the dev server has to install dependencies and
// boot, which measured 30–155 s on real builds. For that entire window the user sits in front of a
// spinner while the app they asked for already exists, complete, on the server. Nothing is being
// decided in that time as far as their app is concerned — it is pure waiting.
//
// So when this is on, the files are persisted to the durable store the instant they are ready and a
// `file_changed` event is emitted per file. The client's preview is already listening for exactly that
// (PreviewSurface debounces a burst into one reload) and the sandbox-free in-browser preview can render
// straight from the durable store, so the user sees the real app tens of seconds sooner.
//
// WHY THIS IS SAFE TO TURN ON, by construction rather than by hope:
//   • `merge` is an UPSERT of the given paths — it adds and overwrites those paths and touches nothing
//     else, so an early write can never delete or truncate a file the build has not produced yet.
//   • A durable-write failure is swallowed. This is a HEAD START, not the build's save path; the build
//     writes its own files at the end regardless. A first paint that fails must cost the user nothing.
//   • It returns `undefined` when off, so the caller passes no callback at all and the build path is
//     byte-for-byte what it is today.
//
// Extracted from the route (which is ~12k lines and untestable in place) so the behaviour above is
// verified by real tests rather than asserted in a comment. The route keeps ONE call.

import { envFlag } from '../lib/envFlag';

/** A file as the builder hands it over — the same shape `runSimpleBuild` reports. */
export interface ReadyFile {
  path: string;
  content: string;
}

/** The `file_changed` event the client already listens for. Structurally typed to avoid importing the route's bus. */
export interface FileChangedEvent {
  type: 'file_changed';
  agent: 'architect';
  change: { path: string; kind: 'create' };
  ts: number;
}

export interface FirstPaintDeps {
  /** Durable upsert of exactly these paths (production: `mergeWorkspaceFiles`). */
  merge: (workspaceId: string, files: Record<string, string>) => Promise<unknown>;
  /** Publish to the build's event stream (production: `events.emit`). */
  emit: (event: FileChangedEvent) => void;
  /** Injectable clock, so a test can assert the timestamp without racing the wall clock. */
  now?: () => number;
}

/** Is streaming first paint enabled? Default OFF — this is the one place that decides. */
export function streamingFirstPaintEnabled(): boolean {
  return envFlag('AGENTV3_STREAMING_PREVIEW');
}

/**
 * The callback to hand the builder as `onFilesReady`, or `undefined` when the feature is off.
 *
 * Returning `undefined` rather than a no-op function is deliberate: the builder branches on whether the
 * callback exists, so a no-op would still change its code path. Off must mean genuinely untouched.
 */
export function makeFirstPaintHandler(
  workspaceId: string,
  deps: FirstPaintDeps,
  enabled: boolean = streamingFirstPaintEnabled(),
): ((files: ReadyFile[]) => void) | undefined {
  if (!enabled) return undefined;
  const now = deps.now ?? Date.now;
  return (files: ReadyFile[]) => {
    // An empty batch is not an error — the builder can legitimately report nothing on a step. Doing no
    // work is the correct response; a durable write of {} and a burst of zero events would both be noise.
    if (!Array.isArray(files) || files.length === 0) return;
    const record: Record<string, string> = {};
    for (const f of files) {
      // A malformed entry is skipped rather than allowed to poison the batch. This runs on a background
      // best-effort path where nobody is watching a return value, so throwing here would surface as an
      // unhandled rejection during an otherwise healthy build.
      if (!f || typeof f.path !== 'string' || !f.path || typeof f.content !== 'string') continue;
      record[f.path] = f.content;
    }
    if (Object.keys(record).length === 0) return;
    // NOT awaited, and the rejection is swallowed on purpose — see the header. The build's own save
    // still happens at the end, so the worst case of a failure here is that the user waits exactly as
    // long as they do today.
    void Promise.resolve(deps.merge(workspaceId, record)).catch(() => { /* head start only; never the build's save path */ });
    for (const path of Object.keys(record)) {
      deps.emit({ type: 'file_changed', agent: 'architect', change: { path, kind: 'create' }, ts: now() });
    }
  };
}
