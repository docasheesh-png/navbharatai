import type { AgentRole } from './types';

/**
 * AgentLifecycle — the Agent Health Monitor (Phase 1, cat 23).
 *
 * Records the REAL lifecycle of every specialist agent the team spawns: when it
 * starts, whether it succeeded or failed, and how long it took. Aggregated into
 * per-role health so the orchestration layer (and a monitoring surface) can see
 * which agents are reliable and which are struggling — all from real run data,
 * never synthetic.
 *
 * Module-level singleton (like WorkspaceRegistry): health accumulates across
 * builds. Pure bookkeeping with no I/O, so importing it is free and tests can
 * reset it.
 */
export type AgentPhase = 'idle' | 'running' | 'completed' | 'failed';

export interface AgentHealth {
  role: AgentRole;
  phase: AgentPhase;
  /** Total times this role has been spawned. */
  runs: number;
  successes: number;
  failures: number;
  /** Currently running instances of this role (parallel delegation). */
  active: number;
  lastDurationMs?: number;
  /** Sum of completed run durations (for averaging). */
  totalDurationMs: number;
  /** successes / runs, 0..1 (0 when never run). */
  successRate: number;
  updatedTs: number;
  /** Monotonic update counter — deterministic recency ordering even within 1ms. */
  seq: number;
}

/** Opaque handle returned by start(), passed back to finish(). */
export interface RunToken {
  role: AgentRole;
  startedTs: number;
}

class AgentLifecycleTracker {
  private readonly health = new Map<AgentRole, AgentHealth>();
  private counter = 0;

  private ensure(role: AgentRole): AgentHealth {
    let h = this.health.get(role);
    if (!h) {
      h = { role, phase: 'idle', runs: 0, successes: 0, failures: 0, active: 0, totalDurationMs: 0, successRate: 0, updatedTs: Date.now(), seq: 0 };
      this.health.set(role, h);
    }
    return h;
  }

  /** Mark a role as starting a run. Returns a token to pass to finish(). */
  start(role: AgentRole): RunToken {
    const h = this.ensure(role);
    h.runs += 1;
    h.active += 1;
    h.phase = 'running';
    h.updatedTs = Date.now();
    h.seq = ++this.counter;
    return { role, startedTs: h.updatedTs };
  }

  /** Mark a run finished (ok or failed) and fold in its duration. */
  finish(token: RunToken, ok: boolean): void {
    const h = this.ensure(token.role);
    const duration = Math.max(0, Date.now() - token.startedTs);
    h.active = Math.max(0, h.active - 1);
    if (ok) h.successes += 1;
    else h.failures += 1;
    h.lastDurationMs = duration;
    h.totalDurationMs += duration;
    h.successRate = h.runs > 0 ? h.successes / h.runs : 0;
    // Phase reflects the most recent terminal state when nothing is still active.
    h.phase = h.active > 0 ? 'running' : ok ? 'completed' : 'failed';
    h.updatedTs = Date.now();
    h.seq = ++this.counter;
  }

  healthOf(role: AgentRole): AgentHealth | undefined {
    const h = this.health.get(role);
    return h ? { ...h } : undefined;
  }

  /** Snapshot of every role that has run, most-recently-updated first. */
  snapshot(): AgentHealth[] {
    return [...this.health.values()].map((h) => ({ ...h })).sort((a, b) => b.seq - a.seq);
  }

  /** Test-only: clear all recorded health. */
  reset(): void {
    this.health.clear();
    this.counter = 0;
  }
}

/** Shared singleton — the live Agent Health Monitor. */
export const agentLifecycle = new AgentLifecycleTracker();
