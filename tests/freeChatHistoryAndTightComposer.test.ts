/**
 * THE FREE CHAT GETS A HISTORY BUTTON ON DESKTOP, AND ITS COMPOSER SITS ON THE FOOTER (admin 2026-09-23).
 *
 *   1. *"navbharatai free ke andar history ka option nahi hai (footer nahi hai, is liye). history button
 *      ko, input box wali line me, mode selecter se pahle (left me) rakho! (only in desktop)"*
 *   2. *"input box aur footer me bahut jyada space khali hai, footer ka border input box ke saath
 *      ek dam chipka den"*
 *
 * Item 2 was two defects stacked, measured in real Chromium at 390×844 before the change — a 24px gap
 * from the message box to the bar, of which only 8px was the composer's own padding:
 *
 *   • 16px DEAD STRIP, on every device. The full-height screens (chat, Studio, Preview, Shell) were sized
 *     `100dvh − 3.5rem − notch`, i.e. for a 3.5rem header. TopNav is `h-10` — 2.5rem — so each of them
 *     ended 16px short of the viewport (and 3.5rem short in focus mode, where there is no header at all).
 *   • ONE HOME-INDICATOR INSET, on notched phones. The composer added `env(safe-area-inset-bottom)`
 *     although the bottom bar had already reserved it — the exact defect NavBharatAI Pro's composer was
 *     fixed for on 2026-09-14 with `--nb-safe-below`; this was the sibling it never reached.
 *
 * After: 8px on the phone (the panel's own padding, matching its `pt-2`), and the Studio / chat screens
 * reach the bottom of the viewport on desktop too. These are wiring facts no render test in this repo
 * exercises, so they are asserted against the source, comments stripped.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const strip = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*$/gm, '');

const APP = strip(read('src/App.tsx'));
const PANEL = strip(read('src/components/panels/NBIChatPanel.tsx'));
const CHAT = strip(read('src/components/ide/AIChat.tsx'));

describe('1 · a History button, on desktop only, to the LEFT of Mode', () => {
  it('App.tsx hands the free chat the ONE history opener, gated exactly like Mode', () => {
    // Derived from `modePickerOpener`, so "is the bottom bar there?" is still asked once, and a phone —
    // whose bar carries both History and Mode — never gets a second History control.
    expect(APP).toContain('const historyOpener = modePickerOpener ? openHistoryForCurrentSurface : undefined;');
    expect(APP).toContain('onOpenHistory={historyOpener}');
  });

  it('NBIChatPanel forwards it and holds no history of its own', () => {
    expect(PANEL).toContain('onOpenHistory={onOpenHistory}');
    expect(PANEL).not.toMatch(/HistoryPopup|HistoryView/);
  });

  it('AIChat hands History and Mode to the shared shell, which stacks them left of the box', () => {
    // 2026-09-23: one column, History above Mode (admin sketch) — the order is the shell's, asserted in
    // freeChatModeOnDesktop.test.ts; here, that the free chat passes both doors, each behind its gate.
    expect(CHAT).toContain('onOpenHistory={showFreeHistoryButton ? onOpenHistory : undefined}');
    expect(CHAT).toContain('onOpenMode={showFreeModeButton ? onOpenModePicker : undefined}');
  });

  it('shares Mode\'s carve-out, so it never appears beside Pro\'s own dropdown', () => {
    expect(CHAT).toContain("const showFreeHistoryButton = Boolean(onOpenHistory) && !(onModeChange && activeAgent === 'navbharatai-pro');");
  });
});

describe('2 · the composer sits on the footer', () => {
  it('no full-height screen is sized for a header height guessed by hand', () => {
    // The class of the bug, not the instance: whatever the header's height, a `100vh − Nrem` here would
    // restate it and drift. The box is a stretched flex item and takes what is left under the header.
    expect(APP).not.toMatch(/calc\(100d?vh-[\d.]+rem-var\(--nb-safe-top\)\)/);
  });

  it('…and those screens still clip, so the chat scrolls inside rather than the page', () => {
    expect(APP).toContain(`['chat', 'nbi_chat', 'studio', 'preview', 'shell'].includes(activeView) ? "overflow-hidden" :`);
  });

  it('the free chat composer does not reserve the home indicator the bottom bar already reserved', () => {
    expect(CHAT).toContain("'max(8px, var(--nb-safe-below, env(safe-area-inset-bottom, 0px)))'");
    expect(CHAT).not.toContain("'max(8px, env(safe-area-inset-bottom, 8px))'");
  });
});
