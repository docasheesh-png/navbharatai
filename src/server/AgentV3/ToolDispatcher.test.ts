import { describe, it, expect, beforeEach } from 'vitest';
import { ToolDispatcher, type ActuatorPort } from './ToolDispatcher';
import { defaultToolCatalog, CATALOG_TOOL_NAMES } from './ToolCatalog';
import { WorkspaceState } from './WorkspaceState';
import { AgentEventStream } from './AgentEventStream';
import type { ToolUse } from './ClaudeClient';
import type { AgentEvent } from './types';
import { getWorkspaceMemory } from './WorkspaceMemory';

/** An in-memory fake sandbox implementing just the ActuatorPort slice. */
class FakeActuator implements ActuatorPort {
  files = new Map<string, string>();
  commands: string[] = [];
  commandResult = { exitCode: 0, stdout: '', stderr: '' };

  async readFile(_ws: string, path: string): Promise<string> {
    const f = this.files.get(path);
    if (f === undefined) throw new Error(`ENOENT: ${path}`);
    return f;
  }
  async writeFile(_ws: string, path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async listFiles(): Promise<string[]> {
    return [...this.files.keys()];
  }
  async runCommand(_ws: string, command: string) {
    this.commands.push(command);
    return this.commandResult;
  }
  async getPortUrl(_ws: string, port: number): Promise<string> {
    return `https://sandbox-${port}.example.dev`;
  }
}

function call(name: string, input: Record<string, unknown>, id = 't1'): ToolUse {
  return { id, name, input };
}

describe('ToolCatalog', () => {
  it('exposes exactly the documented tools with required schemas', () => {
    const catalog = defaultToolCatalog();
    expect(catalog.map((t) => t.name).sort()).toEqual([...CATALOG_TOOL_NAMES].sort());
    for (const tool of catalog) {
      expect(tool.input_schema.type).toBe('object');
      expect(typeof tool.description).toBe('string');
    }
  });
});

describe('ToolDispatcher', () => {
  let act: FakeActuator;
  let state: WorkspaceState;
  let stream: AgentEventStream;
  let events: AgentEvent[];
  let d: ToolDispatcher;

  beforeEach(() => {
    act = new FakeActuator();
    stream = new AgentEventStream();
    events = [];
    stream.subscribe((e) => events.push(e), false);
    state = new WorkspaceState(stream);
    d = new ToolDispatcher(act, 'ws-1', state, stream);
  });

  it('write_file creates a file, records the change, emits events', async () => {
    const res = await d.dispatch(call('write_file', { path: 'src/App.tsx', content: 'hello' }), 'frontend');
    expect(res.is_error).toBe(false);
    expect(act.files.get('src/App.tsx')).toBe('hello');
    expect(state.snapshot().files).toEqual([{ path: 'src/App.tsx', kind: 'create' }]);
    expect(events.find((e) => e.type === 'tool_call')).toBeTruthy();
    expect(events.find((e) => e.type === 'tool_result' && e.ok)).toBeTruthy();
    expect(events.find((e) => e.type === 'file_changed')).toBeTruthy();
  });

  it('write_file on an existing path records a modify', async () => {
    act.files.set('a.ts', 'old');
    await d.dispatch(call('write_file', { path: 'a.ts', content: 'new' }));
    expect(state.snapshot().files[0].kind).toBe('modify');
  });

  it('read_file returns contents', async () => {
    act.files.set('a.ts', 'CONTENT');
    const res = await d.dispatch(call('read_file', { path: 'a.ts' }));
    expect(res.content).toBe('CONTENT');
    expect(res.is_error).toBe(false);
  });

  it('read_file on a missing file returns an honest is_error (not a throw)', async () => {
    const res = await d.dispatch(call('read_file', { path: 'nope.ts' }));
    expect(res.is_error).toBe(true);
    expect(res.content).toContain('Error:');
  });

  it('edit_file replaces a unique string and emits a diff', async () => {
    act.files.set('a.ts', 'const x = 1;\nconst y = 2;');
    const res = await d.dispatch(call('edit_file', { path: 'a.ts', old_string: 'const x = 1;', new_string: 'const x = 42;' }));
    expect(res.is_error).toBe(false);
    expect(act.files.get('a.ts')).toBe('const x = 42;\nconst y = 2;');
    expect(events.find((e) => e.type === 'diff')).toBeTruthy();
  });

  it('edit_file errors when old_string is not unique', async () => {
    act.files.set('a.ts', 'dup\ndup');
    const res = await d.dispatch(call('edit_file', { path: 'a.ts', old_string: 'dup', new_string: 'x' }));
    expect(res.is_error).toBe(true);
    expect(res.content).toContain('not unique');
  });

  it('edit_file errors when old_string is absent', async () => {
    act.files.set('a.ts', 'abc');
    const res = await d.dispatch(call('edit_file', { path: 'a.ts', old_string: 'zzz', new_string: 'x' }));
    expect(res.is_error).toBe(true);
    expect(res.content).toContain('not found');
  });

  it('bash runs the command and records terminal output', async () => {
    act.commandResult = { exitCode: 0, stdout: 'hello\n', stderr: '' };
    const res = await d.dispatch(call('bash', { command: 'echo hello' }));
    expect(act.commands).toContain('echo hello');
    expect(res.content).toContain('exit=0');
    expect(state.snapshot().terminalLines.length).toBe(1);
  });

  it('grep shells out with a quoted pattern', async () => {
    act.commandResult = { exitCode: 0, stdout: 'a.ts:1:foo', stderr: '' };
    const res = await d.dispatch(call('grep', { pattern: 'foo' }));
    expect(act.commands[0]).toContain('grep -rn');
    expect(res.content).toContain('foo');
  });

  it('glob matches workspace files by pattern', async () => {
    act.files.set('src/a.ts', '');
    act.files.set('src/b.tsx', '');
    act.files.set('readme.md', '');
    const res = await d.dispatch(call('glob', { pattern: 'src/**/*.ts' }));
    expect(res.content).toContain('src/a.ts');
    expect(res.content).not.toContain('readme.md');
  });

  it('update_todo replaces the todo list and emits todo_updated', async () => {
    const res = await d.dispatch(
      call('update_todo', { todos: [{ id: '1', title: 'scaffold', status: 'in_progress' }] }),
    );
    expect(res.is_error).toBe(false);
    expect(state.snapshot().todos).toEqual([{ id: '1', title: 'scaffold', status: 'in_progress' }]);
    expect(events.find((e) => e.type === 'todo_updated')).toBeTruthy();
  });

  it('update_preview resolves the sandbox URL and emits a preview event', async () => {
    const res = await d.dispatch(call('update_preview', { port: 5173 }));
    expect(res.is_error).toBe(false);
    expect(res.content).toContain('https://sandbox-5173.example.dev');
    const ev = events.find((e) => e.type === 'preview');
    expect(ev && ev.type === 'preview' && ev.url).toBe('https://sandbox-5173.example.dev');
  });

  it('update_preview errors honestly when the sandbox has no port mapping', async () => {
    const noPort = new ToolDispatcher(
      { readFile: act.readFile.bind(act), writeFile: act.writeFile.bind(act), listFiles: act.listFiles.bind(act), runCommand: act.runCommand.bind(act) },
      'ws-1',
      state,
      stream,
    );
    const res = await noPort.dispatch(call('update_preview', { port: 3000 }));
    expect(res.is_error).toBe(true);
    expect(res.content).toContain('not available');
  });

  it('creates a real git checkpoint after a write when a checkpointer is wired', async () => {
    const checkpointer = {
      checkpoint: async (message: string) => ({ id: 'c1', sha: 'deadbeef', message, ts: 1 }),
    };
    const dWithGit = new ToolDispatcher(act, 'ws-1', state, stream, undefined, checkpointer);
    await dWithGit.dispatch(call('write_file', { path: 'a.ts', content: 'x' }));
    const checkpoints = state.snapshot().checkpoints;
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0].sha).toBe('deadbeef');
  });

  it('unknown tool returns an honest error', async () => {
    const res = await d.dispatch(call('teleport', {}));
    expect(res.is_error).toBe(true);
    expect(res.content).toContain('Unknown tool');
  });

  it('missing required arg returns an honest error', async () => {
    const res = await d.dispatch(call('write_file', { path: 'a.ts' })); // no content
    expect(res.is_error).toBe(true);
    expect(res.content).toContain('content');
  });

  it('second_opinion returns the injected reviewer result', async () => {
    const dWithOpinion = new ToolDispatcher(
      act, 'ws-1', state, stream, undefined, undefined,
      async (prompt: string) => `[second opinion via GEMINI]\nReviewed: ${prompt}`,
    );
    const res = await dWithOpinion.dispatch(call('second_opinion', { prompt: 'check my auth flow' }));
    expect(res.is_error).toBe(false);
    expect(res.content).toContain('second opinion via GEMINI');
    expect(res.content).toContain('check my auth flow');
  });

  it('second_opinion returns an honest "not available" message when not wired (does not throw)', async () => {
    const res = await d.dispatch(call('second_opinion', { prompt: 'review this' }));
    expect(res.is_error).toBe(false);
    expect(res.content).toContain('not available');
  });

  it('consensus returns the injected panel result', async () => {
    const dWithConsensus = new ToolDispatcher(
      act, 'ws-1', state, stream, undefined, undefined, undefined,
      async (question: string) => `Consensus panel on: ${question}\n\nPanel note: 3 perspective(s) gathered.`,
    );
    const res = await dWithConsensus.dispatch(call('consensus', { question: 'shard the DB?' }));
    expect(res.is_error).toBe(false);
    expect(res.content).toContain('Consensus panel on: shard the DB?');
    expect(res.content).toContain('3 perspective(s) gathered');
  });

  it('consensus returns an honest "not available" message when not wired (does not throw)', async () => {
    const res = await d.dispatch(call('consensus', { question: 'decide this' }));
    expect(res.is_error).toBe(false);
    expect(res.content).toContain('not available');
  });
});

describe('ToolDispatcher — evaluate integration (new dimensions)', () => {
  function makeDispatcher(ws: string): ToolDispatcher {
    const a = new FakeActuator();
    const s = new AgentEventStream();
    return new ToolDispatcher(a, ws, new WorkspaceState(s), s);
  }
  const evalText = async (dd: ToolDispatcher): Promise<string> =>
    (await dd.dispatch(call('evaluate', {}))).content;
  const write = (dd: ToolDispatcher, path: string, content: string) =>
    dd.dispatch(call('write_file', { path, content }));

  it('flags a secret leak (.env not gitignored) and blocks readiness', async () => {
    const dd = makeDispatcher('ws-eval-leak-1');
    await write(dd, '.env', 'API_KEY=secret123');
    await write(dd, '.gitignore', 'node_modules/\ndist/');
    await write(dd, 'src/App.tsx', 'export const App = () => null;');
    const out = await evalText(dd);
    expect(out).toContain('Secret leak');
    expect(out).toContain('not covered by .gitignore');
    expect(out).toContain('NOT READY');
  });

  it('passes the secret-leak check when .env is gitignored', async () => {
    const dd = makeDispatcher('ws-eval-leak-2');
    await write(dd, '.env', 'API_KEY=x');
    await write(dd, '.gitignore', '.env\nnode_modules/');
    const out = await evalText(dd);
    expect(out).toContain('Secret leak: ✓');
  });

  it('flags a hardcoded localhost URL', async () => {
    const dd = makeDispatcher('ws-eval-url');
    await write(dd, 'src/api.ts', "export const API = 'http://localhost:3000/api';");
    const out = await evalText(dd);
    expect(out).toContain('hardcoded localhost URL');
  });

  it('flags a hardcoded server listen port (no process.env.PORT)', async () => {
    const dd = makeDispatcher('ws-eval-port');
    await write(dd, 'server.ts', 'import express from "express";\nconst app = express();\napp.listen(3000);');
    const out = await evalText(dd);
    expect(out).toContain('hardcoded listen port');
    expect(out).toContain('process.env.PORT');
  });

  it('passes the port check when the listen port comes from process.env.PORT', async () => {
    const dd = makeDispatcher('ws-eval-port-ok');
    await write(dd, 'server.ts', 'const app = require("express")();\napp.listen(process.env.PORT || 3000);');
    const out = await evalText(dd);
    expect(out).toContain('Server port: ✓');
  });

  it('flags a .gitignore that exists but does not cover node_modules', async () => {
    const dd = makeDispatcher('ws-eval-hygiene-nm');
    await write(dd, 'package.json', JSON.stringify({ scripts: { dev: 'vite' } }));
    await write(dd, '.gitignore', 'dist/\n.env');
    await write(dd, 'src/App.tsx', 'export const App = () => null;');
    const out = await evalText(dd);
    expect(out).toContain('does not ignore node_modules');
  });

  it('flags runnability when there is no run script', async () => {
    const dd = makeDispatcher('ws-eval-run');
    await write(dd, 'package.json', JSON.stringify({ dependencies: { react: '^18' }, scripts: { lint: 'eslint .' } }));
    await write(dd, 'src/App.tsx', 'export const App = () => null;');
    const out = await evalText(dd);
    expect(out).toContain('Runnability');
    expect(out).toContain('no defined way to start');
  });

  it('flags missing SEO metadata in index.html', async () => {
    const dd = makeDispatcher('ws-eval-seo');
    await write(dd, 'index.html', '<html><head></head><body><div id="root"></div></body></html>');
    const out = await evalText(dd);
    expect(out).toContain('SEO/metadata');
    expect(out).toContain('<title>');
  });

  it('flags credentials embedded in a connection string', async () => {
    const dd = makeDispatcher('ws-eval-connstr');
    await write(dd, 'src/db.ts', 'export const url = "mongodb://admin:s3cret99@cluster0.abcd.mongodb.net/db";');
    const out = await evalText(dd);
    expect(out).toContain('connection-string-credentials');
  });

  it('flags command injection from a dynamically-built shell command', async () => {
    const dd = makeDispatcher('ws-eval-cmdinj');
    await write(dd, 'src/run.ts', 'import { execSync } from "child_process";\nexport const go = (dir) => execSync(`rm -rf ${dir}`);');
    const out = await evalText(dd);
    expect(out).toContain('command-injection');
  });

  it('flags insecure security config (disabled TLS verification)', async () => {
    const dd = makeDispatcher('ws-eval-sec');
    await write(dd, 'src/http.ts', 'const agent = new Agent({ rejectUnauthorized: false });');
    const out = await evalText(dd);
    expect(out).toContain('Security config');
    expect(out).toContain('NOT READY'); // high security-config issue blocks readiness
  });

  it('reports READY for a clean, runnable, well-configured project', async () => {
    const dd = makeDispatcher('ws-eval-clean');
    await write(dd, 'package.json', JSON.stringify({ scripts: { dev: 'vite', build: 'vite build' }, devDependencies: { vite: '^5' } }));
    await write(dd, 'index.html', '<html lang="en"><head><title>App</title><meta name="viewport" content="width=device-width"><meta name="description" content="A real app."></head><body></body></html>');
    await write(dd, '.gitignore', 'node_modules/\n.env');
    await write(dd, 'tsconfig.json', '{ "compilerOptions": { "strict": true } }');
    await write(dd, 'package-lock.json', '{}');
    await write(dd, 'src/App.tsx', 'export const App = () => null;');
    const out = await evalText(dd);
    expect(out).toContain('readiness: READY');
    expect(out).not.toContain('NOT READY');
  });
});

describe('ToolDispatcher — evaluate integration (more dimensions + generators)', () => {
  function makeDispatcher(ws: string): ToolDispatcher {
    const a = new FakeActuator();
    const s = new AgentEventStream();
    return new ToolDispatcher(a, ws, new WorkspaceState(s), s);
  }
  const evalText = async (dd: ToolDispatcher): Promise<string> =>
    (await dd.dispatch(call('evaluate', {}))).content;
  const write = (dd: ToolDispatcher, path: string, content: string) =>
    dd.dispatch(call('write_file', { path, content }));
  const read = async (dd: ToolDispatcher, path: string): Promise<string> =>
    (await dd.dispatch(call('read_file', { path }))).content;

  it('flags fake/incomplete code (authenticity) and blocks readiness', async () => {
    const dd = makeDispatcher('ws-eval-auth');
    await write(dd, 'src/api.ts', 'export function getUser() { throw new Error("Not implemented"); }');
    const out = await evalText(dd);
    expect(out).toContain('Authenticity');
    expect(out).toContain('NOT READY');
  });

  it('flags an accessibility issue (image with no alt text)', async () => {
    const dd = makeDispatcher('ws-eval-a11y');
    await write(dd, 'src/Logo.tsx', 'export const Logo = () => <img src="/logo.png" />;');
    const out = await evalText(dd);
    expect(out.toLowerCase()).toContain('accessib');
  });

  it('flags a requested feature that was not built (requirement coverage)', async () => {
    const ws = 'ws-eval-req';
    const dd = makeDispatcher(ws);
    getWorkspaceMemory(ws).recordRequest('build a todo app with a dashboard');
    await write(dd, 'src/TodoList.tsx', 'export const TodoList = () => null;');
    const out = await evalText(dd);
    expect(out).toContain('Requirement coverage');
    expect(out).toContain('dashboard');
  });

  it('flags a real React app with no error boundary', async () => {
    const dd = makeDispatcher('ws-eval-eb');
    await write(dd, 'src/App.tsx', 'export const App = () => null;');
    await write(dd, 'src/Header.tsx', 'export const Header = () => null;');
    const out = await evalText(dd);
    expect(out).toContain('Error boundary');
    expect(out).toContain('no error boundary');
  });

  it('flags zero test coverage on a multi-module project', async () => {
    const dd = makeDispatcher('ws-eval-tc');
    await write(dd, 'src/a.ts', 'export const a = 1;');
    await write(dd, 'src/b.ts', 'export const b = 2;');
    await write(dd, 'src/c.ts', 'export const c = 3;');
    const out = await evalText(dd);
    expect(out).toContain('Test coverage');
    expect(out).toContain('No tests at all');
  });

  it('generate_readme writes a README derived from package.json', async () => {
    const dd = makeDispatcher('ws-gen-readme');
    await write(dd, 'package.json', JSON.stringify({ name: 'my-app', dependencies: { react: '^18' }, scripts: { dev: 'vite' } }));
    await dd.dispatch(call('generate_readme', {}));
    const readme = await read(dd, 'README.md');
    expect(readme).toContain('# my-app');
    expect(readme).toContain('React');
  });

  it('generate_gitignore writes a valid .gitignore', async () => {
    const dd = makeDispatcher('ws-gen-gi');
    await write(dd, 'src/App.tsx', 'export const App = () => null;');
    await dd.dispatch(call('generate_gitignore', {}));
    const gi = await read(dd, '.gitignore');
    expect(gi).toContain('node_modules/');
    expect(gi).toContain('.env');
  });

  it('generate_env_example documents the referenced env vars', async () => {
    const dd = makeDispatcher('ws-gen-env');
    await write(dd, 'src/config.ts', 'export const url = process.env.API_URL; export const key = process.env.SECRET_KEY;');
    await dd.dispatch(call('generate_env_example', {}));
    const env = await read(dd, '.env.example');
    expect(env).toContain('API_URL=');
    expect(env).toContain('SECRET_KEY=');
  });
});

describe('ToolDispatcher — evaluate integration (compliance + env vars)', () => {
  function makeDispatcher(ws: string): ToolDispatcher {
    const a = new FakeActuator();
    const s = new AgentEventStream();
    return new ToolDispatcher(a, ws, new WorkspaceState(s), s);
  }
  const evalText = async (dd: ToolDispatcher): Promise<string> =>
    (await dd.dispatch(call('evaluate', {}))).content;
  const write = (dd: ToolDispatcher, path: string, content: string) =>
    dd.dispatch(call('write_file', { path, content }));

  it('flags secrets/PII written to logs (compliance) and blocks readiness', async () => {
    const dd = makeDispatcher('ws-eval-comp');
    await write(dd, 'src/auth.ts', "console.log('user password is', password);");
    const out = await evalText(dd);
    expect(out.toLowerCase()).toContain('compliance');
    expect(out).toContain('NOT READY');
  });

  it('flags an undocumented env var read in code', async () => {
    const dd = makeDispatcher('ws-eval-env');
    await write(dd, 'src/config.ts', 'export const k = process.env.MISSING_SECRET_TOKEN;');
    const out = await evalText(dd);
    expect(out).toContain('Env var check');
    expect(out).toContain('MISSING_SECRET_TOKEN');
  });
});
