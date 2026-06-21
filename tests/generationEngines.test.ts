import { describe, it, expect } from 'vitest';
import { BackendGenerationEngine } from '../src/server/AppMakerLab/generator/BackendGenerationEngine';
import { FrontendGenerationEngine } from '../src/server/AppMakerLab/generator/FrontendGenerationEngine';
import { DatabaseGenerationEngine } from '../src/server/AppMakerLab/generator/DatabaseGenerationEngine';
import { DefaultGenerationEngine } from '../src/server/AppMakerLab/generator/DefaultGenerationEngine';
import type { GenerationTask } from '../src/server/AppMakerLab/generator/PlannerTypes';

function task(contentDescription: string, type: GenerationTask['type'] = 'BACKEND'): GenerationTask {
  return {
    id: 't-1',
    type,
    name: 'test',
    path: 'src/test.ts',
    dependencies: [],
    contentDescription,
    priority: 1,
    engine: 'test',
    status: 'PENDING',
  };
}

describe('BackendGenerationEngine', () => {
  const engine = new BackendGenerationEngine();

  it('returns one Patch per call', async () => {
    const patches = await engine.execute(task('Resource: User'));
    expect(patches).toHaveLength(1);
  });

  it('patch path includes the resource name', async () => {
    const patches = await engine.execute(task('Resource: Product'));
    expect(patches[0].path).toContain('product');
  });

  it('patch content includes Express Router', async () => {
    const patches = await engine.execute(task('Resource: Order'));
    expect(patches[0].content).toContain('Router');
  });
});

describe('FrontendGenerationEngine', () => {
  const engine = new FrontendGenerationEngine();

  it('returns at least one Patch', async () => {
    const patches = await engine.execute(task('Page: Home, Components: Header,Footer', 'FRONTEND'));
    expect(patches.length).toBeGreaterThan(0);
  });

  it('page patch path includes the page name', async () => {
    const patches = await engine.execute(task('Page: Dashboard, Components: Card', 'FRONTEND'));
    const pagePatch = patches.find(p => p.path.includes('Dashboard'));
    expect(pagePatch).toBeDefined();
  });

  it('components patch includes component names', async () => {
    const patches = await engine.execute(task('Page: Profile, Components: Avatar', 'FRONTEND'));
    const compPatch = patches.find(p => p.content.includes('Avatar'));
    expect(compPatch).toBeDefined();
  });
});

describe('DatabaseGenerationEngine', () => {
  const engine = new DatabaseGenerationEngine();

  it('returns one Patch per call', async () => {
    const patches = await engine.execute(task('Entity: User, Fields: id:string', 'DATABASE'));
    expect(patches).toHaveLength(1);
  });

  it('patch path includes the entity name', async () => {
    const patches = await engine.execute(task('Entity: Product, Fields: id:string', 'DATABASE'));
    expect(patches[0].path).toContain('product');
  });

  it('patch content defines an interface', async () => {
    const patches = await engine.execute(task('Entity: Order', 'DATABASE'));
    expect(patches[0].content).toContain('interface');
  });
});

describe('DefaultGenerationEngine', () => {
  const engine = new DefaultGenerationEngine();

  it('returns at least one Patch', async () => {
    const patches = await engine.execute(task('generic description'));
    expect(patches.length).toBeGreaterThan(0);
  });

  it('patch includes a README.md', async () => {
    const patches = await engine.execute(task('generic description'));
    expect(patches[0].path).toContain('README');
  });
});
