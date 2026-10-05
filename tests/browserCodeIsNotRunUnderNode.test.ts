/**
 * Q-146: a browser-only app's localStorage seed was run with node, died on `localStorage is not defined`, and
 * the builder spent ~10 minutes on shims to make browser code run where no browser exists. The tool result
 * now says, the first time, that it cannot — and where the code belongs.
 */
import { describe, it, expect } from 'vitest';
import { browserCodeInNodeHint } from '../src/server/AgentV3/browserCodeInNode';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';

const ERR = "file:///app/scripts/seed.ts:3\n  localStorage.setItem('students', JSON.stringify(rows));\n  ^\nReferenceError: localStorage is not defined\n    at file:///app/scripts/seed.ts:3:3";

describe('browser code run under node is named, once, with where it belongs', () => {
  it('node, tsx, npx tsx and an npm seed script — every browser global', () => {
    for (const cmd of ['node scripts/seed.js', 'npx tsx scripts/seed.ts', 'tsx src/seed.ts', 'cd app && npm run seed']) {
      expect(browserCodeInNodeHint(cmd, ERR), cmd).toMatch(/BROWSER CODE, RUN UNDER NODE\. `localStorage`/);
    }
    expect(browserCodeInNodeHint('node a.js', 'ReferenceError: window is not defined')).toMatch(/`window`/);
    expect(browserCodeInNodeHint('node a.js', 'ReferenceError: document is not defined')).toMatch(/`document`/);
  });

  it('never: another error, a browser run, or a command that is not a node run', () => {
    expect(browserCodeInNodeHint('node a.js', 'ReferenceError: foo is not defined')).toBeNull();
    expect(browserCodeInNodeHint('npm run dev', ERR)).toBeNull();
    expect(browserCodeInNodeHint('cat log.txt', ERR)).toBeNull();
  });

  class Act implements ActuatorPort {
    async readFile(): Promise<string> { throw new Error('ENOENT'); }
    async writeFile(): Promise<void> {}
    async listFiles(): Promise<string[]> { return []; }
    async runCommand() { return { exitCode: 1, stdout: '', stderr: ERR }; }
    async getPortUrl(_w: string, p: number) { return `https://s-${p}.example.dev`; }
  }

  it('the builder sees it in the bash tool\'s result', async () => {
    const stream = new AgentEventStream();
    const d = new ToolDispatcher(new Act(), 'ws-seed', new WorkspaceState(stream), stream);
    const out = String((await d.dispatch({ id: 'b1', name: 'bash', input: { command: 'npx tsx scripts/seed.ts' } }, 'architect')).content);
    expect(out).toContain('BROWSER CODE, RUN UNDER NODE');
  });
});
