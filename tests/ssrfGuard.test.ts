import { describe, it, expect } from 'vitest';
import {
  isBlockedIpv4, isBlockedIpv6, isBlockedIp, isBlockedHostname, assertPublicHttpUrl,
} from '../src/server/lib/ssrfGuard';

/**
 * SSRF guard for the API Tester proxy (admin autopsy 2026-07-21). A server-side fetch of a
 * user-supplied URL is a classic SSRF hole; these tests lock that private / loopback / link-local /
 * cloud-metadata targets are refused and only public HTTP(S) URLs pass.
 */

describe('isBlockedIpv4', () => {
  it('blocks loopback, private, CGNAT, link-local (incl. cloud metadata), multicast/reserved', () => {
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.9.9', '172.31.255.255', '192.168.1.1',
      '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '240.0.0.1', '255.255.255.255']) {
      expect(isBlockedIpv4(ip)).toBe(true);
    }
  });
  it('allows genuine public IPv4', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1']) {
      expect(isBlockedIpv4(ip)).toBe(false);
    }
  });
  it('treats malformed IPv4 as blocked', () => {
    expect(isBlockedIpv4('999.1.1.1')).toBe(true);
    expect(isBlockedIpv4('not-an-ip')).toBe(true);
  });
});

describe('isBlockedIpv6', () => {
  it('blocks loopback, unspecified, ULA, link-local, and IPv4-mapped private', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1']) {
      expect(isBlockedIpv6(ip)).toBe(true);
    }
  });
  it('allows public IPv6 and IPv4-mapped public', () => {
    expect(isBlockedIpv6('2606:4700:4700::1111')).toBe(false);
    expect(isBlockedIpv6('::ffff:8.8.8.8')).toBe(false);
  });
});

describe('isBlockedIp / isBlockedHostname', () => {
  it('routes v4/v6 correctly and blocks non-IPs', () => {
    expect(isBlockedIp('8.8.8.8')).toBe(false);
    expect(isBlockedIp('127.0.0.1')).toBe(true);
    expect(isBlockedIp('2606:4700:4700::1111')).toBe(false);
    expect(isBlockedIp('garbage')).toBe(true);
  });
  it('blocks localhost + internal suffixes + metadata host', () => {
    for (const h of ['localhost', 'app.localhost', 'db.internal', 'printer.local', 'metadata.google.internal']) {
      expect(isBlockedHostname(h)).toBe(true);
    }
    expect(isBlockedHostname('example.com')).toBe(false);
  });
});

describe('assertPublicHttpUrl', () => {
  it('rejects non-http(s) schemes', async () => {
    expect((await assertPublicHttpUrl('ftp://example.com')).ok).toBe(false);
    expect((await assertPublicHttpUrl('file:///etc/passwd')).ok).toBe(false);
    expect((await assertPublicHttpUrl('not a url')).ok).toBe(false);
  });
  it('rejects loopback / private / metadata IP literals', async () => {
    expect((await assertPublicHttpUrl('http://127.0.0.1/admin')).ok).toBe(false);
    expect((await assertPublicHttpUrl('http://169.254.169.254/latest/meta-data/')).ok).toBe(false);
    expect((await assertPublicHttpUrl('http://192.168.0.1/')).ok).toBe(false);
    expect((await assertPublicHttpUrl('http://[::1]/')).ok).toBe(false);
  });
  it('rejects localhost hostname', async () => {
    expect((await assertPublicHttpUrl('http://localhost:3000/api/health')).ok).toBe(false);
  });
  it('allows a public IP literal', async () => {
    expect((await assertPublicHttpUrl('https://8.8.8.8/')).ok).toBe(true);
  });
});
