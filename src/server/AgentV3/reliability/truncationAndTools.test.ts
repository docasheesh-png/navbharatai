import { describe, it, expect, afterEach } from 'vitest';
import { PendingWrites, salvageTruncatedContent, truncatedWriteNotice, PARTIAL_CONTENT_KEY } from './resumeWrite';
import { modelMaxOutputTokens, streamingBudget } from './streamBudget';
import { bannedInstallRefusal, bannedPackagesInCommand, stripBannedDeps } from './bannedPackages';
import { modularizePrompt, moduleText, FILE_SIZE_RULE } from './modularPrompt';
import { CORE_TOOL_NAMES, DynamicToolset } from './coreToolset';
import { parseOpenAiCompletion } from '../providers/OpenAiToolAdapter';
import { architectSystemPrompt } from '../systemPrompt';
import { catalogForTools } from '../ToolCatalog';
import { roleConfig } from '../AgentRegistry';
import { ToolDispatcher, type ActuatorPort } from '../ToolDispatcher';
import { WorkspaceState } from '../WorkspaceState';
import { AgentEventStream } from '../AgentEventStream';

afterEach(() => {
  delete process.env.AGENTV3_RESUME_TRUNCATED;
  delete process.env.AGENTV3_BANNED_PACKAGE_GUARD;
});

describe('P2b salvageTruncatedContent', () => {
  it('decodes the partial content exactly, dropping a half-written escape', () => {
    expect(salvageTruncatedContent('{"path":"a.ts","content":"line1\\nline2\\')).toBe('line1\nline2');
    expect(salvageTruncatedContent('{"path":"a.ts","content":"x \\u00')).toBe('x ');
    expect(salvageTruncatedContent('{"path":"a.ts","content":"say \\"hi\\" ok')).toBe('say "hi" ok');
    expect(salvageTruncatedContent('{"path":"a.ts"')).toBeNull();
  });

  it('the adapter carries the partial ONLY when the flag is on', () => {
    const completion = { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function' as const, function: { name: 'write_file', arguments: '{"path":"src/App.tsx","content":"import React' } }] }, finish_reason: 'length' }] };
    expect(parseOpenAiCompletion(completion).toolUses[0].input).toEqual({ path: 'src/App.tsx' });
    process.env.AGENTV3_RESUME_TRUNCATED = 'on';
    expect(parseOpenAiCompletion(completion).toolUses[0].input).toEqual({ path: 'src/App.tsx', [PARTIAL_CONTENT_KEY]: 'import React' });
  });

  it('PendingWrites buffers and a notice shows the tail', () => {
    const p = new PendingWrites();
    p.start('a.ts', 'abc');
    expect(p.append('a.ts', 'def')).toBe('abcdef');
    expect(p.take('a.ts')).toBe('abcdef');
    expect(p.has('a.ts')).toBe(false);
    expect(truncatedWriteNotice('a.ts', 'hello')).toMatch(/NOT saved/);
  });
});

class FakeActuator implements ActuatorPort {
  files = new Map<string, string>();
  commands: string[] = [];
  async readFile(_ws: string, path: string): Promise<string> {
    const f = this.files.get(path);
    if (f === undefined) throw new Error(`ENOENT: ${path}`);
    return f;
  }
  async writeFile(_ws: string, path: string, content: string): Promise<void> { this.files.set(path, content); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand(_ws: string, command: string) { this.commands.push(command); return { exitCode: 0, stdout: '', stderr: '' }; }
  async getPortUrl(_ws: string, port: number): Promise<string> { return `https://sandbox-${port}.example.dev`; }
}

function dispatcher(): { d: ToolDispatcher; act: FakeActuator } {
  const act = new FakeActuator();
  const stream = new AgentEventStream();
  const d = new ToolDispatcher(act, 'ws-rel', new WorkspaceState(stream), stream);
  return { d, act };
}

describe('P2b dispatcher: a cut-off write is never persisted; append_file finishes it', () => {
  it('buffers the partial, then writes the whole file only on done:true', async () => {
    process.env.AGENTV3_RESUME_TRUNCATED = 'on';
    const { d, act } = dispatcher();
    const r1 = await d.dispatch({ id: '1', name: 'write_file', input: { path: 'src/util.ts', [PARTIAL_CONTENT_KEY]: 'export const a = 1;\nexport const b' } }, 'architect');
    expect(r1.content).toMatch(/NOT saved/);
    expect(act.files.has('src/util.ts')).toBe(false);
    await d.dispatch({ id: '2', name: 'append_file', input: { path: 'src/util.ts', content: ' = 2;\n' } }, 'architect');
    expect(act.files.has('src/util.ts')).toBe(false);
    const r3 = await d.dispatch({ id: '3', name: 'append_file', input: { path: 'src/util.ts', content: 'export const c = 3;\n', done: true } }, 'architect');
    expect(r3.is_error).toBe(false);
    expect(act.files.get('src/util.ts')).toBe('export const a = 1;\nexport const b = 2;\nexport const c = 3;\n');
  });
});

describe('P5b banned packages', () => {
  it('finds banned packages in install commands', () => {
    expect(bannedPackagesInCommand('npm install xlsx react && npm i -D @types/uuid')).toEqual(['xlsx', '@types/uuid']);
    expect(bannedInstallRefusal('npm install exceljs')).toBeNull();
    expect(bannedInstallRefusal('npm install uuid')).toMatch(/randomUUID/);
  });

  it('strips banned deps from package.json', () => {
    const r = stripBannedDeps(JSON.stringify({ dependencies: { react: '^18', xlsx: '0.18.5' }, devDependencies: { '@types/uuid': '^10' } }, null, 2));
    expect(r.removed).toEqual(['xlsx', '@types/uuid']);
    expect(JSON.parse(r.content)).toEqual({ dependencies: { react: '^18' }, devDependencies: {} });
  });

  it('dispatcher refuses the install (nothing runs) only when the flag is on', async () => {
    const { d, act } = dispatcher();
    process.env.AGENTV3_BANNED_PACKAGE_GUARD = 'on';
    const r = await d.dispatch({ id: 'b', name: 'bash', input: { command: 'npm install xlsx' } }, 'architect');
    expect(r.is_error).toBe(true);
    expect(r.content).toMatch(/Not run/);
    expect(act.commands.some((c) => c.includes('npm install xlsx'))).toBe(false);
  });
});

describe('P2a stream budget', () => {
  it('gives the caller its ask up to the model ceiling, never less than the clamp', () => {
    const clamped = { maxTokens: 4833, clamped: true, requested: 32000 };
    expect(streamingBudget(32000, 'kimi-k2.7-code', clamped).maxTokens).toBe(32000);
    expect(streamingBudget(32000, 'unknown-model', clamped, {}).maxTokens).toBe(16000);
    expect(streamingBudget(2000, 'glm-5.3', clamped).maxTokens).toBe(4833);
    expect(modelMaxOutputTokens('glm-4-flash')).toBe(16000);
  });
});

describe('P5a modular prompt', () => {
  const full = architectSystemPrompt('react-vite', {});

  it('a todo app drops the game/full-stack/python modules and lists them on demand', () => {
    const r = modularizePrompt(full, 'ek simple todo app banao');
    expect(r.deferred).toEqual(expect.arrayContaining(['games', 'fullstack', 'python']));
    expect(r.charsAfter).toBeLessThan(r.charsBefore * 0.8);
    expect(r.prompt).toContain('ON-DEMAND GUIDES');
    expect(r.prompt).not.toContain('GAMES ARE BUILT WITH THE GAME TOOLS');
    // The core identity / rules stay.
    expect(r.prompt).toContain('You are NavBharatAI Pro');
    expect(r.prompt).toContain('WHO CREATED YOU');
  });

  it('a game request keeps the game module; read_guide text is the original text', () => {
    expect(modularizePrompt(full, 'snake game banao').loaded).toContain('games');
    expect(moduleText(full, 'games')).toContain('GAMES ARE BUILT WITH THE GAME TOOLS');
  });

  it('nothing deferred ⇒ the prompt is unchanged', () => {
    const all = modularizePrompt(full, 'x', ['games', 'fullstack', 'python', 'ai-in-app', 'secrets', 'android', 'finishing']);
    expect(all.prompt).toBe(full);
  });

  it('the 200-line rule exists', () => {
    expect(FILE_SIZE_RULE).toMatch(/200 LINES/);
  });
});

describe('P5c core toolset', () => {
  it('offers the core tools + load_tools, and loads more on demand', () => {
    const all = catalogForTools(roleConfig('architect').tools);
    const ts = new DynamicToolset(all);
    const offered = ts.offered();
    expect(offered).toContain('load_tools');
    expect(offered.filter((n) => n !== 'load_tools').every((n) => CORE_TOOL_NAMES.includes(n))).toBe(true);
    const fullChars = JSON.stringify(all).length;
    const slimChars = JSON.stringify(ts.tools).length;
    expect(slimChars).toBeLessThan(fullChars * 0.75);
    const extra = all.find((t) => !CORE_TOOL_NAMES.includes(t.name))!;
    expect(ts.load([extra.name, 'nope'])).toMatch(/Loaded: .*Unknown tool/s);
    expect(ts.offered()).toContain(extra.name);
  });
});
