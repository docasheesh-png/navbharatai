/**
 * THE MESSAGE BOX IS ONE LINE WHEN THE FOOTER ALREADY CARRIES HISTORY AND MODE (admin 2026-09-24).
 *
 * Admin, with a phone screenshot of the free chat — footer on, box still two rows:
 *   "jab navbharatai free chat ke sabhi ai me footer on hai, (full screen exit hai) to input box double
 *    line dikhane ki jarurat nahi hai!!! … input box ko 2 line me is liye dikhaya ja raha tha, kyu ki
 *    history button gayab tha. ab jab history button footer me hai, to input box single line me
 *    chalega!! sabhi mode ke liye badlo"
 *
 * The two rows (2026-09-23) existed only to stand beside the History / Mode column; with that column
 * gone the text no longer needed a row of its own. The column is absent EXACTLY when the phone's bottom
 * bar is on screen (App passes `undefined` for both openers then), so the shell reads the column — one
 * answer, derived once in App — and never asks the device question a second time.
 *
 * Every surface renders this one shell, so "sabhi mode ke liye" is true by construction; the last block
 * holds each of them to passing BOTH openers through, since a surface that dropped one would silently
 * pick the wrong layout.
 */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ComposerShell, SEND_SLOT_CLASS } from '../src/components/chat/ComposerShell';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

function render(opts: { history?: boolean; mode?: boolean }): string {
  return renderToStaticMarkup(
    React.createElement(
      ComposerShell,
      {
        onOpenHistory: opts.history ? () => {} : undefined,
        onOpenMode: opts.mode ? () => {} : undefined,
        controls: React.createElement('button', { 'data-ctl': 'attach' }, 'A'),
        send: React.createElement('button', { 'data-ctl': 'send' }, 'S'),
      },
      React.createElement('textarea', { 'data-ctl': 'text' }),
    ),
  );
}

describe('footer on (no History / Mode column) ⇒ one line', () => {
  const html = render({});

  it('lays the box out on one line', () => {
    expect(html).toContain('data-composer-layout="one-line"');
    expect(html).not.toContain('data-composer-layout="two-rows"');
  });

  it('puts the text, the controls and Send side by side, in that order', () => {
    const text = html.indexOf('data-ctl="text"');
    const ctl = html.indexOf('data-ctl="attach"');
    const send = html.indexOf('data-ctl="send"');
    expect(text).toBeGreaterThan(-1);
    expect(ctl).toBeGreaterThan(text);
    expect(send).toBeGreaterThan(ctl);
    // No column and no second row: the controls are not wrapped in the two-row box's own row.
    expect(html).not.toContain('justify-end gap-1 px-1.5 pb-1');
  });

  it('does not force the box to two rows\' height through Send', () => {
    expect(html).toContain(SEND_SLOT_CLASS.oneLine);
    expect(html).not.toContain('min-h-[84px]');
  });

  it('renders no History or Mode button — the footer has them', () => {
    expect(html).not.toMatch(/history/i);
  });
});

describe('full screen (the column is back) ⇒ the two rows the admin sketched', () => {
  for (const [label, opts] of [
    ['History and Mode', { history: true, mode: true }],
    ['Mode only', { mode: true }],
    ['History only', { history: true }],
  ] as const) {
    it(`${label}: two rows, Send at least 72px`, () => {
      const html = render(opts);
      expect(html).toContain('data-composer-layout="two-rows"');
      expect(html).toContain(SEND_SLOT_CLASS.twoRows);
      expect(html).toContain('justify-end gap-1 px-1.5 pb-1');
    });
  }
});

describe('the column is the ONE signal — App derives it once', () => {
  const APP = read('src/App.tsx');

  it('both openers are undefined exactly while the bottom bar is on screen', () => {
    expect(APP).toContain('const modePickerOpener = showsGlobalMobileNav ? undefined :');
    expect(APP).toContain('const historyOpener = modePickerOpener ? openHistoryForCurrentSurface : undefined;');
  });

  it('the shell never asks the device question itself', () => {
    // Comments stripped: the shell's own docblock names the App-side gate to explain why it is not asked here.
    const SHELL = read('src/components/chat/ComposerShell.tsx')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(SHELL).not.toMatch(/showsGlobalMobileNav|matchMedia|innerWidth|useIsMobile/);
  });
});

describe('every AI surface passes both openers through, so it lands on the right layout', () => {
  const surfaces: Record<string, string> = {
    freeChat: 'src/components/ide/AIChat.tsx',
    professionals: 'src/components/professionals/ProfessionalChat.tsx',
    doctorAi: 'src/components/sda/SDAChat.tsx',
    imageGenerator: 'src/components/ide/AIImageGenerator.tsx',
  };
  for (const [name, rel] of Object.entries(surfaces)) {
    it(`${name}`, () => {
      const src = read(rel);
      const at = src.indexOf('<ComposerShell');
      expect(at).toBeGreaterThan(-1);
      // The shell's own props come first, before `controls=` opens the surface's buttons.
      const props = src.slice(at, src.indexOf('controls={', at));
      expect(props).toMatch(/onOpenHistory=/);
      expect(props).toMatch(/onOpenMode=/);
    });
  }
});

// ── THE WHOLE BOX IS THE INPUT, and the rail never grows (admin 2026-09-24, two phone screenshots:
// "input box ka pura area hi input box hona chahiye … history/mode button ka size na bade, bas input
// box ka size badhe"). ──────────────────────────────────────────────────────────────────────────────
import { tapFocusesComposerText } from '../src/components/chat/ComposerShell';

/** A minimal element: its ancestors, and the selector it matches (if any), are all a tap needs. */
function fakeEl(matches: string | null, parent: any = null): any {
  const el: any = {
    parent,
    matches,
    closest(sel: string) {
      for (let n: any = el; n; n = n.parent) {
        if (n.matches && sel.split(',').map((s) => s.trim()).includes(n.matches)) return n;
      }
      return null;
    },
  };
  return el;
}
function fakeBox(): any {
  const box: any = fakeEl(null);
  box.contains = (n: any) => { for (let x = n; x; x = x.parent) if (x === box) return true; return false; };
  return box;
}

describe('a tap anywhere in the box that is not a control goes to the text', () => {
  it('the empty area beside the icons focuses the text', () => {
    const box = fakeBox();
    const emptyRow = fakeEl(null, box);
    expect(tapFocusesComposerText(emptyRow, box)).toBe(true);
    expect(tapFocusesComposerText(box, box)).toBe(true);
  });

  it('a tap on a control — or on the icon inside one — is left to that control', () => {
    const box = fakeBox();
    const send = fakeEl('button', box);
    const icon = fakeEl(null, send);
    expect(tapFocusesComposerText(send, box)).toBe(false);
    expect(tapFocusesComposerText(icon, box)).toBe(false);
    expect(tapFocusesComposerText(fakeEl('textarea', box), box)).toBe(false);
  });

  it('a tap outside the box, or with no box, does nothing', () => {
    const box = fakeBox();
    expect(tapFocusesComposerText(fakeEl(null), box)).toBe(false);
    expect(tapFocusesComposerText(fakeEl(null, box), null)).toBe(false);
    expect(tapFocusesComposerText(null, box)).toBe(false);
  });

  it('both layouts wire the handler onto the box itself', () => {
    const SHELL = read('src/components/chat/ComposerShell.tsx');
    const wired = SHELL.match(/ref=\{wholeBox\.ref\} onMouseDown=\{wholeBox\.onMouseDown\} onClick=\{wholeBox\.onClick\}/g) ?? [];
    expect(wired.length).toBe(2);
  });
});

describe('the History / Mode column does not grow with the message', () => {
  it('the column sits at the bottom and does not stretch', () => {
    const html = render({ history: true, mode: true });
    expect(html).toMatch(/class="[^"]*\bself-end\b[^"]*" data-composer-rail=""/);
  });
});
