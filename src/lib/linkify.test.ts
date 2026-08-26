import { describe, it, expect } from 'vitest';
import { splitLinks, trimUrlTail, isSafeHttpUrl } from './linkify';

const links = (s: string) => splitLinks(s).filter((p) => p.kind === 'link') as Array<{ kind: 'link'; href: string; label: string }>;
const text = (s: string) => splitLinks(s).filter((p) => p.kind === 'text').map((p: any) => p.value).join('');

/**
 * REAL, CLICKABLE, SAFE LINKS (admin 2026-08-25). Three of the four chat surfaces rendered plain
 * text, so a URL an AI wrote could not be tapped at all. These tests pin the parser that fixes that —
 * and, just as hard, pin what must NEVER become a link, because this text is authored by a model and
 * by the pages it read.
 */
describe('splitLinks — what becomes a link', () => {
  it('links a bare https URL and keeps the surrounding sentence intact', () => {
    const s = 'Check enquiry.indianrail.gov.in or https://www.irctc.co.in/nget for live status.';
    expect(links(s).map((l) => l.href)).toEqual(['https://www.irctc.co.in/nget']);
    expect(text(s)).toContain('Check enquiry.indianrail.gov.in or ');
    expect(text(s)).toContain(' for live status.');
  });

  it('upgrades a bare www. host rather than leaving it dead text', () => {
    expect(links('see www.indiapost.gov.in today')[0]).toMatchObject({
      href: 'https://www.indiapost.gov.in',
      label: 'www.indiapost.gov.in',
    });
  });

  it('renders a markdown citation as a link with its LABEL, not raw brackets', () => {
    // The models are told to cite in markdown; these surfaces do not render markdown, so without
    // this the user would see literal [IRCTC](https://…) in the bubble.
    const out = splitLinks('Source: [IRCTC](https://www.irctc.co.in) — checked today.');
    expect(out).toContainEqual({ kind: 'link', href: 'https://www.irctc.co.in', label: 'IRCTC' });
    expect(text('Source: [IRCTC](https://www.irctc.co.in) — checked today.')).not.toContain('[IRCTC]');
  });

  it('handles several links in one message', () => {
    expect(links('a https://x.test/1 b https://y.test/2 c')).toHaveLength(2);
  });
});

describe('splitLinks — what must NEVER become a link', () => {
  it('refuses javascript:, data: and vbscript: URLs — this text is model-authored', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'vbscript:msgbox(1)']) {
      expect(links(`click ${bad} now`)).toHaveLength(0);
      expect(text(`click ${bad} now`)).toContain(bad); // still readable, just not clickable
    }
  });

  it('isSafeHttpUrl accepts only http and https', () => {
    expect(isSafeHttpUrl('https://a.test')).toBe(true);
    expect(isSafeHttpUrl('http://a.test')).toBe(true);
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeHttpUrl('ftp://a.test')).toBe(false);
    expect(isSafeHttpUrl('not a url')).toBe(false);
  });

  it('a markdown link pointing at a non-http scheme stays plain text', () => {
    expect(links('[tap me](javascript:alert(1))')).toHaveLength(0);
  });
});

describe('trimUrlTail — the punctuation belongs to the sentence', () => {
  it('drops trailing sentence punctuation', () => {
    expect(trimUrlTail('https://a.test/page.')).toBe('https://a.test/page');
    expect(trimUrlTail('https://a.test/page,')).toBe('https://a.test/page');
    expect(trimUrlTail('https://a.test/page?')).toBe('https://a.test/page');
  });

  it('drops an UNBALANCED closing bracket but keeps a balanced one', () => {
    expect(trimUrlTail('https://a.test/x)')).toBe('https://a.test/x');
    // Wikipedia-style titles legitimately end in ')'.
    expect(trimUrlTail('https://en.wikipedia.org/wiki/Kanpur_(city)')).toBe('https://en.wikipedia.org/wiki/Kanpur_(city)');
  });

  it('a link inside brackets does not swallow the bracket', () => {
    expect(links('(see https://a.test/x) ok')[0].href).toBe('https://a.test/x');
  });

  it('a trailing query string survives — it is part of the address', () => {
    expect(trimUrlTail('https://a.test/s?q=train+12951')).toBe('https://a.test/s?q=train+12951');
  });
});

describe('splitLinks — degenerate input never throws', () => {
  it('empty, whitespace and link-free text', () => {
    expect(splitLinks('')).toEqual([]);
    expect(links('no links here at all')).toHaveLength(0);
    expect(text('plain')).toBe('plain');
  });
});
