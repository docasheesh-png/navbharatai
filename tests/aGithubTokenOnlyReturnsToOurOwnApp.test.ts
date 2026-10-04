// Forensic audit 2026-10-04 (P0) — the GitHub OAuth callback hands the token only to a page of OUR app.
//
// The callback redirects to `<state>#gh_token=<token>`, and `safeReturnUrl` checked only the ORIGIN of
// `state`. navbharatai.com also serves other people's code — `/pwa/<id>` (any account's hosted HTML),
// `/preview/<id>`, static files — and any of those pages can read its own fragment. One click on a crafted
// authorize link with `state=https://navbharatai.com/pwa/<attacker>` sent a victim's repo-scoped token there.

import { describe, it, expect } from 'vitest';
import { safeReturnUrl } from '../src/server/routes/githubAuth';

describe('our app\'s own pages are accepted, exactly as the client sends them', () => {
  for (const u of [
    'https://navbharatai.com/',
    'https://navbharatai.com/?view=git',
    'https://www.navbharatai.com/settings',
    'https://navbharatai.com/store/apps',
  ]) {
    it(u, () => { expect(safeReturnUrl(u)).toBe(u); });
  }

  it('a fragment in the state is dropped, never carried', () => {
    expect(safeReturnUrl('https://navbharatai.com/#x=1')).toBe('https://navbharatai.com/');
  });
});

describe('a page that serves someone else\'s code never receives the token', () => {
  for (const u of [
    'https://navbharatai.com/pwa/a1b2c3d4e5f60718',
    'https://navbharatai.com/PWA/a1b2c3d4e5f60718',
    'https://navbharatai.com/%70wa/a1b2c3d4e5f60718',
    'https://navbharatai.com/preview/abc',
    'https://navbharatai.com/preview-app/abc/x',
    'https://navbharatai.com/api/agentv3/preview-door',
    'https://navbharatai.com/preview-sandbox.html',
    'https://navbharatai.com/guide',
    'https://evil.example/',
    'javascript:alert(1)',
    '',
  ]) {
    it(u || '(empty)', () => { expect(safeReturnUrl(u)).toBeNull(); });
  }
});
