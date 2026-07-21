// AgentV3 — parallel-build gate + write-safety wrapper (AP-4 slice 2).
//
// Flips the builder from "frontend/backend sub-agents run SERIALLY" to "they may run in PARALLEL", behind
// a flag (default OFF → production byte-identical). Safety rests on three facts:
//   1. FILE WRITES are the only ASYNC shared mutation — two agents writing the SAME path could clobber.
//      `lockedActuator` routes every writeFile through a per-path `PathWriteLock`, so same-path writes
//      serialize (different paths stay concurrent — the whole point). Worst case (a mis-partitioned pair
//      both targeting one file) degrades to serial-write order — never corruption.
//   2. The other shared surfaces (WorkspaceState, the project graph/memory) are mutated by SYNCHRONOUS
//      point-updates (applyFileChange / indexFile), which are atomic under single-threaded JS — two
//      "parallel" agents interleave only at `await` boundaries, never mid-mutation.
//   3. The event stream + reducer are already order-tolerant.
// So the write lock + the existing FE/BE partition make parallel writers safe. The SPEEDUP itself must be
// measured on a real large multi-file build (a live-sandbox canary) — which is why it ships flag-gated.

import type { ActuatorPort } from './ToolDispatcher';
import type { PathWriteLock } from './pathWriteLock';

/** True when the admin has enabled parallel FE/BE building. Default OFF (unset ⇒ today's serial behaviour). */
export function parallelBuildEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.AGENTV3_PARALLEL_BUILD === 'on';
}

/** Builder/fixer task roles that WRITE — eligible for parallel dispatch ONLY when the flag is on (their
 *  same-path writes are then serialized by lockedActuator; disjoint paths run concurrently). */
export const PARALLEL_WRITER_ROLES = new Set<string>(['frontend', 'backend']);

/**
 * Wrap an actuator so every `writeFile(workspaceId, path, content)` runs under `lock` keyed by PATH —
 * same-path writes serialize, different-path writes run concurrently. All other methods pass through
 * unchanged (bound to the original). Returns the same ActuatorPort shape. Pure wrapper (no I/O of its own).
 */
export function lockedActuator<T extends ActuatorPort>(actuator: T, lock: PathWriteLock): T {
  return new Proxy(actuator, {
    get(target, prop, receiver) {
      if (prop === 'writeFile') {
        return (workspaceId: string, path: string, content: string) =>
          lock.run(String(path), () => (target as ActuatorPort).writeFile(workspaceId, path, content));
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  }) as T;
}
