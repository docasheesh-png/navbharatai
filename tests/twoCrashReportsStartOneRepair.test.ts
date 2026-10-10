/**
 * PR-12 — two crash reports must not start two repairs, evaluate is not parallel, and the
 * incremental cache is per dispatcher (BLD-11, TD-14, TD-18, TD-20).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { claimAutoRepair } from '../src/server/AgentV3/previewAutoRepair';
import { previewGaveUp, clearPreviewGaveUp } from '../src/server/AgentV3/previewGiveUp';
import { isParallelSafeToolUse } from '../src/server/AgentV3/AgentRunner';
import { ToolDispatcher } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { FakeActuator, toolCall } from './helpers/dispatcherHarness';

const ROOT = resolve(__dirname, '..');

describe('claimAutoRepair', () => {
  it('two reports at the same moment: exactly one wins', () => {
    const now = 1_700_000_000_000;
    const a = claimAutoRepair('ws-race-pr12', now);
    const b = claimAutoRepair('ws-race-pr12', now);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(claimAutoRepair('ws-race-pr12', now + 120_000)).toBe(true);
  });

  it('the route claims synchronously, before any await, and saves the durable marker before the browse', () => {
    const route = readFileSync(resolve(ROOT, 'src/server/routes/agentv3.ts'), 'utf8');
    const start = route.indexOf("app.post('/api/agentv3/preview-error/auto-repair'");
    expect(start).toBeGreaterThan(0);
    const slice = route.slice(start, start + 4000);
    const claimAt = slice.indexOf('if (!claimAutoRepair(workspaceId))');
    const awaitAt = slice.indexOf('await ');
    const saveAt = slice.indexOf('previewAutoRepairAt: Date.now()');
    const browseAt = slice.indexOf('autoRepairBrowse');
    expect(claimAt).toBeGreaterThan(0);
    expect(awaitAt).toBeGreaterThan(claimAt);
    expect(saveAt).toBeGreaterThan(claimAt);
    expect(browseAt).toBeGreaterThan(saveAt);
  });
});

describe('evaluate is not parallel-safe', () => {
  it('PARALLEL_SAFE_TOOLS does not include evaluate', () => {
    const src = readFileSync(resolve(ROOT, 'src/server/AgentV3/AgentRunner.ts'), 'utf8');
    const start = src.indexOf('const PARALLEL_SAFE_TOOLS');
    const end = src.indexOf('const PARALLEL_SAFE_TASK_ROLES');
    const block = src.slice(start, end);
    expect(block).not.toContain("'evaluate'");
    expect(block).not.toContain('"evaluate"');
    expect(isParallelSafeToolUse({ id: 'e', name: 'evaluate', input: {} })).toBe(false);
  });
});

describe('tsbuildinfo is per dispatcher', () => {
  it('src has no shared /tmp/agentv3.tsbuildinfo literal', () => {
    const needle = '/tmp/agentv3' + '.tsbuildinfo';
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist') continue;
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(?:ts|tsx|js|mjs|cjs)$/.test(name) && readFileSync(p, 'utf8').includes(needle)) hits.push(p);
      }
    };
    walk(resolve(ROOT, 'src'));
    expect(hits).toEqual([]);
  });

  it('two dispatchers typecheck into different caches', async () => {
    const act = new FakeActuator();
    const stream = new AgentEventStream();
    const a = new ToolDispatcher(act, 'ws-tsc-a', new WorkspaceState(stream), stream);
    const b = new ToolDispatcher(act, 'ws-tsc-b', new WorkspaceState(stream), stream);
    await a.endgameIo().runTsc();
    await b.endgameIo().runTsc();
    const ids = act.commands.map((c) => c.match(/\/tmp\/agentv3-([A-Za-z0-9]+)\.tsbuildinfo/)?.[1]);
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
  });
});

describe('preview port and shared give-up', () => {
  const WS = 'ws-giveup-pr12';
  afterEach(() => {
    clearPreviewGaveUp(WS);
    vi.useRealTimers();
  });

  it('update_preview refuses a port outside 1–65535', async () => {
    const act = new FakeActuator();
    const stream = new AgentEventStream();
    const d = new ToolDispatcher(act, WS, new WorkspaceState(stream), stream);
    const res = await d.dispatch(toolCall('update_preview', { port: 70000 }));
    expect(res.is_error).toBe(true);
    expect(String(res.content)).toContain('port must be an integer 1–65535');
    expect(act.commands).toHaveLength(0);
  });

  it('after dispatcher A gives up, dispatcher B on the same workspace sees it', async () => {
    vi.useFakeTimers();
    const dead = {
      readFile: async (_w: string, p: string) => {
        if (p === 'package.json') return '{"scripts":{"dev":"vite"}}';
        throw new Error(`ENOENT: ${p}`);
      },
      writeFile: async () => {},
      listFiles: async () => [],
      runCommand: async (_w: string, command: string) => (
        command.includes('PORT_UP')
          ? { exitCode: 0, stdout: 'PORT_DOWN', stderr: '' }
          : { exitCode: 0, stdout: '', stderr: '' }
      ),
      getPortUrl: async (_w: string, port: number) => `https://sandbox-${port}.example.dev`,
    };
    const stream = new AgentEventStream();
    const state = new WorkspaceState(stream);
    const a = new ToolDispatcher(dead, WS, state, stream);
    const first = a.dispatch(toolCall('update_preview', { port: 5173 }, 'a1'));
    await vi.advanceTimersByTimeAsync(20_000);
    await first;
    const second = a.dispatch(toolCall('update_preview', { port: 5173 }, 'a2'));
    await vi.advanceTimersByTimeAsync(20_000);
    await second;
    expect(previewGaveUp(WS)).toBe(true);
    const b = new ToolDispatcher(dead, WS, state, stream);
    const third = await b.dispatch(toolCall('update_preview', { port: 5173 }, 'b1'));
    expect(third.is_error).toBe(true);
    expect(String(third.content)).toContain('FINAL');
    expect(previewGaveUp(WS)).toBe(true);
  });
});
