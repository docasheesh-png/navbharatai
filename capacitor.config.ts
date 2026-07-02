import type { CapacitorConfig } from '@capacitor/cli';

// NavBharatAI — Capacitor native-app config (Phase 1, Android-first; admin decisions 2026-07-02:
// Android before iOS, appId com.navbharatai.app, in-app purchases hidden in v1).
//
// PHASE 1 = HOSTED MODE: the native shell loads the live site (server.url) instead of the bundled
// dist/. WHY: the entire frontend calls the API with relative paths (fetch('/api/…')) — hundreds of
// call sites. In bundled mode the WebView origin is capacitor://localhost, so every relative API
// call would break; rewriting all call sites is Phase 2/3 work (a single apiUrl() base). Hosted mode
// ships a WORKING, store-installable app now — native shell + real APK — with auth/payments flows
// unchanged. dist/ is still synced as the webDir so `cap sync` has real assets and the switch to
// bundled mode later is a one-line config change (remove server.url).
const config: CapacitorConfig = {
  appId: 'com.navbharatai.app',
  appName: 'NavBharatAI',
  webDir: 'dist',
  server: {
    url: 'https://navbharatai.com',
    // Keep the https scheme on Android so cookies/secure-context features behave like the web.
    androidScheme: 'https',
  },
};

export default config;
