import { beforeEach, describe, expect, it } from 'vitest';
import { parseIgnoreFile } from '../src/server/AgentV3/ignoreRules';
import { _clearWorkspaceMemory, getWorkspaceMemory } from '../src/server/AgentV3/WorkspaceMemory';
import { makeDispatcher, toolCall } from './helpers/dispatcherHarness';

const SCHEMA = 'model User {\n  id String\n}\n';

describe('every tool write respects the guards', () => {
  beforeEach(() => { _clearWorkspaceMemory(); });

  it('(a) generate_types refuses to write .env', async () => {
    const { act, d } = makeDispatcher();
    act.files.set('.env', 'KEEP=1\n');
    const res = await d.dispatch(toolCall('generate_types', { outPath: '.env' }), 'architect');
    expect(res.is_error).toBe(true);
    expect(act.files.get('.env')).toBe('KEEP=1\n');
  });

  it('(b) generate_types will not wholesale-replace an existing src/App.tsx', async () => {
    const { act, d } = makeDispatcher();
    const original = 'export default function App(){ return null; }\n';
    act.files.set('src/App.tsx', original);
    act.files.set('schema.prisma', SCHEMA);
    const res = await d.dispatch(toolCall('generate_types', { outPath: 'src/App.tsx' }), 'architect');
    expect(res.is_error).toBe(true);
    expect(res.content).toContain('already exists');
    expect(act.files.get('src/App.tsx')).toBe(original);
  });

  it('(c) an absolute path still matches an anchored ignore rule', async () => {
    const { act, d } = makeDispatcher();
    d.setIgnoreRules(parseIgnoreFile('/src/legacy/**\n'));
    const res = await d.dispatch(toolCall('write_file', {
      path: '/home/user/workspace/src/legacy/x.ts',
      content: 'export const x = 1;\n',
    }), 'architect');
    expect(res.is_error).toBe(true);
    expect(act.files.has('src/legacy/x.ts')).toBe(false);
    expect(act.files.has('/home/user/workspace/src/legacy/x.ts')).toBe(false);
  });

  it('(d) the same rule blocks replace_symbol and codemod_rename into src/legacy', async () => {
    const { act, d } = makeDispatcher();
    d.setIgnoreRules(parseIgnoreFile('/src/legacy/**\n'));
    const original = 'export function Legacy(){ return 1; }\n';
    act.files.set('src/legacy/x.ts', original);
    const replaced = await d.dispatch(toolCall('replace_symbol', {
      path: 'src/legacy/x.ts',
      symbol: 'Legacy',
      code: 'export function Legacy(){ return 2; }\n',
    }), 'architect');
    expect(replaced.is_error).toBe(true);
    expect(act.files.get('src/legacy/x.ts')).toBe(original);

    const renamed = await d.dispatch(toolCall('codemod_rename', {
      old_name: 'Legacy',
      new_name: 'Kept',
    }, 'd2'), 'architect');
    expect(renamed.is_error).toBe(true);
    expect(act.files.get('src/legacy/x.ts')).toBe(original);
  });

  it('(e) a batch writes the good file, refuses the unparseable one, and lists both', async () => {
    const { act, d } = makeDispatcher();
    const res = await d.dispatch(toolCall('write_files_batch', { files: [
      { path: 'src/Good.tsx', content: 'export const ok = 1;\n' },
      { path: 'src/Bad.tsx', content: 'export const x = (' },
    ] }), 'frontend');
    expect(res.is_error).toBe(true);
    expect(act.files.get('src/Good.tsx')).toBe('export const ok = 1;\n');
    expect(act.files.has('src/Bad.tsx')).toBe(false);
    expect(res.content).toContain('src/Good.tsx');
    expect(res.content).toContain('src/Bad.tsx');
    expect(res.content).toContain('Not written:');
  });

  it('(f) a batched package.json is stored and indexed with the pinned prisma major', async () => {
    const { act, d, events } = makeDispatcher();
    const res = await d.dispatch(toolCall('write_files_batch', { files: [
      { path: 'package.json', content: JSON.stringify({ name: 'app', dependencies: { prisma: '^7' } }, null, 2) },
    ] }), 'architect');
    expect(res.is_error).toBe(false);
    const stored = JSON.parse(act.files.get('package.json') ?? '{}');
    expect(stored.dependencies.prisma).toBe('^6');
    const diff = events.find((e) => e.type === 'diff') as { diff?: { patch?: string } } | undefined;
    expect(diff?.diff?.patch ?? '').toContain('^6');
    expect(getWorkspaceMemory('ws-1').graph().files).toContain('package.json');
  });
});
