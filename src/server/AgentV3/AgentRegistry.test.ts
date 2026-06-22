import { describe, it, expect } from 'vitest';
import { roleConfig, isWorkerRole, WORKER_ROLES } from './AgentRegistry';
import { catalogForTools, taskToolDef } from './ToolCatalog';

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
