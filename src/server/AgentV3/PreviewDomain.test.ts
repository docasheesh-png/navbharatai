import { describe, it, expect } from 'vitest';
import { applyPreviewDomain, previewDomain } from './PreviewDomain';

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

  it('previewDomain() defaults to mitrify.xyz and honours the env override', () => {
    const prev = process.env.E2B_PREVIEW_DOMAIN;
    delete process.env.E2B_PREVIEW_DOMAIN;
    expect(previewDomain()).toBe('mitrify.xyz');
    process.env.E2B_PREVIEW_DOMAIN = 'preview.example.com';
    expect(previewDomain()).toBe('preview.example.com');
    if (prev === undefined) delete process.env.E2B_PREVIEW_DOMAIN;
    else process.env.E2B_PREVIEW_DOMAIN = prev;
  });
});
