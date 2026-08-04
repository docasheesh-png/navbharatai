// Tests for where the sandbox browser may go (admin 2026-08-04: "koi real world website open kare…").
//
// Two things are being locked, and the second is the one that would have been easy to get wrong:
//   1. Real public websites open — the new capability actually works, including the bare "zomato.com"
//      form a person types.
//   2. The long-standing use — screenshotting the user's OWN dev server on localhost — still works.
//      A blanket "block private addresses" guard would have been the obvious implementation and would
//      have silently broken every preview screenshot in the product.

import { describe, it, expect } from 'vitest';
import { classifyBrowseTarget, isBrowsableUrl, isInfrastructureIpv4 } from './browseTarget';

describe('real public websites open — the new capability', () => {
  it.each([
    'https://example.com',
    'https://www.zomato.com/mumbai',
    'http://example.org/path?q=1#frag',
    'https://sub.domain.co.in:8443/page',
  ])('%s', (url) => {
    const t = classifyBrowseTarget(url);
    expect(t.kind).toBe('public');
    expect(t.url).toBeTruthy();
  });

  it('a bare domain, as a person actually types it, is treated as https', () => {
    const t = classifyBrowseTarget('zomato.com');
    expect(t.kind).toBe('public');
    expect(t.url).toBe('https://zomato.com/');
  });

  it('surrounding whitespace does not change the answer', () => {
    expect(classifyBrowseTarget('  https://example.com  ').kind).toBe('public');
  });
});

describe('the sandbox\'s OWN preview still works — the regression that mattered', () => {
  it.each([
    'http://localhost:5173',
    'http://127.0.0.1:3000/dashboard',
    'http://localhost',
    'http://[::1]:8080',
  ])('%s is classified as the sandbox, not blocked', (url) => {
    const t = classifyBrowseTarget(url);
    expect(t.kind).toBe('sandbox');
    expect(isBrowsableUrl(url)).toBe(true);
  });
});

describe('infrastructure addresses are refused', () => {
  it('THE ONE THAT MATTERS MOST: cloud metadata hands out credentials to anything inside the machine', () => {
    for (const url of [
      'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
      'http://metadata.google.internal/computeMetadata/v1/',
      'http://metadata/computeMetadata/v1/',
    ]) {
      expect(classifyBrowseTarget(url).kind, url).toBe('blocked');
    }
  });

  it.each([
    ['private 10/8', 'http://10.0.0.5/admin'],
    ['private 172.16/12', 'http://172.20.1.1'],
    ['private 192.168/16', 'http://192.168.1.1'],
    ['carrier-grade NAT', 'http://100.64.0.1'],
    ['IPv6 link-local', 'http://[fe80::1]/'],
    ['IPv6 unique-local', 'http://[fd00::1]/'],
    ['a bare hostname that can only be on the LAN', 'http://router'],
    ['an internal service name', 'http://redis:6379'],
  ])('%s is refused', (_name, url) => {
    expect(classifyBrowseTarget(url).kind).toBe('blocked');
  });

  it('non-web schemes are refused rather than guessed at', () => {
    for (const url of ['file:///etc/passwd', 'data:text/html,<h1>x', 'javascript:alert(1)', 'ftp://x.com']) {
      expect(classifyBrowseTarget(url).kind, url).toBe('blocked');
    }
  });

  it('junk and empty input never throw and never pass', () => {
    for (const bad of ['', '   ', 'http://', 'not a url at all !!', null, undefined, 42, {}]) {
      expect(() => classifyBrowseTarget(bad as never)).not.toThrow();
      expect(classifyBrowseTarget(bad as never).kind).toBe('blocked');
    }
  });

  it('a refusal tells the MODEL what to do instead', () => {
    const t = classifyBrowseTarget('http://169.254.169.254');
    expect(t.reason).toMatch(/real public site/i);
  });
});

describe('the IPv4 range rule itself', () => {
  it('classifies infrastructure ranges', () => {
    expect(isInfrastructureIpv4([169, 254, 169, 254])).toBe(true);
    expect(isInfrastructureIpv4([10, 1, 2, 3])).toBe(true);
    expect(isInfrastructureIpv4([172, 16, 0, 1])).toBe(true);
    expect(isInfrastructureIpv4([172, 32, 0, 1])).toBe(false); // just OUTSIDE the private block
    expect(isInfrastructureIpv4([192, 168, 0, 1])).toBe(true);
  });

  it('leaves genuine public addresses alone', () => {
    expect(isInfrastructureIpv4([8, 8, 8, 8])).toBe(false);
    expect(isInfrastructureIpv4([1, 1, 1, 1])).toBe(false);
    expect(isInfrastructureIpv4([172, 15, 0, 1])).toBe(false);
  });

  // Loopback is NOT listed as infrastructure here: classifyBrowseTarget answers 'sandbox' for it first,
  // which is exactly what keeps preview screenshots working.
  it('does not itself claim loopback — the caller classifies that as the sandbox', () => {
    expect(isInfrastructureIpv4([127, 0, 0, 1])).toBe(false);
  });
});
