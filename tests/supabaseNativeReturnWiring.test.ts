import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * REGRESSION LOCK for the 2026-09-14 fix (admin report, screenshotted from the iOS app: tapping
 * "Connect Supabase" ends on "Please sign in first." with no way back into the app).
 *
 * ROOT CAUSE: the one-tap Supabase connect flow was built and fixed for the WEB app only — a full-page
 * `window.location.assign()` plus a same-origin redirect back to `https://navbharatai.com`. The native
 * (Capacitor) app's own WebView origin is `https://localhost` / `capacitor://localhost`, so that
 * redirect stranded native users on a different, unauthenticated browser session. This mirrors the
 * SAME class of bug already fixed for GitHub connect (see githubNativeReturnWiring.test.ts) — an
 * in-app browser plus a return through the app's own `com.navbharat.ai://` deep link.
 *
 * These are STRING-CONTENT assertions, not fixed-offset slices — githubNativeReturnWiring.test.ts's
 * 1600-char window is exactly the kind of thing this new insertion had to work around once already.
 */
const read = (rel: string): string => readFileSync(join(__dirname, '..', rel), 'utf8');
const app = read('src/App.tsx');
const card = read('src/components/settings/SupabaseConnectCard.tsx');
const serverRoute = read('src/server/routes/supabaseIntegration.ts');
const serverOAuth = read('src/server/lib/supabaseOAuth.ts');

describe('App.tsx: the native deep-link listener understands the Supabase return', () => {
  it('checks for a Supabase deep link before falling into the GitHub branch', () => {
    const listenerAt = app.indexOf("addListener('appUrlOpen'");
    expect(listenerAt, 'the native OAuth deep-link listener is gone').toBeGreaterThan(-1);
    const supabaseCheckAt = app.indexOf('handleSupabaseUrlOpen(data?.url)', listenerAt);
    const githubCheckAt = app.indexOf('tokenFromDeepLink(data?.url)', listenerAt);
    expect(supabaseCheckAt).toBeGreaterThan(listenerAt);
    expect(githubCheckAt).toBeGreaterThan(supabaseCheckAt);
  });

  it('stashes into the SAME sessionStorage keys the web redirect already uses', () => {
    expect(app).toContain("sessionStorage.setItem('nbai.sbConnectNonce', sbNonce)");
    expect(app).toContain("sessionStorage.setItem('nbai.sbConnectError', sbErr)");
  });

  it('lands on Settings → Database and fires the event the card listens for', () => {
    const at = app.indexOf('handleSupabaseUrlOpen');
    const body = app.slice(at, app.indexOf('appUrlOpen', at));
    expect(body).toContain("toggleTab('settings')");
    expect(body).toContain("setSettingsScreen('database')");
    expect(body).toContain('SUPABASE_NATIVE_RETURN_EVENT');
    expect(body).toContain('Browser.close()');
  });

  it('imports the parser from the pure, tested module — not a re-implementation inline', () => {
    expect(app).toContain("from './lib/supabaseOauthReturn'");
    expect(app).toContain('nonceFromSupabaseDeepLink');
    expect(app).toContain('errorFromSupabaseDeepLink');
  });
});

describe('SupabaseConnectCard.tsx: native platform opens an in-app browser, never a full-page navigation', () => {
  it('checks Capacitor.isNativePlatform before deciding how to open the consent URL', () => {
    expect(card).toContain('isNativePlatform');
    expect(card).toContain('@capacitor/core');
  });

  it('native path uses the in-app browser plugin, not window.location.assign', () => {
    const at = card.indexOf('if (native) {');
    expect(at, 'the native branch in connect() is gone').toBeGreaterThan(-1);
    const nativeBranch = card.slice(at, card.indexOf('window.location.assign', at));
    expect(nativeBranch).toContain('@capacitor/browser');
    expect(nativeBranch).toContain('Browser.open(');
  });

  it('tells the server this is a native flow, so the server can choose the deep-link return', () => {
    expect(card).toMatch(/JSON\.stringify\(\{\s*native\s*\}\)/);
  });

  it('re-attempts completion on the native-return event, not only on mount', () => {
    expect(card).toContain('SUPABASE_NATIVE_RETURN_EVENT');
    expect(card).toContain('window.addEventListener(SUPABASE_NATIVE_RETURN_EVENT');
  });
});

describe('server: the callback decides web vs. native from ONE function, so the two paths cannot drift', () => {
  it('the native flag travels from /start, alongside the verifier, to the callback', () => {
    expect(serverRoute).toContain("req.body?.native === true");
    expect(serverRoute).toMatch(/rememberVerifier\(nonce, verifier, req\.body\?\.native === true, now\)/);
  });

  it('both the success and failure redirects are native-aware', () => {
    const at = serverRoute.indexOf("app.get('/api/integrations/supabase/callback'");
    expect(at).toBeGreaterThan(-1);
    const route = serverRoute.slice(at, serverRoute.indexOf("app.post('/api/integrations/supabase/complete'"));
    expect(route).toContain('let isNative = false;');
    expect(route).toContain('isNative = verifierHit.isNative;');
    expect(route).toContain('appRedirect(res, { nonce }, isNative)');
  });

  it('the native redirect is the app\'s OWN scheme, never the public web origin', () => {
    expect(serverOAuth).toContain("SUPABASE_NATIVE_REDIRECT = 'com.navbharat.ai://supabase-callback'");
  });

  it('uses the SAME scheme GitHub connect already registered, so nothing native-side needs re-registering', () => {
    // Both server modules name the identical scheme prefix — a typo here would need a new Play/App
    // Store build to fix, since the intent-filter / CFBundleURLSchemes registration is scheme-only.
    expect(serverOAuth).toContain('com.navbharat.ai://');
  });
});
