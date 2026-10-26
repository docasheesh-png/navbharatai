/** Unified pad: Type above, divider, action bar + Send outside Type (admin 2026-10-26). */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMPOSER_TEXTAREA_CLASS, COMPOSER_SEND_SLOT_CLASS } from '../src/components/chat/ComposerShell';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('unified composer pad', () => {
  it('shell keeps Type above an action bar that owns Send', () => {
    const shell = read('src/components/chat/ComposerShell.tsx');
    const render = shell.slice(shell.indexOf('export function ComposerShell'));
    expect(render.indexOf('{children}')).toBeLessThan(render.indexOf('data-composer-toolbar'));
    expect(render.indexOf('data-composer-toolbar')).toBeLessThan(render.indexOf('{send}'));
    expect(COMPOSER_SEND_SLOT_CLASS).toContain('nb-composer-send-slot');
    expect(COMPOSER_TEXTAREA_CLASS).toContain('min-h-[40px]');
  });

  it('CSS draws the pad divider and never overlays Send inside Type on phones', () => {
    const css = read('src/components/chat/composer.css');
    expect(css).toContain('[data-composer-toolbar]');
    expect(css).toContain('border-top: 1px solid');
    expect(css).toContain('nb-composer-send-slot');
    expect(css).toContain('position: static !important');
    expect(css).toContain('nb-composer-tools-toggle { display: none !important; }');
    expect(css).toContain('position: fixed !important');
  });

  it('Pro Send/Expand sit in the tools action bar, not absolute over Type', () => {
    const pro = read('src/components/agentv3/AgentV3Panel.tsx');
    const tools = pro.slice(pro.indexOf('<MobileComposerTools'), pro.indexOf('</MobileComposerTools>'));
    expect(tools).toContain('nb-pro-send-slot');
    expect(tools).toContain('nb-pro-expand-desktop');
    expect(tools).toContain('aria-label="Cancel request"');
    const type = pro.slice(pro.indexOf('data-tour="chat"'), pro.indexOf('data-tour="chat"') + 5000);
    expect(type).not.toContain('nb-pro-send-btn');
    expect(type).not.toContain('absolute right-2');
  });

  it('AttachMenu stays iOS-safe for Free paperclip', () => {
    const src = read('src/components/AttachMenu.tsx');
    expect(src).not.toMatch(/setTimeout\s*\(\s*\(\)\s*=>\s*ref\.current\?\.click/);
    expect(src).toContain('ATTACH_FILE_INPUT_CLASS');
    expect(src).toContain('opacity-0');
  });
});
