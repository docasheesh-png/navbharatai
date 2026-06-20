import { describe, it, expect } from 'vitest';
import { VfsActuator } from '../src/server/EngineerAI/actuators/VfsActuator';
import { ProAgentRouter } from '../src/server/EngineerAI/AI/ProAgentRouter';
import { runProEngine, selectTier } from '../src/server/EngineerAI/ProEngineRunner';
import { VirtualFileSystem } from '../src/server/project/ProjectModel';
import type { BuildProgressEvent } from '../src/server/project/BuildPipeline';

describe('VfsActuator (Tier 0)', () => {
  it('writes, reads, lists and searches over the VFS', async () => {
    const vfs = new VirtualFileSystem();
    const a = new VfsActuator(vfs);
    await a.writeFile('w', 'src/app.tsx', 'export const App = () => <div>hi needle</div>;');
    expect(await a.readFile('w', 'src/app.tsx')).toContain('needle');
    expect(await a.listFiles()).toEqual(['src/app.tsx']);
    expect(await a.searchFiles('w', ['needle'])).toEqual(['src/app.tsx']);
    expect(await a.searchFiles('w', ['nomatch'])).toEqual([]);
  });

  it('readFile throws on missing file', async () => {
    const a = new VfsActuator(new VirtualFileSystem());
    await expect(a.readFile('w', 'nope.ts')).rejects.toThrow();
  });

  it('checkpoint + restore round-trips the workspace', async () => {
    const vfs = new VirtualFileSystem();
    const a = new VfsActuator(vfs);
    await a.writeFile('w', 'a.txt', 'original');
    const id = await a.checkpoint('w');
    await a.writeFile('w', 'a.txt', 'changed');
    await a.writeFile('w', 'b.txt', 'new');
    await a.restore('w', id);
    expect(await a.readFile('w', 'a.txt')).toBe('original');
    expect(await a.listFiles()).toEqual(['a.txt']);
  });

  it('build() maps the static gate: pass on clean, fail on broken syntax', async () => {
    const ok = new VfsActuator(VirtualFileSystem.fromRecord({
      'index.html': '<!doctype html><html><body><script src="app.js"></script></body></html>',
      'app.js': 'const x = 1; console.log(x);',
    }));
    expect((await ok.build()).success).toBe(true);

    const broken = new VfsActuator(VirtualFileSystem.fromRecord({
      'index.html': '<!doctype html><html><body><script src="app.js"></script></body></html>',
      'app.js': 'const x = (((;',
    }));
    const res = await broken.build();
    expect(res.success).toBe(false);
    expect(res.logs).toMatch(/SYNTAX|ERROR/);
  });

  it('sandbox-only methods degrade gracefully and never throw', async () => {
    const a = new VfsActuator(new VirtualFileSystem());
    await expect(a.runCommand('w', 'rm -rf /')).resolves.toMatchObject({ exitCode: 0 });
    await expect(a.runCommand('w', 'git status')).resolves.toMatchObject({ exitCode: 0 });
    await expect(a.screenshot()).resolves.toMatchObject({ base64: '', mimeType: 'image/png' });
    await expect(a.browserAction()).resolves.toMatchObject({ screenshot: '' });
    await expect(a.getConsoleErrors()).resolves.toEqual({ errors: [] });
    expect(await a.getSandboxId()).toBeNull();
    expect(await a.pauseSandbox()).toBe(false);
  });

  it('runCommand routes build-like commands through the static gate', async () => {
    const a = new VfsActuator(VirtualFileSystem.fromRecord({ 'app.js': 'const x = (((;' }));
    const r = await a.runCommand('w', 'npm run build');
    expect(r.exitCode).toBe(1);
  });

  it('provisionBackend and downloadDistFiles reject (require a sandbox tier)', async () => {
    const a = new VfsActuator(new VirtualFileSystem());
    await expect(a.provisionBackend('w', ['db'])).rejects.toThrow();
    await expect(a.downloadDistFiles('w')).rejects.toThrow();
  });
});

describe('ProAgentRouter', () => {
  it('delegates to the injected ModelCall, bypassing the shared router gate', async () => {
    const calls: Array<{ system: string; user: string }> = [];
    const r = new ProAgentRouter(async (system, user) => { calls.push({ system, user }); return 'OUTPUT'; });
    expect(await r.hasHealthyProvider()).toBe(true);
    const { response, telemetry } = await r.route('the-prompt', 'the-system');
    expect(response.content).toBe('OUTPUT');
    expect(response.provider).toBe('PRO');
    expect(telemetry.success).toBe(true);
    expect(calls[0]).toEqual({ system: 'the-system', user: 'the-prompt' });
  });
});

describe('selectTier', () => {
  it('clamps everything to vfs in Phase 1', () => {
    const big = new VirtualFileSystem();
    for (let i = 0; i < 500; i++) big.write(`f${i}.ts`, 'x'.repeat(10_000));
    expect(selectTier(big, true)).toBe('vfs');
  });

  it('escalates by size/needs when unclamped', () => {
    const small = VirtualFileSystem.fromRecord({ 'index.html': '<html></html>', 'app.js': 'const x=1;' });
    expect(selectTier(small, false)).toBe('vfs');

    const server = VirtualFileSystem.fromRecord({
      'package.json': JSON.stringify({ dependencies: { express: '^4' } }),
      'server.js': 'const e = require("express")();',
    });
    expect(selectTier(server, false)).toBe('cloudrun');

    const huge = new VirtualFileSystem();
    for (let i = 0; i < 200; i++) huge.write(`f${i}.ts`, 'const x=1;');
    expect(selectTier(huge, false)).toBe('e2b');
  });
});

describe('runProEngine (end-to-end, VFS tier)', () => {
  // A scripted model: step 1 edits a file, step 2 finishes. The loop calls the
  // model once per step; we reply with one ReAct action each time.
  function scriptedModel(actions: string[]): (s: string, u: string) => Promise<string> {
    let i = 0;
    return async () => actions[Math.min(i++, actions.length - 1)];
  }

  it('produces usable files when the agent edits then finishes', async () => {
    const events: BuildProgressEvent[] = [];
    const model = scriptedModel([
      JSON.stringify({ thought: 'create the page', action: 'edit_file', args: { path: 'index.html', content: '<!doctype html><html><body><h1>Hello</h1></body></html>' } }),
      JSON.stringify({ thought: 'all done', action: 'done', args: { summary: 'Built the page.' } }),
    ]);
    const res = await runProEngine({ prompt: 'make a hello page', callModel: model, send: (e) => events.push(e) });
    expect(res.usable).toBe(true);
    expect(res.files['index.html']).toContain('Hello');
    expect(res.tier).toBe('vfs');
    expect(events.some((e) => e.type === 'files')).toBe(true);
  });

  it('is NOT usable for a conversational-only reply (falls back)', async () => {
    const model = scriptedModel([
      JSON.stringify({ thought: 'just chatting', action: 'reply', args: { message: 'Hi there!' } }),
    ]);
    const res = await runProEngine({ prompt: 'hello', callModel: model, send: () => {} });
    expect(res.usable).toBe(false);
  });
});
