import { describe, expect, it } from 'vitest';
import { orphansToHandBack } from '../src/server/AgentV3/orphanHandBack';
import { unreferencedComponents, dataEntryEvidence } from '../src/server/AgentV3/journeyDerivation';
import { applyLeftoverNet } from '../src/server/AgentV3/leftoverComponents';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { resolveLocalImport } from '../src/server/AgentV3/ArchitectureAnalysis';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

// cfd01074: these three COMPLETE import statements survived in the App read receipt before deletion.
// The receipt retains only 614 source characters; all other source below is synthetic, not a saved-app replay.
const RETAINED_IMPORTS = [
  "import { HomeScreen } from '@/components/HomeScreen';",
  "import { LessonScreen } from '@/components/LessonScreen';",
  "import { ProgressScreen } from '@/components/ProgressScreen';",
].join('\n');
const SCREEN_PATHS = ['HomeScreen', 'LessonScreen', 'ProgressScreen'].map((n) => `src/components/${n}.tsx`);
const UNUSED = 'src/components/Unused.tsx';
const base = (entry: string, extra: Record<string, string> = {}): Record<string, string> => ({
  'package.json': JSON.stringify({ dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' } }),
  'src/main.tsx': "import App from './App';\nimport './index.css';",
  'src/index.css': 'input { padding: 8px; }',
  'src/App.tsx': entry,
  'src/components/Live.tsx': 'export function Live() { return <input name="entry" />; }',
  [UNUSED]: 'export function Unused() { return <div />; }',
  ...extra,
});
const handBack = (project: Record<string, string>): string[] =>
  orphansToHandBack({ project, written: Object.keys(project), env: {} });
const recordedShape = (): Record<string, string> => {
  const p = base(RETAINED_IMPORTS + '\nexport default function App() { return <><HomeScreen /><LessonScreen /><ProgressScreen /></>; }');
  delete p['src/components/Live.tsx'];
  for (const path of SCREEN_PATHS) {
    const name = path.split('/').pop()!.replace('.tsx', '');
    p[path] = `export function ${name}() { return <input name="entry" />; }`;
  }
  return p;
};

describe('an imported screen is never destructive leftover evidence', () => {
  it('keeps the three retained alias imports and still names a genuine unused screen', () => {
    expect(handBack(recordedShape())).toEqual([UNUSED]);
  });

  const shapes: Array<[string, string, string?]> = [
    ['relative', "import { Live } from './components/Live';"],
    ['source alias', "import { Live } from '@/components/Live';"],
    ['tilde alias', "import { Live } from '~/components/Live';"],
    ['bare source root', "import { Live } from 'components/Live';"],
    ['directory index', "import { Live } from '@/components';", 'src/components/index.tsx'],
    ['explicit JS output', "import { Live } from '@/components/Live.js';"],
    ['explicit JSX output', "import { Live } from '@/components/Live.jsx';"],
    ['lazy literal', "const Live = lazy(() => import('@/components/Live'));"],
    ['constant template import', 'const Live = lazy(() => import(`@/components/Live`));'],
    ['re-export', "export { Live } from '@/components/Live';"],
    ['star re-export', "export * from '@/components/Live';"],
    ['side-effect import', "import '@/components/Live';"],
    ['CJS literal', "const { Live } = require('@/components/Live');"],
    ['CJS module literal', "const { Live } = module.require('@/components/Live');"],
    ['TS import equals', "import Live = require('@/components/Live');"],
  ];
  it.each(shapes)('preserves %s edges without disabling genuine orphan detection', (_name, entry, target) => {
    const p = base(entry);
    if (target) {
      p[target] = p['src/components/Live.tsx'];
      delete p['src/components/Live.tsx'];
    }
    expect(handBack(p)).toEqual([UNUSED]);
  });

  it('derives data-entry evidence from an alias-imported screen', () => {
    expect(dataEntryEvidence(base("import { Live } from '@/components/Live';"))?.path).toBe('src/components/Live.tsx');
  });

  it('uses the importing frontend source root in a nested app', () => {
    const p = {
      'client/src/main.tsx': "import App from './App';",
      'client/src/App.tsx': "import { Live } from '@/components/Live';",
      'client/src/components/Live.tsx': 'export const Live = () => null;',
      'client/src/components/Unused.tsx': 'export const Unused = () => null;',
    };
    expect(handBack(p)).toEqual(['client/src/components/Unused.tsx']);
  });

  it.each([
    ['missing relative target', "import { Missing } from './Missing';"],
    ['missing conventional alias', "import { Live } from '@/screens/Live';"],
    ['unknown hash alias', "import { Live } from '#screens/Live';"],
    ['unknown tilde alias', "import { Live } from '~screens/Live';"],
    ['absolute local import', "import { Live } from '/screens/Live';"],
    ['computed dynamic import', 'const Live = lazy(() => import(modulePath));'],
    ['computed template import', 'const Live = lazy(() => import(`./components/${name}`));'],
    ['computed CJS import', 'const Live = require(modulePath);'],
    ['computed module CJS import', 'const Live = module.require(modulePath);'],
    ['computed module loader', 'const Live = module[loader](modulePath);'],
    ['CJS context loader', "const screens = require.context('./components');"],
    ['glob import', "const screens = import.meta.glob('./components/*.tsx');"],
    ['eager glob import', "const screens = import.meta.globEager('./components/*.tsx');"],
    ['broken loading syntax', 'export * from modulePath;'],
  ])('stands down when %s makes the graph unprovable', (_name, entry) => {
    expect(handBack(base(entry))).toEqual([]);
  });

  it.each([
    ['alias roots', { 'components/Live.tsx': 'export const Live = () => null;' }, '@/components/Live', 'src/components/Live.tsx'],
    ['extension alternatives', { 'src/components/Live.ts': 'export const Live = () => null;' }, '@/components/Live', 'src/components/Live.ts'],
    ['file versus directory index', { 'src/components/Live/index.tsx': 'export const Live = () => null;' }, '@/components/Live', 'src/components/Live.tsx'],
    ['JS output versus TS source', { 'src/components/Live.js': 'export const Live = () => null;' }, '@/components/Live.js', 'src/components/Live.js'],
  ] as const)('stands down for ambiguous %s while advisory resolution keeps its old first match', (_name, extra, spec, oldFirst) => {
    const p = base(`import { Live } from '${spec}';`, extra);
    expect(resolveLocalImport('src/App.tsx', spec, new Set(Object.keys(p)))).toBe(oldFirst);
    expect(handBack(p)).toEqual([]);
  });

  it('ordinary npm imports do not hide a genuine unused component', () => {
    const p = base("import React from 'react'; import { createRoot } from 'react-dom/client'; import { Live } from '@/components/Live';");
    expect(handBack(p)).toEqual([UNUSED]);
  });

  it('comments and quoted loading examples do not invent graph edges or uncertainty', () => {
    const p = base("import { Live } from './components/Live';\n// import(modulePath)\nconst example = \"import.meta.glob('./components/*')\";");
    expect(handBack(p)).toEqual([UNUSED]);
  });

  it('keeps the existing no-entry and incomplete-graph stand-downs', () => {
    const p = base("import { Live } from './components/Live';");
    delete p['src/main.tsx'];
    delete p['src/App.tsx'];
    expect([...unreferencedComponents(p)]).toEqual([]);
    expect(handBack(base("import { Live } from './components/Live'; import './not-read';"))).toEqual([]);
  });

  it('keeps every destructive orphan consumer on the one import-observability authority', () => {
    const root = path.resolve('src/server/AgentV3');
    const callers = readdirSync(root).filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .filter((name) => /\bunreferencedComponents\s*\(/.test(readFileSync(path.join(root, name), 'utf8')));
    expect(callers.sort()).toEqual(['journeyDerivation.ts', 'orphanHandBack.ts']);
    expect(readFileSync(path.join(root, 'orphanHandBack.ts'), 'utf8')).toContain('unreferencedComponents(input.project');
    expect(readFileSync(path.join(root, 'ToolDispatcher.ts'), 'utf8')).toContain('orphansToHandBack({ project: orphanProject');
  });

  it('the real dispatcher-to-leftover path deletes only the proven unused file', async () => {
    class MemoryActuator implements ActuatorPort {
      files = new Map(Object.entries(recordedShape()));
      removed: string[] = [];
      async readFile(_w: string, p: string): Promise<string> { const value = this.files.get(p); if (value === undefined) throw new Error('ENOENT'); return value; }
      async writeFile(_w: string, p: string, value: string): Promise<void> { this.files.set(p, value); }
      async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
      async runCommand(_w: string, cmd: string) {
        const match = /^rm -f -- '([^']+)'$/.exec(cmd);
        if (match) { this.removed.push(match[1]); this.files.delete(match[1]); }
        return { exitCode: 0, stdout: '', stderr: '' };
      }
      async getPortUrl(): Promise<string> { return 'https://preview.invalid'; }
    }
    const actuator = new MemoryActuator();
    const stream = new AgentEventStream();
    const dispatcher = new ToolDispatcher(actuator, 'orphan-alias-fixture', new WorkspaceState(stream), stream);
    dispatcher.setBuildWrites(() => [...actuator.files.keys()]);
    const removed = await applyLeftoverNet(dispatcher, { record: () => {}, retract: () => 0 }, 'Build a learning app.', {});
    expect(removed).toEqual([UNUSED]);
    expect(actuator.removed).toEqual([UNUSED]);
    for (const path of SCREEN_PATHS) expect(actuator.files.has(path)).toBe(true);
  });
});
