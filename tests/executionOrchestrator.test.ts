import { describe, it, expect, vi } from 'vitest';
import { ExecutionOrchestrator } from '../src/server/AppMakerLab/generator/ExecutionOrchestrator';
import { EngineRegistry, EngineType } from '../src/server/AppMakerLab/generator/EngineRegistry';
import { EngineDispatcher } from '../src/server/AppMakerLab/generator/EngineDispatcher';
import { EventType } from '../src/server/AppMakerLab/eventbus/EventTypes';
import type { IEventBus } from '../src/server/AppMakerLab/eventbus/IEventBus';
import type { ICheckpointManager } from '../src/server/AppMakerLab/checkpoint/ICheckpointManager';
import type { GenerationPlan } from '../src/server/AppMakerLab/generator/GenerationPlan';
import type { GenerationTask } from '../src/server/AppMakerLab/generator/PlannerTypes';

function makeEventBus(): IEventBus {
  return { publish: vi.fn().mockResolvedValue(undefined), subscribe: vi.fn() } as unknown as IEventBus;
}

function makeCheckpointManager(): ICheckpointManager {
  return { save: vi.fn().mockResolvedValue(undefined), load: vi.fn().mockResolvedValue({ taskStatuses: {} }) } as unknown as ICheckpointManager;
}

function task(id: string, engine = EngineType.BACKEND, deps: string[] = []): GenerationTask {
  return { id, type: 'BACKEND', name: id, path: `src/${id}.ts`, dependencies: deps, contentDescription: 'Resource: Test', priority: 1, engine, status: 'PENDING' };
}

function plan(tasks: GenerationTask[]): GenerationPlan {
  return { planId: 'plan-1', workspaceId: 'ws-1', correlationId: 'corr-1', blueprintId: 'bp-1', blueprintHash: 'hash', tasks, createdAt: new Date().toISOString() };
}

describe('ExecutionOrchestrator.execute', () => {
  it('returns patches from dispatched tasks', async () => {
    const registry = new EngineRegistry();
    registry.register(EngineType.BACKEND, { execute: async () => [{ path: 'src/out.ts', content: 'code' }] });
    const dispatcher = new EngineDispatcher(registry);
    const orchestrator = new ExecutionOrchestrator(makeEventBus(), dispatcher, makeCheckpointManager());
    const patches = await orchestrator.execute(plan([task('t-1')]));
    expect(patches.length).toBeGreaterThan(0);
  });

  it('publishes GENERATION_STARTED event', async () => {
    const eventBus = makeEventBus();
    const registry = new EngineRegistry();
    registry.register(EngineType.BACKEND, { execute: async () => [] });
    const dispatcher = new EngineDispatcher(registry);
    const orchestrator = new ExecutionOrchestrator(eventBus, dispatcher, makeCheckpointManager());
    await orchestrator.execute(plan([task('t-1')]));
    const publishMock = eventBus.publish as ReturnType<typeof vi.fn>;
    const types = publishMock.mock.calls.map((c: any) => c[0].type);
    expect(types).toContain(EventType.GENERATION_STARTED);
  });

  it('returns empty patches for empty plan', async () => {
    const registry = new EngineRegistry();
    const dispatcher = new EngineDispatcher(registry);
    const orchestrator = new ExecutionOrchestrator(makeEventBus(), dispatcher, makeCheckpointManager());
    const patches = await orchestrator.execute(plan([]));
    expect(patches).toHaveLength(0);
  });
});
