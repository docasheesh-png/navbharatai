/** The 2026-10-25 desktop report: a tiny full-width strip must not return in any AI lane. */
import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { ComposerShell, COMPOSER_TEXTAREA_CLASS } from '../src/components/chat/ComposerShell';
const read = (path: string) => readFileSync(path, 'utf8');
const shellSurfaces = [
  'ide/AIChat', 'ide/AIImageGenerator', 'professionals/ProfessionalChat', 'sda/SDAChat',
  'ide/AgentV3MiniChat', 'ide/BotBuildHelp', 'repoAnalyst/RepoAnalystTool', 'ide/LiveCollaboration',
];
describe('one roomy prompt card across NavBharatAI', () => {
  it.each(shellSurfaces)('%s uses the shared shell and readable growing editor', (surface) => {
    const source = read(`src/components/${surface}.tsx`);
    expect(source).toContain('<ComposerShell');
    expect(source).toContain('COMPOSER_TEXTAREA_CLASS');
    expect(source).toMatch(/autoGrow\(|scrollHeight/);
  });
  it('Pro shares the card and editor tokens, capped and centred even without a preview pane', () => {
    const source = read('src/components/agentv3/AgentV3Panel.tsx');
    expect(source).toContain('${COMPOSER_BOX_CLASS}`} data-composer-surface="pro"');
    expect(source).toContain('mx-auto w-[calc(100%-1.5rem)] max-w-3xl');
    expect(source).toContain('${COMPOSER_TEXTAREA_CLASS} overflow-y-auto');
    expect(source).toContain('clampComposerHeight(el.scrollHeight, lineH, padY)');
    expect(source).toContain('order-2 flex-nowrap overflow-x-auto px-2 pb-2 pr-24');
    expect(source).not.toContain('pl-4 pr-20 py-2.5 text-[15px]');
    expect(source).toContain("const composerBtnY = 'bottom-2'");
  });
  it('the editor has real writing space without zooming iOS, and no control-sized right reserve', () => {
    expect(COMPOSER_TEXTAREA_CLASS).toContain('min-h-[72px]');
    expect(COMPOSER_TEXTAREA_CLASS).toContain('text-[16px]');
    expect(COMPOSER_TEXTAREA_CLASS).not.toMatch(/\bpr-(?:[2-9]\d|\d{3})\b/);
  });
  it.each([false, true])('navigation rail %s never puts controls alongside typed text', (rail) => {
    const html = renderToStaticMarkup(React.createElement(ComposerShell, {
      onOpenHistory: rail ? () => {} : undefined,
      controls: React.createElement('button', {}, 'Attach'),
      send: React.createElement('button', {}, 'Send'),
      children: React.createElement('textarea', { className: COMPOSER_TEXTAREA_CLASS }),
    }));
    expect(html).toContain('mx-auto w-full max-w-3xl');
    expect(html.indexOf('</textarea>')).toBeLessThan(html.indexOf('data-composer-toolbar'));
    expect(html).toContain('flex-nowrap');
    expect(html).toContain('shrink-0 self-end');
    expect(html).not.toContain('one-line');
  });
});
