// GA-7 (project coordinator) — milestones + role assignment + coordinator digest. Pure projections
// over the existing module DAG.
import { describe, it, expect } from 'vitest';
import {
  createProjectPlan,
  markModuleStatus,
  moduleBuildContext,
  computeMilestones,
  assignModuleRole,
  moduleMilestone,
  coordinatorDigest,
  type ProjectModule,
} from './ProjectPlan';

const mod = (over: Partial<ProjectModule> = {}): ProjectModule => ({
  id: 'm1', name: 'Module', description: '', dependsOn: [], files: [], contracts: '', status: 'pending', ...over,
});
const plan = (mods: ProjectModule[]) => createProjectPlan('build a big app', 'vite-react', mods, 1_000);

describe('computeMilestones — dependency-ordered layering', () => {
  it('groups modules by dependency depth into ordered milestones', () => {
    const p = plan([
      mod({ id: 'data', name: 'Data', files: ['prisma/schema.prisma'] }),
      mod({ id: 'api', name: 'API', dependsOn: ['data'], files: ['src/server/routes.ts'] }),
      mod({ id: 'ui', name: 'UI', dependsOn: ['api'], files: ['src/App.tsx'] }),
      mod({ id: 'ui2', name: 'UI2', dependsOn: ['api'], files: ['src/Page.tsx'] }),
    ]);
    const ms = computeMilestones(p);
    expect(ms).toHaveLength(3);
    expect(ms[0].moduleIds).toEqual(['data']);           // depth 0
    expect(ms[1].moduleIds).toEqual(['api']);            // depth 1
    expect(ms[2].moduleIds.sort()).toEqual(['ui', 'ui2']); // depth 2 — parallel
    expect(ms[2].total).toBe(3);
  });

  it('is cycle-safe (a dependency cycle does not hang, still returns milestones)', () => {
    const p = plan([
      mod({ id: 'a', dependsOn: ['b'] }),
      mod({ id: 'b', dependsOn: ['a'] }),
    ]);
    const ms = computeMilestones(p);
    expect(ms.length).toBeGreaterThanOrEqual(1);
  });

  it('empty plan → no milestones', () => {
    expect(computeMilestones(plan([]))).toEqual([]);
  });
});

describe('assignModuleRole — files first, then description', () => {
  it('assigns by owned files', () => {
    expect(assignModuleRole(mod({ files: ['prisma/schema.prisma'] }))).toBe('data');
    expect(assignModuleRole(mod({ files: ['src/server/api/routes.ts'] }))).toBe('backend');
    expect(assignModuleRole(mod({ files: ['src/components/Button.tsx'] }))).toBe('frontend');
    expect(assignModuleRole(mod({ files: ['src/a.test.ts'] }))).toBe('test');
    expect(assignModuleRole(mod({ files: ['Dockerfile'] }))).toBe('devops');
  });

  it('falls back to description keywords, then general', () => {
    expect(assignModuleRole(mod({ files: [], description: 'the REST API for orders' }))).toBe('backend');
    expect(assignModuleRole(mod({ files: [], name: 'Dashboard UI', description: 'the main screen' }))).toBe('frontend');
    expect(assignModuleRole(mod({ files: [], name: 'X', description: 'misc glue' }))).toBe('general');
  });
});

describe('moduleMilestone + coordinatorDigest', () => {
  const p = plan([
    mod({ id: 'data', name: 'Data', files: ['prisma/schema.prisma'] }),
    mod({ id: 'api', name: 'API', dependsOn: ['data'], files: ['src/server/api.ts'] }),
  ]);

  it('maps a module to its milestone position', () => {
    expect(moduleMilestone(p, 'data')).toEqual({ index: 1, total: 2 });
    expect(moduleMilestone(p, 'api')).toEqual({ index: 2, total: 2 });
    expect(moduleMilestone(p, 'nope')).toBeNull();
  });

  it('digest reflects progress + current build + role', () => {
    const building = markModuleStatus(p, 'data', 'in_progress');
    const d = coordinatorDigest(building);
    expect(d).toContain('milestone 1/2');
    expect(d).toContain('[data]'); // the role of the in-progress module
  });

  it('digest surfaces a block reason', () => {
    const failed = markModuleStatus(p, 'data', 'failed');
    expect(coordinatorDigest(failed)).toContain('BLOCKED');
  });

  it('empty plan → empty digest', () => {
    expect(coordinatorDigest(plan([]))).toBe('');
  });
});

describe('moduleBuildContext — carries the coordination line', () => {
  it('includes the milestone + role for the module being built', () => {
    const p = plan([
      mod({ id: 'data', name: 'Data', files: ['prisma/schema.prisma'] }),
      mod({ id: 'api', name: 'API', dependsOn: ['data'], files: ['src/server/api.ts'] }),
    ]);
    const ctx = moduleBuildContext(p, p.modules.find((m) => m.id === 'api')!);
    expect(ctx).toContain('COORDINATION: milestone 2/2');
    expect(ctx).toContain('role: backend');
  });
});
