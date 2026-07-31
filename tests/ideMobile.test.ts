import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Phone-first Code Studio (admin 2026-07-31): on a narrow screen the editor is tuned for touch and the
 * key no-Ctrl actions become tap buttons. Desktop is untouched. Source-level lock.
 */
const studio = readFileSync(join(__dirname, '../src/components/ide/CodeStudio.tsx'), 'utf8');
const editor = readFileSync(join(__dirname, '../src/components/ide/Editor.tsx'), 'utf8');

describe('Mobile editor is tuned for touch', () => {
  it('CodeStudio overrides Monaco options when isMobile (no minimap/sticky, word-wrap, fat scrollbars)', () => {
    const i = studio.indexOf('...(isMobile ? {');
    expect(i).toBeGreaterThan(-1);
    const block = studio.slice(i, i + 900);
    expect(block).toContain('minimap: { enabled: false }');
    expect(block).toContain('stickyScroll: { enabled: false }');
    expect(block).toContain("wordWrap: 'on'");
    expect(block).toContain('verticalScrollbarSize: 14');
  });
});

describe('Mobile action toolbar (no Ctrl key on a phone)', () => {
  it('the editor shows Undo / Redo / Find / Run as tap buttons on mobile only', () => {
    // A mobile-only action row (md:hidden) with real editor actions.
    expect(editor).toContain("editorRef.current?.trigger('mobile-toolbar', 'undo', {})");
    expect(editor).toContain("editorRef.current?.trigger('mobile-toolbar', 'redo', {})");
    expect(editor).toContain("editorRef.current?.getAction('actions.find')?.run()");
    // It is a mobile-only surface (the action row has its own height class), with a Run button.
    expect(editor).toContain('md:hidden h-11');
    const i = editor.indexOf('md:hidden h-11');
    expect(editor.slice(i, i + 1400)).toContain('onRun');
  });
});
