/**
 * Tests for CoderAgent (step-focus delegation). CoderAgent stays live as part of the
 * ProEngineRunner closure (legacy /api/build pipeline); the retired Engineer AI router
 * factory and its tests were deleted in the 2026-07-09 Engineer AI cleanup.
 */
import { describe, it, expect, vi } from 'vitest';
import { CoderAgent, STEPS_PER_PLAN_STEP } from '../src/server/EngineerAI/CoderAgent';
import type { EngineerTask, SharedLoopState } from '../src/server/EngineerAI/EngineerAITypes';
import type { PlanStep } from '../src/server/EngineerAI/PlannerAgent';

// ── CoderAgent ────────────────────────────────────────────────────────────────

function makeShared(): SharedLoopState {
  return {
    history: [],
    consecutiveParseFailures: 0,
    lastPreviewUrl: null,
    lastScreenshot: null,
    lastConsoleCheck: Date.now(),
    globalStep: 0,
    terminated: false,
    completionEvent: null,
    providerFallbackShown: false,
  };
}

function makeTask(instruction = 'Build a todo app'): EngineerTask {
  return { workspaceId: 'ws-test', instruction };
}

async function* emptyRunner(): AsyncGenerator<never> {}

describe('STEPS_PER_PLAN_STEP', () => {
  it('is 12 (bounds per-step ReAct iterations)', () => {
    expect(STEPS_PER_PLAN_STEP).toBe(12);
  });
});

describe('CoderAgent.runStep', () => {
  it('returns an async generator', () => {
    const agent = new CoderAgent(() => emptyRunner());
    const step: PlanStep = { description: 'scaffold files', focusHint: 'Create project structure' };
    const gen = agent.runStep(makeTask(), 'Build app', step, 0, 3, makeShared(), 12, Date.now() + 60000, '');
    expect(typeof gen[Symbol.asyncIterator]).toBe('function');
  });

  it('injects step context prefix into the runner call', async () => {
    let capturedPrefix = '';
    async function* captureRunner(
      _task: EngineerTask,
      _instruction: string,
      prefix: string,
    ): AsyncGenerator<never> {
      capturedPrefix = prefix;
    }
    const agent = new CoderAgent(captureRunner as any);
    const step: PlanStep = { description: 'install deps', focusHint: 'Run npm install' };
    const gen = agent.runStep(makeTask(), 'Build app', step, 1, 4, makeShared(), 12, Date.now() + 60000, '');
    // Drain the generator to trigger the runner
    for await (const _ of gen) { /* consume */ }
    expect(capturedPrefix).toContain('CURRENT STEP 2/4');
    expect(capturedPrefix).toContain('Run npm install');
  });

  it('passes empty prefix when step has no focusHint', async () => {
    let capturedPrefix = '';
    async function* captureRunner(
      _task: EngineerTask,
      _instruction: string,
      prefix: string,
    ): AsyncGenerator<never> {
      capturedPrefix = prefix;
    }
    const agent = new CoderAgent(captureRunner as any);
    const step: PlanStep = { description: 'write code', focusHint: '' };
    const gen = agent.runStep(makeTask(), 'Build app', step, 0, 1, makeShared(), 12, Date.now() + 60000, '');
    for await (const _ of gen) { /* consume */ }
    expect(capturedPrefix).toBe('');
  });

  it('forwards the task, instruction, shared state, and limits to the runner', async () => {
    let capturedTask: EngineerTask | null = null;
    let capturedInstruction = '';
    let capturedShared: SharedLoopState | null = null;
    let capturedMaxSteps = 0;

    async function* captureRunner(
      task: EngineerTask,
      instruction: string,
      _prefix: string,
      shared: SharedLoopState,
      maxSteps: number,
    ): AsyncGenerator<never> {
      capturedTask = task;
      capturedInstruction = instruction;
      capturedShared = shared;
      capturedMaxSteps = maxSteps;
    }
    const agent = new CoderAgent(captureRunner as any);
    const task = makeTask('specific instruction');
    const shared = makeShared();
    const step: PlanStep = { description: 'test step', focusHint: 'focus' };
    const gen = agent.runStep(task, 'specific instruction', step, 0, 1, shared, 7, Date.now() + 60000, '');
    for await (const _ of gen) { /* consume */ }
    expect(capturedTask).toBe(task);
    expect(capturedInstruction).toBe('specific instruction');
    expect(capturedShared).toBe(shared);
    expect(capturedMaxSteps).toBe(7);
  });
});
