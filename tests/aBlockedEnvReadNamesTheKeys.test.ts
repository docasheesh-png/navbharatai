// 🔑 A BLOCKED `.env` READ ANSWERS WHAT IT WAS ASKING — KEY NAMES, NEVER VALUES (failedbr #2271, 2026-11-20).
//
// The builder ran `cat .env 2>/dev/null || echo "no .env" && cat .env.example` twice to learn which keys the app had.
// Both were refused ("reads a .env secrets file") with nothing it could act on, and the turns went to rediscovering it.
// The refusal stands and no value is shown; the block now lists the saved key NAMES and points at .env.example.
// Reversion: drop `+ envReadBlockedRemedy(…)` from the HIGH-risk block message and the dispatcher test fails.

import { describe, it, expect } from 'vitest';
import { envReadBlockedRemedy } from '../src/server/AgentV3/CommandGovernance';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';

class MemActuator implements ActuatorPort {
  commands: string[] = [];
  async readFile(): Promise<string> { throw new Error('ENOENT'); }
  async writeFile(): Promise<void> {}
  async listFiles(): Promise<string[]> { return []; }
  async runCommand(_w: string, c: string) { this.commands.push(c); return { exitCode: 0, stdout: '', stderr: '' }; }
}

describe("#2271's command: still refused, now with the key names", () => {
  it('names the saved keys, shows no value, and never runs the read', async () => {
    const stream = new AgentEventStream();
    const act = new MemActuator();
    const d = new ToolDispatcher(act, 'ws-env-read', new WorkspaceState(stream), stream);
    d.setUserSecrets({ VITE_SUPABASE_URL: 'https://secret-project.supabase.co', VITE_SUPABASE_ANON_KEY: 'eyJsecretvalue' });
    const r = await d.dispatch({ id: 'b1', name: 'bash', input: { command: 'cat .env 2>/dev/null || echo "no .env" && cat .env.example' } });
    const text = `${r.content}`;
    expect(text).toMatch(/GOVERNANCE BLOCKED/);
    expect(text).toContain('VITE_SUPABASE_ANON_KEY, VITE_SUPABASE_URL');
    expect(text).not.toContain('secret-project');
    expect(text).not.toContain('eyJsecretvalue');
    expect(act.commands.some((c) => /cat \.env/.test(c))).toBe(false);
  });
});

describe('the remedy', () => {
  it('says "none yet" when nothing is saved', () => {
    expect(envReadBlockedRemedy(['reads a .env secrets file (exposes stored keys)'], [])).toMatch(/none yet/);
  });
  it('is empty for any other block', () => {
    expect(envReadBlockedRemedy(['runs with elevated privileges (sudo)'], ['A'])).toBe('');
  });
});
