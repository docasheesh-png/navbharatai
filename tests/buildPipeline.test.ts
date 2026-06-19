import { describe, it, expect, vi } from 'vitest';
import { runBuild } from '../src/server/project/BuildPipeline';
import type { FileEdit } from '../src/server/project/EditEngine';

describe('runBuild', () => {
  it('generates files from a prompt and returns a clean project', async () => {
    const generate = vi.fn(async () => [
      { op: 'write', path: 'index.html', content: '<h1>Todo App</h1><script src="app.js"></script>' },
      { op: 'write', path: 'app.js', content: 'console.log("todo")' },
    ] as FileEdit[]);
    const fix = vi.fn(async () => [] as FileEdit[]);

    // scaffold:false → test the pure generation path (no skeleton seeding)
    const r = await runBuild({ prompt: 'make a todo app', generate, fix, scaffold: false });
    expect(r.ok).toBe(true);
    expect(r.applied).toBe(2);
    expect(r.fileCount).toBe(2);
    expect(r.files['index.html']).toContain('Todo App');
    expect(fix).not.toHaveBeenCalled(); // already clean → no repair needed
    expect(r.baselineSnapshotId).toBeTruthy();
  });

  it('seeds a runnable framework skeleton for a fresh build (scaffold default)', async () => {
    // generator adds nothing; the scaffold alone must produce a clean project
    const r = await runBuild({ prompt: 'a react dashboard', generate: async () => [], fix: async () => [] });
    expect(r.scaffolded).toBe('vite-react');
    expect(r.files['src/main.jsx']).toBeTruthy();
    expect(r.files['package.json']).toBeTruthy();
    expect(r.ok).toBe(true); // skeleton verifies clean (no dangling refs)
  });

  it('does not scaffold when editing an existing project', async () => {
    const r = await runBuild({
      prompt: 'tweak it',
      files: { 'index.html': '<h1>mine</h1>' },
      generate: async () => [], fix: async () => [],
    });
    expect(r.scaffolded).toBeUndefined();
    expect(r.fileCount).toBe(1);
  });

  it('skips the feature-completion loop when isEdit is true', async () => {
    // On an edit, completeFeatures must NOT run (it would treat the edit
    // instruction as a feature spec and could undo the change).
    const completeFeatures = vi.fn(async () => [] as FileEdit[]);
    const generate = async (): Promise<FileEdit[]> => [
      { op: 'patch', path: 'index.html', find: 'mine', replace: 'yours' },
    ];
    const r = await runBuild({
      prompt: 'rename the heading',
      files: { 'index.html': '<h1>mine</h1>' },
      generate, fix: async () => [], completeFeatures,
      isEdit: true, modular: true,
    });
    expect(completeFeatures).not.toHaveBeenCalled();
    expect(r.files['index.html']).toContain('yours');
  });

  it('auto-repairs a broken generation before returning', async () => {
    // generation writes invalid JSON; the fixer corrects it
    const generate = async (): Promise<FileEdit[]> => [
      { op: 'write', path: 'index.html', content: '<h1>x</h1>' },
      { op: 'write', path: 'config.json', content: '{ broken json' },
    ];
    const fix = vi.fn(async () => [{ op: 'write', path: 'config.json', content: '{"ok":true}' }] as FileEdit[]);

    const r = await runBuild({ prompt: 'app with config', generate, fix });
    expect(r.ok).toBe(true);
    expect(r.repairAttempts).toBe(1);
    expect(fix).toHaveBeenCalledOnce();
    expect(r.files['config.json']).toBe('{"ok":true}');
  });

  it('edits existing files without losing unrelated ones', async () => {
    const generate = async (): Promise<FileEdit[]> => [
      { op: 'patch', path: 'app.js', find: 'v1', replace: 'v2' },
    ];
    const r = await runBuild({
      prompt: 'bump version',
      files: { 'index.html': '<h1>app</h1>', 'app.js': 'const v="v1"', 'keep.js': 'KEEP' },
      generate, fix: async () => [],
    });
    expect(r.files['app.js']).toBe('const v="v2"');
    expect(r.files['keep.js']).toBe('KEEP'); // untouched
    expect(r.files['index.html']).toContain('app');
  });

  it('reports not-ok when repair cannot fix the project', async () => {
    const generate = async (): Promise<FileEdit[]> => [{ op: 'write', path: 'bad.json', content: '{ nope' }];
    const r = await runBuild({ prompt: 'x', generate, fix: async () => [] });
    expect(r.ok).toBe(false);
    expect(r.verify.errors).toBeGreaterThan(0);
  });

  it('modular mode implements ONE module per call with live progress events', async () => {
    const prompt = 'app with authentication, a dashboard, and dark mode';
    const generate = async (): Promise<FileEdit[]> => [
      { op: 'write', path: 'index.html', content: '<div id="root"></div><script type="module" src="/src/main.jsx"></script>' },
      { op: 'write', path: 'src/main.jsx', content: "import {createRoot} from 'react-dom/client';\nimport App from './App.jsx';\ncreateRoot(document.getElementById('root')).render(<App/>)" },
      { op: 'write', path: 'src/App.jsx', content: 'export default function App(){ return null; }' },
    ];
    const sig: Record<string, string> = { 'Authentication': 'login auth password session', 'Dashboard': 'dashboard', 'Dark / Light theme': 'theme darkMode toggleTheme' };
    let calls = 0;
    const completeFeatures = async (_p: string, missing: string[]): Promise<FileEdit[]> => {
      calls++;
      const m = missing[0]; // modular → exactly one
      return [{ op: 'write', path: `src/feat${calls}.jsx`, content: `// ${sig[m] || m}\nexport default ()=>null;` }];
    };
    const events: any[] = [];
    const r = await runBuild({
      prompt, scaffold: false, generate, fix: async () => [], completeFeatures,
      modular: true, onProgress: (e) => events.push(e),
      files: { 'package.json': JSON.stringify({ dependencies: { react: '^18', 'react-dom': '^18' } }) },
    });
    // one module per call (not all-at-once)
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(r.validation.featureCoverage!.coverage).toBeGreaterThanOrEqual(80);
    expect(events.some((e) => e.type === 'module' && e.state === 'done')).toBe(true);
    expect(events.some((e) => e.type === 'status')).toBe(true);
  });

  it('agentically completes missing features until coverage passes', async () => {
    const prompt = 'a react app with authentication, a dashboard, and dark mode';
    // Initial generation = a shell (no features) → coverage 0 → preview blocked.
    const generate = async (): Promise<FileEdit[]> => [
      { op: 'write', path: 'index.html', content: '<div id="root"></div><script type="module" src="/src/main.jsx"></script>' },
      { op: 'write', path: 'src/main.jsx', content: "import {createRoot} from 'react-dom/client';\nimport App from './App.jsx';\ncreateRoot(document.getElementById('root')).render(<App/>)" },
      { op: 'write', path: 'src/App.jsx', content: 'export default function App(){ return null; }' },
    ];
    // completeFeatures implements the missing features when asked.
    const completeFeatures = async (): Promise<FileEdit[]> => [
      { op: 'write', path: 'src/App.jsx', content: "// auth login password session, dashboard, theme darkMode toggleTheme\nexport default function App(){ return null; }" },
    ];
    const r = await runBuild({
      prompt, scaffold: false, generate, fix: async () => [], completeFeatures,
      files: { 'package.json': JSON.stringify({ dependencies: { react: '^18', 'react-dom': '^18' } }) },
    });
    expect(r.validation.featureCoverage!.coverage).toBeGreaterThanOrEqual(80);
    expect(r.previewAllowed).toBe(true);
  });
});
