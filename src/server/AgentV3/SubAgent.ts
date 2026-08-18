import type { AgentEventStream } from './AgentEventStream';
import type { WorkspaceState } from './WorkspaceState';
import type { TurnRunner } from './ClaudeClient';
import type { ActuatorPort, SubAgentSpawn } from './ToolDispatcher';
import type { Checkpointer } from './GitManager';
import { ToolDispatcher } from './ToolDispatcher';
import { AgentRunner } from './AgentRunner';
import { roleConfig } from './AgentRegistry';
import { catalogForTools } from './ToolCatalog';
import { agentLifecycle } from './AgentLifecycle';
import { getWorkspaceMemory } from './WorkspaceMemory';
import type { AgentRole } from './types';

/**
 * Builds the `SubAgentSpawn` the Architect's `task` tool uses to delegate work
 * to a specialist (§3.3). The spawned worker:
 *  - runs with its role's constrained tool set (no `task` → no deep recursion),
 *  - shares the same sandbox actuator, WorkspaceState and event stream (so its
 *    file changes, diffs and terminal output land on the same merged surfaces),
 *  - is attributed to its role in the AI-team tracker,
 *  - has its own step + budget caps under the global CostGuard.
 *
 * Wiring the spawn here (not inside ToolDispatcher) keeps the dispatcher
 * decoupled from AgentRunner and avoids a circular import.
 */
export interface SubAgentDeps {
  client: TurnRunner;
  actuator: ActuatorPort;
  workspaceId: string;
  state: WorkspaceState;
  events: AgentEventStream;
  model: string;
  onlyOpus?: boolean;
  /**
   * The build's power level (admin tier→model redefinition 2026-07-13). MUST be threaded: sub-agents
   * spend the bulk of a build's tokens, and AgentRunner bills by `powerLevel ?? onlyOpus` — without
   * this a Strong ('mini' → Sonnet 100%) build's sub-agents fell back to the boolean and were billed
   * at real-Opus rates for Sonnet work.
   */
  powerLevel?: 'weak' | 'off' | 'mini' | 'medium' | 'max';
  /** Claude reasoning effort for the tier (Opus tiers only) — same lever the top-level runner gets. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Per-sub-agent caps (defaults: 40 steps; budget inherited from parent if unset). */
  maxSteps?: number;
  maxBudgetUsd?: number;
  /** Max output tokens per turn. The Architect delegates ALL app code to sub-agents, so the top-level
   *  runner's 32000 cap (buildMaxTokensPerTurn) MUST be passed through — otherwise a sub-agent falls
   *  back to ClaudeClient's 8192 default and truncates large multi-file writes (the #1 cause of
   *  incomplete complex apps), costing extra repair turns. */
  maxTokensPerTurn?: number;
  /** Real git checkpointer, so sub-agent writes are committed too. */
  checkpointer?: Checkpointer;
  /**
   * Build-level token accumulator (billing accounting fix). The Architect delegates ALL app code to
   * sub-agents, so the bulk of a build's tokens are spent HERE. Passing the parent build's sink makes
   * every sub-agent's turns count toward the user's charge — previously they were dropped entirely.
   */
  usageSink?: import('./UsageSink').UsageSink;

  /**
   * C2 — the project's protected paths, as a GETTER rather than a value.
   *
   * A sub-agent writes files exactly like the architect does, so a child dispatcher without the guard
   * would be a hole straight through it. It is a thunk because the spawn is constructed BEFORE the
   * ignore file is read — passing the array here would capture an empty one and silently disarm every
   * sub-agent, which is the worst kind of bug: the feature would look present and protect nothing.
   */
  ignoreRules?: () => import('./ignoreRules').IgnoreRule[];

}

export function makeSubAgentSpawn(deps: SubAgentDeps): SubAgentSpawn {
  return async (role: AgentRole, instruction: string) => {
    const cfg = roleConfig(role);
    // A child dispatcher with NO spawn capability → workers cannot recurse.
    const childDispatcher = new ToolDispatcher(
      deps.actuator, deps.workspaceId, deps.state, deps.events, undefined, deps.checkpointer,
    );
    // C2 — arm the guard on the child too. Read at SPAWN time via the thunk, so it sees the rules
    // however late they were loaded.
    try { childDispatcher.setIgnoreRules(deps.ignoreRules?.() ?? []); } catch { /* never block a spawn */ }
    // TERMINAL-EVENT ISOLATION — the sub-runner shares the build's event stream, so its own
    // `done`/`error` used to flow to every surface as if the WHOLE build finished: the client
    // reducer set done:true and overwrote the top-level summary (the "Step limit reached (40)"
    // shown while the Architect, cap 80, was still working). Translate the specialist's terminal
    // events into non-terminal `agent_done`; everything else (files, diffs, tool calls, narration)
    // passes through unchanged so the merged surfaces stay live.
    const childEvents = Object.create(deps.events) as AgentEventStream;
    childEvents.emit = (event) => {
      if (event.type === 'done') {
        deps.events.emit({ type: 'agent_done', agent: role, ok: event.ok, summary: event.summary, ts: event.ts });
      } else if (event.type === 'error') {
        deps.events.emit({ type: 'agent_done', agent: role, ok: false, summary: event.message, ts: event.ts });
      } else {
        deps.events.emit(event);
      }
    };
    const runner = new AgentRunner({
      client: deps.client,
      dispatcher: childDispatcher,
      state: deps.state,
      events: childEvents,
      model: deps.model,
      system: cfg.system,
      tools: catalogForTools(cfg.tools),
      onlyOpus: deps.onlyOpus,
      powerLevel: deps.powerLevel,
      effort: deps.effort,
      maxSteps: deps.maxSteps ?? 40,
      maxBudgetUsd: deps.maxBudgetUsd,
      maxTokensPerTurn: deps.maxTokensPerTurn,
      agentRole: role,
      // Billing accounting fix: feed the SAME build-level sink so this sub-agent's tokens are billed.
      usageSink: deps.usageSink,
    });
    // Give the specialist the live project map (Phase 2) so it knows the codebase
    // the Architect has built so far — what files/components/routes exist and what
    // has failed — instead of working blind. Empty early in a build (no-op then).
    // Plus the shared VERIFICATION LEDGER (slice 4): "deps already installed / tsc already
    // clean" — the diagnostics showed each specialist re-running npm install + tsc from
    // scratch because nothing told it the work was already done.
    const mem = getWorkspaceMemory(deps.workspaceId);
    const projectMap = mem.projectMap();
    const verification = mem.verificationStatus();
    const contextBlocks = [
      projectMap ? `Current project context:\n${projectMap}` : '',
      verification,
    ].filter(Boolean);
    const fullInstruction = contextBlocks.length
      ? `${contextBlocks.join('\n\n')}\n\n---\nYour task: ${instruction}`
      : instruction;

    // Record the real lifecycle of this delegated run (Agent Health Monitor).
    const token = agentLifecycle.start(role);
    try {
      const result = await runner.run(fullInstruction);
      agentLifecycle.finish(token, result.ok);
      return { ok: result.ok, summary: result.summary };
    } catch (err) {
      agentLifecycle.finish(token, false);
      throw err;
    }
  };
}
