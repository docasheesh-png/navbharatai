import { describe, it, expect } from 'vitest';
import { buildSeoHead, applySeoHead, isSafeUrl } from '../src/lib/seoHead';

// Both defects encoded below were harmless while "Apply" only touched a throwaway preview, and are
// not harmless now that it writes the user's real page. Descriptions are free text people paste from
// anywhere, and a page's <head> is not the only place a <title> string can appear in a file.

const PAGE = `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<title>Old title</title>
<meta name="description" content="old description">
</head>
<body><h1>Hello</h1></body></html>`;

describe('buildSeoHead — values are escaped for attribute context', () => {
  it('a double quote in a description cannot break out of the attribute', () => {
    const out = buildSeoHead({ description: 'He said "hello" to me' });
    expect(out).toContain('&quot;hello&quot;');
    expect(out).not.toContain('content="He said "hello"');
  });

  it('an injection attempt becomes text, not markup', () => {
    const out = buildSeoHead({ description: '" onload="steal()' });
    expect(out).not.toContain('onload="steal()');
    expect(out).toContain('&quot;');
  });

  it('escapes angle brackets and ampersands in the title too', () => {
    const out = buildSeoHead({ title: 'Tea & <b>Coffee</b>' });
    expect(out).toContain('Tea &amp; &lt;b&gt;Coffee&lt;/b&gt;');
  });

  it('writes the ordinary tags a page needs', () => {
    const out = buildSeoHead({ title: 'Chai Point', description: 'Best chai', keywords: 'chai, tea', robots: 'index, follow' });
    expect(out).toContain('<title>Chai Point</title>');
    expect(out).toContain('name="description" content="Best chai"');
    expect(out).toContain('name="robots"');
  });

  it('falls back to the page title/description for the social tags', () => {
    const out = buildSeoHead({ title: 'T', description: 'D' });
    expect(out).toContain('property="og:title" content="T"');
    expect(out).toContain('property="og:description" content="D"');
  });

  it('leaves out every field the user did not fill in', () => {
    expect(buildSeoHead({})).toBe('');
  });
});

describe('isSafeUrl — a canonical link is a real injection vector', () => {
  it('accepts ordinary web addresses', () => {
    expect(isSafeUrl('https://navbharatai.com/page')).toBe(true);
    expect(isSafeUrl('/relative/path')).toBe(true);
  });

  it('refuses anything that can execute', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>', 'vbscript:x', '']) {
      expect(isSafeUrl(bad), bad).toBe(false);
    }
  });

  it('refuses a URL containing a quote that would break the attribute', () => {
    expect(isSafeUrl('https://x.com/" onload="y')).toBe(false);
  });

  it('an unsafe canonical or image URL is simply not written', () => {
    const out = buildSeoHead({ canonicalUrl: 'javascript:alert(1)', ogImage: 'data:text/html,x' });
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('data:text/html');
  });
});

describe('applySeoHead', () => {
  it('replaces the existing tags rather than stacking new ones', () => {
    const r = applySeoHead(PAGE, { title: 'New title', description: 'New description' });
    expect(r.ok).toBe(true);
    expect(r.replaced).toBe(2);
    expect(r.code.match(/<title>/g)).toHaveLength(1);
    expect(r.code).toContain('New title');
    expect(r.code).not.toContain('Old title');
    expect(r.code).not.toContain('old description');
  });

  it('keeps the rest of the head and the whole body', () => {
    const r = applySeoHead(PAGE, { title: 'X' });
    expect(r.code).toContain('<meta charset="UTF-8">');
    expect(r.code).toContain('<h1>Hello</h1>');
  });

  it('applying twice is the same as applying once', () => {
    const once = applySeoHead(PAGE, { title: 'X', description: 'Y' });
    const twice = applySeoHead(once.code, { title: 'X', description: 'Y' });
    expect(twice.code).toBe(once.code);
  });

  it('does NOT touch a <title> that lives outside the head — the old version deleted it', () => {
    // A page that shows example markup, or builds it in JS, legitimately contains this text.
    const withSample = `<html><head><title>Real</title></head><body>
<pre>&lt;title&gt;example&lt;/title&gt;</pre>
<script>const tpl = "<title>from js</title>";</script>
</body></html>`;
    const r = applySeoHead(withSample, { title: 'New' });
    expect(r.ok).toBe(true);
    expect(r.code).toContain('const tpl = "<title>from js</title>"');
    expect(r.code).toContain('<title>New</title>');
    expect(r.code).not.toContain('<title>Real</title>');
  });

  it('declines a page with no head instead of guessing', () => {
    const frag = '<div>just a fragment</div>';
    const r = applySeoHead(frag, { title: 'X' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(frag);
    expect(r.error).toMatch(/head/i);
  });

  it('handles a head with attributes', () => {
    const r = applySeoHead('<html><head lang="en"><title>A</title></head><body></body></html>', { title: 'B' });
    expect(r.ok).toBe(true);
    expect(r.code).toContain('<title>B</title>');
  });
});
