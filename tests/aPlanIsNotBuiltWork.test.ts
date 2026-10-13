// Autopsy 9c612cdb (2026-10-12), Q-945 — found while tracing Q-944: update_todo counted as built work.
//
// `builtSomethingNow()` decides whether a stopped or timed-out build says "Your files so far are saved — send
// another message and I'll continue from here" or "Nothing had been written yet, so nothing was lost". It
// counted every tool call as work unless the tool was on a short list of reads — a deny-list, which 2b0a3ed5
// (2026-09-17) closed for read_file and nothing else. update_todo, update_preview, typecheck, screenshot and
// every new read-only tool counted as work, so a fresh build stopped after a plan-only turn told the user
// their files were saved when not one file existed.
//
// THE CLASS: "did this run produce work?" answered by OMISSION from a list of tool names, so every new
// non-writing tool counts as work by default. Locked here by an exhaustive census — every tool the platform
// offers is classified on purpose, in exactly one set — and by the runner case the report's shape produces.
import { describe, it, expect } from 'vitest';
import { AgentRunner, toolUseCouldProduceWork } from '../src/server/AgentV3/AgentRunner';
import { ClaudeClient, type MessagesCreateClient } from '../src/server/AgentV3/ClaudeClient';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { defaultToolCatalog, taskToolDef, secondOpinionToolDef, consensusToolDef, recipeToolDef } from '../src/server/AgentV3/ToolCatalog';
import { APPEND_FILE_TOOL } from '../src/server/AgentV3/reliability/resumeWrite';
import { abortBuild } from '../src/server/AgentV3/buildAbortCause';
import { NO_WORK_TOOLS, PRODUCES_WORK_TOOLS, PRODUCES_WORK_PREFIXES, toolWorkClass } from '../src/server/AgentV3/toolWork';
import { readFileSync } from 'node:fs';

/** Every tool any lane can be offered: the catalog, the tools built outside it, and the flag-gated extras. */
const OFFERED = [
  ...defaultToolCatalog().map((t) => t.name),
  taskToolDef().name, secondOpinionToolDef().name, consensusToolDef().name, recipeToolDef().name,
  APPEND_FILE_TOOL.name, 'read_guide', 'load_tools',
];

describe('1 · 🔒 CENSUS — every offered tool is classified, on purpose, exactly once', () => {
  it('no tool reaches the "unclassified" default', () => {
    expect(OFFERED.filter((n) => toolWorkClass(n) === 'unclassified')).toEqual([]);
  });

  it('no tool is on both sides, and no entry names a tool that does not exist', () => {
    const producesByPrefix = (n: string) => PRODUCES_WORK_PREFIXES.some((p) => n.startsWith(p));
    expect([...NO_WORK_TOOLS].filter((n) => PRODUCES_WORK_TOOLS.has(n) || producesByPrefix(n))).toEqual([]);
    const offered = new Set(OFFERED);
    expect([...NO_WORK_TOOLS, ...PRODUCES_WORK_TOOLS].filter((n) => !offered.has(n))).toEqual([]);
  });

  it('read_guide and load_tools are real tool definitions (the census list above is not a guess)', () => {
    const src = readFileSync('src/server/AgentV3/reliability/modularPrompt.ts', 'utf8') + readFileSync('src/server/AgentV3/reliability/coreToolset.ts', 'utf8');
    expect(src).toContain("name: 'read_guide'");
    expect(src).toContain("name: 'load_tools'");
  });
});

describe('2 · the predicate', () => {
  const tu = (name: string, input: Record<string, unknown> = {}) => ({ id: 'x', name, input });

  it('🔴 bookkeeping, checks and the preview are not built work', () => {
    for (const n of ['update_todo', 'update_preview', 'typecheck', 'lint', 'evaluate', 'code_graph', 'console_errors', 'screenshot', 'stop_build', 'run_tests']) {
      expect(toolUseCouldProduceWork(tu(n)), n).toBe(false);
    }
  });

  it('what writes, runs or spawns a writer still is (the opposite lie is never told)', () => {
    for (const n of ['write_file', 'edit_file', 'write_files_batch', 'bash', 'append_file', 'run_recipe', 'generate_auth', 'codemod_rename', 'manage_dependency', 'deploy']) {
      expect(toolUseCouldProduceWork(tu(n)), n).toBe(true);
    }
    expect(toolUseCouldProduceWork(tu('task', { role: 'frontend' }))).toBe(true);
    expect(toolUseCouldProduceWork(tu('task', { role: 'reviewer' }))).toBe(false);
  });

  it('a tool from outside the catalog (a service the user connected) still counts — its effects cannot be seen', () => {
    expect(toolWorkClass('github__create_issue')).toBe('unclassified');
    expect(toolUseCouldProduceWork(tu('github__create_issue'))).toBe(true);
  });
});

describe('3 · the runner: a plan-only start, then Stop', () => {
  async function stopAfter(first: { name: string; input: Record<string, unknown> }) {
    const ac = new AbortController();
    const client: MessagesCreateClient = {
      messages: {
        create: async () => ({
          content: [{ type: 'tool_use', id: 't1', ...first }],
          stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 },
        }) as never,
      },
    };
    const dispatcher = {
      dispatch: async (call: { id: string }) => {
        abortBuild(ac, 'user-stop'); // the user pressed Stop while the plan was being recorded
        return { tool_use_id: call.id, content: 'Updated 1 todo(s).', is_error: false };
      },
    };
    const stream = new AgentEventStream();
    return new AgentRunner({
      client: new ClaudeClient(client), dispatcher: dispatcher as never, state: new WorkspaceState(stream), events: stream,
      model: 'm', system: 's', tools: defaultToolCatalog(), signal: ac.signal, hasExistingFiles: () => false,
    }).run('build a video app');
  }

  it('🔴 a fresh build that only recorded its plan says nothing was written — not "your files are saved"', async () => {
    const r = await stopAfter({ name: 'update_todo', input: { todos: [{ id: '1', title: 'Player', status: 'pending' }] } });
    expect(r.ok).toBe(false);
    expect(r.summary).toBe('Stopped, as you asked. Nothing had been written yet, so nothing was lost.');
  });

  it('a build that wrote keeps its recovery line', async () => {
    const r = await stopAfter({ name: 'write_file', input: { path: 'src/App.tsx', content: 'x' } });
    expect(r.summary).toMatch(/Your files so far are saved/);
  });
});
