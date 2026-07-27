import { describe, it, expect } from 'vitest';
import {
  insertSnippet, externalResourceUrl, pageLoadsTailwind, snippetNeedsTailwind,
} from '../src/lib/htmlInsert';

// The Component Library's "Insert" now writes the user's real file instead of a preview, which is
// what makes the difference between a component (append every time — two pricing cards is a valid
// thing to want) and a library tag (never twice — loading jQuery again is a real bug) load-bearing.

const PAGE = '<html><head><title>x</title></head><body><h1>Hi</h1></body></html>';
const CARD = '<div class="bg-gray-800 rounded-2xl p-6"><h2 class="text-white">Card</h2></div>';
const JQUERY = '<script src="https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js"></script>';

describe('insertSnippet — components', () => {
  it('adds the markup at the end of the body, where it will be seen', () => {
    const r = insertSnippet('index.html', PAGE, CARD);
    expect(r.ok).toBe(true);
    expect(r.skipped).toBe(false);
    expect(r.code.indexOf(CARD)).toBeGreaterThan(r.code.indexOf('<h1>Hi</h1>'));
    expect(r.code.indexOf(CARD)).toBeLessThan(r.code.indexOf('</body>'));
  });

  it('adding the same component twice really adds it twice — that is the point', () => {
    const once = insertSnippet('index.html', PAGE, CARD);
    const twice = insertSnippet('index.html', once.code, CARD);
    expect(twice.code.split('rounded-2xl').length - 1).toBe(2);
  });

  it('a page with no </body> still receives the markup', () => {
    const r = insertSnippet('partial.html', '<div>only this</div>', CARD);
    expect(r.ok).toBe(true);
    expect(r.code).toContain('only this');
    expect(r.code).toContain('rounded-2xl');
  });

  it('refuses a file that is not an HTML page, and changes nothing', () => {
    const src = 'export const A = () => <div/>;';
    const r = insertSnippet('src/App.tsx', src, CARD);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(src);
    expect(r.error).toBeTruthy();
  });

  it('refuses an empty snippet', () => {
    expect(insertSnippet('index.html', PAGE, '   ').ok).toBe(false);
  });
});

describe('insertSnippet — library tags', () => {
  it('puts a library in the <head>, so it loads before the page uses it', () => {
    const r = insertSnippet('index.html', PAGE, JQUERY);
    expect(r.ok).toBe(true);
    expect(r.code.indexOf('jquery')).toBeLessThan(r.code.indexOf('</head>'));
  });

  it('does NOT load the same library a second time', () => {
    const once = insertSnippet('index.html', PAGE, JQUERY);
    const twice = insertSnippet('index.html', once.code, JQUERY);
    expect(twice.skipped).toBe(true);
    expect(twice.code).toBe(once.code);
    expect(twice.code.split('jquery.min.js').length - 1).toBe(1);
  });

  it('recognises a stylesheet <link> as a library too', () => {
    const link = '<link rel="stylesheet" href="https://cdn.example.com/x.css">';
    const once = insertSnippet('index.html', PAGE, link);
    expect(once.code.indexOf('x.css')).toBeLessThan(once.code.indexOf('</head>'));
    expect(insertSnippet('index.html', once.code, link).skipped).toBe(true);
  });

  it('externalResourceUrl only matches a real single tag', () => {
    expect(externalResourceUrl(JQUERY)).toContain('jquery.min.js');
    expect(externalResourceUrl(CARD)).toBeNull();
    expect(externalResourceUrl('<script>inline()</script>')).toBeNull();
  });
});

describe('the Tailwind warning — honest instead of silently unstyled', () => {
  it('spots a page that already loads Tailwind, however it does so', () => {
    expect(pageLoadsTailwind('<script src="https://cdn.tailwindcss.com"></script>')).toBe(true);
    expect(pageLoadsTailwind('@import "tailwindcss";')).toBe(true);
    expect(pageLoadsTailwind('<link href="/assets/tailwind.css" rel="stylesheet">')).toBe(true);
    expect(pageLoadsTailwind(PAGE)).toBe(false);
  });

  it('knows which snippets actually depend on Tailwind', () => {
    expect(snippetNeedsTailwind(CARD)).toBe(true);
    expect(snippetNeedsTailwind(JQUERY)).toBe(false);
    expect(snippetNeedsTailwind('<div style="color:red">plain</div>')).toBe(false);
  });
});
