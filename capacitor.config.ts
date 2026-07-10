import type { CapacitorConfig } from '@capacitor/cli';

// NavBharatAI — Capacitor native-app config (admin decisions 2026-07-02: appId com.navbharatai.app,
// in-app purchases hidden in v1; 2026-07-08: iOS/App Store added alongside Android/Play Store).
//
// HOSTED MODE (both platforms): the native shell loads the live site (server.url) instead of the
// bundled dist/. WHY: the entire frontend calls the API with relative paths (fetch('/api/…')) —
// hundreds of call sites. In bundled mode the WebView origin is capacitor://localhost, so every
// relative API call would break; rewriting all call sites is later work (a single apiUrl() base).
// Hosted mode ships a WORKING, store-installable app now — native shell + real APK/IPA — with
// auth/payments flows unchanged. dist/ is still synced as the webDir so `cap sync` has real assets
// and the switch to bundled mode later is a one-line config change (remove server.url).
//
// See MOBILE_PUBLISHING.md for the end-to-end Play Store + App Store runbook (build, sign, submit,
// payments policy). The iOS native project (ios/) is generated on a Mac with `npx cap add ios` — it
// is NOT committed here because an iOS build requires macOS + Xcode (Apple's hard requirement).
const config: CapacitorConfig = {
  // Store package/bundle id (PERMANENT once published). Admin registered the Play Console app as
  // com.navbharat.ai (2026-07-09), so this matches it across Android + iOS. The Android `namespace`
  // (internal code package) remains com.navbharatai.app in android/app/build.gradle — that is fine,
  // applicationId ≠ namespace is standard.
  appId: 'com.navbharat.ai',
  appName: 'NavBharatAI',
  webDir: 'dist',
  server: {
    url: 'https://navbharatai.com',
    // Keep the https scheme on both platforms so cookies/secure-context features behave like the web.
    androidScheme: 'https',
    iosScheme: 'https',
  },
  ios: {
    // Respect the safe-area insets (notch / home indicator) instead of drawing the WebView under them.
    contentInset: 'automatic',
  },
  plugins: {
    // Native Google Sign-In. Google BLOCKS OAuth inside embedded WebViews (their policy), which is
    // why the web signInWithRedirect flow opens an external browser and then fails with "missing
    // initial state" on return. On native we instead use the device's Google account via Play
    // Services and hand the resulting credential to the Firebase JS SDK (skipNativeAuth: true), so
    // the web SDK stays the single source of truth for the session — the web login path is untouched.
    FirebaseAuthentication: {
      skipNativeAuth: true,
      providers: ['google.com'],
    },
    // Splash screen: show app icon while loading, auto-hide once React mounts.
    SplashScreen: {
      launchShowDuration: 3000,
      launchAutoHide: false, // manually hidden after app ready
    },
    // Status bar: match app theme (dark text on light background, or vice versa).
    StatusBar: {
      style: 'dark',
      backgroundColor: '#ffffff',
    },
  },
};

export default config;
