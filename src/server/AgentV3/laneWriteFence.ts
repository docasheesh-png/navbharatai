// AgentV3 — the WRITE FENCE: only the lane that currently owns the workspace may write to it.
//
// WHY THIS EXISTS (autopsy a38c6fef, "Music player for Android 16", 2026-09-13).
// A build has several lanes that can produce an app: the simple builder, the one-shot, and the full
// agentic builder. Only one of them owns the workspace at a time, and a lane is handed off the moment
// its deadline passes. But a deadline is a `Promise.race`, and **losing a race does not stop work** —
// the loser's closure keeps running, and when it finally finishes it writes.
//
// That is exactly what happened. The one-shot lane was abandoned at 150 s; 17 minutes later it
// completed and dumped 14 files on top of the finished app the full builder had meanwhile written.
// Three of them survived the model's own hand-cleanup (`src/icons.tsx`, `src/VolumeControl.css`,
// `src/types.d.ts`); the eleven unused components in `icons.tsx` cost 66 readiness points
// (100 − 6×11 − 8 = 26/100), which tripped the 50/100 bar, which turned the release gate RED, which
// failed a build whose app had already rendered cleanly in a real browser. The user was told their
// app was not ready to use. It was.
//
// THE POINT OF THIS FILE, AND WHY IT IS NOT ANOTHER FLAG.
// The identical bug was root-caused in July (the StudySync incident) and fixed with a `lapsed` flag
// inside `SimpleBuilder`. The flag works. It also has to be remembered — in every lane, at every
// write site, by every future author — and `OneShotBuilder`, which has the same shape and its own
// private copy of `withTimeout`, never got one. Two months later the same failure returned.
//
// A rule that must be remembered is a rule that will be forgotten. So ownership is no longer a
// convention a lane opts into: a lane is handed a WRITER, that writer is bound to that lane's lease,
// and a lease dies the instant another lane opens or the workspace is handed off. A forgotten guard,
// a new lane, a third copy of `withTimeout` — none of them can produce a zombie write, because the
// only way to write is through a writer that knows whether it is still allowed to.
//
// Pure, dependency-free and synchronous in its decision, so it is fully unit-testable and can never
// itself be the thing that stalls a build.

/** Thrown when an abandoned lane tries to write. Carries what it tried to do, for the report. */
export class LaneAbandonedError extends Error {
  readonly lane: string;
  readonly paths: string[];
  constructor(lane: string, paths: string[]) {
    super(
      `${lane} was handed off before this write — refused ${paths.length} file(s) so an abandoned lane `
      + `cannot overwrite the app that replaced it`,
    );
    this.name = 'LaneAbandonedError';
    this.lane = lane;
    this.paths = paths;
  }
}

/** The shape of every file-writing function in the fast lanes. */
export type WriteFiles = (files: { path: string; content: string }[]) => Promise<void>;

/** What the fence reports when it refuses a write. This is evidence, so it is never swallowed. */
export interface RefusedWrite {
  /** The lane that tried to write after losing ownership. */
  lane: string;
  /** Who owns the workspace now — another lane, or `null` for the full builder. */
  holder: string | null;
  /** The paths the zombie would have overwritten. */
  paths: string[];
}

export interface LaneWriteFence {
  /**
   * Open a lane and get the ONLY writer it may use. Opening a lane revokes whatever lane was open
   * before it — a build never has two owners, so this needs no separate close call on the happy path.
   */
  open(lane: string): WriteFiles;
  /**
   * Hand the workspace to the full agentic builder. From this moment NO fast lane may write, whether
   * or not it knows it was abandoned. Idempotent.
   */
  handoff(): void;
  /** The lane that currently owns the workspace, or `null` once it has been handed off. */
  readonly holder: string | null;
}

/**
 * Wrap the build's real file-writing function in a fence.
 *
 * `onRefused` is called synchronously before the refusal throws, and must never throw itself — it is
 * the honesty half of the fix (rule 5). Before this existed, a zombie write left no trace at all: the
 * autopsy above had to be reconstructed from write timestamps and an `agent=frontend` label, which is
 * why it took two months and a second occurrence to find. Now the build report says it outright.
 */
export function createLaneWriteFence(
  write: WriteFiles,
  onRefused?: (info: RefusedWrite) => void,
): LaneWriteFence {
  interface Lease { readonly lane: string; live: boolean; }
  let current: Lease | null = null;

  const revoke = (): void => {
    if (current) current.live = false;
    current = null;
  };

  return {
    open(lane: string): WriteFiles {
      revoke();
      // The lease is captured by the returned closure, NOT looked up at call time. That distinction is
      // the whole guarantee: checking "is some lane open?" would let a dead lane write through a live
      // successor's ownership — which is precisely the sequence that occurred (simple build abandoned,
      // one-shot opened, simple build's zombie finishes). The writer asks whether ITS OWN lane is
      // still the owner, and nothing else.
      const lease: Lease = { lane, live: true };
      current = lease;
      return async (files) => {
        if (!lease.live) {
          const paths = (files ?? []).map((f) => f?.path).filter((p): p is string => typeof p === 'string');
          try { onRefused?.({ lane, holder: current?.lane ?? null, paths }); } catch { /* evidence is best-effort; the refusal is not */ }
          throw new LaneAbandonedError(lane, paths);
        }
        await write(files);
      };
    },
    handoff(): void {
      revoke();
    },
    get holder(): string | null {
      return current?.lane ?? null;
    },
  };
}
