/**
 * The cursor tool's arithmetic and the combo dispatcher, without a browser (admin 2026-09-24, the
 * CUSTOM face). The real-browser proof is `scripts/ideShortcutAudit/`; this locks the decisions.
 */
import { describe, it, expect } from 'vitest';
import { cursorMove, shrink, cursorAll, toggleCursorMode } from '../src/components/ide/cursorTool';
import { dispatchCombo, applyCursorTool, type EditorLike } from '../src/components/ide/dispatchCombo';
import { resolveCombo, type TableEntry } from '../src/components/ide/keyCombo';

const lines = { lineCount: 5, lineMaxColumn: (l: number) => (l === 3 ? 1 : 11) }; // line 3 is empty

describe('cursorMove — what an arrow does', () => {
  const sel = { startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 3 };
  it('neutral moves, select extends', () => {
    expect(cursorMove('left', 'neutral', false, sel, lines)).toEqual({ kind: 'command', id: 'cursorLeft' });
    expect(cursorMove('down', 'select', false, sel, lines)).toEqual({ kind: 'command', id: 'cursorDownSelect' });
  });
  it('chord turns ← and → into Backspace and Delete, ↑↓ still move', () => {
    expect(cursorMove('left', 'select', true, sel, lines)).toEqual({ kind: 'command', id: 'deleteLeft' });
    expect(cursorMove('right', 'neutral', true, sel, lines)).toEqual({ kind: 'command', id: 'deleteRight' });
    expect(cursorMove('up', 'deselect', true, sel, lines)).toEqual({ kind: 'command', id: 'cursorUp' });
  });
  it('deselect returns a new selection', () => {
    const r = cursorMove('right', 'deselect', false, { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6 }, lines);
    expect(r).toEqual({ kind: 'setSelection', selection: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 5 } });
  });
});

describe('shrink — deselect from either end, never inverting', () => {
  it('← gives up the first character; → the last', () => {
    const s = { startLineNumber: 1, startColumn: 2, endLineNumber: 1, endColumn: 8 };
    expect(shrink('left', s, lines).startColumn).toBe(3);
    expect(shrink('right', s, lines).endColumn).toBe(7);
  });
  it('crosses a line boundary at the edge of a line', () => {
    expect(shrink('left', { startLineNumber: 1, startColumn: 11, endLineNumber: 2, endColumn: 4 }, lines)).toMatchObject({ startLineNumber: 2, startColumn: 1 });
    expect(shrink('right', { startLineNumber: 1, startColumn: 3, endLineNumber: 2, endColumn: 1 }, lines)).toMatchObject({ endLineNumber: 1, endColumn: 11 });
  });
  it('↑ drops the last line, ↓ the first; on one line they collapse toward the anchor', () => {
    expect(shrink('up', { startLineNumber: 1, startColumn: 1, endLineNumber: 3, endColumn: 1 }, lines).endLineNumber).toBe(2);
    expect(shrink('down', { startLineNumber: 1, startColumn: 1, endLineNumber: 3, endColumn: 1 }, lines).startLineNumber).toBe(2);
    expect(shrink('up', { startLineNumber: 2, startColumn: 2, endLineNumber: 2, endColumn: 6 }, lines)).toMatchObject({ endColumn: 2 });
  });
  it('an empty selection stays empty', () => {
    const e = { startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 3 };
    for (const m of ['left', 'right', 'up', 'down'] as const) expect(shrink(m, e, lines)).toEqual(e);
  });
});

describe('ALL and the mode toggle', () => {
  it('ALL selects, or with chord deletes', () => {
    expect(cursorAll(false)).toEqual({ kind: 'selectAll' });
    expect(cursorAll(true)).toEqual({ kind: 'deleteAll' });
  });
  it('pressing the active mode returns to neutral', () => {
    expect(toggleCursorMode('neutral', 'select')).toBe('select');
    expect(toggleCursorMode('select', 'select')).toBe('neutral');
    expect(toggleCursorMode('select', 'deselect')).toBe('deselect');
  });
});

/** These suites run in Node, where `KeyboardEvent` does not exist; the dispatcher only needs its shape. */
class FakeKeyboardEvent {
  type: string; key: string; keyCode: number; defaultPrevented = false;
  constructor(type: string, init: { key?: string; keyCode?: number } = {}) { this.type = type; this.key = init.key ?? ''; this.keyCode = init.keyCode ?? 0; }
  preventDefault() { this.defaultPrevented = true; }
}
(globalThis as unknown as { KeyboardEvent: unknown }).KeyboardEvent = FakeKeyboardEvent;

/** A fake editor that records what was asked of it. */
function fakeEditor(opts: { consume?: boolean } = {}) {
  const log: string[] = [];
  const el = {
    dispatchEvent: (e: Event) => { log.push(`event:${e.type}:${(e as KeyboardEvent).key}:${(e as unknown as { keyCode: number }).keyCode}`); return !opts.consume; },
    querySelector: () => null,
  };
  const ed: EditorLike = {
    focus: () => { log.push('focus'); },
    trigger: (_s, id, payload) => { log.push(`trigger:${id}:${JSON.stringify(payload)}`); },
    getDomNode: () => el as unknown as HTMLElement,
    getSelection: () => ({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 4 }),
    setSelection: (s) => { log.push(`select:${JSON.stringify(s)}`); },
    getModel: () => ({ getLineCount: () => 3, getLineMaxColumn: () => 9, getFullModelRange: () => 'FULL' }),
    executeEdits: (_s, edits) => { log.push(`edit:${JSON.stringify(edits)}`); },
  };
  return { ed, log };
}
const table: TableEntry[] = [{ key: 'ctrl+a', label: 'Select All', command: 'editor.action.selectAll', keys: ['Ctrl', 'A'] }];

describe('dispatchCombo — every outcome is said in words', () => {
  it('a table match runs the SAME handler the dropdown runs', () => {
    const ran: unknown[] = [];
    const out = dispatchCombo(resolveCombo('ctrl+a', table), null, (keys, cmd) => ran.push([keys, cmd]));
    expect(ran).toEqual([[['Ctrl', 'A'], 'editor.action.selectAll']]);
    expect(out).toEqual({ ok: true, message: 'Ran "Select All" (CTRL+A).' });
  });
  it('a bare character is typed into a focused editor', () => {
    const { ed, log } = fakeEditor();
    expect(dispatchCombo(resolveCombo('x', table), ed, () => {}).ok).toBe(true);
    expect(log).toEqual(['focus', 'trigger:type:{"text":"x"}']);
  });
  it('a key event reaches the editor with the legacy keyCode, and reports whether it was consumed', () => {
    const consumed = fakeEditor({ consume: true });
    const out = dispatchCombo(resolveCombo('ctrl+shift+k', table), consumed.ed, () => {});
    expect(out).toEqual({ ok: true, message: 'Sent CTRL+SHIFT+K to the editor.' });
    expect(consumed.log).toEqual(['focus', 'event:keydown:K:75', 'event:keyup:K:75']);
    const ignored = fakeEditor({ consume: false });
    expect(dispatchCombo(resolveCombo('ctrl+shift+k', table), ignored.ed, () => {})).toMatchObject({ ok: false, message: expect.stringContaining('not bound') });
  });
  it('without an editor, typing and key events say so instead of failing silently', () => {
    expect(dispatchCombo(resolveCombo('x', table), null, () => {})).toMatchObject({ ok: false, message: expect.stringContaining('Open a file') });
    expect(dispatchCombo(resolveCombo('alt+up', table), null, () => {})).toMatchObject({ ok: false });
  });
  it('unsupported and empty pass their reasons through', () => {
    expect(dispatchCombo(resolveCombo('', table), null, () => {})).toMatchObject({ ok: false, message: expect.stringContaining('Type a key') });
    expect(dispatchCombo(resolveCombo('alt+tab', table), null, () => {})).toMatchObject({ ok: false, message: expect.stringContaining('operating system') });
  });
});

describe('applyCursorTool', () => {
  it('ALL selects the whole document; with chord it deletes it', () => {
    const a = fakeEditor(); applyCursorTool(a.ed, { type: 'all' }, { mode: 'neutral', chord: false });
    expect(a.log).toEqual(['focus', 'select:{"startLineNumber":1,"startColumn":1,"endLineNumber":3,"endColumn":9}']);
    const b = fakeEditor(); applyCursorTool(b.ed, { type: 'all' }, { mode: 'neutral', chord: true });
    expect(b.log[1]).toContain('edit:[{"range":"FULL","text":""');
  });
  it('an arrow in deselect mode sets the shrunken selection; in select mode it triggers the command', () => {
    const a = fakeEditor(); applyCursorTool(a.ed, { type: 'right' }, { mode: 'deselect', chord: false });
    expect(a.log[1]).toBe('select:{"startLineNumber":1,"startColumn":1,"endLineNumber":1,"endColumn":3}');
    const b = fakeEditor(); applyCursorTool(b.ed, { type: 'right' }, { mode: 'select', chord: false });
    expect(b.log[1]).toBe('trigger:cursorRightSelect:{}');
  });
  it('does nothing without an editor', () => {
    expect(() => applyCursorTool(null, { type: 'undo' }, { mode: 'neutral', chord: false })).not.toThrow();
  });
});
