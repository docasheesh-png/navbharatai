// ProjectPlanStore — in-process cache behavior. Under VITEST the Firestore layer is skipped by
// design (getDb() returns null), so these verify the write-through cache that fronts it: a build
// turn saves the plan, the next turn on the same instance reads it back with zero I/O.

import { describe, it, expect, beforeEach } from 'vitest';
import { saveProjectPlan, loadProjectPlan, deleteProjectPlan, __clearProjectPlanCacheForTests } from './ProjectPlanStore';
import { createProjectPlan, type ProjectModule } from './ProjectPlan';

const mods: ProjectModule[] = [
  { id: 'a', name: 'Core', description: '', dependsOn: [], files: [], contracts: '', status: 'done' },
  { id: 'b', name: 'Auth', description: '', dependsOn: ['a'], files: [], contracts: '', status: 'pending' },
];

beforeEach(() => __clearProjectPlanCacheForTests());

describe('ProjectPlanStore cache', () => {
  it('save → load round-trips on the same instance', async () => {
    const plan = createProjectPlan('goal', 'vite-react', mods, 1_000);
    await saveProjectPlan('ws-1', plan);
    expect(await loadProjectPlan('ws-1')).toEqual(plan);
  });

  it('load for an unknown workspace is null', async () => {
    expect(await loadProjectPlan('ws-none')).toBeNull();
  });

  it('plans are isolated per workspace', async () => {
    const p1 = createProjectPlan('one', 'vite-react', mods, 1);
    const p2 = createProjectPlan('two', 'vite-react', [], 2);
    await saveProjectPlan('ws-1', p1);
    await saveProjectPlan('ws-2', p2);
    expect((await loadProjectPlan('ws-1'))?.goal).toBe('one');
    expect((await loadProjectPlan('ws-2'))?.goal).toBe('two');
  });

  it('delete removes the plan', async () => {
    await saveProjectPlan('ws-1', createProjectPlan('goal', 'vite-react', mods, 1));
    await deleteProjectPlan('ws-1');
    expect(await loadProjectPlan('ws-1')).toBeNull();
  });

  it('a later save overwrites (status progression persists)', async () => {
    const p = createProjectPlan('goal', 'vite-react', mods, 1);
    await saveProjectPlan('ws-1', p);
    const advanced = { ...p, modules: p.modules.map((m) => ({ ...m, status: 'done' as const })) };
    await saveProjectPlan('ws-1', advanced);
    expect((await loadProjectPlan('ws-1'))?.modules.every((m) => m.status === 'done')).toBe(true);
  });
});
