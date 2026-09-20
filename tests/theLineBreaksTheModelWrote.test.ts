/**
 * THE LINE BREAKS THE MODEL WROTE, AND THE ONES THE RENDERER THREW AWAY.
 *
 * 🔴 THE REPORT (admin, 2026-09-20, screenshot of a Hindi song in free chat): *"gana likhwaya jaye,
 * to jahan 2 line honi chahiye waha 1 line me hi dono line likh deta hai."* A four-line mukhda came
 * back as one long line, its `[Mukhda]` label run into the lyrics beside it.
 *
 * **The label is what proves the model was innocent.** `SONGCRAFT_DIRECTIVE` tells it to *"Label each
 * part on its own line"* — so a label sitting INSIDE the lyric line is a break that was written and
 * then discarded. In CommonMark a single newline inside a paragraph is a SOFT break and renders as a
 * space; `react-markdown` implements the spec exactly, and no surface in this app passed any plugin.
 *
 * TWO user-visible consequences, both measured below against a real render:
 *   • every song, poem, shayari, address and plain-line list was flattened into one paragraph;
 *   • every GFM TABLE was shown as literal `| a | b |` pipes — and `AIChat.tsx` had styled
 *     `table`/`thead`/`th`/`td` and task-list `input` components that could never once have fired,
 *     because GFM is not CommonMark either.
 *
 * Each test fails if its fix is reverted — checked by reverting each one.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CHAT_MARKDOWN_PLUGINS } from '../src/lib/chatMarkdown';

/** The exact shape the songcraft directive asks the model to produce. */
const SONG = [
  '[Mukhda]',
  'धूल जमी है इन राहों पर,',
  'धुंधली सी यादें बाकी हैं।',
  'खोए हैं हम ऐसी रातों में,',
  'जिनमें कोई सुबह बाकी नहीं।',
].join('\n');

const render = (md: string, withPlugins: boolean): string =>
  renderToStaticMarkup(
    React.createElement(
      ReactMarkdown as any,
      withPlugins ? { remarkPlugins: CHAT_MARKDOWN_PLUGINS } : null,
      md,
    ),
  );

/** Every chat surface that renders somebody's typed lines. Not the curated legal document. */
const CHAT_SURFACES = [
  'src/components/ide/AIChat.tsx',
  'src/components/sda/SDAChat.tsx',
  'src/components/ide/AgentV3MiniChat.tsx',
];

const source = (rel: string): string => readFileSync(join(process.cwd(), rel), 'utf8');

describe('a newline the author typed is a line break', () => {
  it('🔴 THE BUG, measured: without the plugins the song has no line breaks at all', () => {
    const before = render(SONG, false);
    expect(before).not.toContain('<br');
    // One paragraph, five lyric lines inside it — exactly what the screenshot showed.
    expect((before.match(/<p>/g) || []).length).toBe(1);
  });

  it('🔒 THE FIX: each written line becomes its own line', () => {
    const after = render(SONG, true);
    // Four newlines between five lines ⇒ four breaks.
    expect((after.match(/<br/g) || []).length).toBe(4);
    // REVERSION GUARD: drop `remark-breaks` from CHAT_MARKDOWN_PLUGINS and this is 0.
    expect(after).toContain('<br');
  });

  it('the label the directive asks for stays on its own line', () => {
    const after = render(SONG, true);
    // `[Mukhda]` must be followed by a break, not by a lyric.
    expect(after).toMatch(/\[Mukhda\]\s*<br/);
  });

  it('⚠️ a BLANK line is still a new paragraph — the fix adds breaks, it does not remove paragraphs', () => {
    const after = render('Antara one.\n\nAntara two.', true);
    expect((after.match(/<p>/g) || []).length).toBe(2);
    expect(after).not.toContain('<br');
  });

  it('⚠️ and ordinary prose on ONE line is untouched', () => {
    const line = 'This is a single ordinary sentence with no newline in it.';
    expect(render(line, true)).toBe(render(line, false));
  });
});

describe('the table components were dead code', () => {
  const TABLE = '| City | Population |\n| --- | --- |\n| Pune | 7.4M |';

  it('🔴 THE BUG: a markdown table reached the user as literal pipe characters', () => {
    const before = render(TABLE, false);
    expect(before).not.toContain('<table');
    expect(before).toContain('|');
  });

  it('🔒 THE FIX: it is a real table, so the styled components can finally fire', () => {
    const after = render(TABLE, true);
    expect(after).toContain('<table');
    expect(after).toContain('<thead');
    expect(after).toContain('<td>Pune</td>');
  });

  it('a task list renders a checkbox, which the `input` component was already written for', () => {
    const after = render('- [x] done\n- [ ] not done', true);
    expect(after).toContain('type="checkbox"');
  });
});

describe('the class, not the instance', () => {
  it('🔒 EVERY chat markdown surface passes the SHARED plugin list', () => {
    for (const rel of CHAT_SURFACES) {
      const src = source(rel);
      expect(src, `${rel} must import the shared plugins`).toContain('CHAT_MARKDOWN_PLUGINS');
      // Every ReactMarkdown in a chat surface must carry them — a second, plugin-less call site is
      // exactly how this bug returns.
      const calls = (src.match(/<ReactMarkdown/g) || []).length;
      const wired = (src.match(/remarkPlugins=\{CHAT_MARKDOWN_PLUGINS\}/g) || []).length;
      expect(wired, `${rel}: ${calls} <ReactMarkdown>, ${wired} wired`).toBe(calls);
    }
  });

  it('the plugin list is defined in ONE place, so a surface cannot pick its own', () => {
    const shared = source('src/lib/chatMarkdown.ts');
    expect(shared).toContain('remark-gfm');
    expect(shared).toContain('remark-breaks');
    for (const rel of CHAT_SURFACES) {
      // A surface may not import the plugins directly — that is a private copy of the decision.
      expect(source(rel), `${rel} must not import a plugin itself`).not.toMatch(/from 'remark-/);
    }
  });
});
