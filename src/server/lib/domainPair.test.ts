import { describe, it, expect } from 'vitest';
import { canonicalHost, alternateHost, domainPair, isAlternateOf } from './domainPair';

describe('www ↔ apex — the two spellings of one website', () => {
  it('🔒 the canonical is always the apex, whichever one the user typed', () => {
    expect(domainPair('mitrify.com')).toEqual({ canonical: 'mitrify.com', alternate: 'www.mitrify.com' });
    expect(domainPair('www.mitrify.com')).toEqual({ canonical: 'mitrify.com', alternate: 'www.mitrify.com' });
    expect(domainPair('WWW.Mitrify.COM.')).toEqual({ canonical: 'mitrify.com', alternate: 'www.mitrify.com' });
  });

  it('🔒 only a two-label host gets a www twin — a subdomain does not', () => {
    // Nobody types www.blog.x.com, and an alternate the user never sets up would sit "pending"
    // forever under a domain that is otherwise done.
    expect(domainPair('blog.mitrify.com')).toEqual({ canonical: 'blog.mitrify.com', alternate: null });
    expect(alternateHost('app.shop.co.in')).toBeNull();
  });

  it('states its one honest limit: a three-label apex gets no twin either', () => {
    // Without a public-suffix list `shop.co.in` is indistinguishable from `blog.x.com`. Offering
    // less beats guessing wrong; the header says so.
    expect(domainPair('shop.co.in').alternate).toBeNull();
  });

  it('never manufactures a www.www', () => {
    expect(alternateHost('www.x.com')).toBe('www.x.com'.slice(4) === 'x.com' ? 'www.x.com' : null);
    expect(canonicalHost('www.www.x.com')).toBe('www.x.com');
    expect(alternateHost('www.www.x.com')).toBeNull();
  });

  it('isAlternateOf recognises the twin and nothing else', () => {
    expect(isAlternateOf('www.mitrify.com', 'mitrify.com')).toBe(true);
    expect(isAlternateOf('mitrify.com', 'mitrify.com')).toBe(false);
    expect(isAlternateOf('www.other.com', 'mitrify.com')).toBe(false);
    expect(isAlternateOf('www.blog.x.com', 'blog.x.com')).toBe(false);
  });

  it('tolerates garbage without throwing', () => {
    expect(canonicalHost('')).toBe('');
    expect(alternateHost('')).toBeNull();
    expect(domainPair(undefined as unknown as string)).toEqual({ canonical: '', alternate: null });
  });
});
