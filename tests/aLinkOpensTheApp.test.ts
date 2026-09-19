import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  routeForPath,
  deepLinkTarget,
  APP_LINK_CLAIMS,
  APP_LINK_HOSTS,
} from '../src/lib/deepLinkRoute';
import {
  assetLinksJson,
  assetLinkFingerprints,
  malformedFingerprints,
  ANDROID_PACKAGE_NAME,
  ASSET_LINKS_PATH,
} from '../src/server/lib/assetLinks';

/**
 * 🔗 A navbharatai.com LINK OPENS THE APP (admin 2026-09-19: "mujhe sabse acchi native app banani hai").
 *
 * Tapping one opened a BROWSER — the loudest remaining "this is a website" moment, and a growth leak
 * besides (share links, referral codes, published apps).
 *
 * An App Link has two halves that fail in OPPOSITE directions, which is the whole reason this file is
 * one test and not three:
 *   • claim a URL we cannot serve ⇒ the app opens, dumps the user on Home, and has EATEN the page they
 *     asked for — strictly worse than never claiming it;
 *   • serve a URL we do not claim ⇒ code nobody reaches.
 * So the manifest's claimed paths and `deepLinkRoute`'s destinations are asserted against each other.
 * A path added to one and not the other fails CI.
 */

const root = process.cwd();
const manifest = readFileSync(join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8');

/** The `<intent-filter android:autoVerify="true">` block, and only that one. */
function autoVerifyFilter(): string {
  const m = manifest.match(/<intent-filter\s+android:autoVerify="true">([\s\S]*?)<\/intent-filter>/);
  return m ? m[1] : '';
}

describe('the manifest claims exactly what the app can serve', () => {
  it('there is an autoVerify intent filter at all', () => {
    expect(autoVerifyFilter(), 'without autoVerify Android never checks assetlinks.json').not.toBe('');
  });

  it('every claimed path is one deepLinkRoute resolves — no URL is eaten', () => {
    const filter = autoVerifyFilter();
    const claimed = [...filter.matchAll(/android:(path|pathPrefix)="([^"]+)"/g)].map((m) => ({
      kind: m[1] as 'path' | 'pathPrefix',
      value: m[2],
    }));
    expect(claimed.length, 'a filter with hosts but no paths claims the whole domain').toBeGreaterThan(0);

    for (const claim of claimed) {
      // A prefix claim is probed with a realistic child, since the prefix itself need not resolve.
      const probe = claim.kind === 'pathPrefix' ? `${claim.value}abc123` : claim.value;
      expect(
        routeForPath(probe, ''),
        `the manifest claims ${claim.kind}="${claim.value}" but routeForPath("${probe}") has nowhere to send it`,
      ).not.toBeNull();
    }
  });

  it('the manifest and APP_LINK_CLAIMS are the same list, in both directions', () => {
    const claimed = [...autoVerifyFilter().matchAll(/android:(path|pathPrefix)="([^"]+)"/g)]
      .map((m) => `${m[1]}:${m[2]}`)
      .sort();
    const declared = APP_LINK_CLAIMS.map((c) => `${c.kind}:${c.value}`).sort();
    expect(claimed).toEqual(declared);
  });

  it('claims every host the module names, and only https', () => {
    const hosts = [...autoVerifyFilter().matchAll(/android:host="([^"]+)"/g)].map((m) => m[1]).sort();
    expect(hosts).toEqual([...APP_LINK_HOSTS].sort());
    expect(autoVerifyFilter()).not.toMatch(/android:scheme="http"/);
  });

  it('does NOT claim the whole domain', () => {
    // `pathPrefix="/"` matches every URL on the host, including /privacy and /terms — pages Play and
    // Meta fetch, and pages a person who taps them asked to READ, not to have swallowed by an app.
    expect(autoVerifyFilter()).not.toMatch(/android:pathPrefix="\/"/);
    expect(routeForPath('/privacy', ''), '/privacy must stay with the browser').toBeNull();
    expect(routeForPath('/terms', ''), '/terms must stay with the browser').toBeNull();
  });
});

describe('deepLinkTarget — where a link goes', () => {
  it('sends the known destinations to the right view', () => {
    expect(deepLinkTarget('https://navbharatai.com/')?.view).toBe('home');
    expect(deepLinkTarget('https://navbharatai.com/admin')?.view).toBe('admin');
    expect(deepLinkTarget('https://www.navbharatai.com/store')?.view).toBe('appstore');
    expect(deepLinkTarget('https://navbharatai.com/store/app/abc123')?.view).toBe('appstore');
    expect(deepLinkTarget('https://navbharatai.com/?view=appstore')?.view).toBe('appstore');
  });

  it('keeps the path and query, because the share link IS the id', () => {
    const t = deepLinkTarget('https://navbharatai.com/store/app/abc123?ref=wa');
    // NavAppStore reads the id out of the pathname itself — losing it would open Browse instead of
    // the app somebody was sent, which is the failure this feature exists to prevent.
    expect(t?.path).toBe('/store/app/abc123');
    expect(t?.search).toBe('?ref=wa');
  });

  it('tolerates a trailing slash, the way a pasted link carries one', () => {
    expect(deepLinkTarget('https://navbharatai.com/store/')?.view).toBe('appstore');
    expect(deepLinkTarget('https://navbharatai.com/admin/')?.view).toBe('admin');
  });

  it('🔒 refuses a link that is not ours — a host check, not a path check', () => {
    // A deep link arrives from outside and names its own origin. Honouring the PATH alone would let
    // any website open any screen of the app.
    expect(deepLinkTarget('https://evil.example/admin')).toBeNull();
    expect(deepLinkTarget('https://navbharatai.com.evil.example/admin')).toBeNull();
    expect(deepLinkTarget('http://navbharatai.com/admin'), 'plain http is not claimed').toBeNull();
    expect(deepLinkTarget('com.navbharat.ai://github-callback#gh_token=x')).toBeNull();
    expect(deepLinkTarget('not a url')).toBeNull();
    expect(deepLinkTarget(undefined)).toBeNull();
  });

  it('preserves the ORDER App.tsx used, so no existing URL is re-decided', () => {
    // App.tsx checked admin before store, and honoured ?view=appstore on ANY path. Both kept.
    expect(routeForPath('/admin', '?view=appstore')?.view).toBe('admin');
    expect(routeForPath('/anything', '?view=appstore')?.view).toBe('appstore');
    expect(routeForPath('/anything', '')).toBeNull();
  });
});

describe('assetlinks.json — the file that turns the claim on', () => {
  const FP = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';
  const FP2 = '11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00';

  it('serves nothing when unset — today\'s behaviour exactly', () => {
    expect(assetLinksJson({} as NodeJS.ProcessEnv)).toBeNull();
    expect(assetLinksJson({ ANDROID_CERT_SHA256: '' } as NodeJS.ProcessEnv)).toBeNull();
    expect(assetLinksJson({ ANDROID_CERT_SHA256: '   ' } as NodeJS.ProcessEnv)).toBeNull();
  });

  it('emits the statement Android looks for', () => {
    const body = assetLinksJson({ ANDROID_CERT_SHA256: FP } as NodeJS.ProcessEnv);
    const parsed = JSON.parse(String(body));
    expect(parsed[0].relation).toEqual(['delegate_permission/common.handle_all_urls']);
    expect(parsed[0].target.namespace).toBe('android_app');
    expect(parsed[0].target.package_name).toBe(ANDROID_PACKAGE_NAME);
    expect(parsed[0].target.sha256_cert_fingerprints).toEqual([FP]);
  });

  it('takes BOTH certificates, which is the normal case under Play App Signing', () => {
    // The upload key and Google's app-signing key are different certificates; which one reaches a
    // phone depends on how the app was installed. Listing one makes the other fail silently.
    const body = assetLinksJson({ ANDROID_CERT_SHA256: `${FP}, ${FP2}` } as NodeJS.ProcessEnv);
    expect(JSON.parse(String(body))[0].target.sha256_cert_fingerprints).toEqual([FP, FP2]);
  });

  it('normalises lower case and drops a duplicate', () => {
    const env = { ANDROID_CERT_SHA256: `${FP.toLowerCase()},${FP}` } as NodeJS.ProcessEnv;
    expect(assetLinkFingerprints(env)).toEqual([FP]);
  });

  it('🔒 DROPS a malformed entry instead of passing it through', () => {
    // Android rejects the WHOLE file if any entry is malformed, so a typo would silently disable link
    // handling for the good fingerprint beside it — this repo has been bitten twice by exactly that
    // shape (a trailing space in BRAVE_API_KEY, an `=` in ALERT_EMAIL_FROM).
    const env = { ANDROID_CERT_SHA256: `${FP},not-a-fingerprint,AA:BB` } as NodeJS.ProcessEnv;
    expect(assetLinkFingerprints(env)).toEqual([FP]);
    expect(malformedFingerprints(env)).toEqual(['not-a-fingerprint', 'AA:BB']);
    // …and a value made only of rubbish serves nothing rather than an empty statement list.
    expect(assetLinksJson({ ANDROID_CERT_SHA256: 'nonsense' } as NodeJS.ProcessEnv)).toBeNull();
  });

  it('the package name is the app id Capacitor ships, not the code namespace', () => {
    const capConfig = readFileSync(join(root, 'capacitor.config.ts'), 'utf8');
    expect(capConfig).toContain(`appId: '${ANDROID_PACKAGE_NAME}'`);
    // The Android `namespace` is a DIFFERENT string and putting it here verifies nothing.
    expect(ANDROID_PACKAGE_NAME).not.toBe('com.navbharatai.app');
  });
});

describe('the route is wired where a .well-known path can actually be reached', () => {
  const server = readFileSync(join(root, 'server.ts'), 'utf8');

  it('server.ts serves ASSET_LINKS_PATH', () => {
    expect(ASSET_LINKS_PATH).toBe('/.well-known/assetlinks.json');
    expect(server).toContain('app.get(ASSET_LINKS_PATH');
  });

  it('it is mounted BEFORE the static handler, like the Apple route beside it', () => {
    // express.static's `dotfiles` default is 'ignore', so a .well-known path never reaches it. The
    // Apple domain-association route records this; placing ours after static would 404 for ever.
    const ours = server.indexOf('app.get(ASSET_LINKS_PATH');
    const staticAt = server.search(/express\.static\(/);
    expect(ours).toBeGreaterThan(-1);
    if (staticAt > -1) expect(ours).toBeLessThan(staticAt);
  });

  it('answers 404 when unconfigured, never an empty 200', () => {
    const block = server.slice(server.indexOf('app.get(ASSET_LINKS_PATH'), server.indexOf('app.get(ASSET_LINKS_PATH') + 1400);
    expect(block).toContain('res.status(404)');
    expect(block).toContain("res.type('application/json')");
  });
});

describe('the native shell actually navigates on an App Link', () => {
  const app = readFileSync(join(root, 'src/App.tsx'), 'utf8');

  it('appUrlOpen consults deepLinkTarget', () => {
    expect(app).toContain('handleAppLinkOpen(data?.url)');
    expect(app).toContain('const target = deepLinkTarget(url);');
  });

  it('writes the path onto the local origin BEFORE switching view', () => {
    // The order is the feature: /store/app/<id> is read out of window.location by NavAppStore, so a
    // view switch without the path lands on Browse and the shared app is lost.
    const at = app.indexOf('const handleAppLinkOpen');
    const block = app.slice(at, at + 900);
    expect(block.indexOf('history.replaceState')).toBeLessThan(block.indexOf('setActiveView(target.view)'));
  });

  it('App.tsx no longer keeps its own private copy of the path rule', () => {
    // Two readers of one question is how autopsy 1a7f4a58 happened; a third for deep links would have
    // made it three.
    expect(app).toContain('routeForPath(window.location.pathname, window.location.search)');
    expect(app).not.toMatch(/=== '\/admin'; \} catch \{ return false; \}/);
  });
});
