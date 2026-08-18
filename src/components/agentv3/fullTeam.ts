// Full Team premium UX (Fix 60, admin 2026-07-13) — the PURE brains behind the 'max' tier's
// premium build experience, kept out of the panel so every rule is unit-testable:
//   • mid-build steering gate (when the composer sends a live message to the working team),
//   • the team-HQ card's progress model (real plan steps → progress squares, real agents → roster).
// Everything here is driven by REAL engine state (todos, agents, running) — never synthetic.

import type { AgentCard, TodoItem } from './agentV3Types';

/**
 * May the composer send a LIVE message to the team right now? During a running BUILD, in the build
 * lane — Plan/Advise have their own send path (read-only, and they already work mid-build).
 *
 * 🔓 EVERY TIER since ROADMAP §8A/A1 (2026-08-18). It was 'max'-only, which left everyone else with
 * Stop-and-rebuild as their only correction — paying for a whole build to avoid one turn. See
 * `steerAllowedForBuild` in routes/agentv3.ts for the full reasoning and the revert switch; the server
 * still enforces the real gate on the build's resolved tier, so this stays UX, not security.
 *
 * `powerLevel` is deliberately still a parameter: the server is authoritative, and if the admin flips
 * AGENTV3_STEER_ALL_TIERS=off, this signature is where the tier check comes back — no call-site churn.
 */
export function canSteerMidBuild(running: boolean, _powerLevel: string, chatMode: string): boolean {
  return running === true && chatMode === 'build';
}

/** Whether the premium Team HQ card is shown: FULL TEAM tier + a build actually running. */
export function showTeamHq(running: boolean, powerLevel: string): boolean {
  return running === true && powerLevel === 'max';
}

export interface TeamHqModel {
  /** Real specialists seen this build (Architect + spawned sub-agents), newest activity first. */
  roster: AgentCard[];
  /** How many team members are actively working right now. */
  activeCount: number;
  /** Real plan progress → the card's progress squares. total 0 = no plan yet (render squares hidden). */
  progress: { done: number; active: number; total: number };
}

/** Build the Team HQ card's model from REAL reducer state. Pure. */
export function teamHqModel(agents: Record<string, AgentCard>, todos: TodoItem[]): TeamHqModel {
  const roster = Object.values(agents).sort((a, b) => b.updatedTs - a.updatedTs);
  return {
    roster,
    activeCount: roster.filter((a) => a.active).length,
    progress: {
      done: todos.filter((t) => t.status === 'done').length,
      active: todos.filter((t) => t.status === 'in_progress').length,
      total: todos.length,
    },
  };
}

/** "3m 42s" style elapsed label for the Team HQ card. Pure. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
