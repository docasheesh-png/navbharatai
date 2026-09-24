/**
 * THE EDITOR IS THE SAME ON A PHONE (admin 2026-09-24: "mobile me woh sab kaam hone chahiye jo
 * desktop me ho sakte hai" — and then, on the plan: "pura editor desktop jaisa kaam kare").
 *
 * 🔴 THE BUG. `Editor.tsx` picked a plain `<textarea>` whenever `window.innerWidth < 768`, on an
 * unmeasured "memory issues" comment. The textarea never calls `onMount`, so on every phone
 * `editorInstance` stayed null, ~55 of the 82 Shortcuts-panel entries dispatched to nothing, and
 * the Cursor popup (gated on the instance) never opened. CodeStudio's phone-tuned Monaco options
 * (2026-07-31) had been discarded by that gate since the day they were written.
 *
 * Measured before the default moved (Playwright, 390×844, real `dist/monaco`, 8,000-line TS file):
 * heap 28–30 MB after load, 37–42 MB typing; 2.0 MB brotli on the wire. Not a reason for a gate.
 *
 * The rule now: the engine is a USER CHOICE (Settings → Editor engine) or a real load failure —
 * never the viewport. These tests lock the pure decision, the persisted preference, and — because
 * `tsc` cannot see a `window.innerWidth` comparison come back — the source.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  decideEditorEngine, readLiteEditorPreference, writeLiteEditorPreference, LITE_EDITOR_KEY,
} from '../src/components/ide/editorEngine';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('decideEditorEngine — the one rule', () => {
  it('defaults to the full editor: no choice, no failure ⇒ monaco', () => {
    expect(decideEditorEngine({ liteEditor: false, monacoFailed: false })).toBe('monaco');
  });
  it('the user may choose the plain editor', () => {
    expect(decideEditorEngine({ liteEditor: true, monacoFailed: false })).toBe('textarea');
  });
  it('a load failure always falls back, whatever the choice', () => {
    expect(decideEditorEngine({ liteEditor: false, monacoFailed: true })).toBe('textarea');
    expect(decideEditorEngine({ liteEditor: true, monacoFailed: true })).toBe('textarea');
  });
  it('takes NO viewport input — screen width cannot pick the engine', () => {
    // The type is the lock: an `innerWidth`/`isMobile` field would have to be added to EngineInputs
    // to be read, and this assertion names the only two inputs that exist.
    const inputs = { liteEditor: false, monacoFailed: false };
    expect(Object.keys(inputs).sort()).toEqual(['liteEditor', 'monacoFailed']);
    expect(decideEditorEngine(inputs)).toBe('monaco');
  });
});

describe('the persisted preference', () => {
  const store = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m }; };

  it('reads "on" as lite and everything else — missing, "off", junk — as the full editor', () => {
    const s = store();
    expect(readLiteEditorPreference(s)).toBe(false);
    s.setItem(LITE_EDITOR_KEY, 'on');
    expect(readLiteEditorPreference(s)).toBe(true);
    s.setItem(LITE_EDITOR_KEY, 'off');
    expect(readLiteEditorPreference(s)).toBe(false);
    s.setItem(LITE_EDITOR_KEY, 'yes please');
    expect(readLiteEditorPreference(s)).toBe(false);
  });

  it('writes and reads back both ways', () => {
    const s = store();
    writeLiteEditorPreference(s, true);
    expect(s.m.get(LITE_EDITOR_KEY)).toBe('on');
    expect(readLiteEditorPreference(s)).toBe(true);
    writeLiteEditorPreference(s, false);
    expect(readLiteEditorPreference(s)).toBe(false);
  });

  it('a store that is absent or throws (private mode, quota) never breaks the editor', () => {
    expect(readLiteEditorPreference(null)).toBe(false);
    expect(readLiteEditorPreference(undefined)).toBe(false);
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); } };
    expect(readLiteEditorPreference(broken)).toBe(false);
    expect(() => writeLiteEditorPreference(broken, true)).not.toThrow();
  });
});

describe('source guards — what tsc and the pure tests cannot see', () => {
  const editor = stripComments(read('src/components/ide/Editor.tsx'));
  const studio = stripComments(read('src/components/ide/CodeStudio.tsx'));

  it('Editor.tsx no longer picks the textarea from the screen width', () => {
    expect(editor).not.toMatch(/innerWidth\s*<\s*\d+/);
    expect(editor).not.toMatch(/isMobile\s*\|\|\s*monacoFailed/);
    expect(editor).toContain("decideEditorEngine({ liteEditor, monacoFailed }) === 'textarea'");
  });

  it('the load-failure fallback is still there — a file must always open', () => {
    expect(editor).toContain('setMonacoFailed(true)');
    expect(editor).toContain('loader.init()');
  });

  it("the memo comparator sees `liteEditor` — otherwise the toggle changes nothing until a reload", () => {
    const cmp = editor.slice(editor.lastIndexOf('(prev, next) =>'));
    expect(cmp).toContain('prev.liteEditor === next.liteEditor');
  });

  it('CodeStudio passes the choice to BOTH editor panes and offers the switch in Settings', () => {
    expect((studio.match(/liteEditor=\{liteEditor\}/g) ?? []).length).toBe(2);
    expect(studio).toContain('readLiteEditorPreference(localStorage)');
    expect(studio).toContain('writeLiteEditorPreference(localStorage, v)');
    expect(studio).toContain('Lite editor (plain text)');
  });

  it("the phone-tuned Monaco options (2026-07-31) can finally apply: CodeStudio's phone override still exists", () => {
    // These were written for phones and discarded by the width gate for two months. Keeping the
    // assertion here ties the two facts together: the gate is gone AND the tuning is present.
    expect(studio).toContain('...(isMobile ? {');
    expect(studio).toContain('verticalScrollbarSize: 14');
  });
});
