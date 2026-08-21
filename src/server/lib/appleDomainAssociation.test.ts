// Tests for Apple's domain-verification file (admin 2026-08-21).
//
// The failure that led here: Sign in with Apple reached Apple's consent screen with the correct
// client_id and redirect_uri, and Apple's OWN authorize endpoint answered 403 twice — the signature of
// a Service ID whose domain is registered but not VERIFIED. Apple verifies by fetching this file; we
// never served the path at all.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  appleDomainAssociation,
  APPLE_DOMAIN_ASSOCIATION_PATH,
  APPLE_DOMAIN_ASSOCIATION_FILE,
} from './appleDomainAssociation';

const throwing = () => { throw new Error('ENOENT'); };

describe('appleDomainAssociation', () => {
  it('serves the env value first — the admin can verify without waiting for a code change', () => {
    expect(appleDomainAssociation({ APPLE_DOMAIN_ASSOCIATION: '  token-from-apple  ' } as never, throwing))
      .toBe('token-from-apple');
  });

  it('falls back to the committed file, read from the documented path', () => {
    let asked = '';
    const read = (f: string) => { asked = f; return 'token-from-file'; };
    expect(appleDomainAssociation({} as never, read)).toBe('token-from-file');
    expect(asked).toBe(APPLE_DOMAIN_ASSOCIATION_FILE);
  });

  it('env WINS over the file, so a correction does not need a deploy', () => {
    expect(appleDomainAssociation({ APPLE_DOMAIN_ASSOCIATION: 'from-env' } as never, () => 'from-file'))
      .toBe('from-env');
  });

  it('returns null when neither source has it — the route then 404s HONESTLY', () => {
    // An empty 200 would be worse than a 404: Apple reads it as a file whose contents do not match,
    // and the admin ends up debugging a mismatch instead of a missing file.
    expect(appleDomainAssociation({} as never, throwing)).toBeNull();
    expect(appleDomainAssociation({ APPLE_DOMAIN_ASSOCIATION: '   ' } as never, throwing)).toBeNull();
    expect(appleDomainAssociation({} as never, () => '   ')).toBeNull();
  });

  it('never throws when the file is absent — that is the ordinary case, not an error', () => {
    expect(() => appleDomainAssociation({} as never, throwing)).not.toThrow();
  });

  it('serves the EXACT path Apple fetches — a typo here is a silent verification failure', () => {
    expect(APPLE_DOMAIN_ASSOCIATION_PATH).toBe('/.well-known/apple-developer-domain-association.txt');
  });
});

describe('the route is wired into the server, before the static handler', () => {
  it('server.ts mounts the path and reads it through this module', () => {
    // express.static ignores dotfiles by default, so a `.well-known` directory would be skipped —
    // the route MUST be explicit, and it must come before the static middleware.
    const src = readFileSync(join(process.cwd(), 'server.ts'), 'utf8');
    expect(src).toContain('APPLE_DOMAIN_ASSOCIATION_PATH');
    expect(src).toContain('appleDomainAssociation(process.env');
    expect(src.indexOf('APPLE_DOMAIN_ASSOCIATION_PATH')).toBeLessThan(src.indexOf('express.static(distPath'));
  });
});
