import { describe, expect, it } from 'vitest';
import { orphansToHandBack } from '../src/server/AgentV3/orphanHandBack';
import { applyLeftoverNet } from '../src/server/AgentV3/leftoverComponents';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';

// All app/config source here is inert fixture text. No generated code, package or config is executed.
const LIVE = 'src/components/Live.tsx';
const UNUSED = 'src/components/Unused.tsx';
const manifest = (extra: Record<string, unknown> = {}): string => JSON.stringify({
  name: 'example-app', private: true,
  dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0', '@scope/ui': '^1.0.0' },
  ...extra,
});
const project = (imports = "import { Live } from '@/components/Live';", extra: Record<string, string> = {}): Record<string, string> => ({
  'package.json': manifest(),
  'tsconfig.json': JSON.stringify({ compilerOptions: { jsx: 'react-jsx', moduleResolution: 'bundler' } }),
  'src/main.tsx': "import App from './App'; import './index.css';",
  'src/index.css': 'input { padding: 8px; }',
  'src/App.tsx': `${imports}\nexport default function App() { return <Live />; }`,
  [LIVE]: 'export function Live() { return <input name="entry" />; }',
  [UNUSED]: 'export function Unused() { return <div />; }',
  ...extra,
});
const handBack = (files: Record<string, string>): string[] =>
  orphansToHandBack({ project: files, written: Object.keys(files), env: {} });

class MemoryActuator implements ActuatorPort {
  readonly files: Map<string, string>;
  readonly reads: string[] = [];
  readonly removed: string[] = [];
  constructor(files: Record<string, string>, private readonly unreadable?: string) { this.files = new Map(Object.entries(files)); }
  async readFile(_workspace: string, path: string): Promise<string> {
    this.reads.push(path);
    const value = this.files.get(path);
    if (path === this.unreadable || value === undefined) throw new Error('ENOENT');
    return value;
  }
  async writeFile(_workspace: string, path: string, source: string): Promise<void> { this.files.set(path, source); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand(_workspace: string, command: string) {
    const deletion = /^rm -f -- '([^']+)'$/.exec(command);
    if (deletion) { this.removed.push(deletion[1]); this.files.delete(deletion[1]); }
    return { exitCode: 0, stdout: '', stderr: '' };
  }
  async getPortUrl(): Promise<string> { return 'https://preview.invalid'; }
}
async function removeThroughDispatcher(files: Record<string, string>, unreadable?: string) {
  const actuator = new MemoryActuator(files, unreadable);
  const stream = new AgentEventStream();
  const dispatcher = new ToolDispatcher(actuator, 'unknown-import-fixture', new WorkspaceState(stream), stream);
  dispatcher.setBuildWrites(() => [...actuator.files.keys()]);
  const removed = await applyLeftoverNet(dispatcher, { record: () => {}, retract: () => 0 }, 'Build a learning app.', {});
  return { actuator, removed };
}

describe('unknown import bindings cannot justify deleting a screen', () => {
  it.each([
    ['simple bare', 'Live', { Live: ['src/components/Live'] }],
    ['bare subpath', 'screens/Live', { 'screens/*': ['src/components/*'] }],
  ] as const)('keeps screens behind a configured %s alias', (_name, spec, paths) => {
    expect(handBack(project(`import { Live } from '${spec}';`, {
      'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths } }),
    }))).toEqual([]);
  });

  it('does not infer an undeclared bare import is an external npm package', () => {
    expect(handBack(project("import { Live } from 'screens/Live';"))).toEqual([]);
  });

  it('lets a configured local alias override a declared npm dependency', () => {
    expect(handBack(project("import { Live } from 'react';", {
      'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { react: ['src/components/Live'] } } }),
    }))).toEqual([]);
  });

  it('keeps the runtime target when Vite overrides the conventional source-root alias', async () => {
    const runtimeLive = 'custom/components/Live.tsx';
    const files = project(undefined, {
      [runtimeLive]: 'export function Live() { return <input name="runtime-entry" />; }',
      'vite.config.ts': "import { defineConfig } from 'vite'; export default defineConfig({ resolve: { alias: { '@': './custom' } } });",
    });
    expect(handBack(files)).toEqual([]);
    const { actuator, removed } = await removeThroughDispatcher(files);
    expect(actuator.reads).toContain('vite.config.ts');
    expect(removed).toEqual([]);
    expect(actuator.files.has(runtimeLive)).toBe(true);
    expect(actuator.files.has(LIVE)).toBe(true);
  });

  it.each([
    ['unresolved inherited config', 'tsconfig.json', JSON.stringify({ extends: './missing.base.json' })],
    ['malformed compiler config', 'tsconfig.json', '{ "compilerOptions": '],
    ['malformed JavaScript config', 'jsconfig.json', '{ "compilerOptions": '],
    ['malformed package metadata', 'package.json', '{ "dependencies": '],
  ])('stands down for %s', (_name, file, source) => {
    expect(handBack(project(undefined, { [file]: source }))).toEqual([]);
  });

  it('a present inherited config must be understood, not merely found in the file map', () => {
    expect(handBack(project(undefined, {
      'tsconfig.json': JSON.stringify({ extends: './compiler.base.json' }),
      'compiler.base.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['custom/*'] } } }),
      'custom/components/Live.tsx': 'export function Live() { return <input name="runtime-entry" />; }',
    }))).toEqual([]);
  });

  it.each(['workspace:*', 'file:../screens', 'link:../screens'])('does not call a %s dependency external proof', (version) => {
    expect(handBack(project("import { Live } from 'screens/Live';", {
      'package.json': manifest({ dependencies: { screens: version } }),
    }))).toEqual([]);
  });

  it('does not treat a package self-name as proof of an external module', () => {
    expect(handBack(project("import { Live } from 'example-app/components/Live';", {
      'package.json': manifest({ exports: { './components/*': './src/components/*.tsx' } }),
    }))).toEqual([]);
  });

  it('still proves genuine leftovers with ordinary/scoped npm subpaths and builtins', () => {
    const files = project("import React from 'react'; import { createRoot } from 'react-dom/client'; import '@scope/ui/button'; import 'node:path'; import 'fs/promises'; import { Live } from '@/components/Live';");
    expect(handBack(files)).toEqual([UNUSED]);
  });

  it('keeps conventional configured aliases useful for genuine orphan detection', () => {
    expect(handBack(project(undefined, {
      'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } } }),
    }))).toEqual([UNUSED]);
  });

  it('reads package/compiler metadata on the real cleanup path and removes only the genuine leftover', async () => {
    const files = project("import React from 'react'; import '@scope/ui/button'; import { Live } from './components/Live';", {
      'package.json': manifest({ devDependencies: { vite: '^7.0.0' } }),
      'vite.config.ts': "import { defineConfig } from 'vite'; export default defineConfig({});",
    });
    const { actuator, removed } = await removeThroughDispatcher(files);
    expect(actuator.reads).toEqual(expect.arrayContaining(['package.json', 'tsconfig.json', 'vite.config.ts']));
    expect(removed).toEqual([UNUSED]);
    expect(actuator.removed).toEqual([UNUSED]);
    expect(actuator.files.has(LIVE)).toBe(true);
  });

  it('a listed but unreadable compiler config cannot become deletion permission', async () => {
    const { actuator, removed } = await removeThroughDispatcher(project(), 'tsconfig.json');
    expect(actuator.reads).toContain('tsconfig.json');
    expect(removed).toEqual([]);
    expect(actuator.removed).toEqual([]);
    expect(actuator.files.has(LIVE)).toBe(true);
  });
});
