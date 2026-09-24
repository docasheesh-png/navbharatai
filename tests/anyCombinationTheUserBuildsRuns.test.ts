/**
 * THE KEY-COMBO ENGINE (admin 2026-09-24): whatever a user assembles on the CUSTOM face — from the
 * key buttons, the phone keyboard, or both — resolves to exactly one honest outcome: our own table,
 * a typed character, a real key event for the editor's own bindings, or a stated "cannot".
 */
import { describe, it, expect } from 'vitest';
import {
  parseCombo, comboId, parseChord, chordId, resolveCombo, keyEventInit, appendKey, normalizeToken,
  type TableEntry,
} from '../src/components/ide/keyCombo';

const table: TableEntry[] = [
  { key: 'ctrl+a', label: 'Select All', command: 'editor.action.selectAll', keys: ['Ctrl', 'A'] },
  { key: 'ctrl+shift+p', label: 'Command Palette', command: 'editor.action.quickCommand', keys: ['Ctrl', 'Shift', 'P'] },
  { key: 'ctrl+k ctrl+f', label: 'Format Selection', command: 'editor.action.formatSelection', keys: ['Ctrl', 'K', 'F'] },
  { key: 'f12', label: 'Go to Definition', command: 'editor.action.revealDefinition', keys: ['F12'] },
  { key: 'ctrl+`', label: 'Toggle Terminal', command: 'workbench.action.terminal.toggleTerminal', keys: ['Ctrl', '`'] },
];

describe('parsing what people type', () => {
  it('reads modifiers in any order, any spelling, any case', () => {
    expect(comboId(parseCombo('Shift + CTRL + a'))).toBe('ctrl+shift+a');
    expect(comboId(parseCombo('Control+A'))).toBe('ctrl+a');
    expect(comboId(parseCombo('Cmd+Option+Up'))).toBe('alt+meta+up');
    expect(comboId(parseCombo('Win+D'))).toBe('meta+d');
  });
  it('knows the button spellings: Esc, Del, PgUp, arrows, CapsLk, ↑', () => {
    for (const [raw, want] of [['Esc', 'escape'], ['Del', 'delete'], ['PgUp', 'pageup'], ['↑', 'up'], ['ArrowLeft', 'left'], ['CapsLk', 'capslock'], ['Return', 'enter'], [' ', 'space']]) {
      expect(normalizeToken(raw)).toBe(want);
    }
  });
  it('a trailing or doubled + is the plus KEY, not a separator', () => {
    expect(parseCombo('ctrl++')).toMatchObject({ modifiers: ['ctrl'], key: '+' });
    expect(parseCombo('+')).toMatchObject({ modifiers: [], key: '+' });
  });
  it('a chord is two presses separated by a space, as VS Code writes it', () => {
    expect(chordId(parseChord('Ctrl+K  Ctrl+F'))).toBe('ctrl+k ctrl+f');
    expect(chordId(parseChord('ctrl+k s'))).toBe('ctrl+k s');
  });
  it('empty and whitespace parse to nothing', () => {
    expect(parseCombo('')).toMatchObject({ modifiers: [], key: null });
    expect(parseChord('   ')).toEqual([]);
  });
});

describe('resolution order', () => {
  it('our own table wins, whatever the spelling — the same command the dropdown runs', () => {
    const r = resolveCombo('CTRL + A', table);
    expect(r.kind).toBe('table');
    if (r.kind === 'table') expect(r.entry.command).toBe('editor.action.selectAll');
    expect(resolveCombo('ctrl+k ctrl+f', table).kind).toBe('table');
    expect(resolveCombo('F12', table).kind).toBe('table');
    expect(resolveCombo('ctrl+`', table).kind).toBe('table');
  });
  it('a bare character is typed; shift+letter types the capital', () => {
    expect(resolveCombo('x', table)).toEqual({ kind: 'type', text: 'x' });
    expect(resolveCombo('{', table)).toEqual({ kind: 'type', text: '{' });
    expect(resolveCombo('shift+x', table)).toEqual({ kind: 'type', text: 'X' });
    expect(resolveCombo('नम', table).kind).not.toBe('type'); // two characters are not one key
  });
  it('anything else with a modifier becomes a REAL key event, carrying the legacy keyCode Monaco reads', () => {
    const r = resolveCombo('ctrl+shift+k', table);
    expect(r.kind).toBe('keyevent');
    if (r.kind === 'keyevent') expect(r.init).toEqual({ key: 'K', code: 'KeyK', keyCode: 75, ctrlKey: true, shiftKey: true, altKey: false, metaKey: false });
    const arrow = resolveCombo('alt+up', table);
    if (arrow.kind === 'keyevent') expect(arrow.init).toMatchObject({ key: 'ArrowUp', code: 'ArrowUp', keyCode: 38, altKey: true });
  });
  it('a lone navigation or function key is a key event too (Home, End, F5, Tab, Escape, Backspace, Delete)', () => {
    for (const [k, keyCode] of [['home', 36], ['end', 35], ['f5', 116], ['tab', 9], ['esc', 27], ['backspace', 8], ['delete', 46], ['enter', 13], ['pgdn', 34]] as const) {
      const r = resolveCombo(k, table);
      expect(r.kind, k).toBe('keyevent');
      if (r.kind === 'keyevent') expect(r.init.keyCode, k).toBe(keyCode);
    }
  });
  it('a chord not in the table is sent as two presses', () => {
    const r = resolveCombo('ctrl+k ctrl+0', table);
    expect(r.kind).toBe('chord');
    if (r.kind === 'chord') expect(r.presses.map((p) => p.keyCode)).toEqual([75, 48]);
  });
  it('a shifted symbol names the same physical key with shift held', () => {
    expect(keyEventInit(parseCombo('ctrl+!'))).toMatchObject({ key: '1', code: 'Digit1', keyCode: 49, ctrlKey: true, shiftKey: true });
    expect(keyEventInit(parseCombo('ctrl+shift+/'))).toMatchObject({ code: 'Slash', keyCode: 191, shiftKey: true });
  });
});

describe('honesty — what a web page cannot do is SAID, never faked', () => {
  it('Fn, Print Screen, Num Lock, Caps Lock alone', () => {
    for (const k of ['fn', 'PrtSc', 'NumLk', 'CapsLk', 'fn+f5']) {
      const r = resolveCombo(k, table);
      expect(r.kind, k).toBe('unsupported');
      if (r.kind === 'unsupported') expect(r.reason.length).toBeGreaterThan(20);
    }
  });
  it('the OS-owned combos: Alt+Tab, Alt+F4, Ctrl+Alt+Delete, the Windows key alone', () => {
    for (const k of ['alt+tab', 'Alt+F4', 'ctrl+alt+del', 'win', 'Cmd']) {
      expect(resolveCombo(k, table).kind, k).toBe('unsupported');
    }
  });
  it('a bare modifier says what is missing', () => {
    const r = resolveCombo('ctrl', table);
    expect(r.kind).toBe('unsupported');
    if (r.kind === 'unsupported') expect(r.reason).toMatch(/add the key/i);
  });
  it('a word that is not a key is refused by name, not silently dropped', () => {
    const r = resolveCombo('ctrl+banana', table);
    expect(r.kind).toBe('unsupported');
    if (r.kind === 'unsupported') expect(r.reason).toContain('banana');
  });
  it('nothing typed is "empty", not an error', () => {
    expect(resolveCombo('', table)).toEqual({ kind: 'empty' });
  });
});

describe('the input box', () => {
  it('a pressed key joins with + unless the text already ends in one', () => {
    expect(appendKey('', 'Ctrl')).toBe('Ctrl');
    expect(appendKey('Ctrl', 'A')).toBe('Ctrl+A');
    expect(appendKey('Ctrl+', 'A')).toBe('Ctrl+A');
    expect(appendKey('Ctrl+K ', 'S')).toBe('Ctrl+K S'); // a chord's second press keeps the space
  });
});
