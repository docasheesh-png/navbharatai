import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { autoGrow, resetGrow, resizeMobileComposer } from '../src/lib/autoGrowTextarea';

function viewport(width = 390, height = 800, visibleHeight = height) {
  vi.stubGlobal('window', {
    innerHeight: height,
    visualViewport: { height: visibleHeight },
    matchMedia: (query: string) => ({ matches: query === '(max-width: 639px)' && width <= 639 }),
  });
}
function editor(value = '', contentHeight = 44, composer = true) {
  let measured = contentHeight;
  const el = {
    value,
    style: { height: '200px' },
    classList: { contains: (name: string) => composer && name === 'nb-composer-text' },
    get scrollHeight() {
      // A real textarea keeps at least its current clientHeight. Reset before measuring.
      return Math.max(measured, Number.parseFloat(this.style.height) || 0);
    },
  };
  return { el: el as unknown as HTMLTextAreaElement, setContentHeight: (height: number) => { measured = height; } };
}
afterEach(() => vi.unstubAllGlobals());

describe('compact mobile composer sizing', () => {
  it('starts at one 44px line even when a long placeholder wraps', () => {
    viewport();
    const { el } = editor('', 180);
    expect(resizeMobileComposer(el)).toBe(true);
    expect(el.style.height).toBe('44px');
  });
  it('grows with wrapping/newlines, caps pasted text, and shrinks when deleted', () => {
    viewport();
    const { el, setContentHeight } = editor('first\nsecond', 68);
    autoGrow(el, 240);
    expect(el.style.height).toBe('68px');
    el.value = 'a long pasted draft';
    setContentHeight(900);
    autoGrow(el, 240);
    expect(el.style.height).toBe('160px');
    el.value = 'short';
    setContentHeight(44);
    autoGrow(el, 240);
    expect(el.style.height).toBe('44px');
  });
  it('reset after clear/send ignores the old scroll height and placeholder', () => {
    viewport();
    const { el } = editor('long draft', 900);
    autoGrow(el, 128);
    el.value = '';
    resetGrow(el);
    expect(el.style.height).toBe('44px');
  });
  it('uses the visible keyboard viewport and retains a usable minimum', () => {
    viewport(390, 800, 300);
    const { el } = editor('long draft', 900);
    autoGrow(el, 240);
    expect(el.style.height).toBe('90px');
    viewport(390, 800, 100);
    autoGrow(el, 240);
    expect(el.style.height).toBe('44px');
  });
  it('uses innerHeight when visualViewport is unavailable', () => {
    vi.stubGlobal('window', { innerHeight: 400, matchMedia: () => ({ matches: true }) });
    const { el } = editor('long draft', 900);
    autoGrow(el, 240);
    expect(el.style.height).toBe('120px');
  });
  it('changes at the 640px breakpoint without altering desktop growth/reset', () => {
    const { el } = editor('draft', 210);
    viewport(639);
    autoGrow(el, 240);
    expect(el.style.height).toBe('160px');
    viewport(640);
    expect(resizeMobileComposer(el)).toBe(false);
    autoGrow(el, 240);
    expect(el.style.height).toBe('210px');
    resetGrow(el);
    expect(el.style.height).toBe('');
  });
  it('leaves unrelated textareas on their existing max-height contract', () => {
    viewport();
    const { el } = editor('draft', 190, false);
    expect(resizeMobileComposer(el)).toBe(false);
    expect(el.style.height).toBe('200px');
    autoGrow(el, 128);
    expect(el.style.height).toBe('128px');
    resetGrow(el);
    expect(el.style.height).toBe('');
  });
  it('does not require browser globals for SSR or non-DOM consumers', () => {
    vi.stubGlobal('window', undefined);
    const { el } = editor('draft', 80);
    expect(resizeMobileComposer(el)).toBe(false);
    autoGrow(el, 128);
    expect(el.style.height).toBe('80px');
  });
});

// Execute the actual image composer's prompt effect, not a copy of its sizing logic.
// This catches a caller-side passive effect undoing the shared shell's compact height.
function imagePromptEffect(el: HTMLTextAreaElement) {
  const path = join(__dirname, '../src/components/ide/AIImageGenerator.tsx');
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback: ts.ArrowFunction | undefined;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect'
      && node.arguments[1]?.getText(source) === '[prompt]' && ts.isArrowFunction(node.arguments[0])) callback = node.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(source);
  expect(callback).toBeDefined();
  const js = ts.transpileModule(`const effect = ${callback!.getText(source)}; effect();`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('taRef', 'autoGrow', js)({ current: el }, autoGrow);
}

describe('actual image composer sizing integration', () => {
  it('cannot expand an empty mobile composer after the shell layout effect', () => {
    viewport();
    const { el } = editor('', 180);
    resizeMobileComposer(el);
    imagePromptEffect(el);
    expect(el.style.height).toBe('44px');
  });
  it('keeps the keyboard cap after image prompt updates and restores desktop128px', () => {
    const { el } = editor('long image brief', 900);
    viewport(390, 800, 300);
    imagePromptEffect(el);
    expect(el.style.height).toBe('90px');
    viewport(900);
    imagePromptEffect(el);
    expect(el.style.height).toBe('128px');
  });
});

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ComposerShell, MobileComposerTools, COMPOSER_TEXTAREA_CLASS } from '../src/components/chat/ComposerShell';
const sourceText = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');
describe('mobile tools and desktop layout contract', () => {
  function shell(controls: React.ReactNode) {
    return renderToStaticMarkup(React.createElement(ComposerShell, {
      controls, send: React.createElement('button', { 'data-send': true }, 'Send'),
    }, React.createElement('textarea', { className: COMPOSER_TEXTAREA_CLASS })));
  }
  it('preserves mounted controls behind an accessible mobile disclosure', () => {
    const html = shell(React.createElement('button', { 'data-attach': true }, 'Attach'));
    expect(html).toContain('aria-label="Composer tools"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('data-attach="true"');
    expect(html).toContain('data-open="false"');
    expect(html).toContain('data-send="true"');
  });
  it('omits empty tool menus but keeps the desktop spacer before Send', () => {
    const html = shell(null);
    expect(html).not.toContain('aria-label="Composer tools"');
    expect(html).toContain('nb-composer-no-tools');
    expect(html).toMatch(/nb-composer-controls[^>]*><\/div><div class="nb-composer-send-slot/);
  });
  it('keeps desktop flow and scopes all compact layout to the phone breakpoint', () => {
    const css = sourceText('src/components/chat/composer.css');
    expect(css).toContain('@media (max-width: 639px)');
    expect(css.split('@media')[0]).toContain('display: contents');
    expect(css).toContain('font-size: 16px');
    expect(css).toContain('transition: none');
    expect(css).toContain('nb-composer-send-slot');
    expect(css).toContain('max-height: var(--nb-composer-menu-max-height');
    expect(css).toContain('bottom: var(--nb-composer-menu-bottom');
    expect(css).toContain('flex-wrap: nowrap');
    expect(css).toContain('overflow-y: visible');
  });
  it('keeps Pro Send in the action bar (outside Type) and resizes across breakpoints', () => {
    const pro = sourceText('src/components/agentv3/AgentV3Panel.tsx');
    const toolsStart = pro.indexOf('<MobileComposerTools');
    const toolsEnd = pro.indexOf('</MobileComposerTools>');
    expect(toolsEnd).toBeGreaterThan(pro.indexOf('<ChatToolbar', toolsStart));
    const toolsBlock = pro.slice(toolsStart, toolsEnd);
    expect(toolsBlock).toContain('nb-pro-send-slot');
    expect(toolsBlock).toContain('aria-label="Cancel request"');
    expect(toolsBlock).toContain('NextSuggestionsBulb');
    expect(toolsBlock).toContain('nb-pro-expand-desktop');
    expect(pro).not.toContain('nb-pro-suggestions-corner');
    expect(pro).toContain("window.visualViewport?.addEventListener('resize', resize)");
    expect(pro).toContain('if (resizeMobileComposer(el))');
  });
  it('unified pad CSS: Type above, action bar below, no + disclosure, menus fixed', () => {
    const css = sourceText('src/components/chat/composer.css');
    expect(css).toContain('nb-composer-tools-toggle { display: none !important; }');
    expect(css).toContain('[data-composer-toolbar]');
    expect(css).toContain('border-top: 1px solid');
    expect(css).toContain('nb-pro-send-slot');
    expect(css).toContain('position: fixed !important');
    expect(css).toContain('order: 1 !important'); // Type
    expect(css).toContain('order: 2 !important'); // action bar
    expect(css).toContain('max-height: min(72px, 14dvh) !important');
    expect(css.split('@media')[0]).toContain('.nb-composer-tools, .nb-composer-tools-content { display: contents; }');
  });
});


describe('Switch module reveals the compact tools before opening Build options', () => {
  it('renders controlled reveal state without hiding the requested picker', () => {
    const html = renderToStaticMarkup(React.createElement(MobileComposerTools, {
      open: true, onOpenChange: () => {}, children: React.createElement('button', {}, 'Build options'),
    }));
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('data-open="true"');
    expect(html).toContain('Build options');
  });
  it('opens the outer disclosure first for Switch module; Continue with Weak stays on Weak', () => {
    const pro = sourceText('src/components/agentv3/AgentV3Panel.tsx');
    const start = pro.indexOf('const openModulePicker = () => {');
    const body = pro.slice(start, pro.indexOf('requestAnimationFrame', start));
    expect(body.indexOf('setComposerToolsOpen(true)')).toBeGreaterThan(-1);
    expect(body.indexOf('setComposerToolsOpen(true)')).toBeLessThan(body.indexOf('setSettingsOpen(true)'));
    expect(pro).toContain('<MobileComposerTools open={composerToolsOpen} onOpenChange={setComposerToolsOpen}>');
    expect(pro).toContain('onClick={openModulePicker}');
    expect(pro).toContain('Continue with Weak');
    expect(pro).toContain("setPowerLevel('weak')");
    expect(pro).toContain('weakForceContinueRef');
    expect(pro).not.toContain('setPowerLevel(opt.key); openModulePicker();');
  });
});
