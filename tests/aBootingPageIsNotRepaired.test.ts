// HEAL CENSUS OF AUTOPSY 303e8a6f (2026-10-12) — HTML_ENTRY_REPAIRED is a real repair when it fires correctly, and the
// census kept it a heal. But its detector fired on pages that ALREADY booted, so some of those heals were false —
// and one shape was a harmful write: a second module script beside an entry the page already loaded, which can
// mount the app twice. Five shapes, plus the route picking a `dist/` or `public/` copy that sorts first in the
// durable store's key order.
//
// The CLASS: a "does it boot?" detector that recognised one spelling of a booting page (an `id="root"`, a script
// named main|index). It now reads what the entry module actually mounts into and any local module script, and both
// lanes ask one function which page is the app's.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ensureHtmlEntryScript, appEntryHtmlKey } from '../src/server/AgentV3/HtmlEntryGuard';

const REACT_MAIN = "import { createRoot } from 'react-dom/client';\ncreateRoot(document.getElementById('root')!).render(null);\n";
const VUE_MAIN = "import { createApp } from 'vue';\nimport App from './App.vue';\ncreateApp(App).mount('#app');\n";
const page = (body: string, head = '') => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

describe('a page that already boots is left alone', () => {
  it.each([
    ['Vue mounts into #app', { 'index.html': page('<div id="app"></div><script type="module" src="/src/main.ts"></script>'), 'src/main.ts': VUE_MAIN }],
    ['an unquoted id', { 'index.html': page('<div id=root></div><script type="module" src="/src/main.tsx"></script>'), 'src/main.tsx': REACT_MAIN }],
    ['the entry script is not named main|index', { 'index.html': page('<div id="root"></div><script type="module" src="/src/app.tsx"></script>'), 'src/main.tsx': REACT_MAIN }],
    ['an inline module script imports the entry', { 'index.html': page('<div id="root"></div><script type="module">import "/src/main.tsx";</script>'), 'src/main.tsx': REACT_MAIN }],
    ['a CRA page the bundler fills in (no root index.html)', { 'public/index.html': page('<div id="root"></div>'), 'src/index.js': REACT_MAIN }],
  ])('%s', (_n, files) => {
    expect(ensureHtmlEntryScript(files as Record<string, string>).injected).toBe(false);
  });
});

describe('a page that cannot boot is still repaired — with the id the entry really uses', () => {
  it('no script and no mount: both are added (the original 2026-07-13 case)', () => {
    const out = ensureHtmlEntryScript({ 'index.html': page(''), 'src/main.tsx': REACT_MAIN });
    expect(out.injected).toBe(true);
    expect(out.files['index.html']).toContain('<div id="root"></div>');
    expect(out.files['index.html']).toContain('<script type="module" src="/src/main.tsx"></script>');
  });

  it('a Vue page missing its mount gets #app, not #root', () => {
    const out = ensureHtmlEntryScript({ 'index.html': page('<script type="module" src="/src/main.ts"></script>'), 'src/main.ts': VUE_MAIN });
    expect(out.files['index.html']).toContain('<div id="app"></div>');
    expect(out.files['index.html']).not.toContain('id="root"');
  });

  it('a remote script is not the app\'s entry', () => {
    const out = ensureHtmlEntryScript({ 'index.html': page('<div id="root"></div><script type="module" src="https://cdn.example.com/x.js"></script>'), 'src/main.tsx': REACT_MAIN });
    expect(out.injected).toBe(true);
  });
});

describe('🔒 one answer for which page is the app\'s, on both lanes', () => {
  it('the root page — never a dist/ or public/ copy that sorts first', () => {
    expect(appEntryHtmlKey({ 'dist/index.html': '', 'index.html': '' })).toBe('index.html');
    expect(appEntryHtmlKey({ 'public/index.html': '' })).toBeNull();
    const out = ensureHtmlEntryScript({ 'dist/index.html': page(''), 'index.html': page('<div id="root"></div><script type="module" src="/src/main.tsx"></script>'), 'src/main.tsx': REACT_MAIN });
    expect(out.injected).toBe(false);
  });

  it('the route asks the guard which page it is', () => {
    const route = readFileSync(join(__dirname, '../src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain('const htmlKey = appEntryHtmlKey(full);');
    expect(route).not.toMatch(/const htmlKey = Object\.keys\(full\)\.find\(\(k\) => \/\(\^\|\\\/\)index\\\.html\$\/i/);
  });
});
