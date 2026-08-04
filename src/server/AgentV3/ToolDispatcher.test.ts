import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ToolDispatcher, applyEdit, boundedWholeFileDiff, nearestEditRegion, type ActuatorPort, ALWAYS_WRITE_SECRETS } from './ToolDispatcher';
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
    // Automatically simulate a live port for port-readiness checks so update_preview doesn't time out.
    if (command.includes('nc -z')) return { exitCode: 0, stdout: 'PORT_UP', stderr: '' };
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

  // Deep-test 2026-07-18: the typecheck tool must pinpoint a frontend SYNTAX error's exact location so the
  // model fixes it directly instead of hand-counting <div> tags for 40 steps (the real flail loop).
  it('typecheck surfaces a frontend syntax error with its EXACT location (the flail fix)', async () => {
    act.files.set('src/App.tsx', 'export default function App(){ const handleExportCSV=()=>1; const handleExportCSV=()=>2; return null }');
    const res = await d.dispatch(call('typecheck', {}), 'architect');
    expect(res.content).toMatch(/SYNTAX ERROR/);
    expect(res.content).toContain('src/App.tsx');            // names the offending file…
    expect(res.content).toMatch(/handleExportCSV|already been declared/); // …and the real cause
    expect(res.content).toMatch(/do NOT hand-count/i);       // steers away from the tag-counting flail
  });
  it('typecheck reports frontend clean when every file parses', async () => {
    act.files.set('tsconfig.json', '{}');
    act.files.set('src/App.tsx', 'export default function App(){ return null }');
    act.commandResult = { exitCode: 0, stdout: '', stderr: '' }; // tsc --noEmit clean
    const res = await d.dispatch(call('typecheck', {}), 'architect');
    expect(res.content).not.toMatch(/SYNTAX ERROR/);
    expect(res.content).not.toMatch(/TYPE ERROR/);
    // Honest: it says it ran the REAL type-checker, not just the esbuild parse.
    expect(res.content).toMatch(/type-checks clean \(tsc --noEmit\)/);
  });

  // Deep-test autopsy 2026-08-01 (real report: a SaaS dashboard on kimi-k2.5). esbuild's parse-only
  // typecheck stayed GREEN for 30 min while the real `tsc && vite build` failed on SEMANTIC errors
  // (TS2300 duplicate 'Team', TS1361 import-type, TS2339 ErrorBoundary state/props). The typecheck tool
  // must now run REAL `tsc --noEmit` and surface those per file — the class of bug that caused the flail.
  it('typecheck runs REAL tsc --noEmit and surfaces SEMANTIC errors esbuild is blind to', async () => {
    act.files.set('tsconfig.json', '{"compilerOptions":{"strict":true}}');
    // Parses clean (so no syntax header) — the error is SEMANTIC, exactly what esbuild misses.
    act.files.set('src/App.tsx', 'export default function App(){ return null; }');
    act.commandResult = {
      exitCode: 2,
      stdout: "src/App.tsx(7,8): error TS2300: Duplicate identifier 'Team'.\n"
        + "src/ErrorBoundary.tsx(10,10): error TS2339: Property 'state' does not exist on type 'ErrorBoundary'.\n",
      stderr: '',
    };
    const res = await d.dispatch(call('typecheck', {}), 'architect');
    expect(res.content).toMatch(/TYPE ERROR/);
    expect(res.content).toContain('TS2300');
    expect(res.content).toContain("Duplicate identifier 'Team'");
    expect(res.content).toContain('TS2339');
    expect(res.content).toMatch(/tsc && vite build.*will FAIL/);
    // It actually invoked the real type-checker.
    expect(act.commands.some((c) => c.includes('--noEmit'))).toBe(true);
  });

  it('typecheck skips the tsc pass for a non-TS project (never fakes a pass)', async () => {
    act.files.set('index.html', '<!doctype html><html></html>'); // no tsconfig, no .tsx
    act.commandResult = { exitCode: 0, stdout: '', stderr: '' };
    const res = await d.dispatch(call('typecheck', {}), 'architect');
    expect(res.content).not.toMatch(/type-checks clean \(tsc/); // must NOT claim tsc ran
    expect(act.commands.some((c) => c.includes('--noEmit'))).toBe(false); // no tsc for a non-TS app
  });

  // Deep-test 2026-07-18 (root fix): a write/edit that introduces a DUPLICATE declaration (or any syntax
  // break) into a CLEAN file must be REFUSED at write time, so a non-compiling version is never saved.
  describe('write-time parse guard', () => {
    it('REFUSES an edit that adds a duplicate declaration — the file on disk is unchanged', async () => {
      act.files.set('src/App.tsx', 'export default function App(){\n  const handleExportCSV=()=>1;\n  return null;\n}');
      const before = act.files.get('src/App.tsx');
      const res = await d.dispatch(call('edit_file', {
        path: 'src/App.tsx',
        old_string: '  const handleExportCSV=()=>1;',
        new_string: '  const handleExportCSV=()=>1;\n  const handleExportCSV=()=>2;', // duplicate!
      }), 'architect');
      expect(res.content).toMatch(/WRITE REJECTED/);
      expect(res.content).toMatch(/already been declared|DUPLICATE/i);
      expect(act.files.get('src/App.tsx')).toBe(before); // NOT saved
    });

    it('REFUSES creating a new file that does not parse', async () => {
      const res = await d.dispatch(call('write_file', { path: 'src/Broken.tsx', content: 'export const x = (' }), 'frontend');
      expect(res.content).toMatch(/WRITE REJECTED/);
      expect(act.files.has('src/Broken.tsx')).toBe(false);
    });

    it('ALLOWS a normal, valid edit through', async () => {
      act.files.set('src/App.tsx', 'export default function App(){\n  const a = 1;\n  return null;\n}');
      const res = await d.dispatch(call('edit_file', { path: 'src/App.tsx', old_string: 'const a = 1;', new_string: 'const a = 2;' }), 'architect');
      expect(res.content).not.toMatch(/WRITE REJECTED/);
      expect(act.files.get('src/App.tsx')).toContain('const a = 2;');
    });

    it('ALLOWS a repair edit on an ALREADY-broken file (never blocks fixing)', async () => {
      act.files.set('src/App.tsx', 'export default function App(){\n  const a = (\n  return null;\n}'); // already broken
      const res = await d.dispatch(call('edit_file', { path: 'src/App.tsx', old_string: 'const a = (', new_string: 'const a = 1;' }), 'architect');
      expect(res.content).not.toMatch(/WRITE REJECTED/);
      expect(act.files.get('src/App.tsx')).toContain('const a = 1;');
    });
  });

  it('write_file creates a file, records the change, emits events', async () => {
    const res = await d.dispatch(call('write_file', { path: 'src/App.tsx', content: 'hello' }), 'frontend');
    expect(res.is_error).toBe(false);
    expect(act.files.get('src/App.tsx')).toBe('hello');
    expect(state.snapshot().files).toEqual([{ path: 'src/App.tsx', kind: 'create' }]);
    expect(events.find((e) => e.type === 'tool_call')).toBeTruthy();
    expect(events.find((e) => e.type === 'tool_result' && e.ok)).toBeTruthy();
    expect(events.find((e) => e.type === 'file_changed')).toBeTruthy();
    // E7 — a CREATE now streams a diff event (additions only) so the Diff tab isn't empty during a
    // fresh build. Previously only edit_file emitted a diff.
    const diffEv = events.find((e) => e.type === 'diff') as { diff: { path: string; patch: string } } | undefined;
    expect(diffEv?.diff.path).toBe('src/App.tsx');
    expect(diffEv?.diff.patch).toContain('+ hello');
    expect(diffEv?.diff.patch).not.toContain('- '); // create → additions only
    // Creating a NEW file gives a plain confirmation — no edit_file nudge.
    expect(res.content).toContain('Created src/App.tsx');
    expect(res.content).not.toContain('edit_file');
  });

  // T1-sec-redact: a command that prints a secret must never leak it into the model transcript,
  // the terminal, or the user-visible tool_result event. Command output is safe to mask (it is
  // never an edit_file match source), so the returned content itself is redacted.
  it('bash output masks a leaked API key in the returned content AND the tool_result event', async () => {
    const secret = 'sk-ant-abcdef0123456789ABCDEFGHIJ';
    act.commandResult = { exitCode: 0, stdout: `printed key ${secret}\n`, stderr: '' };
    const res = await d.dispatch(call('bash', { command: 'printenv ANTHROPIC_API_KEY' }), 'backend');
    expect(res.is_error).toBe(false);
    expect(res.content).not.toContain(secret);
    expect(res.content).toContain('[REDACTED:api-key]');
    const result = events.find((e) => e.type === 'tool_result');
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('bash masks a secret printed to stderr too', async () => {
    const secret = 'xai-ABCDEFGHIJKLMNOPQRSTUV0123';
    act.commandResult = { exitCode: 1, stdout: '', stderr: `auth failed with token ${secret}\n` };
    const res = await d.dispatch(call('bash', { command: 'node run.js' }), 'backend');
    expect(res.content).not.toContain(secret);
    expect(res.content).toContain('[REDACTED:api-key]');
  });

  it('grep masks a secret sitting in a matched line', async () => {
    const secret = 'AIzaSyA1234567890123456789012345678901';
    act.commandResult = { exitCode: 0, stdout: `src/.env:3:GEMINI_API_KEY=${secret}\n`, stderr: '' };
    const res = await d.dispatch(call('grep', { pattern: 'KEY', path: 'src' }), 'backend');
    expect(res.content).not.toContain(secret);
    expect(res.content).toContain('[REDACTED:');
  });

  it('bash leaves ordinary (non-secret) output untouched', async () => {
    act.commandResult = { exitCode: 0, stdout: 'added 42 packages in 3s\n', stderr: '' };
    const res = await d.dispatch(call('bash', { command: 'npm install' }), 'backend');
    expect(res.content).toContain('added 42 packages in 3s');
    expect(res.content).not.toContain('[REDACTED');
  });

  it('write_files_batch records create vs modify honestly and warns on a wholesale overwrite', async () => {
    // One brand-new file + one that already exists → the batch must record the second as a MODIFY
    // and surface a full-rewrite warning naming it (not silently record both as "create").
    act.files.set('src/Existing.tsx', 'old content');
    const res = await d.dispatch(
      call('write_files_batch', { files: [
        { path: 'src/New.tsx', content: 'brand new' },
        { path: 'src/Existing.tsx', content: 'REPLACED' },
      ] }),
      'frontend',
    );
    expect(res.is_error).toBe(false);
    expect(act.files.get('src/Existing.tsx')).toBe('REPLACED');
    const changes = state.snapshot().files;
    expect(changes).toContainEqual({ path: 'src/New.tsx', kind: 'create' });
    expect(changes).toContainEqual({ path: 'src/Existing.tsx', kind: 'modify' });
    expect(res.content).toContain('FULL-REWRITE WARNING');
    expect(res.content).toContain('src/Existing.tsx');
  });

  it('write_files_batch on all-new files gives NO overwrite warning', async () => {
    const res = await d.dispatch(
      call('write_files_batch', { files: [{ path: 'a.ts', content: '1' }, { path: 'b.ts', content: '2' }] }),
      'frontend',
    );
    expect(res.is_error).toBe(false);
    expect(res.content).not.toContain('FULL-REWRITE WARNING');
  });

  it('write_files_batch flags LIKELY CONTENT LOSS when a batched rewrite shrinks a substantial file', async () => {
    // A ≥400-byte file rewritten to <50% of its size in a batch → the forensic content-loss verdict
    // (parity with the single-file write_file path), while a modest edit stays a plain overwrite.
    act.files.set('src/Big.tsx', 'x'.repeat(2000));
    act.files.set('src/Small.tsx', 'y'.repeat(1000));
    const res = await d.dispatch(
      call('write_files_batch', { files: [
        { path: 'src/Big.tsx', content: 'x'.repeat(200) },   // 90% smaller → content-loss
        { path: 'src/Small.tsx', content: 'y'.repeat(900) }, // barely changed → just a rewrite
      ] }),
      'frontend',
    );
    expect(res.is_error).toBe(false);
    expect(res.content).toContain('LIKELY CONTENT LOSS');
    expect(res.content).toContain('src/Big.tsx');
    // Only the shrunk file is counted — the barely-changed Small.tsx is NOT flagged as content loss.
    expect(res.content).toContain('1 of these rewrites came back much smaller');
  });

  // E2 (audit Batch 3): the batch writes files in bounded PARALLEL. Every distinct file must still
  // land with its exact content, be recorded as a change, and appear in the summary — no file lost
  // or overwritten by a racing worker — regardless of write completion order.
  it('write_files_batch writes every file of a large batch (parallel, none lost)', async () => {
    const files = Array.from({ length: 25 }, (_, i) => ({ path: `src/f${i}.ts`, content: `content-${i}` }));
    const res = await d.dispatch(call('write_files_batch', { files }), 'frontend');
    expect(res.is_error).toBe(false);
    for (let i = 0; i < 25; i++) {
      expect(act.files.get(`src/f${i}.ts`)).toBe(`content-${i}`);
    }
    // Every file recorded as a change (Map keyed by path → 25 distinct entries).
    expect(state.snapshot().files).toHaveLength(25);
    expect(res.content).toContain('Wrote 25 file(s)');
  });

  // A concurrent writer must never race two writes to the SAME path. Duplicate paths in one batch
  // collapse to their LAST entry (last write wins — the serial loop's final state), deterministically.
  it('write_files_batch dedupes a duplicated path to the last write (no race)', async () => {
    const res = await d.dispatch(
      call('write_files_batch', { files: [
        { path: 'dup.ts', content: 'first' },
        { path: 'other.ts', content: 'x' },
        { path: 'dup.ts', content: 'LAST' },
      ] }),
      'frontend',
    );
    expect(res.is_error).toBe(false);
    expect(act.files.get('dup.ts')).toBe('LAST'); // deterministic last-wins, not a coin-flip race
    // dup.ts recorded once (not twice) → 2 distinct files total.
    expect(state.snapshot().files).toHaveLength(2);
    expect(res.content).toContain('Wrote 2 file(s)');
  });

  it('generate_openapi writes an OpenAPI 3.0.3 contract from the given routes', async () => {
    const res = await d.dispatch(
      call('generate_openapi', { routes: [{ method: 'GET', path: '/users/:id', summary: 'Get a user' }], title: 'My API' }),
      'backend',
    );
    expect(res.is_error).toBe(false);
    expect(res.content.toLowerCase()).toContain('openapi');
    const doc = JSON.parse(act.files.get('openapi.json')!);
    expect(doc.openapi).toBe('3.0.3');
    expect(doc.info.title).toBe('My API');
    expect(doc.paths['/users/{id}'].get).toBeTruthy(); // Express :id → OpenAPI {id}
  });

  it('generate_openapi reports an honest error on an empty routes array', async () => {
    const res = await d.dispatch(call('generate_openapi', { routes: [] }), 'backend');
    expect(res.content).toContain('empty or missing');
    expect(act.files.has('openapi.json')).toBe(false);
  });

  it('generate_api_docs writes a Markdown API reference from the given routes', async () => {
    const res = await d.dispatch(
      call('generate_api_docs', { routes: [{ method: 'post', path: '/login', description: 'Authenticate', auth: true }] }),
      'backend',
    );
    expect(res.is_error).toBe(false);
    const md = act.files.get('API.md')!;
    expect(md).toContain('# API Reference');
    expect(md).toContain('`/login`');
    expect(md).toContain('POST'); // method upper-cased
    expect(md).toContain('🔒'); // auth marker
  });

  it('generate_api_docs reports an honest error on an empty routes array', async () => {
    const res = await d.dispatch(call('generate_api_docs', { routes: [] }), 'backend');
    expect(res.content).toContain('empty or missing');
    expect(act.files.has('API.md')).toBe(false);
  });

  it('generate_tests writes a Vitest skeleton with an honest TODO (no faked assertion)', async () => {
    const res = await d.dispatch(
      call('generate_tests', {
        path: 'src/services/auth.test.ts',
        module_path: './auth',
        functions: [{ name: 'login', params: ['email', 'password'], async: true }],
      }),
      'qa',
    );
    expect(res.is_error).toBe(false);
    const t = act.files.get('src/services/auth.test.ts')!;
    expect(t).toContain("import { describe, it, expect } from 'vitest';");
    expect(t).toContain("from './auth'");
    expect(t).toContain('login');
    expect(t).toContain('await login'); // async awaited
    expect(t).toContain('TODO: assert real behaviour'); // honest skeleton, not a fake pass
  });

  it('generate_tests requires path, module_path and functions', async () => {
    expect((await d.dispatch(call('generate_tests', { module_path: './a', functions: [{ name: 'x' }] }), 'qa')).content).toContain('required');
    expect((await d.dispatch(call('generate_tests', { path: 'a.test.ts', module_path: './a', functions: [] }), 'qa')).content).toContain('empty or missing');
  });

  it('generate_observability writes dependency-free instrumentation files for both sides', async () => {
    const res = await d.dispatch(call('generate_observability', { target: 'both' }), 'backend');
    expect(res.is_error).toBe(false);
    // Frontend error handler.
    const obs = act.files.get('src/observability.ts')!;
    expect(obs).toContain("addEventListener('error'");
    expect(obs).toContain("addEventListener('unhandledrejection'");
    // Backend request logger + health endpoint.
    const logger = act.files.get('src/server/requestLogger.ts')!;
    expect(logger).toContain('export function requestLogger');
    expect(logger).not.toContain('morgan'); // dependency-free — no forced install
    const health = act.files.get('src/server/health.ts')!;
    expect(health).toContain("healthRouter.get('/health'");
    // The result tells the agent how to wire each file in.
    expect(res.content).toContain('Wire each in with edit_file');
  });

  it('generate_observability respects target=frontend (no backend files)', async () => {
    const res = await d.dispatch(call('generate_observability', { target: 'frontend' }), 'frontend');
    expect(res.is_error).toBe(false);
    expect(act.files.has('src/observability.ts')).toBe(true);
    expect(act.files.has('src/server/requestLogger.ts')).toBe(false);
    expect(act.files.has('src/server/health.ts')).toBe(false);
  });

  it('generate_bundle_optimization writes lazyWithRetry + a vite.config when none exists', async () => {
    const res = await d.dispatch(call('generate_bundle_optimization', {}), 'frontend');
    expect(res.is_error).toBe(false);
    const helper = act.files.get('src/lib/lazyWithRetry.tsx')!;
    expect(helper).toContain('export function lazyWithRetry');
    const vite = act.files.get('vite.config.ts')!;
    expect(vite).toContain('manualChunks');
  });

  it('generate_bundle_optimization returns a merge snippet when vite.config already exists', async () => {
    act.files.set('vite.config.ts', 'export default {}');
    const res = await d.dispatch(call('generate_bundle_optimization', {}), 'frontend');
    expect(res.is_error).toBe(false);
    expect(act.files.get('vite.config.ts')).toBe('export default {}'); // not clobbered
    expect(res.content).toContain('Merge this into your vite.config.ts');
    expect(act.files.has('src/lib/lazyWithRetry.tsx')).toBe(true);
  });

  it('generate_seed_data writes realistic fixtures/seed.json for the given entities', async () => {
    const res = await d.dispatch(
      call('generate_seed_data', {
        entities: [{ name: 'User', fields: [{ name: 'id' }, { name: 'email' }, { name: 'name' }] }],
        count: 5,
      }),
      'backend',
    );
    expect(res.is_error).toBe(false);
    const seed = JSON.parse(act.files.get('fixtures/seed.json')!);
    expect(seed.User).toHaveLength(5);
    expect(String(seed.User[0].email)).toContain('@example.com');
  });

  it('generate_seed_data reports an honest error on an empty entities array', async () => {
    const res = await d.dispatch(call('generate_seed_data', { entities: [] }), 'backend');
    expect(res.content).toContain('empty or missing');
  });

  it('generate_auth writes a dependency-free JWT module + middleware by default', async () => {
    const res = await d.dispatch(call('generate_auth', {}), 'backend');
    expect(res.is_error).toBe(false);
    const jwt = act.files.get('src/server/auth/jwt.ts')!;
    expect(jwt).toContain('export function signToken');
    expect(jwt).toContain('export function verifyToken');
    expect(act.files.get('src/middleware/authMiddleware.ts')).toContain('Bearer ');
    expect(res.content).not.toContain('npm i'); // jwt path is dependency-free
  });

  it('generate_auth type=firebase emits client helpers and notes the install', async () => {
    const res = await d.dispatch(call('generate_auth', { type: 'firebase' }), 'backend');
    expect(res.is_error).toBe(false);
    expect(act.files.get('src/lib/authClient.ts')).toContain("from 'firebase/auth'");
    expect(res.content).toContain('npm i firebase');
  });

  it('generate_migration writes a prisma schema + sql ddl for the given entities', async () => {
    const res = await d.dispatch(
      call('generate_migration', {
        entities: [{ name: 'User', fields: [{ name: 'id' }, { name: 'email' }, { name: 'age' }] }],
      }),
      'backend',
    );
    expect(res.is_error).toBe(false);
    expect(act.files.get('prisma/schema.prisma')).toContain('model User {');
    expect(act.files.get('migrations/001_init.sql')).toContain('CREATE TABLE "users"');
  });

  it('generate_migration reports an honest error on an empty entities array', async () => {
    const res = await d.dispatch(call('generate_migration', { entities: [] }), 'backend');
    expect(res.content).toContain('empty or missing');
  });

  it('generate_deploy_artifacts writes Dockerfile + compose + CI by default', async () => {
    const res = await d.dispatch(call('generate_deploy_artifacts', { buildCmd: 'npm run build', testCmd: 'npm test' }), 'backend');
    expect(res.is_error).toBe(false);
    expect(act.files.get('Dockerfile')).toContain('FROM node:');
    expect(act.files.get('Dockerfile')).toContain('USER node'); // non-root
    expect(act.files.get('docker-compose.yml')).toContain('services:');
    const ci = act.files.get('.github/workflows/ci.yml')!;
    expect(ci).toContain('actions/checkout@v4');
    expect(ci).toContain('npm test'); // declared test step present
  });

  it('generate_deploy_artifacts honours an include subset', async () => {
    const res = await d.dispatch(call('generate_deploy_artifacts', { include: ['ci'] }), 'backend');
    expect(res.is_error).toBe(false);
    expect(act.files.has('.github/workflows/ci.yml')).toBe(true);
    expect(act.files.has('Dockerfile')).toBe(false);
    expect(act.files.has('docker-compose.yml')).toBe(false);
  });

  it('replace_symbol AST-swaps one function, leaving the rest intact', async () => {
    act.files.set('src/m.ts', 'export const A = 1;\nexport function f(x: number) { return x; }\nexport const B = 2;\n');
    const res = await d.dispatch(
      call('replace_symbol', { path: 'src/m.ts', symbol: 'f', code: 'export function f(x: number) { return x * 2; }' }),
      'frontend',
    );
    expect(res.is_error).toBe(false);
    const out = act.files.get('src/m.ts')!;
    expect(out).toContain('return x * 2;');
    expect(out).toContain('export const A = 1;'); // untouched
    expect(out).toContain('export const B = 2;'); // untouched
    expect(state.snapshot().files).toContainEqual({ path: 'src/m.ts', kind: 'modify' });
  });

  it('replace_symbol errors honestly on a missing symbol / missing file', async () => {
    act.files.set('src/m.ts', 'export const A = 1;\n');
    const missingSym = await d.dispatch(call('replace_symbol', { path: 'src/m.ts', symbol: 'nope', code: 'const nope = 1;' }), 'frontend');
    expect(missingSym.content).toContain('not found');
    const missingFile = await d.dispatch(call('replace_symbol', { path: 'src/ghost.ts', symbol: 'f', code: 'const f = 1;' }), 'frontend');
    expect(missingFile.content).toContain('file not found');
  });

  it('check_conventions reports violations with suggestions (analysis only, no write)', async () => {
    const res = await d.dispatch(
      call('check_conventions', {
        files: ['src/components/myCard.tsx'], // should be PascalCase
        identifiers: [{ name: 'MyFunc', kind: 'function' }], // should be camelCase
      }),
      'frontend',
    );
    expect(res.is_error).toBe(false);
    expect(res.content).toContain('violation');
    expect(res.content).toContain('myCard.tsx');
    expect(res.content).toContain('MyFunc');
    expect(act.files.size).toBe(0); // analysis only — writes nothing
  });

  it('check_conventions confirms clean input and needs at least one input list', async () => {
    const ok = await d.dispatch(call('check_conventions', { files: ['src/components/MyCard.tsx'], identifiers: [{ name: 'myFunc', kind: 'function' }] }), 'frontend');
    expect(ok.content).toContain('No naming/convention violations');
    const empty = await d.dispatch(call('check_conventions', {}), 'frontend');
    expect(empty.content).toContain('at least one');
  });

  it('generate_release_notes writes RELEASE_NOTES.md with an added/removed diff', async () => {
    const res = await d.dispatch(
      call('generate_release_notes', {
        name: 'My App',
        features: ['login', 'dashboard', 'export'],
        previous_features: ['login', 'dashboard'],
        version: 'v1.1.0',
      }),
      'architect',
    );
    expect(res.is_error).toBe(false);
    const md = act.files.get('RELEASE_NOTES.md')!;
    expect(md).toContain('export'); // the newly added feature
    expect(md.toLowerCase()).toContain('my app');
    expect(res.content).toContain('v1.1.0');
  });

  it('generate_release_notes requires a features array', async () => {
    const res = await d.dispatch(call('generate_release_notes', { name: 'X' }), 'architect');
    expect(res.content).toContain('features');
    expect(act.files.has('RELEASE_NOTES.md')).toBe(false);
  });

  it('write_file on an existing path records a modify and nudges toward edit_file', async () => {
    act.files.set('a.ts', 'const a = 1;');
    const res = await d.dispatch(call('write_file', { path: 'a.ts', content: 'const b = 2;' }));
    expect(state.snapshot().files[0].kind).toBe('modify');
    // Overwriting an EXISTING file warns the agent to prefer a surgical edit_file patch.
    expect(res.is_error).toBe(false);
    expect(res.content).toContain('FULL-REWRITE WARNING');
    expect(res.content).toContain('edit_file');
  });

  it('write_file that rewrites a substantial file to under half its size flags likely content loss', async () => {
    act.files.set('big.ts', 'x'.repeat(2000));
    const res = await d.dispatch(call('write_file', { path: 'big.ts', content: 'x'.repeat(300) }));
    expect(res.is_error).toBe(false);
    expect(res.content).toContain('LIKELY CONTENT LOSS');
    expect(res.content).toContain('edit_file');
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

  it('read_file miss on a path-drifted file names the REAL location (ui/ drift self-correct)', async () => {
    // The real build report: component created at src/components/ui/button.tsx, read from src/components/.
    act.files.set('src/components/ui/button.tsx', 'export const Button = () => null;');
    const res = await d.dispatch(call('read_file', { path: 'src/components/button.tsx' }));
    expect(res.is_error).toBe(true); // still an honest error…
    expect(res.content).toContain('src/components/ui/button.tsx'); // …but it hands back the real path
    expect(res.content.toLowerCase()).toContain('did you mean');
  });

  it('read_file miss with no plausible sibling stays a bare honest error (no misleading hint)', async () => {
    act.files.set('src/App.tsx', 'x');
    const res = await d.dispatch(call('read_file', { path: 'src/Totally/Unrelated.tsx' }));
    expect(res.is_error).toBe(true);
    expect(res.content).not.toContain('did you mean');
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

  it('edit_file applies a patch whose whitespace is slightly off (flexible fallback)', async () => {
    // File uses two-space indent; the model supplies four-space indent + extra blank.
    act.files.set('a.ts', 'function f() {\n  return 1;\n}');
    const res = await d.dispatch(call('edit_file', {
      path: 'a.ts',
      old_string: 'function f() {\n    return 1;\n}',  // wrong indentation
      new_string: 'function f() {\n  return 2;\n}',
    }));
    expect(res.is_error).toBe(false);
    expect(act.files.get('a.ts')).toBe('function f() {\n  return 2;\n}');
    expect(res.content).toContain('ignoring whitespace');
    expect(events.find((e) => e.type === 'diff')).toBeTruthy();
  });

  it('bash runs the command and records terminal output', async () => {
    act.commandResult = { exitCode: 0, stdout: 'hello\n', stderr: '' };
    const res = await d.dispatch(call('bash', { command: 'echo hello' }));
    expect(act.commands).toContain('echo hello');
    expect(res.content).toContain('exit=0');
    expect(state.snapshot().terminalLines.length).toBe(1);
  });

  it('bash records successful npm install / tsc --noEmit into the shared verification ledger (slice 4)', async () => {
    const { getWorkspaceMemory, _clearWorkspaceMemory } = await import('./WorkspaceMemory');
    _clearWorkspaceMemory();
    act.commandResult = { exitCode: 0, stdout: 'ok', stderr: '' };
    await d.dispatch(call('bash', { command: 'npm install' }));
    await d.dispatch(call('bash', { command: 'npx tsc --noEmit' }, 't2'));
    const status = getWorkspaceMemory('ws-1').verificationStatus();
    expect(status).toContain('ALREADY INSTALLED');
    expect(status).toContain('checked CLEAN');
    // A FAILED tsc must not be recorded as clean.
    _clearWorkspaceMemory();
    act.commandResult = { exitCode: 2, stdout: '', stderr: 'TS2304' };
    await d.dispatch(call('bash', { command: 'npx tsc --noEmit' }, 't3'));
    expect(getWorkspaceMemory('ws-1').verificationStatus()).not.toContain('checked CLEAN');
    _clearWorkspaceMemory();
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
    // The port-readiness check must be tool-agnostic + IPv4-forced (nc → curl → /dev/tcp on 127.0.0.1),
    // NOT the old `nc -z localhost` — otherwise a missing nc / IPv6 localhost makes update_preview emit
    // no preview event and the client shows "No live preview yet" despite a healthy dev server.
    const portCheck = act.commands.find((c) => c.includes('PORT_UP'));
    expect(portCheck).toBeTruthy();
    expect(portCheck).toContain('127.0.0.1');
    expect(portCheck).toContain('curl -s -o /dev/null');
    expect(portCheck).not.toContain('nc -z localhost');
  });

  it('update_preview NEVER hangs the build when the sandbox stalls — it times out and warns', async () => {
    // Regression: a production build sat in-flight on update_preview for 907s (15 min) until the
    // wall-clock cap because getPortUrl never returned. The handler must be hard-bounded.
    vi.useFakeTimers();
    try {
      const stalling = {
        readFile: act.readFile.bind(act), writeFile: act.writeFile.bind(act),
        listFiles: act.listFiles.bind(act), runCommand: act.runCommand.bind(act),
        // The sandbox SDK hangs forever — withTimeout must rescue the build.
        getPortUrl: () => new Promise<string>(() => { /* never resolves */ }),
      };
      const dd = new ToolDispatcher(stalling, 'ws-1', state, stream);
      const p = dd.dispatch(call('update_preview', { port: 5173 }));
      // Fast-forward past the 10s getPortUrl budget (port check resolves PORT_UP immediately).
      await vi.advanceTimersByTimeAsync(11_000);
      const res = await p;
      expect(res.content).toContain('could not resolve the preview URL');
      expect(events.find((e) => e.type === 'preview')).toBeUndefined(); // no fake-success preview
    } finally {
      vi.useRealTimers();
    }
  });

  it('update_preview SELF-HEALS: port down → managed dev-server start → port up → published', async () => {
    vi.useFakeTimers();
    try {
      // Port is DOWN until the managed `npm run dev` has been launched, then UP — the exact
      // "server died because the model ran it as a foreground bash" scenario from the diagnostics.
      let devStarted = false;
      const commands: string[] = [];
      const healing = {
        readFile: async (_w: string, p: string) => {
          if (p === 'package.json') return '{"scripts":{"dev":"vite"}}';
          throw new Error(`ENOENT: ${p}`);
        },
        writeFile: act.writeFile.bind(act), listFiles: act.listFiles.bind(act),
        runCommand: async (_w: string, command: string) => {
          commands.push(command);
          if (command.includes('npm run dev')) { devStarted = true; return { exitCode: 0, stdout: 'VITE ready', stderr: '' }; }
          if (command.includes('PORT_UP')) return { exitCode: 0, stdout: devStarted ? 'PORT_UP' : 'PORT_DOWN', stderr: '' };
          return { exitCode: 0, stdout: '', stderr: '' };
        },
        getPortUrl: async (_w: string, port: number) => `https://sandbox-${port}.example.dev`,
      };
      const dd = new ToolDispatcher(healing, 'ws-1', state, stream);
      const p = dd.dispatch(call('update_preview', { port: 5173 }));
      await vi.advanceTimersByTimeAsync(9_000); // 6s failing poll → heal → next poll sees PORT_UP
      const res = await p;
      expect(res.is_error).toBe(false);
      expect(res.content).toContain('Live preview published');
      expect(commands.some((c) => c.includes('PORT=5173 npm run dev'))).toBe(true);
      expect(events.find((e) => e.type === 'preview')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('update_preview LOOP-BREAKER: two definitive failures → gave-up, third call short-circuits FINAL', async () => {
    vi.useFakeTimers();
    try {
      const deadPort = {
        readFile: async (_w: string, p: string) => {
          if (p === 'package.json') return '{"scripts":{"dev":"vite"}}';
          throw new Error(`ENOENT: ${p}`);
        },
        writeFile: act.writeFile.bind(act), listFiles: act.listFiles.bind(act),
        runCommand: async (_w: string, command: string) =>
          command.includes('PORT_UP')
            ? { exitCode: 0, stdout: 'PORT_DOWN', stderr: '' }
            : { exitCode: 0, stdout: '', stderr: '' },
        getPortUrl: async (_w: string, port: number) => `https://sandbox-${port}.example.dev`,
      };
      const dd = new ToolDispatcher(deadPort, 'ws-1', state, stream);

      const p1 = dd.dispatch(call('update_preview', { port: 5173 }));
      await vi.advanceTimersByTimeAsync(20_000);
      const r1 = await p1;
      expect(r1.content).toContain('ONE more time'); // first failure — one bounded retry allowed

      const p2 = dd.dispatch(call('update_preview', { port: 5173 }, 't2'));
      await vi.advanceTimersByTimeAsync(20_000);
      const r2 = await p2;
      expect(r2.content).toContain('Do NOT retry'); // second failure — definitive, stop retrying

      // Third call must NOT poll/heal again — it short-circuits instantly (no timer advance needed).
      const r3 = await dd.dispatch(call('update_preview', { port: 5173 }, 't3'));
      expect(r3.content).toContain('FINAL');
      expect(r3.content).toContain('Do NOT call update_preview');
      // No fake-success preview was ever emitted.
      expect(events.find((e) => e.type === 'preview')).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('update_preview skips the managed dev-server start for a static (no package.json) project', async () => {
    vi.useFakeTimers();
    try {
      const commands: string[] = [];
      const staticProj = {
        readFile: async (_w: string, p: string) => { throw new Error(`ENOENT: ${p}`); },
        writeFile: act.writeFile.bind(act), listFiles: act.listFiles.bind(act),
        runCommand: async (_w: string, command: string) => {
          commands.push(command);
          return command.includes('PORT_UP') ? { exitCode: 0, stdout: 'PORT_DOWN', stderr: '' } : { exitCode: 0, stdout: '', stderr: '' };
        },
        getPortUrl: async (_w: string, port: number) => `https://sandbox-${port}.example.dev`,
      };
      const dd = new ToolDispatcher(staticProj, 'ws-1', state, stream);
      const p = dd.dispatch(call('update_preview', { port: 8080 }));
      await vi.advanceTimersByTimeAsync(10_000);
      const res = await p;
      expect(res.content).toContain('WARNING');
      expect(commands.some((c) => c.includes('npm run dev'))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('update_preview maps an *.e2b.app sandbox host to a configured custom preview domain (§12)', async () => {
    const prev = process.env.E2B_PREVIEW_DOMAIN;
    process.env.E2B_PREVIEW_DOMAIN = 'mitrify.xyz'; // custom domain configured → swap applies
    try {
      const e2bAct = {
        readFile: act.readFile.bind(act), writeFile: act.writeFile.bind(act),
        listFiles: act.listFiles.bind(act), runCommand: act.runCommand.bind(act),
        getPortUrl: async (_ws: string, port: number) => `https://${port}-sbx9.e2b.app`,
      };
      const dd = new ToolDispatcher(e2bAct, 'ws-1', state, stream);
      const res = await dd.dispatch(call('update_preview', { port: 5173 }));
      expect(res.is_error).toBe(false);
      expect(res.content).toContain('https://5173-sbx9.mitrify.xyz');
      const ev = events.find((e) => e.type === 'preview');
      expect(ev && ev.type === 'preview' && ev.url).toBe('https://5173-sbx9.mitrify.xyz');
    } finally {
      if (prev === undefined) delete process.env.E2B_PREVIEW_DOMAIN;
      else process.env.E2B_PREVIEW_DOMAIN = prev;
    }
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

  it('creates a real git checkpoint after a write (scheduled in the background, flushed at build end)', async () => {
    let calls = 0;
    const checkpointer = {
      checkpoint: async (message: string) => { calls++; return { id: 'c1', sha: 'deadbeef', message, ts: 1 }; },
    };
    const dWithGit = new ToolDispatcher(act, 'ws-1', state, stream, undefined, checkpointer);
    await dWithGit.dispatch(call('write_file', { path: 'a.ts', content: 'x' }));
    // The write does NOT block on git — the checkpoint is scheduled off the critical path and
    // lands once the background chain drains (flushed here, as the route does at build end).
    await dWithGit.flushCheckpoints();
    const checkpoints = state.snapshot().checkpoints;
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0].sha).toBe('deadbeef');
  });

  it('coalesces many rapid writes into a SINGLE serialized checkpoint (no per-file git, no index.lock races)', async () => {
    let concurrent = 0, maxConcurrent = 0, total = 0;
    const checkpointer = {
      checkpoint: async (message: string) => {
        concurrent++; maxConcurrent = Math.max(maxConcurrent, concurrent); total++;
        await new Promise((r) => setTimeout(r, 5));
        concurrent--;
        return { id: 'c', sha: 'beef', message, ts: 1 };
      },
    };
    const d = new ToolDispatcher(act, 'ws-1', state, stream, undefined, checkpointer);
    // Fire several writes back-to-back, as concurrent agents would.
    await Promise.all([
      d.dispatch(call('write_file', { path: 'a.ts', content: '1' })),
      d.dispatch(call('write_file', { path: 'b.ts', content: '2' })),
      d.dispatch(call('write_file', { path: 'c.ts', content: '3' })),
    ]);
    await d.flushCheckpoints();
    expect(maxConcurrent).toBe(1);       // never two git ops at once → no index.lock race
    expect(total).toBeLessThanOrEqual(3); // coalesced — far fewer commits than naive per-file
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

  it('AUTO-HEALS a secret leak (.env not gitignored) — writes .gitignore, no longer blocks (App #7/#8)', async () => {
    // Deep-test regression: evaluate used to only DETECT the leak and block at 0/100,
    // so the same blocker recurred every build. Now it deterministically heals .gitignore
    // to cover .env, and the leak clears in the same pass.
    const a = new FakeActuator();
    const s = new AgentEventStream();
    const dd = new ToolDispatcher(a, 'ws-eval-leak-1', new WorkspaceState(s), s);
    await write(dd, '.env', 'API_KEY=secret123');
    await write(dd, '.gitignore', 'node_modules/\ndist/');
    await write(dd, 'src/App.tsx', 'export const App = () => null;');
    const out = await evalText(dd);
    // the .gitignore on disk now covers .env …
    expect(a.files.get('.gitignore')).toContain('.env');
    expect(a.files.get('.gitignore')).toContain('node_modules/'); // original rules preserved
    // … and the readiness output no longer reports the leak as a blocker.
    expect(out).not.toContain('not covered by .gitignore');
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

  it('flags a hardcoded JWT signing secret', async () => {
    const dd = makeDispatcher('ws-eval-jwt');
    await write(dd, 'src/auth.ts', "export const tok = (u) => jwt.sign(u, 'static-signing-secret', { expiresIn: '1h' });");
    const out = await evalText(dd);
    expect(out).toContain('hardcoded-jwt-secret');
  });

  it('flags new Function() dynamic code', async () => {
    const dd = makeDispatcher('ws-eval-newfn');
    await write(dd, 'src/run.ts', 'export const make = (body) => new Function("x", body);');
    const out = await evalText(dd);
    expect(out).toContain('dynamic-function');
  });

  it('flags an unsafe innerHTML assignment (XSS sink)', async () => {
    const dd = makeDispatcher('ws-eval-xss');
    await write(dd, 'src/ui.ts', 'export const render = (el, data) => { el.innerHTML = data; };');
    const out = await evalText(dd);
    expect(out).toContain('unsafe-html-sink');
  });

  it('flags a SQL query built from interpolated input', async () => {
    const dd = makeDispatcher('ws-eval-sqli');
    await write(dd, 'src/db.ts', 'export const find = (id) => db.query(`SELECT * FROM users WHERE id = ${id}`);');
    const out = await evalText(dd);
    expect(out).toContain('sql-injection');
  });

  it('flags a hardcoded Authorization Bearer header', async () => {
    const dd = makeDispatcher('ws-eval-authhdr');
    await write(dd, 'src/api.ts', "export const call = () => fetch('/x', { headers: { Authorization: 'Bearer sk_live_abc123def456' } });");
    const out = await evalText(dd);
    expect(out).toContain('hardcoded-auth-header');
  });

  it('flags a hardcoded provider token (e.g. a GitHub token) in source', async () => {
    const dd = makeDispatcher('ws-eval-token');
    // Assembled at runtime so no contiguous token literal lives in this test file.
    const token = 'gh' + 'p_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
    await write(dd, 'src/gh.ts', `export const tok = "${token}";`);
    const out = await evalText(dd);
    expect(out).toContain('hardcoded-provider-token');
  });

  it('flags a forEach(async …) loop that does not await', async () => {
    const dd = makeDispatcher('ws-eval-async');
    await write(dd, 'src/sync.ts', 'export const run = (items) => items.forEach(async (it) => { await save(it); });');
    const out = await evalText(dd);
    expect(out).toContain('forEach(async');
    expect(out).toContain('Promise.all');
  });

  it('flags useEffect(async …) where React cleanup never runs', async () => {
    const dd = makeDispatcher('ws-eval-useeffect');
    await write(dd, 'src/C.tsx', 'export const C = () => { useEffect(async () => { await load(); }, []); return null; };');
    const out = await evalText(dd);
    expect(out).toContain('useEffect(async');
  });

  it('flags a new Promise(async …) executor that swallows errors', async () => {
    const dd = makeDispatcher('ws-eval-promexec');
    await write(dd, 'src/p.ts', 'export const go = () => new Promise(async (resolve) => { resolve(await fetchData()); });');
    const out = await evalText(dd);
    expect(out).toContain('async executor');
  });

  it('flags command injection from a dynamically-built shell command', async () => {
    const dd = makeDispatcher('ws-eval-cmdinj');
    await write(dd, 'src/run.ts', 'import { execSync } from "child_process";\nexport const go = (dir) => execSync(`rm -rf ${dir}`);');
    const out = await evalText(dd);
    expect(out).toContain('command-injection');
  });

  it('flags target="_blank" without rel="noopener" (reverse tabnabbing)', async () => {
    const dd = makeDispatcher('ws-eval-blank');
    await write(dd, 'src/Link.tsx', 'export const L = () => <a href="https://x.com" target="_blank">x</a>;');
    const out = await evalText(dd);
    expect(out).toContain('unsafe-target-blank');
  });

  it('flags a non-VITE_ import.meta.env reference (undefined in the browser)', async () => {
    const dd = makeDispatcher('ws-eval-viteenv');
    await write(dd, 'src/api.ts', 'export const key = import.meta.env.API_KEY;');
    const out = await evalText(dd);
    expect(out).toContain('non-VITE_ import.meta.env');
    expect(out).toContain('VITE_API_KEY');
  });

  it('skips the Vite client-env check when vite config customises envPrefix', async () => {
    const dd = makeDispatcher('ws-eval-viteenv-prefix');
    await write(dd, 'vite.config.ts', "export default { envPrefix: ['VITE_', 'APP_'] };");
    await write(dd, 'src/api.ts', 'export const key = import.meta.env.APP_KEY;');
    const out = await evalText(dd);
    expect(out).toContain('Vite client env: ✓');
  });

  it('flags a real secret committed in .env.example and blocks readiness', async () => {
    const dd = makeDispatcher('ws-eval-envtpl');
    await write(dd, '.env.example', 'OPENAI_API_KEY=sk-proj-AbCdEf0123456789ghIJklMNop');
    await write(dd, 'src/App.tsx', 'export const App = () => null;');
    const out = await evalText(dd);
    expect(out).toContain('REAL secret value');
    expect(out).toContain('NOT READY');
  });

  it('passes the env-template check when .env.example holds only placeholders', async () => {
    const dd = makeDispatcher('ws-eval-envtpl-ok');
    await write(dd, '.env.example', 'OPENAI_API_KEY=your-key-here\nDATABASE_URL=postgres://user:pass@host/db');
    const out = await evalText(dd);
    expect(out).toContain('Env template secrets: ✓');
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

  it('readiness gate pre-seeds the graph from real workspace files (scaffold/bash files become visible)', async () => {
    const ws = 'ws-preseed';
    const a = new FakeActuator();
    // Files that exist in the sandbox but were NOT written via the indexing
    // write-tools (actuator scaffold / bash-created) — so they're absent from the graph.
    a.files.set('index.html', '<!doctype html><div id="root"></div>');
    a.files.set('src/main.tsx', "import App from './App';");
    a.files.set('src/App.tsx', 'export default function App(){ return null; }');
    const s = new AgentEventStream();
    const dd = new ToolDispatcher(a, ws, new WorkspaceState(s), s);
    expect(getWorkspaceMemory(ws).graph().files).toEqual([]); // empty before the gate
    await dd.assessBuildReadiness();
    const files = getWorkspaceMemory(ws).graph().files;
    expect(files).toContain('src/App.tsx');   // import target now visible → not "unresolved"
    expect(files).toContain('src/main.tsx');
    expect(files).toContain('index.html');    // runnability no longer falsely "no index.html"
  });

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

  it('flags a javascript: URL in an href (XSS sink)', async () => {
    const dd = makeDispatcher('ws-eval-jsuri');
    await write(dd, 'src/Nav.tsx', 'export const Nav = () => <a href="javascript:doEvil()">click</a>;');
    const out = await evalText(dd);
    expect(out).toContain('javascript-uri');
  });

  it('flags a placeholder-image service left in the markup', async () => {
    const dd = makeDispatcher('ws-eval-phimg');
    await write(dd, 'src/Hero.tsx', 'export const Hero = () => <img src="https://via.placeholder.com/640" alt="h" />;');
    const out = await evalText(dd);
    expect(out).toContain('placeholder-image');
  });

  it('flags a server-only Node builtin (fs) imported by front-end code', async () => {
    const dd = makeDispatcher('ws-eval-nodebuiltin');
    await write(dd, 'src/components/Saver.tsx', "import fs from 'fs';\nexport const Saver = () => null;");
    const out = await evalText(dd);
    expect(out).toContain('break the browser build');
  });

  it('flags an icon-only <a href> link with no accessible name', async () => {
    const dd = makeDispatcher('ws-eval-linkname');
    await write(dd, 'src/Nav.tsx', 'export const N = () => <a href="/home"><svg /></a>;');
    const out = await evalText(dd);
    expect(out).toContain('link-no-accessible-name');
  });

  it('flags an <iframe> with no accessible title', async () => {
    const dd = makeDispatcher('ws-eval-iframe');
    await write(dd, 'src/Embed.tsx', 'export const E = () => <iframe src="https://x.com/v" />;');
    const out = await evalText(dd);
    expect(out).toContain('iframe-missing-title');
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

  it('missing privacy policy is ADVISORY, not a readiness blocker (the Hospital-build false block)', async () => {
    // A complete CRUD app collecting ordinary form PII (patient name/phone) with no privacy
    // policy page must NOT be hard-blocked — virtually every real app has such a form. The
    // finding is still surfaced in the compliance report as advice for a public launch.
    const dd = makeDispatcher('ws-eval-privacy');
    await write(dd, 'src/pages/Patients.tsx',
      'export function Patients(){ return <form><input name="phone" type="tel" /><input name="email" type="email" /></form>; }');
    const out = await evalText(dd);
    expect(out).toContain('missing-privacy-policy'); // honest advisory still present
    expect(out).not.toContain('serious privacy/compliance issue'); // …but never a high blocker
  });
});

describe('applyEdit (edit_file matching with whitespace-tolerant fallback)', () => {
  it('replaces an exact unique match with no note', () => {
    const r = applyEdit('const x = 1;\nconst y = 2;', 'const x = 1;', 'const x = 42;');
    expect(r.updated).toBe('const x = 42;\nconst y = 2;');
    expect(r.matchedOld).toBe('const x = 1;');
    expect(r.note).toBe('');
  });

  it('throws when an exact match is not unique', () => {
    expect(() => applyEdit('dup\ndup', 'dup', 'x')).toThrow(/not unique/);
  });

  // Connectly Edit #1 autopsy 2026-07-21: the model called edit_file with an EMPTY old_string to ADD
  // styles to Navbar.css. An empty string matches at every position → the old code threw
  // "not unique (1377 matches)" and the model flailed read→append for turns. Empty = append.
  it('APPENDS when old_string is empty (adds new_string to the end, with a separating newline)', () => {
    const r = applyEdit('.navbar { color: red; }', '', '\n.avatar { width: 32px; }');
    expect(r.updated).toBe('.navbar { color: red; }\n\n.avatar { width: 32px; }');
    expect(r.matchedOld).toBe('');
    expect(r.note).toMatch(/append/i);
  });

  it('empty old_string never throws "not unique" (the exact Connectly failure)', () => {
    expect(() => applyEdit('a'.repeat(1377), '', 'X')).not.toThrow();
  });

  it('append on a file already ending in newline does not double the newline', () => {
    expect(applyEdit('body {}\n', '', 'h1 {}').updated).toBe('body {}\nh1 {}');
  });

  it('append on an empty file is just the new content', () => {
    expect(applyEdit('', '', 'first content').updated).toBe('first content');
  });

  it('falls back to a whitespace-flexible match when exact fails', () => {
    // File has single-space indent; supplied old_string has different spacing.
    const file = 'if (a) {\n  doThing();\n}';
    const r = applyEdit(file, 'if (a) {\n      doThing();\n}', 'if (a) {\n  doOther();\n}');
    expect(r.updated).toBe('if (a) {\n  doOther();\n}');
    expect(r.note).toContain('whitespace');
    // matchedOld is the VERBATIM text from the file (real indentation), not the input.
    expect(r.matchedOld).toBe('if (a) {\n  doThing();\n}');
  });

  it('throws "not found" when neither exact nor flexible matches', () => {
    expect(() => applyEdit('abc', 'xyz', 'q')).toThrow(/not found/);
  });

  it('throws "not unique" when the flexible match is ambiguous', () => {
    // 'a + b' (single spaces) does not appear exactly, but matches BOTH
    // double-spaced occurrences under whitespace-flexible matching → ambiguous.
    const file = 'x = a  +  b\ny = a  +  b';
    expect(() => applyEdit(file, 'a + b', 'a - b')).toThrow(/not unique/);
  });

  it('does not treat regex metacharacters in old_string as patterns', () => {
    const file = 'const re = /a.+b/;\nconst ok = 1;';
    const r = applyEdit(file, 'const re = /a.+b/;', 'const re = /done/;');
    expect(r.updated).toBe('const re = /done/;\nconst ok = 1;');
    expect(r.note).toBe('');
  });

  it('inserts a `$` in new_string LITERALLY — the "editing gadbad kar deta hai" regression', () => {
    // JS String.replace treats $&, $1, $`, $', $$ in the REPLACEMENT as special patterns. new_string
    // is real code, so it must be inserted verbatim. Exact-match path (the common "clean" edit).
    const dollarAmp = applyEdit('const a = OLD;', 'OLD', 'total$&price'); // $& used to expand to the match
    expect(dollarAmp.updated).toBe('const a = total$&price;');

    const template = applyEdit('const a = OLD;', 'OLD', '`${user.name}`'); // template literal
    expect(template.updated).toBe('const a = `${user.name}`;');

    const backref = applyEdit('x = OLD', 'OLD', 'a.replace(/(\\d)/, "$1!")'); // $1 backref
    expect(backref.updated).toBe('x = a.replace(/(\\d)/, "$1!")');

    const doubleDollar = applyEdit('p(OLD)', 'OLD', 'cost$$total'); // $$ → literal $$
    expect(doubleDollar.updated).toBe('p(cost$$total)');
  });

  it('inserts a `$` LITERALLY on the whitespace-flexible path too', () => {
    // file has single-space indent; supplied old_string is differently spaced → flexible path.
    const r = applyEdit('fn(a) {\n  OLD;\n}', 'fn(a) {\n      OLD;\n}', 'fn(a) {\n  x = `${v}`;\n}');
    expect(r.updated).toBe('fn(a) {\n  x = `${v}`;\n}');
  });

  // Deep-test build #5: a drift-miss on a LARGE file must point the model at its TARGET region, not the
  // file head — so recovery costs one retry, not an extra read_file + a re-drifted retry (step-burn).
  it('a "not found" error on a large file previews the TARGET region, not just the file head', () => {
    const lines: string[] = [];
    lines.push("import { useState } from 'react'");
    for (let i = 0; i < 400; i++) lines.push(`  const filler_${i} = ${i};`);
    lines.push('  const categoryTotals = expenses.reduce((acc, e) => {'); // distinctive target line (~line 402)
    lines.push('    acc[e.category] = (acc[e.category] || 0) + e.amount;');
    lines.push('    return acc;');
    lines.push('  }, {} as Record<string, number>);');
    for (let i = 0; i < 200; i++) lines.push(`  const tail_${i} = ${i};`);
    const file = lines.join('\n');
    // Multi-line old_string (the real build #5 pattern): the model KEPT the distinctive opening line but
    // its remembered body drifted → exact + whitespace-flexible both miss, but the anchor line still locates it.
    const drifted = [
      '  const categoryTotals = expenses.reduce((acc, e) => {',
      '    acc[e.category] = acc[e.category] + e.amount; // DRIFTED body',
      '  }, {});',
    ].join('\n');
    let msg = '';
    try { applyEdit(file, drifted, 'x', 'App.tsx'); } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/not found in App\.tsx/);
    expect(msg).toContain('categoryTotals');        // the real current region is shown…
    expect(msg).not.toContain("import { useState }"); // …and the useless file head is NOT what we showed
    expect(msg).toMatch(/around your closest match \(lines \d+-\d+/);
  });
});

describe('nearestEditRegion — anchored edit-miss preview (build #5 step-burn fix)', () => {
  it('anchors to the closest distinctive line and states the line range', () => {
    const file = Array.from({ length: 50 }, (_, i) => i === 30 ? '  const specialAnchorToken = compute();' : `  line ${i}`).join('\n');
    const out = nearestEditRegion(file, '  const specialAnchorToken = compute();', 5);
    expect(out).toContain('specialAnchorToken');
    expect(out).toMatch(/lines 2[0-9]-3[0-9]/);       // a window centred on line 31 (1-indexed)
    expect(out).not.toContain('line 5');              // far-away head lines are excluded
  });
  it('falls back to an HONESTLY-labelled head when the target is nowhere in the file', () => {
    const out = nearestEditRegion('const a = 1;\nconst b = 2;', 'totally different content that does not exist');
    expect(out).toMatch(/top of file — your target text was not located/);
  });
  it('produces a copy-safe block (no line-number prefixes inside the fence)', () => {
    const file = 'alpha\nbeta\n  const targetLineHere = 1;\ngamma\ndelta';
    const out = nearestEditRegion(file, '  const targetLineHere = 1;', 2);
    const fenced = out.split('```')[1];
    expect(fenced).toContain('const targetLineHere = 1;');
    expect(fenced).not.toMatch(/^\s*\d+\t/m);          // no "12\t<code>" prefixes that could contaminate a copy
  });
});

describe('ToolDispatcher — secret redaction on the user-visible event surface (R1.1)', () => {
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

  it('redacts a secret in bash stdout from BOTH the tool_result summary and the model content (T1-sec-redact)', async () => {
    // Command output is never an edit_file match source, so — unlike read_file content — it is safe to
    // mask in the model-facing content too. This closes the transcript leak the R1.1 surface-only
    // redaction left open (a secret printed by `printenv`/`cat .env` used to persist in the transcript).
    const secret = 'sk-ant-api03-' + 'A'.repeat(30);
    act.commandResult = { exitCode: 0, stdout: `ANTHROPIC_API_KEY=${secret}`, stderr: '' };
    const res = await d.dispatch(call('bash', { command: 'printenv ANTHROPIC_API_KEY' }));

    const result = events.find((e) => e.type === 'tool_result');
    // User-visible summary must NOT contain the raw secret.
    expect(result && 'summary' in result ? (result as { summary: string }).summary : '').not.toContain(secret);
    expect(result && 'summary' in result ? (result as { summary: string }).summary : '').toContain('[REDACTED:');
    // Model-facing content is now ALSO redacted — the secret never reaches the persisted transcript.
    expect(res.content).not.toContain(secret);
    expect(res.content).toContain('[REDACTED:');
  });

  it('redacts a secret inlined in the tool_call input shown to the user', async () => {
    const secret = 'ghp_' + 'b'.repeat(36);
    await d.dispatch(call('bash', { command: `git remote set-url origin https://${secret}@github.com/x/y.git` }));
    const callEvt = events.find((e) => e.type === 'tool_call') as { input?: { command?: string } } | undefined;
    expect(callEvt?.input?.command ?? '').not.toContain(secret);
    expect(callEvt?.input?.command ?? '').toContain('[REDACTED:');
  });
});

describe('boundedWholeFileDiff (E7 — live diff for write_file, bounded)', () => {
  it('a create (empty old) shows additions only', () => {
    const d = boundedWholeFileDiff('', 'line1\nline2');
    expect(d).toBe('+ line1\n+ line2');
    expect(d).not.toContain('- ');
  });
  it('a wholesale rewrite shows removed then added', () => {
    const d = boundedWholeFileDiff('old1\nold2', 'new1');
    expect(d).toBe('- old1\n- old2\n+ new1');
  });
  it('caps each side at maxLines with a "N more lines" note (no unbounded payload)', () => {
    const big = Array.from({ length: 500 }, (_, i) => `l${i}`).join('\n');
    const d = boundedWholeFileDiff('', big, 160);
    const plusLines = d.split('\n').filter((l) => l.startsWith('+ '));
    expect(plusLines).toHaveLength(160);
    expect(d).toContain('340 more lines');
  });
  it('singular "1 more line" at the exact boundary', () => {
    const big = Array.from({ length: 161 }, (_, i) => `l${i}`).join('\n');
    expect(boundedWholeFileDiff('', big, 160)).toContain('(1 more line)');
  });
});

describe('ToolDispatcher — evaluate integration (AST build-breakers → readiness gate)', () => {
  function makeDispatcher(ws: string): ToolDispatcher {
    const a = new FakeActuator();
    const s = new AgentEventStream();
    return new ToolDispatcher(a, ws, new WorkspaceState(s), s);
  }
  const evalText = async (dd: ToolDispatcher): Promise<string> =>
    (await dd.dispatch(call('evaluate', {}))).content;
  const write = (dd: ToolDispatcher, path: string, content: string) =>
    dd.dispatch(call('write_file', { path, content }));

  it('BLOCKS readiness on a React Rules-of-Hooks violation (conditional hook)', async () => {
    const dd = makeDispatcher('ws-eval-hooks');
    await write(dd, 'package.json', JSON.stringify({ dependencies: { react: '^18' } }));
    await write(dd, 'src/App.tsx', "import { useState } from 'react';\nexport function App({ on }) {\n  if (on) { const [v] = useState(0); }\n  return null;\n}\n");
    const out = await evalText(dd);
    expect(out).toContain('Rules-of-Hooks violation');
    expect(out).toContain('NOT READY');
  });

  it('BLOCKS readiness on an undefined JSX component', async () => {
    const dd = makeDispatcher('ws-eval-jsx');
    await write(dd, 'package.json', JSON.stringify({ dependencies: { react: '^18' } }));
    await write(dd, 'src/App.tsx', 'export function App() { return <Ghost />; }');
    const out = await evalText(dd);
    expect(out).toContain('undefined JSX component');
    expect(out).toContain('NOT READY');
  });

  it('BLOCKS readiness on a broken import (name not exported)', async () => {
    const dd = makeDispatcher('ws-eval-import');
    await write(dd, 'package.json', JSON.stringify({ dependencies: {} }));
    await write(dd, 'src/util.ts', 'export const add = 1;');
    await write(dd, 'src/App.tsx', "import { subtract } from './util';\nexport const v = subtract;\n");
    const out = await evalText(dd);
    expect(out).toContain('broken import');
    expect(out).toContain('NOT READY');
  });

  it('AUTO-FIXES a named import of a default export (the recurring test-file bug) so it does NOT block', async () => {
    // Root cause fae70e42/Notes/Car/Watch: generated test files do `import { App } from './App'` for a
    // DEFAULT-exported App → readiness NOT READY (ok:false). The deterministic reconciler must rewrite
    // it to a default import at the gate, clearing the false blocker AND persisting the corrected file.
    const dd = makeDispatcher('ws-eval-import-autofix');
    await write(dd, 'package.json', JSON.stringify({ dependencies: { react: '^18' } }));
    await write(dd, 'src/App.tsx', 'export default function App() { return null; }\n');
    await write(dd, 'src/App.test.tsx', "import { App } from './App';\nexport const t = App;\n");
    const out = await evalText(dd);
    expect(out).not.toContain('broken import'); // the blocker is auto-repaired, not raised
    // The corrected import is persisted through the actuator (durable write path).
    const fixed = (await dd.dispatch(call('read_file', { path: 'src/App.test.tsx' }))).content;
    expect(fixed).toContain("import App from './App'");
    expect(fixed).not.toContain('{ App }');
  });

  it('still BLOCKS a genuinely-missing named import (reconciler does not over-reach)', async () => {
    // A name that is exported NEITHER as named NOR default has no safe reconciliation — it must stay a
    // real blocker so the agent fixes it (the reconciler only touches unambiguous named<->default swaps).
    const dd = makeDispatcher('ws-eval-import-nofix');
    await write(dd, 'package.json', JSON.stringify({ dependencies: {} }));
    await write(dd, 'src/util.ts', 'export const add = 1;');
    await write(dd, 'src/App.tsx', "import { subtract } from './util';\nexport const v = subtract;\n");
    const out = await evalText(dd);
    expect(out).toContain('broken import');
    expect(out).toContain('NOT READY');
  });

  it('BLOCKS readiness on a hook called but never imported', async () => {
    const dd = makeDispatcher('ws-eval-undefhook');
    await write(dd, 'package.json', JSON.stringify({ dependencies: { react: '^18' } }));
    await write(dd, 'src/App.tsx', 'export function App() { const [v] = useState(0); return v; }');
    const out = await evalText(dd);
    expect(out).toContain('never imported/defined');
    expect(out).toContain('NOT READY');
  });

  it('BLOCKS readiness on a react/react-dom major mismatch (dependency conflict)', async () => {
    const dd = makeDispatcher('ws-eval-depconflict');
    await write(dd, 'package.json', JSON.stringify({ dependencies: { react: '^18.2.0', 'react-dom': '^17.0.2' } }));
    await write(dd, 'src/App.tsx', "import { useState } from 'react';\nexport function App() { const [v] = useState(0); return v; }\n");
    const out = await evalText(dd);
    expect(out).toContain('Dependency conflict');
    expect(out).toContain('NOT READY');
  });

  it('does NOT introduce these blockers for a clean React app (no false-block)', async () => {
    const dd = makeDispatcher('ws-eval-clean');
    await write(dd, 'package.json', JSON.stringify({ dependencies: { react: '^18' } }));
    await write(dd, 'src/App.tsx', "import { useState } from 'react';\nexport function App() {\n  const [v, setV] = useState(0);\n  return <button onClick={() => setV(v + 1)}>{v}</button>;\n}\n");
    const out = await evalText(dd);
    expect(out).not.toContain('Rules-of-Hooks violation');
    expect(out).not.toContain('undefined JSX component');
    expect(out).not.toContain('broken import');
    expect(out).not.toContain('never imported/defined');
  });

  it('framework-gates the React analyzers — a Nuxt app is NOT falsely blocked (ShopSphere autopsy)', async () => {
    // ShopSphere (App #12, Nuxt): a Nuxt `useProducts()` AUTO-IMPORTED composable was flagged "hook called
    // but never imported" and its `useX` composables as "Rules-of-Hooks violations" → the readiness gate
    // FAILED an otherwise-correct build. These analyzers are React-only; a Nuxt dispatcher must not raise them.
    // (act, ws, state, stream, then 7 undefined ctor args, then framework='nuxt'.)
    const a = new FakeActuator();
    const s = new AgentEventStream();
    const dd = new ToolDispatcher(a, 'ws-eval-nuxt', new WorkspaceState(s), s, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'nuxt');
    await write(dd, 'package.json', JSON.stringify({ dependencies: { nuxt: '^3' } }));
    // Same shapes that trip the React analyzers: an unimported `useX()` call + a bare component tag.
    await write(dd, 'pages/index.vue', '<script setup>\nconst products = useProducts();\nif (products) { const x = useState(0); }\n</script>');
    const out = await evalText(dd);
    expect(out).not.toContain('Rules-of-Hooks violation');
    expect(out).not.toContain('never imported/defined');
    expect(out).not.toContain('undefined JSX component');
  });
});

// Slice 4 (2026-07-17) — endgameIo.runTsc uses INCREMENTAL tsc (cache in /tmp, never the workspace)
// so trend-checkpoint peeks and endgame re-verifies are near-free after the first run. Watch-mode was
// deliberately rejected: a watcher log read mid-recompile reports a stale verdict.
describe('ToolDispatcher.endgameIo — incremental tsc', () => {
  it('runs tsc with --incremental and keeps the cache OUT of the workspace (/tmp)', async () => {
    const act = new FakeActuator();
    const commands: string[] = [];
    act.runCommand = async (_w: string, command: string) => { commands.push(command); return { exitCode: 0, stdout: 'ok', stderr: '' }; };
    const d = new ToolDispatcher(act, 'ws-1', undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'vite-react');
    await d.endgameIo().runTsc();
    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain('--incremental');
    expect(commands[0]).toContain('--tsBuildInfoFile /tmp/agentv3.tsbuildinfo');
    expect(commands[0]).toContain('--noEmit');
  });
});

// ShopKhata autopsy 2026-07-17: prisma generate failed 3× (and seed 2×) on an LLM-written
// HALF-relation — an error whose own message says "run `prisma format`". The dispatcher now does
// exactly that, once, and retries — deterministically, before any LLM round is burned.
describe('bash — prisma relation self-heal (format + one retry)', () => {
  const P1012 = `Error: Prisma schema validation - (get-dmmf wasm)
Error code: P1012
error: Error validating field \`user\` in model \`Order\`: The relation field \`user\` on model \`Order\` is missing an opposite relation field on the model \`User\`. Either run \`prisma format\` or add it manually.`;

  function healDispatcher() {
    const act = new FakeActuator();
    act.files.set('backend/prisma/schema.prisma', 'model Order { user User? }');
    const stream = new AgentEventStream();
    const state = new WorkspaceState(stream);
    const d = new ToolDispatcher(act, 'ws-heal', state, stream);
    return { act, d };
  }

  it('runs prisma format and retries once on the exact ShopKhata validation failure', async () => {
    const { act, d } = healDispatcher();
    const results = [
      { exitCode: -1, stdout: '', stderr: P1012 },          // original generate fails
      { exitCode: 0, stdout: 'formatted', stderr: '' },      // prisma format succeeds
      { exitCode: 0, stdout: 'Generated Prisma Client', stderr: '' }, // retry succeeds
    ];
    act.runCommand = async (_ws: string, command: string) => {
      act.commands.push(command);
      return results[Math.min(act.commands.length - 1, results.length - 1)];
    };
    const out = await d.dispatch(call('bash', { command: 'cd backend && npx --no-install prisma generate' }), 'backend');
    expect(String(out.content)).toContain('exit=0');
    expect(String(out.content)).toContain('Generated Prisma Client');
    expect(act.commands[1]).toContain('prisma format');
    expect(act.commands[1]).toContain('cd backend');
    expect(act.commands[2]).toBe('cd backend && npx --no-install prisma generate'); // original retried verbatim
  });

  it('any OTHER failure never triggers the heal (no blind retries)', async () => {
    const { act, d } = healDispatcher();
    act.commandResult = { exitCode: 1, stdout: '', stderr: 'ENOENT: no such file' };
    const out = await d.dispatch(call('bash', { command: 'cd backend && npx --no-install prisma generate' }), 'backend');
    expect(String(out.content)).toContain('exit=1');
    expect(act.commands.filter((c) => c.includes('prisma format'))).toHaveLength(0);
  });
});

// SaaS-dashboard autopsy 2026-07-22: a weak build's login/useAuth debug-logged the password
// (`console.log('login', email, password)`). That single pii-in-logs line is the readiness gate's ONLY
// high-severity privacy/compliance HARD block, so a complete, rendering app was marked NOT READY / failed.
// The dispatcher now redacts credential-logging console statements BEFORE the gate scans (heal-then-judge),
// so the leak is gone AND the block is cleared — a real security fix, not a cosmetic patch.
describe('healCredentialLogs — heal-then-judge credential-in-logs before the readiness gate', () => {
  function healDispatcher() {
    const act = new FakeActuator();
    const stream = new AgentEventStream();
    const state = new WorkspaceState(stream);
    const d = new ToolDispatcher(act, 'ws-cred-heal', state, stream);
    return { act, d };
  }

  it('redacts the leaked password log and persists it, leaving real logic intact', async () => {
    const { act, d } = healDispatcher();
    act.files.set(
      'src/hooks/useAuth.ts',
      `export function useAuth() {\n  const login = (email, password) => {\n    console.log('login', email, password);\n    return api.login(email, password);\n  };\n  return { login };\n}`,
    );
    const note = await d.healCredentialLogs();
    expect(note).toContain('Redacted');
    const healed = act.files.get('src/hooks/useAuth.ts')!;
    expect(healed).toContain('console.log();');          // leak stripped
    expect(healed).not.toMatch(/console\.log\([^)]*password/); // no credential arg left
    expect(healed).toContain('return api.login(email, password);'); // real logic untouched
  });

  it('is a no-op (empty note, no write) on a clean project', async () => {
    const { act, d } = healDispatcher();
    act.files.set('src/App.tsx', `export default function App() { console.log('mounted'); return null; }`);
    const before = act.files.get('src/App.tsx');
    expect(await d.healCredentialLogs()).toBe('');
    expect(act.files.get('src/App.tsx')).toBe(before);
  });

  it('honours the AGENTV3_CRED_LOG_GUARD=off kill switch', async () => {
    const { act, d } = healDispatcher();
    act.files.set('src/a.ts', `console.log('secret', s);`);
    const prev = process.env.AGENTV3_CRED_LOG_GUARD;
    process.env.AGENTV3_CRED_LOG_GUARD = 'off';
    try {
      expect(await d.healCredentialLogs()).toBe('');
      expect(act.files.get('src/a.ts')).toBe(`console.log('secret', s);`);
    } finally {
      if (prev === undefined) delete process.env.AGENTV3_CRED_LOG_GUARD; else process.env.AGENTV3_CRED_LOG_GUARD = prev;
    }
  });
});

// TaskForge fresh-build autopsy 2026-07-18: a seed step (`prisma db seed` / `tsx prisma/seed.ts`) that
// runs BEFORE `prisma generate` fails with "@prisma/client did not initialize yet — run `prisma generate`".
// TaskForge looped this and burned wall-clock budget. The dispatcher now runs `prisma generate` once and
// retries the seed — deterministically, before any LLM round.
describe('bash — prisma client-not-generated self-heal (generate + one retry)', () => {
  const NOT_GENERATED = `Error: @prisma/client did not initialize yet. Please run "prisma generate" and try to import it again.`;

  function healDispatcher() {
    const act = new FakeActuator();
    const stream = new AgentEventStream();
    const state = new WorkspaceState(stream);
    const d = new ToolDispatcher(act, 'ws-heal-gen', state, stream);
    return { act, d };
  }

  it('runs prisma generate and retries once when the client was not generated before seeding', async () => {
    const { act, d } = healDispatcher();
    const results = [
      { exitCode: 1, stdout: '', stderr: NOT_GENERATED },              // seed fails: client not generated
      { exitCode: 0, stdout: 'Generated Prisma Client', stderr: '' },   // prisma generate succeeds
      { exitCode: 0, stdout: 'Seeded 3 users', stderr: '' },            // retry seed succeeds
    ];
    act.runCommand = async (_ws: string, command: string) => {
      act.commands.push(command);
      return results[Math.min(act.commands.length - 1, results.length - 1)];
    };
    const out = await d.dispatch(call('bash', { command: 'cd backend && npx tsx prisma/seed.ts' }), 'backend');
    expect(String(out.content)).toContain('exit=0');
    expect(String(out.content)).toContain('Seeded 3 users');
    expect(act.commands[1]).toContain('prisma generate');
    expect(act.commands[1]).toContain('cd backend');
    expect(act.commands[2]).toBe('cd backend && npx tsx prisma/seed.ts'); // original seed retried verbatim
  });

  it('does NOT self-heal a `prisma generate` command itself (would loop)', async () => {
    const { act, d } = healDispatcher();
    act.commandResult = { exitCode: 1, stdout: '', stderr: NOT_GENERATED };
    const out = await d.dispatch(call('bash', { command: 'cd backend && npx prisma generate' }), 'backend');
    expect(String(out.content)).toContain('exit=1');
    // Only the original command ran — no extra `prisma generate` was injected.
    expect(act.commands).toHaveLength(1);
  });

  it('any OTHER seed failure never triggers the generate heal', async () => {
    const { act, d } = healDispatcher();
    act.commandResult = { exitCode: 1, stdout: '', stderr: 'SyntaxError: Unexpected token in seed.ts' };
    const out = await d.dispatch(call('bash', { command: 'cd backend && npx tsx prisma/seed.ts' }), 'backend');
    expect(String(out.content)).toContain('exit=1');
    expect(act.commands.filter((c) => c.includes('prisma generate'))).toHaveLength(0);
  });
});

describe('user vault secrets reach the app (mitrify autopsy 2026-08-04)', () => {
  // The admin's question: "agar user keys daal bhi de, to kya app un keys ko padh payega?"
  // The keys were stored correctly and the dev server sources .env correctly — but on a managed-preview
  // path the .env was never written, so the two were never introduced.
  let act: FakeActuator;
  let dd: ToolDispatcher;

  beforeEach(() => {
    act = new FakeActuator();
    dd = new ToolDispatcher(act, 'ws-1', new WorkspaceState(), new AgentEventStream());
  });

  it('writes the saved keys into .env when explicitly driven — no run_command needed', async () => {
    dd.setUserSecrets({ RAZORPAY_KEY_ID: 'rzp_live_x', SMTP_HOST: 'smtp.gmail.com' });
    await dd.ensureUserSecretsEnvFile(ALWAYS_WRITE_SECRETS);
    const env = act.files.get('.env') ?? '';
    expect(env).toContain('RAZORPAY_KEY_ID=rzp_live_x');
    expect(env).toContain('SMTP_HOST=smtp.gmail.com');
  });

  it('keeps .env out of git, so the user keys can never reach their repo', async () => {
    dd.setUserSecrets({ STRIPE_SECRET_KEY: 'sk_live_x' });
    await dd.ensureUserSecretsEnvFile(ALWAYS_WRITE_SECRETS);
    expect(act.files.get('.gitignore') ?? '').toMatch(/(^|\n)\.env/);
  });

  it('preserves the app\'s existing .env lines and lets the vault win on a conflict', async () => {
    act.files.set('.env', 'PORT=3000\nRAZORPAY_KEY_ID=placeholder\n');
    dd.setUserSecrets({ RAZORPAY_KEY_ID: 'rzp_live_real' });
    await dd.ensureUserSecretsEnvFile(ALWAYS_WRITE_SECRETS);
    const env = act.files.get('.env') ?? '';
    expect(env).toContain('PORT=3000');               // untouched
    expect(env).toContain('RAZORPAY_KEY_ID=rzp_live_real');
    expect(env).not.toContain('placeholder');
  });

  it('an empty vault writes nothing at all (no stray .env on a keyless app)', async () => {
    dd.setUserSecrets({});
    await dd.ensureUserSecretsEnvFile(ALWAYS_WRITE_SECRETS);
    expect(act.files.has('.env')).toBe(false);
  });

  it('still ignores a command that is not an app command (the lazy gate is intact)', async () => {
    dd.setUserSecrets({ API_TOKEN: 't' });
    await dd.ensureUserSecretsEnvFile('ls -la');
    expect(act.files.has('.env')).toBe(false);
    await dd.ensureUserSecretsEnvFile('npm run dev');
    expect(act.files.get('.env') ?? '').toContain('API_TOKEN=t');
  });

  it('a NEW secret set can still reach disk after an earlier write', async () => {
    dd.setUserSecrets({ A_KEY: '1' });
    await dd.ensureUserSecretsEnvFile(ALWAYS_WRITE_SECRETS);
    dd.setUserSecrets({ A_KEY: '1', B_KEY: '2' });
    await dd.ensureUserSecretsEnvFile(ALWAYS_WRITE_SECRETS);
    expect(act.files.get('.env') ?? '').toContain('B_KEY=2');
  });
});
