import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_ORIGINS, previewHostname } from './previewHost';

afterEach(() => { vi.unstubAllEnvs(); });

describe('previewHostname', () => {
  it('is null when both origins are unset or blank', () => {
    vi.stubEnv('PREVIEW_ORIGIN', '');
    vi.stubEnv('VITE_PREVIEW_ORIGIN', '');
    expect(previewHostname()).toBeNull();
    vi.stubEnv('PREVIEW_ORIGIN', '   ');
    vi.stubEnv('VITE_PREVIEW_ORIGIN', '\t');
    expect(previewHostname()).toBeNull();
  });

  it('parses the hostname and strips protocol, port, and path', () => {
    vi.stubEnv('PREVIEW_ORIGIN', 'https://preview.navbharatai.com:8443/sandbox/index.html?x=1');
    vi.stubEnv('VITE_PREVIEW_ORIGIN', '');
    expect(previewHostname()).toBe('preview.navbharatai.com');
    vi.stubEnv('PREVIEW_ORIGIN', 'http://localhost:5173');
    expect(previewHostname()).toBe('localhost');
    vi.stubEnv('PREVIEW_ORIGIN', 'HTTPS://Preview.NavBharatAI.com/x');
    expect(previewHostname()).toBe('preview.navbharatai.com');
  });

  it('uses VITE_PREVIEW_ORIGIN only when PREVIEW_ORIGIN is unset', () => {
    vi.stubEnv('PREVIEW_ORIGIN', '');
    vi.stubEnv('VITE_PREVIEW_ORIGIN', 'https://preview.example.com/app');
    expect(previewHostname()).toBe('preview.example.com');
    vi.stubEnv('PREVIEW_ORIGIN', 'https://preview.navbharatai.com');
    vi.stubEnv('VITE_PREVIEW_ORIGIN', 'https://other.example.com');
    expect(previewHostname()).toBe('preview.navbharatai.com');
  });

  it('an invalid non-empty PREVIEW_ORIGIN is null and does not fall through', () => {
    vi.stubEnv('PREVIEW_ORIGIN', 'not a url');
    vi.stubEnv('VITE_PREVIEW_ORIGIN', 'https://preview.navbharatai.com');
    expect(previewHostname()).toBeNull();
    vi.stubEnv('PREVIEW_ORIGIN', 'javascript:alert(1)');
    expect(previewHostname()).toBeNull();
    vi.stubEnv('PREVIEW_ORIGIN', 'ftp://files.example.com/x');
    expect(previewHostname()).toBeNull();
  });
});

describe('APP_ORIGINS', () => {
  it('is the parent allow-list, including the Capacitor WebView origin', () => {
    expect(APP_ORIGINS).toEqual([
      'https://navbharatai.com',
      'https://www.navbharatai.com',
      'https://localhost',
      'http://localhost:3000',
      'http://localhost:5173',
      'capacitor://localhost',
    ]);
  });
});
