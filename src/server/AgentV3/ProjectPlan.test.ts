// Software Project Mode — ProjectPlan pure-module tests. These encode the exact failure classes
// that would corrupt a multi-week mega-build: malformed planner output, dependency cycles,
// unsafe file paths, name-vs-id dependency aliasing, and corrupt durable storage.

import { describe, it, expect } from 'vitest';
import {
  projectModeEnabled,
  detectMegaProject,
  isContinuationMessage,
  extractJsonArray,
  parsePlannedModules,
  createProjectPlan,
  nextBuildableModule,
  planComplete,
  planBlockedReason,
  markModuleStatus,
  planProgress,
  planProgressLine,
  projectPlanTodos,
  moduleBuildContext,
  serializeProjectPlan,
  parseStoredProjectPlan,
  projectPlanSystemPrompt,
  projectPlanUserPrompt,
  MAX_MODULES,
  MAX_CONTRACT_CHARS,
  type ProjectModule,
  type ProjectPlan,
} from './ProjectPlan';

const mod = (over: Partial<ProjectModule> = {}): ProjectModule => ({
  id: 'm1',
  name: 'Module One',
  description: 'does things',
  dependsOn: [],
  files: ['src/a.ts'],
  contracts: 'export function a(): void;',
  status: 'pending',
  ...over,
});

const plan = (modules: ProjectModule[]): ProjectPlan => createProjectPlan('build a big app', 'vite-react', modules, 1_000);

describe('project-mode gating', () => {
  it("projectModeEnabled: 'on' = all users, 'off'/unset = disabled", () => {
    expect(projectModeEnabled({ AGENTV3_PROJECT_MODE: 'on' } as NodeJS.ProcessEnv)).toBe(true);
    expect(projectModeEnabled({ AGENTV3_PROJECT_MODE: 'off' } as NodeJS.ProcessEnv)).toBe(false);
    // Audit finding #1: 'true' now reads as a plain YES (it used to fall through to the allowlist
    // and match nobody — an admin writing `true` got silence instead of the mode they asked for).
    expect(projectModeEnabled({ AGENTV3_PROJECT_MODE: 'true' } as NodeJS.ProcessEnv)).toBe(true);
    expect(projectModeEnabled({ AGENTV3_PROJECT_MODE: 'false' } as NodeJS.ProcessEnv)).toBe(false);
    expect(projectModeEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it('projectModeEnabled: a non-on/off value is a per-user ALLOWLIST (safe gradual rollout)', () => {
    const env = { AGENTV3_PROJECT_MODE: 'admin@nav.ai, uid-123' } as NodeJS.ProcessEnv;
    // Listed identity → enabled; everyone else → disabled.
    expect(projectModeEnabled(env, { email: 'admin@nav.ai' })).toBe(true);
    expect(projectModeEnabled(env, { userId: 'uid-123' })).toBe(true);
    expect(projectModeEnabled(env, { email: 'ADMIN@NAV.AI' })).toBe(true); // case-insensitive
    expect(projectModeEnabled(env, { userId: 'someone-else', email: 'other@x.io' })).toBe(false);
    expect(projectModeEnabled(env, {})).toBe(false);
    // 'on' still beats the allowlist parsing (everyone).
    expect(projectModeEnabled({ AGENTV3_PROJECT_MODE: 'on' } as NodeJS.ProcessEnv, { email: 'anyone@x.io' })).toBe(true);
  });

  it('detectMegaProject fires on an explicit large scale', () => {
    expect(detectMegaProject('banao ek software with 1000 files, complete ERP')).toBe(true);
    expect(detectMegaProject('an app with 200+ screens for logistics')).toBe(true);
    // Small explicit scale does NOT fire.
    expect(detectMegaProject('a landing page with 5 pages')).toBe(false);
  });

  it('detectMegaProject fires on big-software noun + a long feature enumeration', () => {
    const features = Array.from({ length: 9 }, (_, i) => `- feature ${i}: something real`).join('\n');
    expect(detectMegaProject(`Build a hospital management system:\n${features}`)).toBe(true);
    // The same noun WITHOUT the enumeration stays conservative (a small HMS demo is fine as one build).
    expect(detectMegaProject('Build a hospital management system')).toBe(false);
  });

  it('detectMegaProject fires on a very long spec even without a category noun', () => {
    const bullets = Array.from({ length: 15 }, (_, i) => `${i + 1}. requirement ${i}`).join('\n');
    expect(detectMegaProject(`I need an app that does:\n${bullets}`)).toBe(true);
  });

  it('detectMegaProject stays OFF for ordinary apps (high precision by design)', () => {
    expect(detectMegaProject('make me a todo app with dark mode')).toBe(false);
    expect(detectMegaProject('ek calculator banao')).toBe(false);
    expect(detectMegaProject('a portfolio site with:\n- about\n- projects\n- contact')).toBe(false);
    expect(detectMegaProject('')).toBe(false);
  });

  it('isContinuationMessage matches the client auto-continue prompt and human phrasings', () => {
    expect(isContinuationMessage('continue')).toBe(true); // the literal Layer-3 auto-continue prompt
    expect(isContinuationMessage('Continue!')).toBe(true);
    expect(isContinuationMessage('please continue')).toBe(true);
    expect(isContinuationMessage('ok, keep going')).toBe(true);
    expect(isContinuationMessage('next module')).toBe(true);
    expect(isContinuationMessage('continue karo')).toBe(true);
    expect(isContinuationMessage('aage badhao')).toBe(true);
  });

  it('isContinuationMessage rejects substantive instructions (never steamroll a real ask)', () => {
    expect(isContinuationMessage('change the logo color to blue')).toBe(false);
    expect(isContinuationMessage('continue but first fix the login bug on the signup page')).toBe(false);
    expect(isContinuationMessage('why did the last module fail?')).toBe(false);
    expect(isContinuationMessage('')).toBe(false);
  });
});

describe('extractJsonArray', () => {
  it('parses a bare JSON array', () => {
    expect(extractJsonArray('[{"a":1}]')).toEqual([{ a: 1 }]);
  });
  it('parses an array inside a ```json fence', () => {
    expect(extractJsonArray('Here is the plan:\n```json\n[1,2]\n```\nDone.')).toEqual([1, 2]);
  });
  it('parses the first bracket-balanced array embedded in prose', () => {
    expect(extractJsonArray('The modules are [ {"name":"x [core]"} ] as requested')).toEqual([{ name: 'x [core]' }]);
  });
  it('handles brackets inside JSON strings without miscounting', () => {
    expect(extractJsonArray('x ["a]b", "c[d"] y')).toEqual(['a]b', 'c[d']);
  });
  it('returns null for prose with no array, invalid JSON, and a bare object', () => {
    expect(extractJsonArray('no json here')).toBeNull();
    expect(extractJsonArray('[{"broken": }]')).toBeNull();
    expect(extractJsonArray('{"a":1}')).toBeNull();
  });
});

describe('parsePlannedModules', () => {
  it('parses a well-formed planner reply', () => {
    const text = JSON.stringify([
      { id: 'm1-core', name: 'Core types', description: 'shared types', dependsOn: [], files: ['src/types.ts'], contracts: 'export interface User {}' },
      { id: 'm2-api', name: 'API layer', description: 'services', dependsOn: ['m1-core'], files: ['src/api/users.ts'], contracts: 'export function getUsers(): Promise<User[]>;' },
    ]);
    const mods = parsePlannedModules(text);
    expect(mods).toHaveLength(2);
    expect(mods[0].id).toBe('m1-core');
    expect(mods[1].dependsOn).toEqual(['m1-core']);
    expect(mods.every((m) => m.status === 'pending')).toBe(true);
  });

  it('returns [] for unparseable output (caller falls back to the normal build path)', () => {
    expect(parsePlannedModules('I would structure it as follows...')).toEqual([]);
    expect(parsePlannedModules('')).toEqual([]);
  });

  it('drops modules without a name and drops unsafe file paths', () => {
    const text = JSON.stringify([
      { name: '', files: ['src/x.ts'] },
      { name: 'Real', files: ['/etc/passwd', '../escape.ts', 'node_modules/x.ts', 'src/ok.ts'] },
    ]);
    const mods = parsePlannedModules(text);
    expect(mods).toHaveLength(1);
    expect(mods[0].files).toEqual(['src/ok.ts']);
  });

  it('resolves dependsOn given as module NAMES to the final slug ids', () => {
    const text = JSON.stringify([
      { name: 'Core Types', files: ['src/types.ts'] },
      { name: 'API', dependsOn: ['Core Types'], files: ['src/api.ts'] },
    ]);
    const mods = parsePlannedModules(text);
    expect(mods[1].dependsOn).toEqual([mods[0].id]);
  });

  it('drops unknown and self dependencies (they would deadlock scheduling)', () => {
    const text = JSON.stringify([
      { id: 'a', name: 'A', dependsOn: ['a', 'ghost'], files: [] },
    ]);
    expect(parsePlannedModules(text)[0].dependsOn).toEqual([]);
  });

  it('dedupes duplicate ids so the dependency graph stays unambiguous', () => {
    const text = JSON.stringify([
      { id: 'core', name: 'Core A', files: [] },
      { id: 'core', name: 'Core B', files: [] },
    ]);
    const mods = parsePlannedModules(text);
    expect(new Set(mods.map((m) => m.id)).size).toBe(2);
  });

  it('caps module count and contract size honestly', () => {
    const many = Array.from({ length: MAX_MODULES + 20 }, (_, i) => ({ id: `m${i}`, name: `M${i}`, files: [], contracts: 'x'.repeat(MAX_CONTRACT_CHARS + 5_000) }));
    const mods = parsePlannedModules(JSON.stringify(many));
    expect(mods).toHaveLength(MAX_MODULES);
    expect(mods[0].contracts.length).toBe(MAX_CONTRACT_CHARS);
  });
});

describe('scheduling', () => {
  it('resumes an in_progress module before starting a new one', () => {
    const p = plan([mod({ id: 'a', status: 'done' }), mod({ id: 'b', status: 'in_progress' }), mod({ id: 'c' })]);
    expect(nextBuildableModule(p)?.id).toBe('b');
  });

  it('picks the first pending module whose deps are all done', () => {
    const p = plan([
      mod({ id: 'a', status: 'done' }),
      mod({ id: 'b', dependsOn: ['a', 'x'] }),
      mod({ id: 'c', dependsOn: ['a'] }),
      mod({ id: 'x' }),
    ]);
    expect(nextBuildableModule(p)?.id).toBe('c');
  });

  it('returns null when the plan is complete, and planComplete/planBlockedReason agree', () => {
    const p = plan([mod({ id: 'a', status: 'done' }), mod({ id: 'b', status: 'done' })]);
    expect(nextBuildableModule(p)).toBeNull();
    expect(planComplete(p)).toBe(true);
    expect(planBlockedReason(p)).toBeNull();
  });

  it('an empty plan is never "complete"', () => {
    expect(planComplete(plan([]))).toBe(false);
  });

  it('reports a failed dependency as the honest blocked reason', () => {
    const p = plan([
      mod({ id: 'a', status: 'failed', statusDetail: 'tsc errors', name: 'Data layer' }),
      mod({ id: 'b', dependsOn: ['a'] }),
    ]);
    expect(nextBuildableModule(p)).toBeNull();
    expect(planBlockedReason(p)).toContain('Data layer');
    expect(planBlockedReason(p)).toContain('tsc errors');
  });

  it('reports a dependency cycle instead of scheduling forever', () => {
    const p = plan([mod({ id: 'a', dependsOn: ['b'] }), mod({ id: 'b', dependsOn: ['a'] })]);
    expect(nextBuildableModule(p)).toBeNull();
    expect(planBlockedReason(p)).toContain('circular');
  });
});

describe('markModuleStatus + progress', () => {
  it('updates immutably, sets/clears detail, ignores unknown ids', () => {
    const p = plan([mod({ id: 'a' })]);
    const failed = markModuleStatus(p, 'a', 'failed', 'gate said no');
    expect(failed).not.toBe(p);
    expect(p.modules[0].status).toBe('pending');
    expect(failed.modules[0].status).toBe('failed');
    expect(failed.modules[0].statusDetail).toBe('gate said no');
    const done = markModuleStatus(failed, 'a', 'done');
    expect(done.modules[0].statusDetail).toBeUndefined();
    expect(markModuleStatus(p, 'ghost', 'done')).toBe(p);
  });

  it('planProgress + planProgressLine tell the honest state', () => {
    const p = plan([
      mod({ id: 'a', status: 'done' }),
      mod({ id: 'b', status: 'in_progress', name: 'Payments' }),
      mod({ id: 'c', status: 'failed' }),
      mod({ id: 'd' }),
    ]);
    expect(planProgress(p)).toEqual({ done: 1, failed: 1, total: 4, complete: false });
    const line = planProgressLine(p);
    expect(line).toContain('1/4');
    expect(line).toContain('Payments');
    expect(line).toContain('1 failed');
  });
});

describe('projections', () => {
  it('projectPlanTodos maps module statuses onto the existing todo UI (failed → blocked)', () => {
    const p = plan([
      mod({ id: 'a', status: 'done', name: 'Core' }),
      mod({ id: 'b', status: 'in_progress' }),
      mod({ id: 'c', status: 'failed' }),
      mod({ id: 'd', status: 'pending' }),
    ]);
    expect(projectPlanTodos(p).map((t) => t.status)).toEqual(['done', 'in_progress', 'blocked', 'pending']);
    expect(projectPlanTodos(p)[0]).toEqual({ id: 'a', title: 'Core', status: 'done' });
  });

  it('moduleBuildContext contains the goal, this module, and DONE contracts — but no pending module details', () => {
    const p = plan([
      mod({ id: 'a', status: 'done', name: 'Core', contracts: 'export interface User {}' }),
      mod({ id: 'b', status: 'pending', name: 'Auth', description: 'login + session', files: ['src/auth/login.ts'] }),
      mod({ id: 'c', status: 'pending', name: 'SecretFutureModule', description: 'NEVER-LEAK-THIS', contracts: 'export const later = 1;' }),
    ]);
    const ctx = moduleBuildContext(p, p.modules[1]);
    expect(ctx).toContain('build a big app');
    expect(ctx).toContain('Auth');
    expect(ctx).toContain('login + session');
    expect(ctx).toContain('src/auth/login.ts');
    expect(ctx).toContain('export interface User {}');
    expect(ctx).not.toContain('NEVER-LEAK-THIS');
    expect(ctx).not.toContain('export const later');
  });
});

describe('durable round-trip', () => {
  it('serialize → parse preserves the plan exactly', () => {
    const p = plan([mod({ id: 'a', status: 'done', statusDetail: undefined }), mod({ id: 'b', status: 'failed', statusDetail: 'boom' })]);
    expect(parseStoredProjectPlan(serializeProjectPlan(p))).toEqual(p);
  });

  it('GA-7: the attempts counter survives the round-trip (0/absent stays absent)', () => {
    const p = plan([
      mod({ id: 'a', status: 'done' }),                                  // no attempts → stays absent
      mod({ id: 'b', status: 'failed', statusDetail: 'boom', attempts: 3 }),
    ]);
    const back = parseStoredProjectPlan(serializeProjectPlan(p))!;
    expect(back.modules[0].attempts).toBeUndefined();
    expect(back.modules[1].attempts).toBe(3);
  });

  it('rejects corrupt storage instead of returning a half-valid plan', () => {
    expect(parseStoredProjectPlan(null)).toBeNull();
    expect(parseStoredProjectPlan('')).toBeNull();
    expect(parseStoredProjectPlan('not json')).toBeNull();
    expect(parseStoredProjectPlan('{"version":2,"goal":"x","framework":"y","createdAt":1,"modules":[]}')).toBeNull();
    // A module with an invalid status poisons the WHOLE stored plan → null (re-plan).
    const bad = { version: 1, goal: 'g', framework: 'f', createdAt: 1, modules: [{ id: 'a', name: 'A', status: 'exploded' }] };
    expect(parseStoredProjectPlan(JSON.stringify(bad))).toBeNull();
  });
});

describe('planner prompts', () => {
  it('system prompt freezes the output shape and the module cap', () => {
    const s = projectPlanSystemPrompt('vite-react');
    expect(s).toContain('JSON array');
    expect(s).toContain('dependsOn');
    expect(s).toContain('contracts');
    expect(s).toContain(String(MAX_MODULES));
  });
  it('user prompt carries the goal and the scaffold', () => {
    const u = projectPlanUserPrompt('a hospital management system', ['package.json', 'src/App.tsx']);
    expect(u).toContain('hospital management system');
    expect(u).toContain('src/App.tsx');
    expect(projectPlanUserPrompt('x', [])).toContain('empty scaffold');
  });
});
