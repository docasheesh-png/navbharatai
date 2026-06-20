import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { VfsActuator } from '../src/server/EngineerAI/actuators/VfsActuator';
import { ProAgentRouter } from '../src/server/EngineerAI/AI/ProAgentRouter';
import { runProEngine, selectTier, resolveBackend } from '../src/server/EngineerAI/ProEngineRunner';
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

describe('resolveBackend (availability-gated downgrade — the never-break ladder)', () => {
  const saved = { docker: process.env.DOCKER_ENABLED, e2b: process.env.E2B_API_KEY };
  beforeEach(() => { delete process.env.DOCKER_ENABLED; delete process.env.E2B_API_KEY; });
  afterEach(() => {
    if (saved.docker === undefined) delete process.env.DOCKER_ENABLED; else process.env.DOCKER_ENABLED = saved.docker;
    if (saved.e2b === undefined) delete process.env.E2B_API_KEY; else process.env.E2B_API_KEY = saved.e2b;
  });
  const vfs = () => new VirtualFileSystem();

  it("'vfs' desired always resolves to the in-memory backend", () => {
    const b = resolveBackend('vfs', vfs());
    expect(b.tier).toBe('vfs');
    expect(b.sandbox).toBe(false);
  });

  it("downgrades 'cloudrun' to vfs when no Docker daemon", () => {
    expect(resolveBackend('cloudrun', vfs()).tier).toBe('vfs');
  });

  it("uses the container tier when DOCKER_ENABLED=true", () => {
    process.env.DOCKER_ENABLED = 'true';
    const b = resolveBackend('cloudrun', vfs());
    expect(b.tier).toBe('cloudrun');
    expect(b.sandbox).toBe(true);
  });

  it("downgrades 'e2b' to vfs with no key and no Docker", () => {
    expect(resolveBackend('e2b', vfs()).tier).toBe('vfs');
  });

  it("'e2b' uses the cloud VM when a user key is supplied", () => {
    const b = resolveBackend('e2b', vfs(), 'sk-user-e2b');
    expect(b.tier).toBe('e2b');
    expect(b.sandbox).toBe(true);
  });

  it("'e2b' falls back to the container tier when only Docker is available", () => {
    process.env.DOCKER_ENABLED = 'true';
    expect(resolveBackend('e2b', vfs()).tier).toBe('cloudrun');
  });

  it("'e2b' uses the env E2B key when present", () => {
    process.env.E2B_API_KEY = 'sk-env-e2b';
    expect(resolveBackend('e2b', vfs()).tier).toBe('e2b');
  });
});

describe('runProEngine (end-to-end, VFS tier)', () => {
  // A scripted model: the loop first calls the PlannerAgent (one call expecting a
  // build-plan JSON), then the ReAct loop calls the model once per step. We reply
  // with one scripted response per call, in order.
  function scriptedModel(responses: string[]): (s: string, u: string) => Promise<string> {
    let i = 0;
    return async () => responses[Math.min(i++, responses.length - 1)];
  }

  const PLAN = JSON.stringify({ steps: [{ description: 'Build the page', focusHint: 'create index.html' }] });

  it('produces usable files when the agent edits then finishes', async () => {
    const events: BuildProgressEvent[] = [];
    const model = scriptedModel([
      PLAN, // PlannerAgent call (Phase 7) — runs before the ReAct loop
      JSON.stringify({ thought: 'create the page', action: 'edit_file', args: { path: 'index.html', content: '<!doctype html><html><body><h1>Hello</h1></body></html>' } }),
      JSON.stringify({ thought: 'all done', action: 'done', args: { summary: 'Built the page.' } }),
    ]);
    const res = await runProEngine({ prompt: 'make a hello page', callModel: model, send: (e) => events.push(e) });
    expect(res.usable).toBe(true);
    expect(res.files['index.html']).toContain('Hello');
    expect(res.tier).toBe('vfs');
    expect(events.some((e) => e.type === 'files')).toBe(true);
    // Internal agent bookkeeping must not leak into the user's project.
    expect(Object.keys(res.files).some((p) => p.startsWith('.engineer/'))).toBe(false);
  });

  it('is NOT usable for a conversational-only reply (falls back)', async () => {
    const model = scriptedModel([
      JSON.stringify({ conversational: true }), // PlannerAgent: conversational turn
      JSON.stringify({ thought: 'just chatting', action: 'reply', args: { message: 'Hi there!' } }),
    ]);
    const res = await runProEngine({ prompt: 'hello', callModel: model, send: () => {} });
    expect(res.usable).toBe(false);
  });

  it('flags partial (and never throws) when the soft-deadline signal aborts the run', async () => {
    const model = scriptedModel([PLAN]);
    const ac = new AbortController();
    ac.abort(); // simulate the soft deadline firing
    const res = await runProEngine({ prompt: 'make something big', callModel: model, send: () => {}, signal: ac.signal });
    expect(res.partial).toBe(true);
    expect(res.usable).toBe(false); // no edits happened before the abort
    expect(res.files).toBeTypeOf('object');
  });
});
