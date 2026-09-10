import { describe, it, expect } from 'vitest';
import { escapeHtml, renderInline, renderLegalMarkdown, renderLegalPageHtml } from './legalMarkdown';

describe('escapeHtml — nothing in a document can become markup', () => {
  it('escapes every HTML-significant character', () => {
    expect(escapeHtml('<script>alert("x")</script>'))
      .toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(escapeHtml("a & b 'c'")).toBe('a &amp; b &#39;c&#39;');
  });
});

describe('renderInline — the formatting these documents actually use', () => {
  it('renders bold, italic and code', () => {
    expect(renderInline('**bold**')).toBe('<strong>bold</strong>');
    expect(renderInline('an *emphasis* here')).toBe('an <em>emphasis</em> here');
    expect(renderInline('`code`')).toBe('<code>code</code>');
  });

  it('renders http and mailto links', () => {
    expect(renderInline('[site](https://navbharatai.com)'))
      .toBe('<a href="https://navbharatai.com" rel="noopener noreferrer">site</a>');
    expect(renderInline('[mail](mailto:info@navbharatai.com)'))
      .toContain('href="mailto:info@navbharatai.com"');
  });

  it('REFUSES a javascript: link but keeps its text', () => {
    // A live XSS vector on a page we serve to reviewers. The reader still sees the words.
    const out = renderInline('[click](javascript:alert(1))');
    expect(out).toBe('click');
    expect(out).not.toContain('<a');
  });

  it('refuses other non-http schemes too', () => {
    expect(renderInline('[x](data:text/html,b)')).toBe('x');
    expect(renderInline('[x](//evil.example)')).toBe('x');
  });

  it('keeps a real URL that contains parentheses intact', () => {
    const out = renderInline('[ref](https://en.wikipedia.org/wiki/Pixel_(disambiguation))');
    expect(out).toContain('href="https://en.wikipedia.org/wiki/Pixel_(disambiguation)"');
    expect(out).not.toContain(')</a>)');
  });
});

describe('renderLegalMarkdown — the document structure', () => {
  it('renders headings at the right level', () => {
    expect(renderLegalMarkdown('# Title')).toBe('<h1>Title</h1>');
    expect(renderLegalMarkdown('## Section')).toBe('<h2>Section</h2>');
    expect(renderLegalMarkdown('### Sub')).toBe('<h3>Sub</h3>');
  });

  it('renders a horizontal rule', () => {
    expect(renderLegalMarkdown('---')).toBe('<hr>');
  });

  it('groups consecutive bullets into ONE list and closes it', () => {
    const html = renderLegalMarkdown('- one\n- two\n\nafter');
    expect(html).toContain('<ul>\n<li>one</li>\n<li>two</li>\n</ul>');
    expect(html).toContain('<p>after</p>');
  });

  it('renders a numbered list as <ol>', () => {
    const html = renderLegalMarkdown('1. first\n2. second');
    expect(html).toBe('<ol>\n<li>first</li>\n<li>second</li>\n</ol>');
  });

  it('switches cleanly between list types', () => {
    const html = renderLegalMarkdown('- bullet\n1. number');
    expect(html).toBe('<ul>\n<li>bullet</li>\n</ul>\n<ol>\n<li>number</li>\n</ol>');
  });

  it('renders a blockquote', () => {
    expect(renderLegalMarkdown('> quoted')).toBe('<blockquote>quoted</blockquote>');
  });

  it('joins wrapped lines into one paragraph', () => {
    expect(renderLegalMarkdown('one line\nnext line')).toBe('<p>one line next line</p>');
  });

  it('escapes document text before formatting it', () => {
    expect(renderLegalMarkdown('a <b>tag</b> in prose')).toBe('<p>a &lt;b&gt;tag&lt;/b&gt; in prose</p>');
  });

  it('handles empty and non-string input without throwing', () => {
    expect(renderLegalMarkdown('')).toBe('');
    expect(renderLegalMarkdown(undefined as unknown as string)).toBe('');
  });
});

describe('renderLegalPageHtml — a complete page a crawler can read', () => {
  const page = renderLegalPageHtml({ title: 'Privacy Policy', updated: '2 September 2026', body: '# Privacy Policy\n\nHello.' });

  it('is a full HTML document with the title in <title>', () => {
    expect(page.startsWith('<!doctype html>')).toBe(true);
    expect(page).toContain('<title>Privacy Policy — NavBharatAI</title>');
  });

  it('carries the document text in the FIRST response — no JavaScript needed', () => {
    // This is the whole point: an automated policy checker that does not run JS must still see it.
    expect(page).toContain('<h1>Privacy Policy</h1>');
    expect(page).toContain('Hello.');
  });

  it('loads NO script and NO external resource', () => {
    expect(page).not.toContain('<script');
    expect(page).not.toContain('http-equiv="refresh"');
    // No font host, no stylesheet link — the page cannot be broken by an external dependency.
    expect(page).not.toContain('<link ');
  });

  it('shows when it was last updated', () => {
    expect(page).toContain('Last updated 2 September 2026');
  });
});
