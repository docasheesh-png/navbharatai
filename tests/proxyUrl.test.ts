import { describe, it, expect } from 'vitest';
import { buildProxyUrl } from '../src/server/runtime/proxyUrl';

describe('buildProxyUrl', () => {
  it('maps rest path onto the origin', () => {
    expect(buildProxyUrl('http://localhost:3005', 'assets/app.js', '/preview-app/s1/assets/app.js'))
      .toBe('http://localhost:3005/assets/app.js');
  });

  it('preserves the query string', () => {
    expect(buildProxyUrl('http://localhost:3005', 'api/data', '/preview-app/s1/api/data?x=1&y=2'))
      .toBe('http://localhost:3005/api/data?x=1&y=2');
  });

  it('handles root path and trailing/leading slashes', () => {
    expect(buildProxyUrl('http://localhost:3005/', '', '/preview-app/s1/')).toBe('http://localhost:3005/');
    expect(buildProxyUrl('http://localhost:3005', '/index.html', '/preview-app/s1/index.html'))
      .toBe('http://localhost:3005/index.html');
  });
});
