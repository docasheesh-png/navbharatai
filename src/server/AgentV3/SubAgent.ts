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
    const runner = new AgentRunner({
      client: deps.client,
      dispatcher: childDispatcher,
      state: deps.state,
      events: deps.events,
      model: deps.model,
      system: cfg.system,
      tools: catalogForTools(cfg.tools),
      onlyOpus: deps.onlyOpus,
      maxSteps: deps.maxSteps ?? 40,
      maxBudgetUsd: deps.maxBudgetUsd,
      agentRole: role,
    });
    // Record the real lifecycle of this delegated run (Agent Health Monitor).
    const token = agentLifecycle.start(role);
    try {
      const result = await runner.run(instruction);
      agentLifecycle.finish(token, result.ok);
      return { ok: result.ok, summary: result.summary };
    } catch (err) {
      agentLifecycle.finish(token, false);
      throw err;
    }
  };
}
