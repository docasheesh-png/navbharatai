/**
 * THE CALL THAT WAS RUNNING WHEN THE USER PRESSED STOP IS ON THE RECORD, AND A DROPPED IMAGE IS SAID ALOUD
 * (autopsy 15e69839, 2026-10-12).
 *
 * After the app rendered, one model call ran for ~3 minutes; the user pressed Stop. The report's `llmCalls` ended
 * at the call BEFORE it, `PROVIDER_TIME_WASTED` said "calls=0", and nothing anywhere said a call had been running
 * for three minutes — the one fact that explained the silence. The stop path returned before the recorder ran.
 *
 * And the call it was waiting on had been asked to "inspect" a screenshot that never reached it: the Chat
 * Completions format carries text only, so KIMI/GLM/NEMOTRON got "The image is attached" and no image.
 */
import { describe, it, expect } from 'vitest';
import { AgentRunner } from '../src/server/AgentV3/AgentRunner';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { defaultToolCatalog } from '../src/server/AgentV3/ToolCatalog';
import { BuildStoppedError } from '../src/server/AgentV3/stopSignal';
import { transcriptToOpenAI, IMAGE_NOT_SHOWN_NOTE } from '../src/server/AgentV3/providers/OpenAiToolAdapter';
import { wasteSummary, emptyWasteLedger } from '../src/server/AgentV3/providerWaste';

class FakeActuator implements ActuatorPort {
  files = new Map<string, string>();
  async readFile(_w: string, p: string): Promise<string> { const f = this.files.get(p); if (f === undefined) throw new Error(`ENOENT: ${p}`); return f; }
  async writeFile(_w: string, p: string, c: string): Promise<void> { this.files.set(p, c); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}

describe('the call in flight at Stop', () => {
  it('🔒 is recorded as a stopped call, with how long it had been running', async () => {
    const controller = new AbortController();
    const calls: Array<{ ok: boolean; error?: string; latencyMs: number }> = [];
    const stream = new AgentEventStream();
    const state = new WorkspaceState(stream);
    const runner = new AgentRunner({
      client: {
        // A provider that thinks until the build is stopped.
        runTurn: () => new Promise((_res, rej) => {
          controller.signal.addEventListener('abort', () => rej(new BuildStoppedError()));
        }),
      } as never,
      dispatcher: new ToolDispatcher(new FakeActuator(), 'ws-stop', state, stream),
      state,
      events: stream,
      model: 'kimi-k2.7-code',
      system: 'You are the Architect.',
      tools: defaultToolCatalog(),
      signal: controller.signal,
      onLlmCall: ((c: { ok: boolean; error?: string; latencyMs: number }) => calls.push(c)) as never,
    });
    const done = runner.run('build');
    await new Promise((r) => setTimeout(r, 120));
    controller.abort();
    await done;
    expect(calls).toHaveLength(1);
    expect(calls[0].ok).toBe(false);
    expect(calls[0].error).toBe(new BuildStoppedError().message);
    expect(calls[0].latencyMs).toBeGreaterThanOrEqual(100);
  });

  it('the "no time wasted" line says a user-stopped call is listed elsewhere, not that none ran', () => {
    expect(wasteSummary(emptyWasteLedger())).toMatch(/or by the user.*LLM_CALL_STOPPED/);
  });
});

describe('an image a text-only model cannot receive', () => {
  it('🔒 a screenshot tool result keeps its text and says the picture was not shown', () => {
    const out = transcriptToOpenAI([
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'screenshot', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [
        { type: 'text', text: 'Screenshot taken. The image is attached — inspect it.' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
      ] }] },
    ]);
    const tool = out.find((m) => (m as { role: string }).role === 'tool') as { content: string };
    expect(tool.content).toContain('Screenshot taken.');
    expect(tool.content).toContain(IMAGE_NOT_SHOWN_NOTE);
  });

  it('a photo the user attached is not silently dropped either', () => {
    const out = transcriptToOpenAI([{ role: 'user', content: [
      { type: 'text', text: 'make this' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
    ] }]);
    expect(JSON.stringify(out)).toContain('cannot receive images');
  });

  it('a result with no image is unchanged', () => {
    const out = transcriptToOpenAI([
      { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'read_file', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'file body' }] }] },
    ]);
    expect(JSON.stringify(out)).not.toContain('cannot receive images');
  });
});
