import type { PlanStep } from './PlannerAgent';
import type { EngineerTask, EngineerAgentEvent, SharedLoopState } from './EngineerAITypes';

/** Max ReAct iterations per plan step. 12 × 8 steps = 96 possible total, bounded by deadline. */
export const STEPS_PER_PLAN_STEP = 12;

/**
 * Phase 7 — thin facade that scopes bounded ReAct execution to a single plan step.
 * The actual dispatch logic lives in EngineerAgentLoop.runBoundedLoop(); CoderAgent
 * just injects the step-focus prefix and delegates via the runner closure provided
 * at construction time (avoids a circular module dependency).
 */
export class CoderAgent {
  constructor(
    private readonly runner: (
      task: EngineerTask,
      effectiveInstruction: string,
      stepContextPrefix: string,
      shared: SharedLoopState,
      maxSteps: number,
      deadline: number,
      dbContextBlock: string,
      signal?: AbortSignal,
    ) => AsyncGenerator<EngineerAgentEvent>,
  ) {}

  runStep(
    task: EngineerTask,
    effectiveInstruction: string,
    step: PlanStep,
    stepIndex: number,
    totalSteps: number,
    shared: SharedLoopState,
    maxSteps: number,
    deadline: number,
    dbContextBlock: string,
    signal?: AbortSignal,
  ): AsyncGenerator<EngineerAgentEvent> {
    const contextPrefix = step.focusHint
      ? `[CURRENT STEP ${stepIndex + 1}/${totalSteps}: ${step.focusHint}]`
      : '';
    return this.runner(
      task,
      effectiveInstruction,
      contextPrefix,
      shared,
      maxSteps,
      deadline,
      dbContextBlock,
      signal,
    );
  }
}
