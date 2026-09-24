/**
 * "BUILDER BHATAKTA THA" — the admin asked for the full builder's wandering to be fixed (2026-09-24).
 * Two causes were found in build f15a9bcc's own report, and both were ours, not the model's.
 *
 * 1. A FRESH SUB-AGENT WAS TOLD IT ALREADY HAD A FILE IT HAD NEVER SEEN. Since f97eb0ec the read
 *    ledger is shared with sub-agents so the build REPORT counts their re-reads — correct. But the same
 *    ledger also drove the NOTICE, so a sub-agent's FIRST read of a file the architect had read came
 *    back with "you have now read X the 6th time … you already have it", and the reviewer was told
 *    "[STOP — … Do not read this path again]" about a file it had never opened. A model told it holds
 *    context it does not hold works blind.
 * 2. A REPAIR PASS PAGED THROUGH OUR OWN SCRIPT. Twelve `sed -n` reads of the sandbox index.html,
 *    chasing a 502 inside NavBharatAI's 330-line preview console mirror as if it were the app.
 */
import { describe, it, expect } from 'vitest';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { bridgeLineRange, bridgeShellNote, injectPreviewBridge, PREVIEW_BRIDGE_MARKER } from '../src/server/AgentV3/previewBridge';

class FakeActuator implements ActuatorPort {
  files = new Map<string, string>();
  stdout = '';
  async readFile(_ws: string, path: string): Promise<string> {
    const f = this.files.get(path);
    if (f === undefined) throw new Error(`ENOENT: ${path}`);
    return f;
  }
  async writeFile(_ws: string, path: string, content: string): Promise<void> { this.files.set(path, content); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: this.stdout, stderr: '' }; }
  async getPortUrl(_ws: string, port: number): Promise<string> { return `https://sandbox-${port}.example.dev`; }
}

const mk = (act: FakeActuator) => {
  const stream = new AgentEventStream();
  return new ToolDispatcher(act, 'ws-1', new WorkspaceState(stream), stream);
};
const read = (d: ToolDispatcher, path: string, id: string) => d.dispatch({ id, name: 'read_file', input: { path } }, 'architect').then((r) => String(r.content));

describe('a read notice speaks about THIS agent’s context', () => {
  it('a sub-agent’s first read of a file the architect already read carries no notice', async () => {
    const act = new FakeActuator();
    act.files.set('src/Ctx.tsx', 'export const x = 1;');
    const parent = mk(act);
    for (let i = 0; i < 6; i++) await read(parent, 'src/Ctx.tsx', `p${i}`); // the architect reads it six times
    const child = mk(act);
    child.shareReadLedger(parent.sharedReadLedger()); // as SubAgent does, for the report
    const first = await read(child, 'src/Ctx.tsx', 'c1');
    expect(first).not.toMatch(/NOTE — you have now read|STOP —/);
    expect(first).toContain('export const x = 1;');
  });

  it('…while the build’s own count still sees every read, across agents (the f97eb0ec measurement)', async () => {
    const act = new FakeActuator();
    act.files.set('src/Ctx.tsx', 'export const x = 1;');
    const parent = mk(act);
    await read(parent, 'src/Ctx.tsx', 'p1');
    const child = mk(act);
    child.shareReadLedger(parent.sharedReadLedger());
    await read(child, 'src/Ctx.tsx', 'c1');
    expect(parent.readLedgerCounts().get('src/Ctx.tsx')).toBe(2);
  });

  it('an agent that really does re-read its own unchanged file is still nudged, then stopped', async () => {
    const act = new FakeActuator();
    act.files.set('src/Ctx.tsx', 'export const x = 1;');
    const d = mk(act);
    await read(d, 'src/Ctx.tsx', 'r1');
    expect(await read(d, 'src/Ctx.tsx', 'r2')).toMatch(/NOTE — you have now read src\/Ctx\.tsx the second time/);
    await read(d, 'src/Ctx.tsx', 'r3');
    expect(await read(d, 'src/Ctx.tsx', 'r4')).toMatch(/^\[STOP —/);
  });
});

describe('our preview script is named as ours when a shell command touches index.html', () => {
  const app = '<!DOCTYPE html>\n<html>\n  <head>\n    <title>Vendor</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>\n';
  const bridged = injectPreviewBridge(app);

  it('finds the script’s exact line range', () => {
    expect(bridged).toContain(PREVIEW_BRIDGE_MARKER);
    const r = bridgeLineRange(bridged)!;
    const lines = bridged.split('\n');
    expect(lines[r.from - 1]).toMatch(/<script\b/);
    expect(lines[r.to - 1]).toMatch(/<\/script>/);
    expect(lines.slice(r.from - 1, r.to).join('\n')).toContain(PREVIEW_BRIDGE_MARKER);
    expect(bridgeLineRange(app)).toBeNull();
    expect(bridgeShellNote(app)).toBe('');
  });

  it('a bash read of index.html gets the note; any other command does not', async () => {
    const act = new FakeActuator();
    act.files.set('index.html', bridged);
    act.stdout = 'some lines';
    const d = mk(act);
    const onIndex = String((await d.dispatch({ id: 'b1', name: 'bash', input: { command: "sed -n '40,80p' index.html" } }, 'architect')).content);
    expect(onIndex).toMatch(/NavBharatAI's own live-preview script/);
    expect(onIndex).toMatch(/NOT part of this app/);
    const other = String((await d.dispatch({ id: 'b2', name: 'bash', input: { command: 'ls src' } }, 'architect')).content);
    expect(other).not.toMatch(/live-preview script/);
  });

  it('a clean index.html adds nothing', async () => {
    const act = new FakeActuator();
    act.files.set('index.html', app);
    const d = mk(act);
    const out = String((await d.dispatch({ id: 'b1', name: 'bash', input: { command: 'cat index.html' } }, 'architect')).content);
    expect(out).not.toMatch(/live-preview script/);
  });
});

// ── 3. THE HANDOFF CARRIES THE FILES, NOT ONLY A SENTENCE ──────────────────────────────────────
import { filesNamedIn, collectHandoff, handoffBlock, HANDOFF_MAX_FILES, HANDOFF_MAX_FILE_CHARS } from '../src/server/AgentV3/taskHandoff';
import { makeSubAgentSpawn } from '../src/server/AgentV3/SubAgent';
import { ClaudeClient, type MessagesCreateClient } from '../src/server/AgentV3/ClaudeClient';

describe('a specialist is handed the files its task names', () => {
  it('finds project paths in an instruction, and nothing that is not one', () => {
    const got = filesNamedIn(
      'Update `src/BusinessContext.tsx` and src/Dashboard.tsx (see ./src/index.css). Also check index.html and package.json. '
      + 'Docs: https://example.com/src/fake.ts — do not touch node_modules/react/index.js. src/BusinessContext.tsx again.',
    );
    expect(got).toEqual(['src/BusinessContext.tsx', 'src/Dashboard.tsx', 'src/index.css', 'index.html', 'package.json']);
  });

  it('is bounded: file count, per-file size and total size', async () => {
    const many = Array.from({ length: 10 }, (_, i) => `src/F${i}.ts`).join(' ');
    const got = await collectHandoff(many, async () => 'x');
    expect(got).toHaveLength(HANDOFF_MAX_FILES);
    const big = await collectHandoff('src/Big.ts src/Ok.ts', async (p) => (p === 'src/Big.ts' ? 'y'.repeat(HANDOFF_MAX_FILE_CHARS + 1) : 'ok'));
    expect(big.map((f) => f.path)).toEqual(['src/Ok.ts']); // too big is simply not attached
    const failing = await collectHandoff('src/Gone.ts src/Here.ts', async (p) => { if (p === 'src/Gone.ts') throw new Error('ENOENT'); return 'here'; });
    expect(failing.map((f) => f.path)).toEqual(['src/Here.ts']);
    expect(handoffBlock([])).toBe('');
  });

  it('END TO END: the spawned specialist receives the file, and re-reading it unchanged is called what it is', async () => {
    const act = new FakeActuator();
    act.files.set('src/BusinessContext.tsx', 'export const useBusiness = () => 1;');
    const stream = new AgentEventStream();
    const sent: string[] = [];
    let i = 0;
    const script = [
      { content: [{ type: 'tool_use', id: 'r1', name: 'read_file', input: { path: 'src/BusinessContext.tsx' } }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } },
      { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' },
    ];
    const raw: MessagesCreateClient = {
      messages: {
        create: async (req: { messages?: Array<{ content: unknown }> }) => {
          sent.push(JSON.stringify(req.messages ?? []));
          return (script[i++] ?? script[1]) as never;
        },
      },
    };
    const spawn = makeSubAgentSpawn({ client: new ClaudeClient(raw), actuator: act, workspaceId: 'ws-h', state: new WorkspaceState(stream), events: stream, model: 'm' });
    await spawn('frontend', 'Add a share button to src/Dashboard.tsx using useBusiness from src/BusinessContext.tsx');
    expect(sent[0]).toContain('export const useBusiness = () => 1;'); // handed over in the task itself
    expect(sent[0]).toContain('You already have them');
    expect(sent[1]).toMatch(/NOTE — you have now read src\/BusinessContext\.tsx the second time/); // honest: it WAS handed over
  });
});
