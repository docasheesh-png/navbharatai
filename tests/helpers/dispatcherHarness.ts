import { ToolDispatcher, type ActuatorPort } from '../../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../../src/server/AgentV3/AgentEventStream';
import type { AgentEvent } from '../../src/server/AgentV3/types';
import type { ToolUse } from '../../src/server/AgentV3/ClaudeClient';

/** In-memory sandbox. Do not edit the copy inside ToolDispatcher.test.ts. */
export class FakeActuator implements ActuatorPort {
  files = new Map<string, string>();
  commands: string[] = [];
  commandResult = { exitCode: 0, stdout: '', stderr: '' };

  async readFile(_ws: string, path: string): Promise<string> {
    const f = this.files.get(path);
    if (f === undefined) throw new Error(`ENOENT: ${path}`);
    return f;
  }
  async writeFile(_ws: string, path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }
  async listFiles(): Promise<string[]> {
    return [...this.files.keys()];
  }
  async runCommand(_ws: string, command: string) {
    this.commands.push(command);
    if (command.includes('nc -z')) return { exitCode: 0, stdout: 'PORT_UP', stderr: '' };
    return this.commandResult;
  }
  async getPortUrl(_ws: string, port: number): Promise<string> {
    return `https://sandbox-${port}.example.dev`;
  }
}

export function toolCall(name: string, input: Record<string, unknown>, id = 't1'): ToolUse {
  return { id, name, input };
}

export function makeDispatcher(opts?: {
  onFileWrite?: (path: string, content: string) => void;
}) {
  const act = new FakeActuator();
  const stream = new AgentEventStream();
  const events: AgentEvent[] = [];
  stream.subscribe((e) => events.push(e), false);
  const state = new WorkspaceState(stream);
  const d = new ToolDispatcher(
    act, 'ws-1', state, stream,
    undefined, undefined, undefined, undefined, undefined, undefined,
    opts?.onFileWrite,
  );
  return { act, d, events, state, stream };
}
