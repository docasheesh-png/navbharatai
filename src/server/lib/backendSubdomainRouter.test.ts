import { describe, it, expect, beforeEach } from 'vitest';
import {
  appsDomain, subdomainFromHost, forwardableRequestHeaders, overRequestCap,
  _clearRequestWindowsForTests,
} from './backendSubdomainRouter';

describe('appsDomain', () => {
  it('is empty (feature off) by default and normalises the env value', () => {
    expect(appsDomain({} as NodeJS.ProcessEnv)).toBe('');
    expect(appsDomain({ MANAGED_BACKEND_APPS_DOMAIN: ' Apps.NavBharatAI.com. ' } as NodeJS.ProcessEnv)).toBe('apps.navbharatai.com');
  });
});

describe('subdomainFromHost', () => {
  const D = 'apps.navbharatai.com';

  it('extracts exactly one legal label under the apps domain', () => {
    expect(subdomainFromHost('todo-3f9a21c7.apps.navbharatai.com', D)).toBe('todo-3f9a21c7');
    expect(subdomainFromHost('TODO-3F9A21C7.APPS.NAVBHARATAI.COM:443', D)).toBe('todo-3f9a21c7');
  });

  it('rejects everything that is not ours', () => {
    expect(subdomainFromHost(undefined, D)).toBeNull();
    expect(subdomainFromHost('apps.navbharatai.com', D)).toBeNull();        // bare domain
    expect(subdomainFromHost('a.b.apps.navbharatai.com', D)).toBeNull();    // two labels deep
    expect(subdomainFromHost('x.navbharatai.com', D)).toBeNull();           // wrong parent
    expect(subdomainFromHost('evilapps.navbharatai.com', D)).toBeNull();    // suffix but not a subdomain
    expect(subdomainFromHost('-bad.apps.navbharatai.com', D)).toBeNull();   // illegal label
    expect(subdomainFromHost('x.apps.navbharatai.com', '')).toBeNull();     // feature off
  });
});

describe('forwardableRequestHeaders', () => {
  it('drops hop-by-hop headers and forces identity encoding upstream', () => {
    const out = forwardableRequestHeaders({
      host: 'a.apps.x.com',
      connection: 'keep-alive',
      'transfer-encoding': 'chunked',
      'content-length': '10',
      'accept-encoding': 'gzip, br',
      'content-type': 'application/json',
      cookie: 'session=1',
      'x-multi': ['a', 'b'],
    });
    expect(out.host).toBeUndefined();
    expect(out.connection).toBeUndefined();
    expect(out['transfer-encoding']).toBeUndefined();
    expect(out['content-length']).toBeUndefined();
    expect(out['accept-encoding']).toBe('identity');
    expect(out['content-type']).toBe('application/json');
    expect(out.cookie).toBe('session=1');
    expect(out['x-multi']).toBe('a, b');
  });
});

describe('overRequestCap', () => {
  beforeEach(() => _clearRequestWindowsForTests());

  it('allows up to the cap within a minute, rejects beyond it, and resets on a new window', () => {
    const t0 = 1_000_000;
    expect(overRequestCap('svc', 3, t0)).toBe(false);
    expect(overRequestCap('svc', 3, t0 + 1)).toBe(false);
    expect(overRequestCap('svc', 3, t0 + 2)).toBe(false);
    expect(overRequestCap('svc', 3, t0 + 3)).toBe(true);   // 4th request in the window
    expect(overRequestCap('svc', 3, t0 + 60_000)).toBe(false); // window rolled
  });

  it('tracks apps independently', () => {
    const t0 = 5_000_000;
    expect(overRequestCap('a', 1, t0)).toBe(false);
    expect(overRequestCap('a', 1, t0 + 1)).toBe(true);
    expect(overRequestCap('b', 1, t0 + 2)).toBe(false);
  });
});
