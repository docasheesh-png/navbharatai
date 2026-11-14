// THE BUILDER IS NEVER SENT BASE64 MEDIA, AND AN EDIT CANNOT CORRUPT IT (single-file game autopsy, 2026-11-14).
//
// Class lock, not instance: a page of ANY shape that still holds a video / sound / image as base64 must reach the model as a short
// placeholder — through the user's request, through every tool result — and an edit that would drop, invent, or break the page
// is refused with the previous version left on disk. These tests drive the REAL AgentRunner and the REAL ToolDispatcher.
import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRunner } from '../src/server/AgentV3/AgentRunner';
import { ClaudeClient, type MessagesCreateClient } from '../src/server/AgentV3/ClaudeClient';
import { ToolDispatcher, type ActuatorPort } from '../src/server/AgentV3/ToolDispatcher';
import { WorkspaceState } from '../src/server/AgentV3/WorkspaceState';
import { AgentEventStream } from '../src/server/AgentV3/AgentEventStream';
import { defaultToolCatalog } from '../src/server/AgentV3/ToolCatalog';
import { clearPreviewGaveUp } from '../src/server/AgentV3/previewGiveUp';
import { buildGameFixture, fixtureMedia, longBase64Runs, b64 } from './helpers/singleFileGameFixture';

class FakeActuator implements ActuatorPort {
  files = new Map<string, string>();
  async readFile(_w: string, p: string): Promise<string> { const f = this.files.get(p); if (f === undefined) throw new Error('ENOENT: ' + p); return f; }
  async writeFile(_w: string, p: string, c: string): Promise<void> { this.files.set(p, c); }
  async listFiles(): Promise<string[]> { return [...this.files.keys()]; }
  async runCommand() { return { exitCode: 0, stdout: '', stderr: '' }; }
}

const GAME = buildGameFixture(fixtureMedia(3)).html; // ~2 MB of the real shape, media inline (a legacy page, a git clone, a paste)

/** Everything a model could read in a request body: all strings, however nested. */
function allText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(allText).join('\n');
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).map(allText).join('\n');
  return '';
}

describe('CLASS LOCK — nothing the model is sent carries base64 media', () => {
  function runnerWith(script: unknown[]) {
    const sent: unknown[][] = [];
    let i = 0;
    const raw: MessagesCreateClient = { messages: { create: async (params: { messages: unknown[] }) => {
      sent.push(JSON.parse(JSON.stringify(params.messages)));
      const m = script[i] ?? { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' };
      i++;
      return m as never;
    } } };
    const actuator = new FakeActuator();
    actuator.files.set('index.html', GAME);
    const stream = new AgentEventStream();
    const state = new WorkspaceState(stream);
    const dispatcher = new ToolDispatcher(actuator, 'ws-1', state, stream);
    const runner = new AgentRunner({ client: new ClaudeClient(raw), dispatcher, state, events: stream, model: 'm', system: 'S', tools: defaultToolCatalog() });
    return { runner, sent, actuator };
  }

  it('a read_file of a game page that holds its media reaches the model as placeholders', async () => {
    const { runner, sent } = runnerWith([
      { content: [{ type: 'tool_use', id: 'r1', name: 'read_file', input: { path: 'index.html' } }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } },
      { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } },
    ]);
    await runner.run('add a shelf item called Dal');
    const second = allText(sent[1]);
    expect(second).toContain('addShelfItem'); // the code is there to edit…
    expect(longBase64Runs(second, 200)).toEqual([]); // …and not one media payload
    expect(second).toContain('media omitted');
    expect(second.length).toBeLessThan(GAME.length / 20);
  });

  it('a bash cat of the page is elided the same way — every tool result goes through the one door', async () => {
    const { runner, sent, actuator } = runnerWith([
      { content: [{ type: 'tool_use', id: 'b1', name: 'bash', input: { command: 'cat index.html' } }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } },
      { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } },
    ]);
    (actuator as unknown as { runCommand: () => Promise<unknown> }).runCommand = async () => ({ exitCode: 0, stdout: GAME, stderr: '' });
    await runner.run('look at the page');
    expect(longBase64Runs(allText(sent[1]), 200)).toEqual([]);
  });

  it('the USER REQUEST itself — a pasted or attached game — is elided before the first model call', async () => {
    const { runner, sent } = runnerWith([{ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }]);
    await runner.run('Make the shelves bigger in this game:\n\n' + GAME);
    const first = allText(sent[0]);
    expect(longBase64Runs(first, 200)).toEqual([]);
    expect(first).toContain('Make the shelves bigger');
    expect(first).toContain('atob(window.__introB64)');
  });

  it('a page with NO media is sent untouched (the elision costs ordinary builds nothing)', async () => {
    const code = '<html><body><script>' + 'var x = 1;\n'.repeat(400) + '</script></body></html>';
    const { runner, sent, actuator } = runnerWith([
      { content: [{ type: 'tool_use', id: 'r1', name: 'read_file', input: { path: 'index.html' } }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } },
      { content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } },
    ]);
    actuator.files.set('index.html', code);
    await runner.run('hi');
    expect(allText(sent[1])).toContain('var x = 1;\nvar x = 1;');
    expect(allText(sent[1])).not.toContain('media omitted');
  });
});

describe('an AI edit to a game page is checked before it is kept', () => {
  let act: FakeActuator;
  let d: ToolDispatcher;
  const write = (content: string, path = 'index.html') => d.dispatch({ id: 'w', name: 'write_file', input: { path, content } }, 'architect');
  const edit = (old_string: string, new_string: string, path = 'index.html') => d.dispatch({ id: 'e', name: 'edit_file', input: { path, old_string, new_string } }, 'architect');

  beforeEach(() => {
    act = new FakeActuator();
    act.files.set('index.html', GAME);
    const stream = new AgentEventStream();
    clearPreviewGaveUp('ws-1');
    d = new ToolDispatcher(act, 'ws-1', new WorkspaceState(stream), stream);
  });

  it('a targeted edit (add an item) lands, and EVERY media byte is still there', async () => {
    const res = await edit('shelf.items.push({ name: name, price: price });', 'shelf.items.push({ name: name, price: price, stock: 10 });');
    expect(res.is_error).toBeFalsy();
    const after = act.files.get('index.html')!;
    expect(after).toContain('stock: 10');
    expect(after.replace('stock: 10', '').replace(', price: price }', ', price: price }')).toBeTruthy();
    expect(after.length).toBe(GAME.length + ', stock: 10'.length);
    for (const run of longBase64Runs(GAME, 200)) expect(after).toContain(run);
  });

  it('a whole-file rewrite that carries the model\'s placeholders is REFUSED, and the page is untouched', async () => {
    const shown = (await import('../src/lib/embeddedMedia')).elideEmbeddedMedia(GAME).text;
    const res = await write(shown.replace('price: 230', 'price: 240'));
    expect(res.content).toMatch(/media omitted|never rewrite/i);
    expect(act.files.get('index.html')).toBe(GAME);
  });

  it('a rewrite that DROPS the media is REFUSED', async () => {
    const res = await write(GAME.replace(/window\.__introB64="[A-Za-z0-9+/=]+"/, 'window.__introB64=""'));
    expect(res.content).toMatch(/delete \d+ embedded media/);
    expect(act.files.get('index.html')).toBe(GAME);
  });

  it('a made-up base64 payload is REFUSED — media is a file, never code', async () => {
    const invented = b64(fixtureMedia().png);
    const res = await edit('var tiny =', `var fake = 'data:image/png;base64,${invented}'; var tiny =`);
    expect(res.content).toMatch(/adds \d+ embedded base64/);
    expect(act.files.get('index.html')).toBe(GAME);
  });

  it('an edit that breaks the page\'s inline JavaScript is REFUSED — the game would be a black screen', async () => {
    const res = await edit('function addShelfItem(name, price) {', 'function addShelfItem(name, price) { if (');
    expect(res.content).toMatch(/JavaScript|no longer parses/i);
    expect(act.files.get('index.html')).toBe(GAME);
  });

  it('an edit that cuts the page off (removes </body></html>) is REFUSED', async () => {
    const res = await edit('</script></body></html>', '</script>');
    expect(res.content).toMatch(/closing|cut off/i);
    expect(act.files.get('index.html')).toBe(GAME);
  });

  it('a reference to an assets/media file that does not exist is REFUSED; once the file exists it is allowed', async () => {
    const add = "var extra = new Audio('assets/media/audio-0123456789.mp3');\nvar shelf =";
    const refused = await edit('var shelf =', add);
    expect(refused.content).toMatch(/do not exist/i);
    expect(act.files.get('index.html')).toBe(GAME);
    act.files.set('assets/media/audio-0123456789.mp3', 'x');
    const ok = await edit('var shelf =', add);
    expect(ok.is_error).toBeFalsy();
    expect(act.files.get('index.html')).toContain('audio-0123456789.mp3');
  });

  it('a page that was ALREADY broken may be repaired step by step (only a regression is refused)', async () => {
    const broken = '<html><body><script>function a( {</script></body></html>';
    act.files.set('index.html', broken);
    const res = await write('<html><body><script>function a() {}</script></body></html>');
    expect(res.is_error).toBeFalsy();
    expect(act.files.get('index.html')).toContain('function a() {}');
  });

  it('only HTML pages are judged: the same wording in a .js file is not touched by this guard', async () => {
    act.files.set('notes.txt', 'hello');
    const res = await write('window.__introB64 = "oops";', 'notes.txt');
    expect(res.is_error).toBeFalsy();
  });

  it('AGENTV3_EDIT_INTEGRITY=off restores the old behaviour (kill switch)', async () => {
    process.env.AGENTV3_EDIT_INTEGRITY = 'off';
    try {
      const res = await edit('</script></body></html>', '</script>');
      expect(res.is_error).toBeFalsy();
    } finally { delete process.env.AGENTV3_EDIT_INTEGRITY; }
  });
});
