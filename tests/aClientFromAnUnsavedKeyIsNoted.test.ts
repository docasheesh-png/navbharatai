// 🔴 A CLIENT BUILT FROM A KEY NOBODY SAVED IS A WHITE SCREEN (failedbr #2271, 2026-11-20 — "INDIAN MUSIC").
//
// The Supabase keys were asked for and never given; the builder's `src/lib/supabase.ts` called
// `createClient(import.meta.env.VITE_SUPABASE_URL, …)` at module load, supabase-js threw "supabaseUrl is required",
// the whole app was a blank page (PREVIEW_NOT_RENDERED), and an unfinished-resume spent a turn healing it.
// Reversion: drop the `_envClientNoted` block from ToolDispatcher's write notes and the dispatcher test fails.

import { describe, it, expect } from 'vitest';
import { unguardedEnvClient } from '../src/server/AgentV3/unguardedEnvClient';
import { generateDbConfig } from '../src/server/lib/DbConfigGenerator';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';

const REPORT_SHAPE = `import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
`;

describe('the shape', () => {
  it("#2271's client is unguarded", () => {
    expect(unguardedEnvClient('src/lib/supabase.ts', REPORT_SHAPE)).toBe(true);
    expect(unguardedEnvClient('src/lib/db.ts', "import { createClient } from '@supabase/supabase-js';\nexport default createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);\n")).toBe(true);
  });
  it("the platform's own guarded client (generate_db_config) is silent", () => {
    const files = generateDbConfig('supabase').files;
    const client = Object.entries(files).find(([, c]) => /createClient/.test(c));
    expect(client).toBeTruthy();
    expect(unguardedEnvClient(client![0], client![1])).toBe(false);
  });
  it('a ternary, an if, or a builder function is left alone', () => {
    const ternary = "import { createClient } from '@supabase/supabase-js';\nconst url = import.meta.env.VITE_SUPABASE_URL;\nexport const supabase = url ? createClient(url, 'k') : null;\n";
    const fn = "import { createClient } from '@supabase/supabase-js';\nexport function getClient() {\n  const url = import.meta.env.VITE_SUPABASE_URL;\n  const c = createClient(url, 'k');\n  return c;\n}\n";
    expect(unguardedEnvClient('src/lib/supabase.ts', ternary)).toBe(false);
    expect(unguardedEnvClient('src/lib/supabase.ts', fn)).toBe(false);
  });
  it('not Supabase, or not code, is not this note', () => {
    expect(unguardedEnvClient('README.md', REPORT_SHAPE)).toBe(false);
    expect(unguardedEnvClient('src/lib/x.ts', "import { createClient } from 'redis';\nexport const r = createClient();\n")).toBe(false);
  });
});

class MemActuator implements ActuatorPort {
  files = new Map<string, string>();
  async readFile(_w: string, p: string): Promise<string> { const f = this.files.get(p); if (f === undefined) throw new Error(`ENOENT: ${p}`); return f; }
  async writeFile(_w: string, p: string, c: string): Promise<void> { this.files.set(p, c); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}

describe('the dispatcher says it while the file is open, once per build', () => {
  it('write_file of the report\'s client carries the note; a second write does not repeat it', async () => {
    const stream = new AgentEventStream();
    const d = new ToolDispatcher(new MemActuator(), 'ws-env', new WorkspaceState(stream), stream);
    const first = (await d.dispatch({ id: 'w1', name: 'write_file', input: { path: 'src/lib/supabase.ts', content: REPORT_SHAPE } })).content;
    expect(first).toMatch(/supabaseUrl is required/);
    expect(first).toMatch(/generate_db_config/);
    const second = (await d.dispatch({ id: 'w2', name: 'write_file', input: { path: 'src/lib/supabase2.ts', content: REPORT_SHAPE } })).content;
    expect(second).not.toMatch(/supabaseUrl is required/);
  });
});
