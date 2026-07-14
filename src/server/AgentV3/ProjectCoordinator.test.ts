import { describe, it, expect } from 'vitest';
import {
  detectOwnershipConflicts,
  detectContractCollisions,
  repairPlanCycles,
  resolveOwnershipConflicts,
  coordinateBeforeTurn,
  applyReplan,
  replanSystemPrompt,
  replanUserPrompt,
  LLM_REPLAN_THRESHOLD,
} from './ProjectCoordinator';
import { nextBuildableModule, type ProjectPlan, type ProjectModule } from './ProjectPlan';

const mod = (over: Partial<ProjectModule> & { id: string }): ProjectModule => ({
  name: over.id, description: '', dependsOn: [], files: [], contracts: '', status: 'pending', ...over,
});
const plan = (modules: ProjectModule[]): ProjectPlan => ({ version: 1, goal: 'g', framework: 'vite-react', createdAt: 1, modules });

describe('detectOwnershipConflicts', () => {
  it('finds a file listed by 2 modules; [] when unique', () => {
    const p = plan([mod({ id: 'a', files: ['src/x.ts', 'src/a.ts'] }), mod({ id: 'b', files: ['src/x.ts'] })]);
    expect(detectOwnershipConflicts(p)).toEqual([{ file: 'src/x.ts', moduleIds: ['a', 'b'] }]);
    expect(detectOwnershipConflicts(plan([mod({ id: 'a', files: ['1.ts'] }), mod({ id: 'b', files: ['2.ts'] })]))).toEqual([]);
  });
});

describe('detectContractCollisions', () => {
  it('finds a symbol exported by 2 contracts; ignores unique/empty', () => {
    const p = plan([
      mod({ id: 'a', contracts: 'export interface User { id: string }\nexport function load(): void' }),
      mod({ id: 'b', contracts: 'export type User = { name: string }' }),
      mod({ id: 'c', contracts: '' }),
    ]);
    const cols = detectContractCollisions(p);
    expect(cols).toEqual([{ symbol: 'User', moduleIds: ['a', 'b'] }]);
  });
  it('parses `export { a as b }` group exports', () => {
    const p = plan([mod({ id: 'a', contracts: 'export { foo as shared }' }), mod({ id: 'b', contracts: 'export const shared = 1' })]);
    expect(detectContractCollisions(p).map((c) => c.symbol)).toEqual(['shared']);
  });
});

describe('repairPlanCycles', () => {
  it('breaks an a↔b cycle so a module becomes buildable and reports the removed edge', () => {
    const p = plan([mod({ id: 'a', dependsOn: ['b'] }), mod({ id: 'b', dependsOn: ['a'] })]);
    expect(nextBuildableModule(p)).toBeNull(); // deadlocked before repair
    const r = repairPlanCycles(p);
    expect(r.changed).toBe(true);
    expect(r.removed.length).toBeGreaterThanOrEqual(1);
    expect(nextBuildableModule(r.plan)).not.toBeNull(); // buildable after repair
  });
  it('is a no-op on an acyclic plan', () => {
    const p = plan([mod({ id: 'a' }), mod({ id: 'b', dependsOn: ['a'] })]);
    const r = repairPlanCycles(p);
    expect(r.changed).toBe(false);
    expect(r.removed).toEqual([]);
  });
});

describe('resolveOwnershipConflicts', () => {
  it('assigns a shared file to the lower-depth module and strips it from the other', () => {
    // a is depth 0 (owner), b depends on a (depth 1) → a keeps src/x.ts, b loses it.
    const p = plan([mod({ id: 'a', files: ['src/x.ts'] }), mod({ id: 'b', dependsOn: ['a'], files: ['src/x.ts', 'src/b.ts'] })]);
    const r = resolveOwnershipConflicts(p);
    expect(r.changed).toBe(true);
    const a = r.plan.modules.find((m) => m.id === 'a')!;
    const b = r.plan.modules.find((m) => m.id === 'b')!;
    expect(a.files).toContain('src/x.ts');
    expect(b.files).not.toContain('src/x.ts');
    expect(b.files).toContain('src/b.ts');
    // Every file is now owned exactly once.
    expect(detectOwnershipConflicts(r.plan)).toEqual([]);
  });
});

describe('coordinateBeforeTurn', () => {
  it('turns a cyclic + conflicted plan into a buildable one', () => {
    const p = plan([
      mod({ id: 'a', dependsOn: ['b'], files: ['src/x.ts'] }),
      mod({ id: 'b', dependsOn: ['a'], files: ['src/x.ts'] }),
    ]);
    const act = coordinateBeforeTurn(p);
    expect(['cycle-break', 'ownership-resolve']).toContain(act.kind);
    expect(nextBuildableModule(act.plan)).not.toBeNull();
    expect(act.notes.length).toBeGreaterThan(0);
  });
  it('returns kind "none" on a clean, advanceable plan', () => {
    const act = coordinateBeforeTurn(plan([mod({ id: 'a' }), mod({ id: 'b', dependsOn: ['a'] })]));
    expect(act.kind).toBe('none');
    expect(act.notes).toEqual([]);
  });
  it('requests an LLM replan when a not-done module has failed >= threshold and is unbuildable', () => {
    // a failed twice; b depends on a → nothing buildable, a not done → needs-llm-replan.
    const p = plan([
      mod({ id: 'a', status: 'failed', attempts: LLM_REPLAN_THRESHOLD, statusDetail: 'tsc error' }),
      mod({ id: 'b', dependsOn: ['a'] }),
    ]);
    const act = coordinateBeforeTurn(p);
    expect(act.kind).toBe('needs-llm-replan');
  });
});

describe('applyReplan', () => {
  const done = mod({ id: 'a', status: 'done', contracts: 'export const A = 1' });
  it('keeps done modules + replaces the not-done tail', () => {
    const old = plan([done, mod({ id: 'b', status: 'failed', attempts: 2 })]);
    const revised = [mod({ id: 'a', status: 'done' }), mod({ id: 'b1' }), mod({ id: 'b2' })];
    const next = applyReplan(old, revised);
    expect(next.modules.map((m) => m.id)).toEqual(['a', 'b1', 'b2']);
    expect(next.modules[0].contracts).toBe('export const A = 1'); // done kept verbatim
    expect(next.modules[1].status).toBe('pending');
    expect(next.modules[1].attempts).toBe(0); // fresh tail
  });
  it('returns the OLD plan when the revision drops a done module (never regress)', () => {
    const old = plan([done, mod({ id: 'b', status: 'failed' })]);
    expect(applyReplan(old, [mod({ id: 'b1' })])).toBe(old);
  });
  it('returns the OLD plan for an empty revision', () => {
    const old = plan([done]);
    expect(applyReplan(old, [])).toBe(old);
  });
});

describe('replan prompt builders', () => {
  it('include the framework, failing error text, and current module names', () => {
    expect(replanSystemPrompt('vite-react')).toContain('vite-react');
    const p = plan([mod({ id: 'a', name: 'Data model', status: 'failed', attempts: 2, statusDetail: 'TS2322 mismatch' })]);
    const u = replanUserPrompt(p, 'a');
    expect(u).toContain('Data model');
    expect(u).toContain('TS2322 mismatch');
  });
});
