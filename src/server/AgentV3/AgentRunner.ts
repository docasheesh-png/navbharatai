import type { AgentEventStream } from './AgentEventStream';
import type { WorkspaceState } from './WorkspaceState';
import type { ClaudeToolDef, TurnRunner, TurnUsage } from './ClaudeClient';
import type { ToolDispatcher } from './ToolDispatcher';
import type { AgentRole } from './types';
import { billedAmountUsd } from './pricing';

/**
 * AgentRunner — the native tool-use loop (RC-1), the heart of P1.
 *
 * One run() drives a full build: call Claude → if it returns tool_use blocks,
 * execute them via the ToolDispatcher and feed the tool_results back → repeat
 * until the model ends its turn with no tools (task complete), or a guardrail
 * trips (step cap / budget cap). The transcript grows across turns (RC-2): the
 * assistant's raw blocks and the tool_results are appended verbatim so the model
 * always sees its own prior actions.
 *
 * Honest by construction: completion is the model ending its turn, a budget stop
 * is reported as ok:false with a clear reason, and tool failures flow back to the
 * model as is_error results — never a fake "done".
 */
export interface AgentRunnerOptions {
  client: TurnRunner;
  dispatcher: ToolDispatcher;
  state: WorkspaceState;
  events: AgentEventStream;
  model: string;
  system: string;
  tools: ClaudeToolDef[];
  /** Max model turns before the loop stops (backstop). Default 50. */
  maxSteps?: number;
  maxTokensPerTurn?: number;
  /** D6 — bill at the Only-Opus 5× rate instead of the standard 2.5×. */
  onlyOpus?: boolean;
  /** Optional hard budget (USD billed to the user). Stops honestly when reached. */
  maxBudgetUsd?: number;
  /** Which agent this loop represents (for event attribution). Default 'architect'. */
  agentRole?: AgentRole;
}

export interface AgentRunResult {
  ok: boolean;
  summary: string;
  steps: number;
  usage: TurnUsage;
  /** Amount billed to the user (D5/D6) for the whole run. */
  billedUsd: number;
}

interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error: boolean;
}

export class AgentRunner {
  constructor(private readonly opts: AgentRunnerOptions) {}

  async run(userPrompt: string): Promise<AgentRunResult> {
    const {
      client,
      dispatcher,
      events,
      model,
      system,
      tools,
      maxTokensPerTurn,
      onlyOpus,
      maxBudgetUsd,
    } = this.opts;
    const maxSteps = this.opts.maxSteps ?? 50;
    const agentRole: AgentRole = this.opts.agentRole ?? 'architect';

    const messages: unknown[] = [{ role: 'user', content: userPrompt }];
    const usage: TurnUsage = {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    };

    const billed = (): number =>
      billedAmountUsd({ inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }, onlyOpus);

    let steps = 0;
    try {
      while (steps < maxSteps) {
        steps++;

        const turn = await client.runTurn({
          model,
          system,
          messages,
          tools,
          maxTokens: maxTokensPerTurn,
        });

        usage.inputTokens += turn.usage.inputTokens;
        usage.outputTokens += turn.usage.outputTokens;
        usage.cacheCreationInputTokens += turn.usage.cacheCreationInputTokens;
        usage.cacheReadInputTokens += turn.usage.cacheReadInputTokens;

        if (turn.text.trim()) {
          events.emit({ type: 'narration', agent: agentRole, text: turn.text, ts: Date.now() });
        }

        // Record the assistant turn verbatim so tool_use ids resolve next turn.
        messages.push({ role: 'assistant', content: turn.rawContent });

        // No tools requested → the model has finished.
        if (turn.toolUses.length === 0) {
          const summary = turn.text.trim() || 'Build complete.';
          events.emit({ type: 'done', ok: true, summary, ts: Date.now() });
          return { ok: true, summary, steps, usage, billedUsd: billed() };
        }

        // Execute each requested tool and gather results for the next turn.
        const resultBlocks: ToolResultBlock[] = [];
        for (const toolUse of turn.toolUses) {
          const result = await dispatcher.dispatch(toolUse, agentRole);
          resultBlocks.push({
            type: 'tool_result',
            tool_use_id: result.tool_use_id,
            content: result.content,
            is_error: result.is_error,
          });
        }
        messages.push({ role: 'user', content: resultBlocks });

        // Budget guardrail (CostGuard / D5) — stop honestly, never silently.
        if (maxBudgetUsd !== undefined && billed() >= maxBudgetUsd) {
          const summary = `Budget reached ($${billed().toFixed(4)} of $${maxBudgetUsd.toFixed(2)}). Stopped.`;
          events.emit({ type: 'done', ok: false, summary, ts: Date.now() });
          return { ok: false, summary, steps, usage, billedUsd: billed() };
        }
      }

      const summary = `Step limit reached (${maxSteps}). Stopped without completing.`;
      events.emit({ type: 'done', ok: false, summary, ts: Date.now() });
      return { ok: false, summary, steps, usage, billedUsd: billed() };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      events.emit({ type: 'error', message, ts: Date.now() });
      return { ok: false, summary: `Error: ${message}`, steps, usage, billedUsd: billed() };
    }
  }
}
