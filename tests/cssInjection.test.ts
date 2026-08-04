import { describe, it, expect } from 'vitest';
import { injectStyleBlock, injectScriptBlock, canCarryStylesheet } from '../src/lib/cssInjection';

// These behaviours only started to matter once "inject into my app" began writing the user's REAL
// file instead of a throwaway preview. The idempotence tests are the important ones: a user who
// adjusts a colour and presses the button again must end up with ONE block, not a growing stack of
// conflicting stylesheets where the last one silently wins.

const CSS = ':root { --color-primary: #6366f1; }';
const CSS2 = ':root { --color-primary: #ef4444; }';

describe('injectStyleBlock — HTML', () => {
  it('adds the stylesheet just before </head>', () => {
    const r = injectStyleBlock('index.html', '<html><head><title>x</title></head><body>hi</body></html>', CSS, 'nb-tokens');
    expect(r.ok).toBe(true);
    expect(r.replaced).toBe(false);
    expect(r.code).toContain('<style id="nb-tokens">');
    expect(r.code.indexOf('<style id="nb-tokens">')).toBeLessThan(r.code.indexOf('</head>'));
    expect(r.code).toContain('hi');
  });

  it('running twice REPLACES the block instead of stacking a second copy', () => {
    const once = injectStyleBlock('index.html', '<html><head></head><body></body></html>', CSS, 'nb-tokens');
    const twice = injectStyleBlock('index.html', once.code, CSS2, 'nb-tokens');
    expect(twice.replaced).toBe(true);
    expect(twice.code.match(/<style id="nb-tokens">/g)).toHaveLength(1);
    expect(twice.code).toContain('#ef4444');
    expect(twice.code).not.toContain('#6366f1');
  });

  it('two different tools keep their own blocks side by side', () => {
    const a = injectStyleBlock('index.html', '<html><head></head><body></body></html>', CSS, 'nb-tokens');
    const b = injectStyleBlock('index.html', a.code, '.dark { color: #fff; }', 'nb-darkmode');
    expect(b.code).toContain('<style id="nb-tokens">');
    expect(b.code).toContain('<style id="nb-darkmode">');
  });

  it('a fragment with no <head> still gets the styles, prepended', () => {
    const r = injectStyleBlock('partial.html', '<div>hello</div>', CSS, 'nb-tokens');
    expect(r.ok).toBe(true);
    expect(r.code.startsWith('<style id="nb-tokens">')).toBe(true);
    expect(r.code).toContain('<div>hello</div>');
  });

  it('matches an existing block written with single quotes or extra attributes', () => {
    const src = `<html><head><style id='nb-tokens' type="text/css">old</style></head><body></body></html>`;
    const r = injectStyleBlock('index.html', src, CSS, 'nb-tokens');
    expect(r.replaced).toBe(true);
    expect(r.code).not.toContain('old');
  });
});

describe('injectStyleBlock — CSS', () => {
  it('appends a fenced block and keeps the user’s own rules', () => {
    const r = injectStyleBlock('styles/main.css', '.mine { color: red; }', CSS, 'nb-tokens');
    expect(r.ok).toBe(true);
    expect(r.code).toContain('.mine { color: red; }');
    expect(r.code).toContain('nb-tokens:start');
    expect(r.code).toContain('nb-tokens:end');
  });

  it('running twice replaces the fenced block, leaving the user’s rules untouched', () => {
    const once = injectStyleBlock('styles/main.css', '.mine { color: red; }', CSS, 'nb-tokens');
    const twice = injectStyleBlock('styles/main.css', once.code, CSS2, 'nb-tokens');
    expect(twice.replaced).toBe(true);
    expect(twice.code.match(/nb-tokens:start/g)).toHaveLength(1);
    expect(twice.code).toContain('.mine { color: red; }');
    expect(twice.code).toContain('#ef4444');
    expect(twice.code).not.toContain('#6366f1');
  });

  it('an empty stylesheet does not gain a stray blank line', () => {
    const r = injectStyleBlock('a.css', '', CSS, 'nb-tokens');
    expect(r.code.startsWith('/* nb-tokens:start')).toBe(true);
  });
});

describe('injectStyleBlock — declines honestly', () => {
  it('refuses a file that cannot carry a stylesheet, and changes nothing', () => {
    const src = 'export const A = () => <div/>;';
    const r = injectStyleBlock('src/App.tsx', src, CSS, 'nb-tokens');
    expect(r.ok).toBe(false);
    expect(r.code).toBe(src);
    expect(r.error).toBeTruthy();
  });

  it('canCarryStylesheet matches what injection actually supports', () => {
    for (const p of ['index.html', 'a.htm', 'styles/main.css']) expect(canCarryStylesheet(p), p).toBe(true);
    for (const p of ['src/App.tsx', 'a.js', 'data.json', 'README.md']) expect(canCarryStylesheet(p), p).toBe(false);
  });
});

describe('injectScriptBlock', () => {
  const PAGE = '<html><head></head><body><p>hi</p></body></html>';
  const JS = 'console.log(1);';

  it('places the script before </body>, where a script belongs', () => {
    const r = injectScriptBlock('index.html', PAGE, JS, 'nb-dark-toggle');
    expect(r.ok).toBe(true);
    expect(r.code.indexOf('<script id="nb-dark-toggle">')).toBeLessThan(r.code.indexOf('</body>'));
  });

  it('running twice replaces the script — the Dark Mode tool used to add a new button every press', () => {
    const once = injectScriptBlock('index.html', PAGE, JS, 'nb-dark-toggle');
    const twice = injectScriptBlock('index.html', once.code, 'console.log(2);', 'nb-dark-toggle');
    expect(twice.replaced).toBe(true);
    expect(twice.code.match(/<script id="nb-dark-toggle">/g)).toHaveLength(1);
    expect(twice.code).toContain('console.log(2);');
    expect(twice.code).not.toContain('console.log(1);');
  });

  it('an empty script REMOVES the block, so switching the option off really takes it out', () => {
    const once = injectScriptBlock('index.html', PAGE, JS, 'nb-dark-toggle');
    const off = injectScriptBlock('index.html', once.code, '', 'nb-dark-toggle');
    expect(off.code).not.toContain('nb-dark-toggle');
    expect(off.code).toContain('<p>hi</p>');
  });

  it('leaves the user’s own script tags alone', () => {
    const src = '<html><body><script>userCode()</script></body></html>';
    const r = injectScriptBlock('index.html', src, JS, 'nb-dark-toggle');
    expect(r.code).toContain('userCode()');
    expect(r.code).toContain('<script id="nb-dark-toggle">');
  });

  it('refuses a CSS file rather than writing a script into it', () => {
    const r = injectScriptBlock('main.css', '.a{}', JS, 'nb-dark-toggle');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('.a{}');
  });
});
