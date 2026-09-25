/**
 * A SECOND CALLER WAITS FOR THE SCAFFOLD (autopsy 2a7fa4b0, 2026-09-25).
 *
 * The build's `ensureWorkspace` returned in 221 ms on a warm sandbox, the architect's first reads of
 * `src/App.tsx`, `src/main.tsx` and `src/index.css` failed "does not exist" while `package.json` read
 * fine, and eight seconds later every file was there. `ensureWorkspace` makes the directory BEFORE it
 * writes the template, and took "the directory exists" to mean "the workspace is ready" — so a caller
 * arriving mid-write returned at once.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { E2BActuator } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator';

function fakeSandbox() {
  let dirMade = false;
  let release!: () => void;
  const templateLanded = new Promise<void>((r) => { release = r; });
  const written: string[] = [];
  const sandbox = {
    files: {
      exists: async () => dirMade,
      makeDir: async () => { dirMade = true; },
      writeFiles: async (files: Array<{ path: string }>) => { await templateLanded; written.push(...files.map((f) => f.path)); },
    },
  };
  return { sandbox, release: () => release(), written };
}

function actuatorOn(sandbox: unknown): E2BActuator {
  const act = new E2BActuator('test-key');
  const a = act as unknown as Record<string, unknown>;
  a.getSandbox = async () => sandbox;
  a._kickoffPlaywright = () => { /* no browser install in a unit test */ };
  return act;
}

describe('ensureWorkspace is one setup per workspace', () => {
  it('🔴 the report case: a second caller does not return until the template has landed', async () => {
    const fake = fakeSandbox();
    const act = actuatorOn(fake.sandbox);
    const first = act.ensureWorkspace('ws-1', 'vite-react');
    await new Promise((r) => setTimeout(r, 0)); // the first caller is now between makeDir and writeFiles
    let secondDone = false;
    const second = act.ensureWorkspace('ws-1', 'vite-react').then(() => { secondDone = true; });
    await new Promise((r) => setTimeout(r, 10));
    expect(secondDone).toBe(false); // before the fix: true, with an empty src/
    fake.release();
    await Promise.all([first, second]);
    expect(secondDone).toBe(true);
    expect(fake.written.some((p) => p.endsWith('src/App.tsx'))).toBe(true);
  });

  it('the template is written ONCE, however many callers arrive together', async () => {
    const fake = fakeSandbox();
    const act = actuatorOn(fake.sandbox);
    const all = Promise.all([act.ensureWorkspace('ws-2'), act.ensureWorkspace('ws-2'), act.ensureWorkspace('ws-2')]);
    await new Promise((r) => setTimeout(r, 0));
    fake.release();
    await all;
    expect(fake.written.filter((p) => p.endsWith('package.json'))).toHaveLength(1);
  });

  it('a finished setup is forgotten, so the next call re-checks the machine', async () => {
    const fake = fakeSandbox();
    fake.release();
    const act = actuatorOn(fake.sandbox);
    await act.ensureWorkspace('ws-3');
    expect((act as unknown as { _ensuring: Map<string, unknown> })._ensuring.size).toBe(0);
    await act.ensureWorkspace('ws-3'); // exists now → returns without writing again
    expect(fake.written.filter((p) => p.endsWith('package.json'))).toHaveLength(1);
  });

  it('a failed setup does not wedge the workspace', async () => {
    const act = actuatorOn({ files: { exists: async () => { throw new Error('sandbox gone'); } } });
    await expect(act.ensureWorkspace('ws-4')).rejects.toThrow('sandbox gone');
    expect((act as unknown as { _ensuring: Map<string, unknown> })._ensuring.size).toBe(0);
  });

  it('WIRING: every entry goes through the single-flight map', () => {
    const src = readFileSync('src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator.ts', 'utf8');
    const body = src.slice(src.indexOf('  async ensureWorkspace('), src.indexOf('  private async _ensureWorkspaceOnce('));
    expect(body).toContain('this._ensuring.get(workspaceId)');
    expect(body).toContain('this._ensureWorkspaceOnce(');
  });
});

describe('the sibling: the Engineer AI actuator carries the same single-flight', () => {
  it('WIRING', () => {
    const src = readFileSync('src/server/EngineerAI/actuators/E2BActuator.ts', 'utf8');
    const body = src.slice(src.indexOf('  async ensureWorkspace('), src.indexOf('  private async _ensureWorkspaceOnce('));
    expect(body).toContain('this._ensuring.get(workspaceId)');
    expect(body).toContain('this._ensureWorkspaceOnce(');
  });
});
