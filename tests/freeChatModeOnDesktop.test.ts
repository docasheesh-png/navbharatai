import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { braceBlock } from './helpers/sourceSlice';

/**
 * THE FREE CHAT'S MODE PICKER REACHES THE DESKTOP (admin 2026-09-20: "mode-selection option is
 * visible on mobile but missing from the desktop UI … place it immediately to the LEFT of the chat
 * input box … there must be ONE shared mode state").
 *
 * On mobile the Mode button lives in the global bottom bar (App.tsx), which is rendered only when
 * `showsGlobalMobileNav` is true — so a desktop user had no way to open the picker at all. The fix
 * adds a Mode button to the composer, and the whole point of these tests is that it is NOT a second
 * mode system: the button asks App.tsx to open the SAME `ModePickerSheet`, through the SAME
 * `setShowModePicker`, and it renders exactly when the bottom bar does not.
 *
 * Read from the source, per block, so a second `useState` for the picker, a second sheet mount, or
 * the prop being passed unconditionally (which would put two Mode buttons on a phone) turns this red.
 */
const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const APP = stripComments(read('src/App.tsx'));
const PANEL = stripComments(read('src/components/panels/NBIChatPanel.tsx'));
const CHAT = stripComments(read('src/components/ide/AIChat.tsx'));

describe('one mode state, two doors — App.tsx', () => {
  it('the composer prop opens the SAME picker the bottom bar opens', () => {
    // The bar's button:
    expect(APP).toContain("if (key === 'mode') { setShowModePicker(true); return; }");
    // The composer's door, on the Free chat panel:
    const panel = APP.slice(APP.indexOf('<NBIChatPanel'), APP.indexOf('/>', APP.indexOf('<NBIChatPanel')));
    expect(panel).toContain('onOpenModePicker={showsGlobalMobileNav ? undefined : () => setShowModePicker(true)}');
  });

  it('🔒 the prop is ABSENT exactly when the mobile bar is on screen — mobile stays byte-identical', () => {
    // Passing it unconditionally would put a second Mode button on every phone, under the bar's.
    const panel = APP.slice(APP.indexOf('<NBIChatPanel'), APP.indexOf('/>', APP.indexOf('<NBIChatPanel')));
    expect(panel).toMatch(/onOpenModePicker=\{showsGlobalMobileNav \? undefined :/);
    // …and that gate is the one the <nav> itself reads, not a second breakpoint.
    expect(APP).toContain('{showsGlobalMobileNav && (\n        <nav');
  });

  it('there is exactly ONE picker state and ONE sheet mount', () => {
    expect(APP.match(/const \[showModePicker, setShowModePicker\] = useState/g)?.length).toBe(1);
    expect(APP.match(/<ModePickerSheet/g)?.length).toBe(1);
  });
});

describe('the door is forwarded, never re-implemented — NBIChatPanel', () => {
  it('declares the prop and hands it straight to AIChat', () => {
    expect(PANEL).toContain('onOpenModePicker?: () => void;');
    expect(PANEL).toContain('onOpenModePicker={onOpenModePicker}');
    // No local state, no local sheet.
    expect(PANEL).not.toContain('ModePickerSheet');
    expect(PANEL).not.toMatch(/useState[^\n]*[Mm]ode/);
  });
});

describe('the button, in the composer — AIChat', () => {
  const button = braceBlock(CHAT, '{showFreeModeButton && (');

  it('renders only when asked for, and never beside the Pro dropdown that owns the same slot', () => {
    expect(CHAT).toContain("const showFreeModeButton = Boolean(onOpenModePicker) && !(onModeChange && activeAgent === 'navbharatai-pro');");
  });

  it('is a real, accessible control that opens the picker', () => {
    expect(button).not.toBe('');
    expect(button).toContain('onClick={onOpenModePicker}');
    expect(button).toContain('aria-label="Choose AI mode"');
    expect(button).toContain('aria-haspopup="dialog"');
    expect(button).toContain('type="button"');
    expect(button).toContain('focus-visible:ring-2');
    // The word "Mode" — the same label the mobile bar uses — and the same icon.
    expect(button).toMatch(/<Layers className="w-3\.5 h-3\.5" \/>\s*Mode/);
  });

  it('sits OUTSIDE the message box, immediately to its LEFT — and the box itself is untouched', () => {
    const buttonAt = CHAT.indexOf('{showFreeModeButton && (');
    const box = CHAT.indexOf('<div className="bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-2xl focus-within:border-indigo-500 transition-all">');
    const textarea = CHAT.indexOf('placeholder="Ask NavBharatAI..."');
    expect(box).toBeGreaterThan(-1);
    // Order in the source is order on screen: [ Mode ] then [ the box ].
    expect(buttonAt).toBeGreaterThan(-1);
    expect(buttonAt).toBeLessThan(box);
    expect(box).toBeLessThan(textarea);
    // The row exists ONLY while the button shows; hidden ⇒ `contents`, i.e. no box of its own, so the
    // mobile layout is byte-for-byte what it was ("mobile wala kuch touch nahi karna").
    expect(CHAT).toContain("className={showFreeModeButton ? 'grid grid-cols-[auto_minmax(0,1fr)] items-end gap-2' : 'contents'}");
    // The textarea's own inset is EXACTLY what it was — the input box is not touched ("na inputbox").
    expect(CHAT).toContain("onModeChange && activeAgent === 'navbharatai-pro' ? \"pl-32\" : \"pl-5\"");
    expect(CHAT).not.toContain('pl-24');
    // Same height as the box's minimum (48px), so the two read as one composer.
    expect(button).toContain('h-12');
  });

  it('holds no mode of its own — it only asks', () => {
    // A `useState` mentioning the picker inside AIChat would be the second state this change forbids.
    expect(CHAT).not.toMatch(/useState[^\n]*[Pp]icker/);
    expect(CHAT).not.toContain('ModePickerSheet');
  });
});
