import { describe, it, expect } from 'vitest';
import { normalizePreviewOrigin, buildPreviewSandboxUrl, PREVIEW_HTML_MESSAGE } from './previewOrigin';

// SECURITY Phase 4 — cross-origin preview isolation (admin chose "separate preview origin"). The pure
// URL logic decides WHETHER isolation is active and WHERE the sandbox host loads. Off by default
// (unset env → null → the caller keeps the current same-origin srcDoc path unchanged).

describe('normalizePreviewOrigin', () => {
  it('returns the bare origin for a valid https/http url (path/trailing slash stripped)', () => {
    expect(normalizePreviewOrigin('https://preview.navbharatai.com')).toBe('https://preview.navbharatai.com');
    expect(normalizePreviewOrigin('https://preview.navbharatai.com/')).toBe('https://preview.navbharatai.com');
    expect(normalizePreviewOrigin('https://preview.navbharatai.com/x/y?z')).toBe('https://preview.navbharatai.com');
  });
  it('returns null for unset / blank / non-web / malformed values', () => {
    expect(normalizePreviewOrigin(undefined)).toBeNull();
    expect(normalizePreviewOrigin('')).toBeNull();
    expect(normalizePreviewOrigin('   ')).toBeNull();
    expect(normalizePreviewOrigin('javascript:alert(1)')).toBeNull();
    expect(normalizePreviewOrigin('not a url')).toBeNull();
  });
});

describe('buildPreviewSandboxUrl — the isolation decision', () => {
  const parent = 'https://navbharatai.com';

  it('OFF BY DEFAULT: unset preview origin → null (caller keeps same-origin srcDoc, zero change)', () => {
    expect(buildPreviewSandboxUrl(undefined, parent)).toBeNull();
    expect(buildPreviewSandboxUrl('', parent)).toBeNull();
  });

  it('builds the isolated host URL, pinning the platform origin via ?parent=', () => {
    const url = buildPreviewSandboxUrl('https://preview.navbharatai.com', parent);
    expect(url).toBe(`https://preview.navbharatai.com/preview-sandbox.html?parent=${encodeURIComponent(parent)}`);
  });

  it('THE ISOLATION INVARIANT: never returns a same-origin url (that would defeat the whole point)', () => {
    // A misconfig pointing the preview origin at the platform itself → null, never a false sense of safety.
    expect(buildPreviewSandboxUrl('https://navbharatai.com', 'https://navbharatai.com')).toBeNull();
  });

  it('a different subdomain IS cross-origin (distinct origin → isolated localStorage)', () => {
    expect(buildPreviewSandboxUrl('https://sandbox.navbharatai.com', 'https://navbharatai.com')).toContain('sandbox.navbharatai.com/preview-sandbox.html');
  });
});

describe('PREVIEW_HTML_MESSAGE envelope key', () => {
  it('is the stable key both the platform and the sandbox host agree on', () => {
    expect(PREVIEW_HTML_MESSAGE).toBe('__nbaiPreviewHtml');
  });
});
