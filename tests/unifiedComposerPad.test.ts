/** Unified pad: Type with Send on its right edge; tools below; no divider (admin 2026-10-26). */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMPOSER_TEXTAREA_CLASS, COMPOSER_SEND_SLOT_CLASS } from '../src/components/chat/ComposerShell';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('unified composer pad', () => {
  it('shell keeps Send on the Type row, tools below without a divider', () => {
    const shell = read('src/components/chat/ComposerShell.tsx');
    const render = shell.slice(shell.indexOf('export function ComposerShell'));
    expect(render.indexOf('{children}')).toBeLessThan(render.indexOf('{send}'));
    expect(render.indexOf('{send}')).toBeLessThan(render.indexOf('data-composer-toolbar'));
    expect(COMPOSER_SEND_SLOT_CLASS).toContain('nb-composer-send-slot');
    expect(COMPOSER_TEXTAREA_CLASS).toContain('min-h-[40px]');
  });

  it('CSS puts Send on Type right edge and draws no pad divider', () => {
    const css = read('src/components/chat/composer.css');
    expect(css).toContain('nb-composer-send-slot');
    expect(css).toContain('position: absolute !important');
    expect(css).toContain('right: 8px !important');
    expect(css).toContain('border-top: none !important');
    expect(css).not.toMatch(/\[data-composer-toolbar\][^{]*\{[^}]*border-top:\s*1px solid/);
    expect(css).not.toMatch(/\.nb-pro-controls[^{]*\{[^}]*border-top:\s*1px solid/);
    expect(css).toContain('nb-composer-tools-toggle { display: none !important; }');
    expect(css).toContain('position: fixed !important');
  });

  it('Pro flattens MobileComposerTools so desktop Type stays above tools', () => {
    const css = read('src/components/chat/composer.css');
    expect(css).toContain('data-composer-surface="pro"] > .nb-composer-tools');
    expect(css).toMatch(/\[data-composer-surface="pro"\][\s\S]*nb-composer-tools-content[\s\S]*display: contents !important/);
    expect(css).toMatch(/\[data-composer-surface="pro"\][\s\S]*\[data-tour="chat"\][\s\S]*order: 1/);
    expect(css).toMatch(/\[data-composer-surface="pro"\][\s\S]*\.nb-pro-controls[\s\S]*order: 2/);
  });

  it('desktop hides the duplicate ↵ Send chip while Search/Clear remain', () => {
    const css = read('src/components/chat/composer.css');
    const desktop = css.slice(css.indexOf('@media (min-width: 640px)'));
    expect(desktop).toContain('.nb-send-enter-toggle');
    expect(desktop).toContain('display: none !important');
    const toolbar = read('src/components/chat/ChatToolbar.tsx');
    expect(toolbar).toContain('Search');
    expect(toolbar).toContain('Clear');
  });

  it('Pro Send sits inside the Type tour row, not the tools action bar', () => {
    const pro = read('src/components/agentv3/AgentV3Panel.tsx');
    const toolsEnd = pro.indexOf('</MobileComposerTools>');
    const tools = pro.slice(pro.indexOf('<MobileComposerTools'), toolsEnd);
    expect(tools).not.toContain('nb-pro-send-slot');
    expect(tools).toContain('nb-pro-expand-desktop');
    const sendAt = pro.indexOf('nb-pro-send-slot');
    expect(sendAt).toBeGreaterThan(pro.indexOf('data-tour="chat"'));
    expect(sendAt).toBeGreaterThan(toolsEnd);
    const sendBlock = pro.slice(sendAt, sendAt + 4000);
    expect(sendBlock).toContain('nb-pro-send-btn');
    expect(sendBlock).toContain('aria-label="Cancel request"');
  });

  it('AttachMenu stays iOS-safe for Free paperclip', () => {
    const src = read('src/components/AttachMenu.tsx');
    expect(src).not.toMatch(/setTimeout\s*\(\s*\(\)\s*=>\s*ref\.current\?\.click/);
    expect(src).toContain('ATTACH_FILE_INPUT_CLASS');
    expect(src).toContain('opacity-0');
  });
});
