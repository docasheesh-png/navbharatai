import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyPreviewDomain, previewDomain, internalPreviewUrl } from './PreviewDomain';

describe('applyPreviewDomain', () => {
  it('swaps an *.e2b.app sandbox host to the custom preview domain', () => {
    expect(applyPreviewDomain('https://3000-abc123.e2b.app', 'mitrify.xyz')).toBe('https://3000-abc123.mitrify.xyz');
  });

  it('preserves a path and an explicit port after the host', () => {
    expect(applyPreviewDomain('https://5173-sb.e2b.app/app/index.html', 'mitrify.xyz')).toBe('https://5173-sb.mitrify.xyz/app/index.html');
    expect(applyPreviewDomain('https://8080-sb.e2b.app:443/x', 'mitrify.xyz')).toBe('https://8080-sb.mitrify.xyz:443/x');
  });

  it('leaves non-e2b hosts untouched (localhost / other domains)', () => {
    expect(applyPreviewDomain('http://localhost:3000', 'mitrify.xyz')).toBe('http://localhost:3000');
    expect(applyPreviewDomain('https://sandbox-5173.example.dev', 'mitrify.xyz')).toBe('https://sandbox-5173.example.dev');
  });

  it('is idempotent — a URL already on the custom domain is unchanged', () => {
    expect(applyPreviewDomain('https://3000-abc.mitrify.xyz', 'mitrify.xyz')).toBe('https://3000-abc.mitrify.xyz');
  });

  it('disables the swap when the domain is set to e2b.app, and handles empty input', () => {
    expect(applyPreviewDomain('https://3000-abc.e2b.app', 'e2b.app')).toBe('https://3000-abc.e2b.app');
    expect(applyPreviewDomain('', 'mitrify.xyz')).toBe('');
  });

  it('previewDomain() defaults to the always-resolvable e2b.app and honours the env override', () => {
    const prev = process.env.E2B_PREVIEW_DOMAIN;
    delete process.env.E2B_PREVIEW_DOMAIN;
    expect(previewDomain()).toBe('e2b.app');
    process.env.E2B_PREVIEW_DOMAIN = 'mitrify.xyz';
    expect(previewDomain()).toBe('mitrify.xyz');
    if (prev === undefined) delete process.env.E2B_PREVIEW_DOMAIN;
    else process.env.E2B_PREVIEW_DOMAIN = prev;
  });
});

describe('internalPreviewUrl — WE verify against the sandbox, the USER gets the brand', () => {
  /**
   * Found auditing the branded-preview change BEFORE it was switched on (2026-08-19).
   *
   * Every preview URL is branded at the point it is produced, and that same URL is handed to
   * browseUrl() for the platform's own checks — preview verify, journey check, runtime-error
   * capture, design gate. Live, each of those would have travelled from inside the sandbox out to
   * Cloudflare and back to the sandbox it started in. The serious part is not the detour: a Worker
   * that is misconfigured or mid-deploy would have failed every VERIFICATION, so working builds
   * would be reported as unverified. A cosmetic feature must never be able to break the pipeline.
   */
  const D = 'mitrify.xyz';

  it('turns a branded preview URL back into the direct sandbox host', () => {
    expect(internalPreviewUrl('https://5173-abc123xyz.mitrify.xyz', D)).toBe('https://5173-abc123xyz.e2b.app');
    expect(internalPreviewUrl('https://3000-sandbox01/', D)).toBe('https://3000-sandbox01/');
  });

  it('keeps the path, query and hash exactly as they were', () => {
    expect(internalPreviewUrl('https://5173-abc123xyz.mitrify.xyz/app?x=1#top', D))
      .toBe('https://5173-abc123xyz.e2b.app/app?x=1#top');
  });

  it('round-trips with applyPreviewDomain — the two are a pair', () => {
    const raw = 'https://5173-abc123xyz.e2b.app/dashboard';
    expect(internalPreviewUrl(applyPreviewDomain(raw, D), D)).toBe(raw);
  });

  it('is idempotent and leaves a non-preview URL alone', () => {
    expect(internalPreviewUrl('https://5173-abc123xyz.e2b.app', D)).toBe('https://5173-abc123xyz.e2b.app');
    expect(internalPreviewUrl('http://localhost:5173/', D)).toBe('http://localhost:5173/');
    expect(internalPreviewUrl('https://navbharatai.com/app', D)).toBe('https://navbharatai.com/app');
    expect(internalPreviewUrl('', D)).toBe('');
  });

  it('rewrites ONLY the port-sandbox shape, never an arbitrary host on our domain', () => {
    // A bare or nested host on the preview domain is not a sandbox, and must not be redirected to
    // one — the same reasoning that keeps the Worker from being an open proxy, applied inbound.
    expect(internalPreviewUrl('https://www.mitrify.xyz/page', D)).toBe('https://www.mitrify.xyz/page');
    expect(internalPreviewUrl('https://5173-abc.evil.mitrify.xyz', D)).toBe('https://5173-abc.evil.mitrify.xyz');
  });

  it('is a no-op while the branded domain is off, so today\'s behaviour is untouched', () => {
    expect(internalPreviewUrl('https://5173-abc123xyz.mitrify.xyz', 'e2b.app')).toBe('https://5173-abc123xyz.mitrify.xyz');
  });
});

describe('the verification path never browses the branded host', () => {
  const route = readFileSync(join(process.cwd(), 'src/server/routes/agentv3.ts'), 'utf8');

  it('every browseUrl call goes through internalPreviewUrl', () => {
    // A missed call site fails only when the Worker is unhealthy — the rarest and worst time to
    // discover it — so the source is the assertion.
    const calls = route.match(/actuator\.browseUrl\(workspaceId,\s*([^),]+)\)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(5);
    for (const c of calls) expect(c, c).toContain('internalPreviewUrl(');
  });
});
