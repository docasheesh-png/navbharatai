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
}

export function makeSubAgentSpawn(deps: SubAgentDeps): SubAgentSpawn {
  return async (role: AgentRole, instruction: string) => {
    const cfg = roleConfig(role);
    // A child dispatcher with NO spawn capability → workers cannot recurse.
    const childDispatcher = new ToolDispatcher(
      deps.actuator, deps.workspaceId, deps.state, deps.events, undefined, deps.checkpointer,
    );
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
      maxSteps: deps.maxSteps ?? 40,
      maxBudgetUsd: deps.maxBudgetUsd,
      maxTokensPerTurn: deps.maxTokensPerTurn,
      agentRole: role,
    });
    // Give the specialist the live project map (Phase 2) so it knows the codebase
    // the Architect has built so far — what files/components/routes exist and what
    // has failed — instead of working blind. Empty early in a build (no-op then).
    const projectMap = getWorkspaceMemory(deps.workspaceId).projectMap();
    const fullInstruction = projectMap
      ? `Current project context:\n${projectMap}\n\n---\nYour task: ${instruction}`
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
