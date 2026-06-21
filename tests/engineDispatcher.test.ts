import { describe, it, expect } from 'vitest';
import { EngineDispatcher } from '../src/server/AppMakerLab/generator/EngineDispatcher';
import { EngineRegistry, EngineType } from '../src/server/AppMakerLab/generator/EngineRegistry';
import type { GenerationTask } from '../src/server/AppMakerLab/generator/PlannerTypes';

function task(engine: string): GenerationTask {
  return {
    id: 't-1',
    type: 'BACKEND',
    name: 'test',
    path: 'src/test.ts',
    dependencies: [],
    contentDescription: '',
    priority: 1,
    engine,
    status: 'PENDING',
  };
}

describe('EngineDispatcher', () => {
  it('throws when the engine type is not registered', async () => {
    const registry = new EngineRegistry();
    const dispatcher = new EngineDispatcher(registry);
    await expect(dispatcher.dispatch(task('UNREGISTERED'))).rejects.toThrow();
  });

  it('dispatches to the registered engine and returns its patches', async () => {
    const registry = new EngineRegistry();
    registry.register(EngineType.BACKEND, { execute: async () => [{ path: 'out.ts', content: 'code' }] });
    const dispatcher = new EngineDispatcher(registry);
    const patches = await dispatcher.dispatch(task(EngineType.BACKEND));
    expect(patches).toHaveLength(1);
    expect(patches[0].path).toBe('out.ts');
  });

  it('returns empty patch array when engine returns nothing', async () => {
    const registry = new EngineRegistry();
    registry.register(EngineType.FRONTEND, { execute: async () => [] });
    const dispatcher = new EngineDispatcher(registry);
    const patches = await dispatcher.dispatch(task(EngineType.FRONTEND));
    expect(patches).toHaveLength(0);
  });
});
