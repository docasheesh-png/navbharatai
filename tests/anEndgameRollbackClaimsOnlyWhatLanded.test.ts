import { describe, expect, it } from 'vitest';
import { runEndgameRepair } from '../src/server/AgentV3/EndgameRepair';
import { ToolDispatcher } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';

const missing = "src/App.tsx(1,1): error TS2307: Cannot find module './missing'.";
const worse = `${missing}\nsrc/missing.ts(1,1): error TS2345: a new error.`;

describe('an endgame rollback records applied operations', () => {
  it.each(['throws', 'unavailable'])('a created file stays in the map when its removal %s', async (mode) => {
    const files = { 'src/App.tsx': "import './missing';\nexport const App = 1;" } as Record<string, string>;
    const logs: string[] = [];
    const output = [missing, worse];
    const result = await runEndgameRepair({
      runTsc: async () => output.shift() ?? '', readFiles: async () => files,
      writeFile: async (path, content) => { files[path] = content; },
      ...(mode === 'throws' ? { removeFile: async () => { throw new Error('rm refused'); } } : {}),
      llmRepair: async () => [{ path: 'src/missing.ts', content: 'export const missing = 1;' }],
      log: (message) => logs.push(message),
    });
    expect(files['src/missing.ts']).toBe('export const missing = 1;');
    expect(result).toMatchObject({ clean: false, rollbackIncomplete: true, tscUnverified: true, errorsAfter: 2, llmFilesWritten: 1 });
    expect(result.llmReverted).not.toBe(true);
    expect(logs.join('\n')).not.toMatch(/kept the better state/);
    expect(logs.join('\n')).toMatch(/rollback.*incomplete/i);
  });

  it('a refused rewrite keeps the actual worse compiler state and cannot claim the repair was reverted', async () => {
    const original = 'export const original = 1;';
    const files = { 'src/App.tsx': original };
    const output = ['src/App.tsx(1,1): error TS2345: one error.', 'src/App.tsx(1,1): error TS2345: first error.\nsrc/App.tsx(2,1): error TS2345: second error.'];
    const result = await runEndgameRepair({
      runTsc: async () => output.shift() ?? '', readFiles: async () => files,
      writeFile: async (path, content) => {
        if (content === original) throw new Error('restore write refused');
        files[path as keyof typeof files] = content;
      },
      llmRepair: async () => [{ path: 'src/App.tsx', content: 'export const worse = 2;' }],
    });
    expect(result).toMatchObject({ clean: false, rollbackIncomplete: true, tscUnverified: true, errorsAfter: 2, llmFilesWritten: 1 });
    expect(result.llmReverted).not.toBe(true);
    expect(files['src/App.tsx']).toBe('export const worse = 2;');
  });

  it('Stop while the compiler is awaited holds the rollback and prevents a false reverted verdict', async () => {
    const controller = new AbortController();
    const files = { 'src/App.tsx': 'export const original = 1;' };
    const writes: string[] = [];
    let enteredCompiler!: () => void;
    let finishCompiler!: (value: string) => void;
    const entered = new Promise<void>((resolve) => { enteredCompiler = resolve; });
    const compiling = new Promise<string>((resolve) => { finishCompiler = resolve; });
    let calls = 0;
    const pending = runEndgameRepair({
      signal: controller.signal,
      runTsc: async () => {
        if (++calls === 1) return 'src/App.tsx(1,1): error TS2345: one error.';
        enteredCompiler(); return compiling;
      },
      readFiles: async () => files,
      writeFile: async (_path, content) => { writes.push(content); },
      llmRepair: async () => [{ path: 'src/App.tsx', content: 'export const worse = 2;' }],
    });
    await entered;
    controller.abort();
    finishCompiler('src/App.tsx(1,1): error TS2345: first error.\nsrc/App.tsx(2,1): error TS2345: second error.');
    const result = await pending;
    expect(writes).toEqual(['export const worse = 2;']);
    expect(result).toMatchObject({ clean: false, rollbackIncomplete: true, tscUnverified: true, lapsed: true, errorsAfter: 2 });
    expect(result.llmReverted).not.toBe(true);
  });

  it('Stop during one candidate write prevents dispatching its sibling file', async () => {
    const controller = new AbortController();
    const writes: string[] = [];
    const result = await runEndgameRepair({
      signal: controller.signal,
      runTsc: async () => 'src/a.ts(1,1): error TS2345: one error.',
      readFiles: async () => ({ 'src/a.ts': 'export const a = 1;', 'src/b.ts': 'export const b = 1;' }),
      writeFile: async (path) => { writes.push(path); controller.abort(); },
      llmRepair: async () => [{ path: 'src/a.ts', content: 'export const a = 2;' }, { path: 'src/b.ts', content: 'export const b = 2;' }],
    });
    expect(writes).toEqual(['src/a.ts']);
    expect(result).toMatchObject({ clean: false, tscUnverified: true, lapsed: true });
  });

  it('the real dispatcher remove port rejects a nonzero shell result before reconciling deletion', async () => {
    const events = new AgentEventStream();
    const state = new WorkspaceState(events);
    state.recordFileChange({ path: 'src/missing.ts', kind: 'create' });
    const dispatcher = new ToolDispatcher({
      readFile: async () => 'original', writeFile: async () => {}, listFiles: async () => ['src/missing.ts'],
      runCommand: async () => ({ exitCode: 1, stdout: '', stderr: 'rm refused' }),
      getPortUrl: async () => 'https://example.test',
    }, 'rollback-port-test', state, events);
    await expect(dispatcher.endgameIo().removeFile('src/missing.ts')).rejects.toThrow(/remove|delet/i);
    expect(state.snapshot().files).toEqual([{ path: 'src/missing.ts', kind: 'create' }]);
  });
});
