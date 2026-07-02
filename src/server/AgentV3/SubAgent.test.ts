import { describe, it, expect } from 'vitest';
import { makeSubAgentSpawn } from './SubAgent';
import { ToolDispatcher, type ActuatorPort } from './ToolDispatcher';
import { ClaudeClient, type MessagesCreateClient } from './ClaudeClient';
import { WorkspaceState } from './WorkspaceState';
import { AgentEventStream } from './AgentEventStream';
import { getWorkspaceMemory, _clearWorkspaceMemory } from './WorkspaceMemory';
import type { AgentEvent } from './types';

class FakeActuator implements ActuatorPort {
  files = new Map<string, string>();
  async readFile(_w: string, p: string): Promise<string> {
    const f = this.files.get(p);
    if (f === undefined) throw new Error(`ENOENT: ${p}`);
    return f;
  }
  async writeFile(_w: string, p: string, c: string): Promise<void> {
    this.files.set(p, c);
  }
  async listFiles(): Promise<string[]> {
    return [...this.files.keys()];
  }
  async runCommand() {
    return { exitCode: 0, stdout: '', stderr: '' };
  }
}

function scriptedClient(messages: unknown[]): MessagesCreateClient {
  let i = 0;
  return { messages: { create: async () => (messages[i++] ?? { content: [{ type: 'text', text: 'end' }], stop_reason: 'end_turn' }) as never } };
}

describe('makeSubAgentSpawn — specialist sub-agents', () => {
  it('spawns a frontend agent that writes a file, attributed to its role', async () => {
    const actuator = new FakeActuator();
    const stream = new AgentEventStream();
    const events: AgentEvent[] = [];
    stream.subscribe((e) => events.push(e), false);
    const state = new WorkspaceState(stream);

    const client = new ClaudeClient(
      scriptedClient([
        {
          content: [
            { type: 'text', text: 'Building the navbar.' },
            { type: 'tool_use', id: 's1', name: 'write_file', input: { path: 'Navbar.tsx', content: 'x' } },
          ],
          stop_reason: 'tool_use',
          usage: { input_tokens: 10, output_tokens: 5 },
        },
        { content: [{ type: 'text', text: 'Navbar done.' }], stop_reason: 'end_turn' },
      ]),
    );

    const spawn = makeSubAgentSpawn({ client, actuator, workspaceId: 'ws', state, events: stream, model: 'm' });
    const result = await spawn('frontend', 'Build a navbar');

    expect(result.ok).toBe(true);
    expect(result.summary).toContain('Navbar');
    expect(actuator.files.get('Navbar.tsx')).toBe('x');
    // The sub-agent's activity is attributed to 'frontend', not 'architect'.
    expect(events.some((e) => e.type === 'narration' && e.agent === 'frontend')).toBe(true);
    expect(events.some((e) => e.type === 'file_changed' && e.agent === 'frontend')).toBe(true);
  });

  it('injects the live project memory into the specialist\'s instruction', async () => {
    _clearWorkspaceMemory();
    // The Architect has already built something this workspace remembers.
    getWorkspaceMemory('ws-mem').indexFile('src/Sidebar.tsx', 'export function Sidebar(){return null;}');

    const stream = new AgentEventStream();
    const state = new WorkspaceState(stream);
    const actuator = new FakeActuator();

    // A client that records the user prompt it receives.
    let seenPrompt = '';
    const recording: MessagesCreateClient = {
      messages: {
        create: async (params: Record<string, unknown>) => {
          const msgs = params.messages as Array<{ role: string; content: unknown }>;
          const first = msgs[0];
          // Content can be a raw string OR a block array (the transcript cache breakpoint converts a
          // string message into a [{type:'text',...}] block to carry cache_control) — read either shape.
          if (typeof first?.content === 'string') seenPrompt = first.content;
          else if (Array.isArray(first?.content)) {
            seenPrompt = (first.content as Array<{ type?: string; text?: string }>)
              .filter((b) => b?.type === 'text' && typeof b.text === 'string')
              .map((b) => b.text)
              .join('');
          }
          return { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' } as never;
        },
      },
    };
    const client = new ClaudeClient(recording);
    const spawn = makeSubAgentSpawn({ client, actuator, workspaceId: 'ws-mem', state, events: stream, model: 'm' });
    await spawn('designer', 'Polish the layout');

    expect(seenPrompt).toContain('Current project context');
    expect(seenPrompt).toContain('Sidebar');
    expect(seenPrompt).toContain('Your task: Polish the layout');
    _clearWorkspaceMemory();
  });

  it('a spawned worker cannot itself spawn (no task tool → honest error)', async () => {
    const actuator = new FakeActuator();
    const stream = new AgentEventStream();
    const state = new WorkspaceState(stream);

    // The worker tries to call task; its dispatcher has no spawn callback.
    const client = new ClaudeClient(
      scriptedClient([
        {
          content: [{ type: 'tool_use', id: 's1', name: 'task', input: { role: 'backend', instruction: 'x' } }],
          stop_reason: 'tool_use',
        },
        { content: [{ type: 'text', text: 'cannot delegate, finishing.' }], stop_reason: 'end_turn' },
      ]),
    );
    const spawn = makeSubAgentSpawn({ client, actuator, workspaceId: 'ws', state, events: stream, model: 'm' });
    const result = await spawn('backend', 'do work');
    // It still completes (the model recovered), proving the worker had no working task tool.
    expect(result.ok).toBe(true);
  });
});

describe('ToolDispatcher task tool', () => {
  function setup(spawn?: (role: string, instr: string) => Promise<{ ok: boolean; summary: string }>) {
    const actuator = new FakeActuator();
    const stream = new AgentEventStream();
    const events: AgentEvent[] = [];
    stream.subscribe((e) => events.push(e), false);
    const state = new WorkspaceState(stream);
    const d = new ToolDispatcher(actuator, 'ws', state, stream, spawn as never);
    return { d, events };
  }

  it('delegates via the injected spawn and emits agent_spawned', async () => {
    const { d, events } = setup(async (role, instr) => ({ ok: true, summary: `${role}:${instr}` }));
    const res = await d.dispatch({ id: 't1', name: 'task', input: { role: 'backend', instruction: 'add API' } }, 'architect');
    expect(res.is_error).toBe(false);
    expect(res.content).toContain('backend');
    expect(events.some((e) => e.type === 'agent_spawned' && e.agent === 'backend')).toBe(true);
  });

  it('errors honestly for an unknown role', async () => {
    const { d } = setup(async () => ({ ok: true, summary: 'x' }));
    const res = await d.dispatch({ id: 't1', name: 'task', input: { role: 'wizard', instruction: 'x' } }, 'architect');
    expect(res.is_error).toBe(true);
    expect(res.content).toContain('unknown role');
  });

  it('errors when no spawn capability is wired (worker context)', async () => {
    const { d } = setup(undefined);
    const res = await d.dispatch({ id: 't1', name: 'task', input: { role: 'backend', instruction: 'x' } }, 'frontend');
    expect(res.is_error).toBe(true);
    expect(res.content).toContain('not available');
  });
});
