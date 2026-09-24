/**
 * THE ONE PLACE A RESOLVED COMBO TOUCHES THE EDITOR (admin 2026-09-24, the CUSTOM face). `keyCombo.ts`
 * decides; this applies. Kept apart so the decision stays testable without a DOM and this file stays
 * small enough to read in one sitting.
 *
 * A `keyevent` is delivered as a REAL `KeyboardEvent` on Monaco's own input element, which is how
 * Monaco's full keybinding table (~300 entries) is honoured without a hand-written case per combo.
 * ⚠️ The legacy `keyCode` is set on purpose: Monaco's `StandardKeyboardEvent` resolves bindings from
 * it, and an event carrying only `key`/`code` resolves to nothing there, silently.
 */
import type { Resolution, KeyEventInit } from './keyCombo';
import { cursorMove, cursorAll, type CursorMode, type CursorMove } from './cursorTool';

/** The slice of a Monaco editor these functions use — typed here so a test can hand in a fake. */
export interface EditorLike {
  focus(): void;
  trigger(source: string, handlerId: string, payload: unknown): void;
  getDomNode(): HTMLElement | null;
  getSelection(): { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } | null;
  setSelection(sel: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }): void;
  getModel(): { getLineCount(): number; getLineMaxColumn(line: number): number; getFullModelRange(): unknown } | null;
  executeEdits(source: string, edits: Array<{ range: unknown; text: string; forceMoveMarkers?: boolean }>): void;
}

export interface DispatchOutcome {
  /** Honest, user-facing, in plain words. Never a vendor name. */
  message: string;
  ok: boolean;
}

/** Monaco listens for keys on this element; a synthetic event anywhere else reaches nothing. */
export function monacoInputElement(editor: EditorLike): HTMLElement | null {
  const root = editor.getDomNode();
  if (!root) return null;
  return (root.querySelector('textarea.inputarea') as HTMLElement | null) ?? root;
}

/** Send one press (keydown + keyup) to the editor. Returns whether Monaco consumed the keydown. */
export function sendKeyEvent(editor: EditorLike, init: KeyEventInit): boolean {
  const target = monacoInputElement(editor);
  if (!target) return false;
  editor.focus();
  const base = { bubbles: true, cancelable: true, composed: true, ...init } as KeyboardEventInit & { keyCode: number };
  const down = new KeyboardEvent('keydown', base);
  // `keyCode` is read-only on the instance in some engines even when the init dict sets it; define
  // it explicitly so Monaco reads the number whichever way the engine exposes it.
  try { Object.defineProperty(down, 'keyCode', { get: () => init.keyCode }); } catch { /* engine already set it */ }
  const consumed = !target.dispatchEvent(down);
  const up = new KeyboardEvent('keyup', base);
  try { Object.defineProperty(up, 'keyCode', { get: () => init.keyCode }); } catch { /* as above */ }
  target.dispatchEvent(up);
  return consumed;
}

/**
 * Apply a resolution. `runShortcut` is CodeStudio's own handler (the same one the dropdown uses), so a
 * combo that matches the table runs exactly what the dropdown would.
 */
export function dispatchCombo(
  res: Resolution,
  editor: EditorLike | null,
  runShortcut: (keys: string[], command?: string) => void,
): DispatchOutcome {
  switch (res.kind) {
    case 'empty':
      return { ok: false, message: 'Type a key or a combination first — for example Ctrl+A.' };
    case 'unsupported':
      return { ok: false, message: res.reason };
    case 'table':
      runShortcut(res.entry.keys, res.entry.command);
      return { ok: true, message: `Ran "${res.entry.label}" (${res.id.toUpperCase()}).` };
    case 'type': {
      if (!editor) return { ok: false, message: 'Open a file first — there is no editor to type into.' };
      editor.focus();
      editor.trigger('keyboard', 'type', { text: res.text });
      return { ok: true, message: `Typed "${res.text}" into the editor.` };
    }
    case 'keyevent': {
      if (!editor) return { ok: false, message: 'Open a file first — there is no editor to send keys to.' };
      const consumed = sendKeyEvent(editor, res.init);
      const id = [res.combo.modifiers.join('+'), res.combo.key].filter(Boolean).join('+').toUpperCase();
      return consumed
        ? { ok: true, message: `Sent ${id} to the editor.` }
        : { ok: false, message: `${id} is not bound to anything in the editor — nothing happened.` };
    }
    case 'chord': {
      if (!editor) return { ok: false, message: 'Open a file first — there is no editor to send keys to.' };
      let consumed = false;
      for (const press of res.presses) consumed = sendKeyEvent(editor, press) || consumed;
      return consumed
        ? { ok: true, message: `Sent ${res.id.toUpperCase()} to the editor.` }
        : { ok: false, message: `${res.id.toUpperCase()} is not bound to anything in the editor — nothing happened.` };
    }
  }
}

/** The cursor tool's arrows, ALL and Undo, applied to the editor. */
export function applyCursorTool(
  editor: EditorLike | null,
  action: { type: CursorMove | 'all' | 'undo' },
  state: { mode: CursorMode; chord: boolean },
): void {
  if (!editor) return;
  editor.focus();
  if (action.type === 'undo') { editor.trigger('keyboard', 'undo', {}); return; }
  const model = editor.getModel();
  if (!model) return;
  if (action.type === 'all') {
    const a = cursorAll(state.chord);
    if (a.kind === 'deleteAll') editor.executeEdits('cursor-tool', [{ range: model.getFullModelRange(), text: '', forceMoveMarkers: true }]);
    else {
      const last = model.getLineCount();
      editor.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: last, endColumn: model.getLineMaxColumn(last) });
    }
    return;
  }
  const sel = editor.getSelection() ?? { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 };
  const a = cursorMove(action.type, state.mode, state.chord, sel, { lineCount: model.getLineCount(), lineMaxColumn: (l) => model.getLineMaxColumn(l) });
  if (a.kind === 'command') editor.trigger('keyboard', a.id, {});
  else if (a.kind === 'setSelection') editor.setSelection(a.selection);
}
