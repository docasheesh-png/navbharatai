import { describe, it, expect } from 'vitest';
import { ensureHtmlEntryScript } from './HtmlEntryGuard';

describe('ensureHtmlEntryScript', () => {
  // THE exact bug (deep-test clock re-run): the per-file index.html had a #root but NO entry script,
  // so the page rendered blank (React never mounted). The guard re-attaches the script.
  it('re-attaches a missing entry script pointing at the real entry module', () => {
    const files = {
      'index.html': '<!doctype html><html><body><noscript>JS required</noscript><div id="root"></div></body></html>',
      'src/main.jsx': "import App from './App'; /* boots */",
      'src/App.jsx': 'export default () => <div>hi</div>;',
    };
    const { files: out, injected } = ensureHtmlEntryScript(files);
    expect(injected).toBe(true);
    expect(out['index.html']).toContain('<script type="module" src="/src/main.jsx"></script>');
    // The script is placed before </body>.
    expect(out['index.html']).toMatch(/<script[^>]*><\/script>\s*<\/body>/);
  });

  it('prefers the conventional entry (main.tsx over main.jsx) when both exist', () => {
    const files = {
      'index.html': '<html><body><div id="root"></div></body></html>',
      'src/main.tsx': 'boot',
      'src/main.jsx': 'boot',
    };
    expect(ensureHtmlEntryScript(files).files['index.html']).toContain('src="/src/main.tsx"');
  });

  it('injects a #root mount node when the HTML lacks one', () => {
    const files = {
      'index.html': '<html><body></body></html>',
      'src/main.tsx': 'boot',
    };
    const { files: out, injected } = ensureHtmlEntryScript(files);
    expect(injected).toBe(true);
    expect(out['index.html']).toContain('<div id="root"></div>');
    expect(out['index.html']).toContain('src="/src/main.tsx"');
  });

  it('is a NO-OP when the HTML already boots correctly', () => {
    const files = {
      'index.html': '<html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
      'src/main.tsx': 'boot',
    };
    const { injected } = ensureHtmlEntryScript(files);
    expect(injected).toBe(false);
  });

  it('does NOT fabricate a script when no entry module exists (never guesses)', () => {
    const files = { 'index.html': '<html><body><div id="root"></div></body></html>' };
    expect(ensureHtmlEntryScript(files).injected).toBe(false);
  });

  it('does not double-inject when a (differently-pathed) entry script is already present', () => {
    const files = {
      'index.html': '<html><body><div id="root"></div><script type="module" src="./src/main.jsx"></script></body></html>',
      'src/main.jsx': 'boot',
    };
    // An entry script exists (path rewriting is the language-coherence guard's job) → don't add a second.
    const out = ensureHtmlEntryScript(files);
    expect(out.injected).toBe(false);
    expect((out.files['index.html'].match(/<script/g) || []).length).toBe(1);
  });

  it('returns unchanged for missing index.html / bad input', () => {
    expect(ensureHtmlEntryScript({ 'src/main.tsx': 'x' }).injected).toBe(false);
    // @ts-expect-error runtime guard
    expect(ensureHtmlEntryScript(null).injected).toBe(false);
  });
});
