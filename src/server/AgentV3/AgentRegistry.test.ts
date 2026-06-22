import { describe, it, expect } from 'vitest';
import { roleConfig, isWorkerRole, WORKER_ROLES, allRoles, findRolesByCapability, rolesByLayer, rosterBriefing } from './AgentRegistry';
import { catalogForTools, taskToolDef } from './ToolCatalog';
import { architectSystemPrompt } from './systemPrompt';

describe('AgentRegistry', () => {
  it('gives only the Architect the task tool (no deep recursion)', () => {
    expect(roleConfig('architect').tools).toContain('task');
    for (const role of WORKER_ROLES) {
      expect(roleConfig(role).tools).not.toContain('task');
    }
  });

  it('keeps QA and Reviewer read-only (no write/edit)', () => {
    for (const role of ['qa', 'reviewer'] as const) {
      const tools = roleConfig(role).tools;
      expect(tools).not.toContain('write_file');
      expect(tools).not.toContain('edit_file');
    }
    expect(roleConfig('reviewer').tools).not.toContain('bash');
  });

  it('every role has a non-empty system prompt and title', () => {
    for (const role of ['architect', ...WORKER_ROLES] as const) {
      const cfg = roleConfig(role);
      expect(cfg.system.length).toBeGreaterThan(20);
      expect(cfg.title.length).toBeGreaterThan(0);
    }
  });

  it('isWorkerRole accepts workers and rejects architect/garbage', () => {
    expect(isWorkerRole('frontend')).toBe(true);
    expect(isWorkerRole('architect')).toBe(false);
    expect(isWorkerRole('wizard')).toBe(false);
  });

  it('staffs the full six-layer roster (planning…operations)', () => {
    // Spot-check that the expanded roster is really present.
    const expected = [
      'requirement', 'planner', 'product',
      'fullstack', 'mobile', 'api', 'devops', 'infrastructure',
      'tester', 'security', 'performance', 'accessibility',
      'refactor', 'optimizer', 'docs', 'researcher', 'monitor', 'recovery',
    ] as const;
    for (const role of expected) expect(isWorkerRole(role)).toBe(true);
    // Architect + every worker is addressable.
    expect(allRoles()).toContain('architect');
    expect(allRoles().length).toBe(WORKER_ROLES.length + 1);
  });

  it('every worker declares capabilities and a valid layer', () => {
    for (const role of WORKER_ROLES) {
      const cfg = roleConfig(role);
      expect(cfg.capabilities.length).toBeGreaterThan(0);
      expect(cfg.layer).not.toBe('lead'); // only the architect is the lead
    }
  });

  it('read-only/run-only roles never get write or edit tools', () => {
    for (const role of ['security', 'performance', 'accessibility', 'researcher', 'monitor'] as const) {
      const tools = roleConfig(role).tools;
      expect(tools).not.toContain('write_file');
      expect(tools).not.toContain('edit_file');
    }
  });
});

describe('Capability Registry', () => {
  it('routes a free-text need to the right specialist', () => {
    expect(findRolesByCapability('schema')).toContain('database');
    expect(findRolesByCapability('a11y')).toContain('accessibility');
    expect(findRolesByCapability('vulnerabilities')).toContain('security');
    expect(findRolesByCapability('rollback')).toContain('recovery');
  });

  it('matches by role name too, and returns [] for nonsense', () => {
    expect(findRolesByCapability('frontend')).toContain('frontend');
    expect(findRolesByCapability('')).toEqual([]);
    expect(findRolesByCapability('zzzznotacapability')).toEqual([]);
  });

  it('groups every role under exactly one layer', () => {
    const grouped = rolesByLayer();
    const flat = Object.values(grouped).flat();
    expect(flat.sort()).toEqual(allRoles().sort());
    expect(grouped.lead).toEqual(['architect']);
  });
});

describe('rosterBriefing (capability-aware routing)', () => {
  it('describes the team by layer with capabilities, for the Architect prompt', () => {
    const brief = rosterBriefing();
    expect(brief).toContain('DEVELOPMENT');
    expect(brief).toContain('QUALITY');
    expect(brief).toContain('database');
    expect(brief).toContain('security');
    // Capabilities are surfaced so the Architect can route by need.
    expect(brief.toLowerCase()).toContain('schema');
  });

  it('is embedded in the Architect system prompt so delegation is capability-aware', () => {
    const prompt = architectSystemPrompt();
    expect(prompt).toContain(rosterBriefing());
  });
});

describe('catalogForTools', () => {
  it('filters to the allowed tools and appends task when allowed', () => {
    const defs = catalogForTools(['read_file', 'bash', 'task']);
    const names = defs.map((d) => d.name).sort();
    expect(names).toEqual(['bash', 'read_file', 'task']);
  });

  it('omits task when not allowed', () => {
    const defs = catalogForTools(['read_file', 'write_file']);
    expect(defs.map((d) => d.name)).not.toContain('task');
  });

  it('task tool enumerates the worker roles', () => {
    const def = taskToolDef();
    const roleProp = def.input_schema.properties.role as { enum?: string[] };
    expect(roleProp.enum).toEqual([...WORKER_ROLES]);
  });
});
