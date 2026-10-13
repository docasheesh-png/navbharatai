/**
 * THE CHAT READS LIKE ONE PRODUCT (admin 2026-10-13, verbatim: *"navbharatai ke sabhi ai ka font, headline
 * etc bilkul claude jaisa karo! navbharatai ke sabhi ke chat wala ui aur ux ko claude jaisa karo!"*).
 *
 * What was found on the way, and what this file keeps from coming back:
 *
 *   • The app had NO typeface of its own — `system-ui`, so every phone drew it differently — and no
 *     serif anywhere for a headline. Now: Inter for the UI and replies, Source Serif 4 for the greeting,
 *     both bundled from npm (OFL), never a font CDN the phone app would have to reach.
 *   • Neither face carries Devanagari. A font stack that does not END in the Devanagari fallbacks turns a
 *     Hindi chat into boxes, silently — the exact trap `theFontIsRealAndHindiStillWorks` recorded for the
 *     image editor. Both stacks are held to the same families here.
 *   • Every surface styled its markdown with `prose prose-invert …`, and the typography plugin those
 *     classes belong to was never installed — they did nothing, anywhere. One prose scale now
 *     (`.nb-prose`), one renderer (`ChatMarkdown.tsx`).
 *   • Five surfaces each hand-rolled their bubbles; the free chat alone captioned every line "YOU /
 *     NAVBHARATAI" in 7px capitals and showed a model badge the White-Label Law never allowed. One
 *     design now (`conversation.ts`): the user's message a soft container, the reply plain prose.
 *   • The free chat's reply row carried a 👍/👎 that only changed its own colour and a "Submit Report"
 *     that ended in `alert()` — a fake feature (second absolute rule). Gone; the real Report stays.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEVANAGARI_STACK } from '../src/lib/imageFonts';
import { dayPartFor, greetingFor, greetingName } from '../src/components/chat/greetingText';
import { Greeting } from '../src/components/chat/Greeting';
import { ChatMarkdown } from '../src/components/chat/ChatMarkdown';
import {
  ASSISTANT_MESSAGE_CLASS, USER_MESSAGE_CLASS, MESSAGE_ACTION_ROW_CLASS, CHAT_PROSE_CLASS, GREETING_CLASS,
} from '../src/components/chat/conversation';
import { COMPOSER_BOX_CLASS, COMPOSER_SEND_CLASS, COMPOSER_STOP_CLASS } from '../src/components/chat/ComposerShell';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
/** Comments quote the OLD wording as evidence; only live code may answer these questions. */
const code = (src: string) =>
  src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

/** Every surface where a person talks to an AI and reads its reply. */
const MESSAGE_SURFACES = [
  'src/components/ide/AIChat.tsx',
  'src/components/agentv3/AgentV3Panel.tsx',
  'src/components/professionals/ProfessionalChat.tsx',
  'src/components/sda/SDAChat.tsx',
  'src/components/ide/AgentV3MiniChat.tsx',
];
/** …and every composer that sends to one. */
const SEND_SURFACES = [...MESSAGE_SURFACES, 'src/components/ide/AIImageGenerator.tsx'];

const CSS = read('src/index.css');
const stack = (name: string): string => {
  const m = CSS.match(new RegExp(`${name}:\\s*([^;]+);`));
  expect(m, `${name} must be declared in index.css`).not.toBeNull();
  return m![1];
};
const families = (s: string): string[] => (s.match(/"[^"]+"/g) ?? []).map((f) => f.replace(/"/g, ''));

describe('the typefaces are real, bundled, and never lose Hindi', () => {
  it('both faces are dependencies (OFL, from npm), imported where the stylesheet is', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(pkg.dependencies['@fontsource-variable/inter']).toBeTruthy();
    expect(pkg.dependencies['@fontsource-variable/source-serif-4']).toBeTruthy();
    const main = code(read('src/main.tsx'));
    expect(main).toContain("import '@fontsource-variable/inter';");
    expect(main).toContain("import '@fontsource-variable/source-serif-4';");
    for (const p of ['@fontsource-variable/inter', '@fontsource-variable/source-serif-4']) {
      expect(existsSync(join(process.cwd(), 'node_modules', p, 'index.css')), `${p} is installed`).toBe(true);
    }
  });

  it('no font comes from a CDN — the phone apps must not need a network request for their own letters', () => {
    expect(read('index.html')).not.toMatch(/fonts\.googleapis|fonts\.gstatic|use\.typekit/);
    expect(CSS).not.toMatch(/@import\s+url\(["']?https?:/);
  });

  it('the sans leads with Inter, the serif with Source Serif 4, and the app reads the sans by default', () => {
    expect(stack('--nb-font-sans')).toMatch(/^'Inter Variable'/);
    expect(stack('--nb-font-serif')).toMatch(/^'Source Serif 4 Variable'/);
    expect(CSS).toMatch(/html\s*\{[^}]*font-family:\s*var\(--nb-font-sans\)/);
    const theme = CSS.match(/@theme inline \{([^}]*)\}/)?.[1] ?? '';
    expect(theme).toContain('--font-sans: var(--nb-font-sans)');
    expect(theme).toContain('--font-serif: var(--nb-font-serif)');
  });

  it('🔒 BOTH stacks carry every Devanagari fallback the image editor relies on — the serif too', () => {
    const wanted = families(DEVANAGARI_STACK);
    expect(wanted.length).toBeGreaterThanOrEqual(4);
    for (const name of ['--nb-font-sans', '--nb-font-serif']) {
      const s = stack(name);
      for (const fam of wanted) expect(s, `${name} must fall back to ${fam}`).toContain(`'${fam}'`);
      // …and they sit BEFORE the generic family, so a Devanagari glyph is never left to the engine's last resort.
      const generic = s.lastIndexOf(name.endsWith('serif') ? 'serif' : 'sans-serif');
      for (const fam of wanted) expect(s.indexOf(`'${fam}'`)).toBeLessThan(generic);
    }
  });
});

describe('the greeting', () => {
  it('names the part of the day at every boundary', () => {
    expect(dayPartFor(5)).toBe('morning');
    expect(dayPartFor(11)).toBe('morning');
    expect(dayPartFor(12)).toBe('afternoon');
    expect(dayPartFor(16)).toBe('afternoon');
    expect(dayPartFor(17)).toBe('evening');
    expect(dayPartFor(23)).toBe('evening');
    expect(dayPartFor(2)).toBe('evening');
    expect(dayPartFor(Number.NaN)).toBe('afternoon');
  });

  it('addresses the first name only, and never an email address', () => {
    expect(greetingName('Asheesh Sharma')).toBe('Asheesh');
    expect(greetingName('  Priya  ')).toBe('Priya');
    expect(greetingName('asheesh@gmail.com')).toBeNull();
    expect(greetingName('')).toBeNull();
    expect(greetingName(null)).toBeNull();
    expect(greetingName('x'.repeat(40))).toBeNull();
    expect(greetingFor(9, 'Asheesh Sharma')).toBe('Good morning, Asheesh');
    expect(greetingFor(20, null)).toBe('Good evening');
  });

  it('renders in the serif headline, with its sub-line', () => {
    const html = renderToStaticMarkup(React.createElement(Greeting, { name: 'Asheesh Sharma', subline: 'Ask me anything.', hour: 9 }));
    expect(html).toContain('Good morning, Asheesh');
    expect(html).toContain('Ask me anything.');
    expect(html).toContain('data-chat-greeting');
    for (const cls of GREETING_CLASS.split(' ')) expect(html).toContain(cls);
    expect(GREETING_CLASS).toContain('font-serif');
  });
});

describe('one conversation design', () => {
  it('the reply is prose on the page — no bubble, no border, no shadow', () => {
    expect(ASSISTANT_MESSAGE_CLASS).not.toMatch(/\bbg-|\bborder\b|\bshadow/);
    expect(ASSISTANT_MESSAGE_CLASS).toContain('w-full');
  });

  it('the user\'s message is a soft container, never the old white-on-accent fill', () => {
    expect(USER_MESSAGE_CLASS).toContain('bg-raised');
    expect(USER_MESSAGE_CLASS).not.toMatch(/bg-accent|text-on-accent|bg-indigo/);
    expect(USER_MESSAGE_CLASS).not.toContain('whitespace-pre-wrap'); // markdown output must not be double-spaced
  });

  it('actions reveal on hover on a pointer device and are always reachable on touch', () => {
    expect(MESSAGE_ACTION_ROW_CLASS).toContain('md:opacity-0');
    expect(MESSAGE_ACTION_ROW_CLASS).toContain('md:group-hover/msg:opacity-100');
    expect(MESSAGE_ACTION_ROW_CLASS).toMatch(/(?:^|\s)opacity-70(?:\s|$)/);
  });

  it('the prose scale exists in index.css under the name the renderer uses', () => {
    expect(CHAT_PROSE_CLASS).toBe('nb-prose');
    for (const sel of ['.nb-prose p', '.nb-prose h1', '.nb-prose h2', '.nb-prose code', '.nb-prose pre', '.nb-prose table', '.nb-prose a']) {
      expect(CSS, `${sel} must be styled`).toContain(sel);
    }
  });

  it('🔒 EVERY message surface reads the shared classes, and none keeps a bubble of its own', () => {
    for (const rel of MESSAGE_SURFACES) {
      const src = code(read(rel));
      expect(src, `${rel} must import the shared conversation design`).toContain("from '../chat/conversation'");
      expect(src, `${rel} must render the user's message with USER_MESSAGE_CLASS`).toContain('USER_MESSAGE_CLASS');
      expect(src, `${rel} must render the reply with ASSISTANT_MESSAGE_CLASS`).toContain('ASSISTANT_MESSAGE_CLASS');
      expect(src, `${rel} still carries a bubble tail`).not.toMatch(/rounded-t[lr]-none|rounded-b[lr]-sm/);
      // The typography plugin is not installed: a `prose` CLASS here is a promise the stylesheet cannot
      // keep. (A variable may be called `prose`; only a className is checked.)
      expect(src, `${rel} uses dead \`prose\` classes`).not.toMatch(/className=\{?[`"'][^`"']*\bprose(?:-[a-z]|\b)/);
      // No vendor label and no "YOU" caption under a line.
      expect(src).not.toContain('activeAgent.toUpperCase()');
      expect(src).not.toContain('msg.modelUsed');
    }
  });

  it('🔒 every composer sends with the same circle and the same arrow', () => {
    expect(COMPOSER_SEND_CLASS).toContain('rounded-full');
    expect(COMPOSER_STOP_CLASS).toContain('rounded-full');
    expect(COMPOSER_BOX_CLASS).toContain('rounded-[1.5rem]');
    for (const rel of SEND_SURFACES) {
      const src = code(read(rel));
      expect(src, `${rel} must send with the arrow`).toContain('<ArrowUp');
      expect(src, `${rel} still uses the paper-plane icon`).not.toContain('<Send ');
    }
  });

  it('the fake feedback row is gone from the free chat, and the real Report remains', () => {
    const chat = code(read('src/components/ide/AIChat.tsx'));
    expect(chat).not.toContain("alert('Thank you for your feedback!')");
    expect(chat).not.toContain('setLiked');
    expect(chat).not.toContain('setDisliked');
    expect(chat).toContain('<ReportAiContent');
  });
});

describe('the one renderer', () => {
  const html = (md: string) => renderToStaticMarkup(React.createElement(ChatMarkdown, { text: md }));

  it('wraps a reply in the prose scale and renders a table, a list and a fenced block', () => {
    const out = html('# Plan\n\n- one\n- two\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n```js\nconst x = 1;\n```');
    expect(out).toContain('class="nb-prose');
    expect(out).toContain('<h1>Plan</h1>');
    expect(out).toContain('<li>one</li>');
    expect(out).toContain('<table');
    expect(out).toContain('const x = 1;');
    expect(out).toContain('Copy'); // the shared code block's button
  });

  it('a link opens in a new tab, and only when it is http(s)', () => {
    const safe = html('see [docs](https://example.com)');
    expect(safe).toMatch(/<a[^>]*href="https:\/\/example.com"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
    const unsafe = html('[x](javascript:alert(1))');
    expect(unsafe).not.toContain('<a');
    expect(unsafe).toContain('x');
  });

  it('keeps the line breaks the author wrote (the shared plugin list rides inside it)', () => {
    expect(html('line one\nline two')).toContain('<br');
  });
});
