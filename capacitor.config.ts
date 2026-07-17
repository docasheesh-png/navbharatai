import type { CapacitorConfig } from '@capacitor/cli';

// NavBharatAI — Capacitor native-app config (admin decisions 2026-07-02: appId com.navbharatai.app,
// in-app purchases hidden in v1; 2026-07-08: iOS/App Store added alongside Android/Play Store).
//
// BUNDLED MODE (both platforms, 2026-07-10): the native shell runs from the local bundle (dist/)
// instead of loading the live site. WHY: true native polish — splash screen, status bar styling,
// haptics, back button handling. API calls use the transport interceptor (src/lib/apiBase.ts) to
// rewrite /api/* URLs to the production origin. Auth uses Firebase JS SDK (web flow) with native
// Google Sign-In via skipNativeAuth: true. This is the production-ready native shell that users
// install from Play Store / App Store.
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
  // BUNDLED MODE (2026-07-10): app runs from local bundle, not the live site.
  // API calls use the transport interceptor (src/lib/apiBase.ts) to rewrite /api/* to production.
  // No server.url → app loads from dist/ and WebView origin is capacitor://localhost.
  ios: {
    // Draw the WebView EDGE-TO-EDGE and let our CSS own the safe-area insets (the `--nb-safe-*` vars in
    // index.css pad the app in from the notch, and the fixed bottom nav pads itself with
    // env(safe-area-inset-bottom)). 'automatic' made WKWebView ALSO inset the content, so the top notch
    // area AND the bottom home-indicator area were padded TWICE — a big wasted black strip above the header
    // and below the composer (admin screenshots 2026-07-15). 'never' removes the native double-inset so
    // there is exactly one inset (ours), and the content extends to fill the screen.
    contentInset: 'never',
  },
  plugins: {
    // Native Google Sign-In. Google BLOCKS OAuth inside embedded WebViews (their policy), which is
    // why the web signInWithRedirect flow opens an external browser and then fails with "missing
    // initial state" on return. On native we instead use the device's Google account via Play
    // Services and hand the resulting credential to the Firebase JS SDK (skipNativeAuth: true), so
    // the web SDK stays the single source of truth for the session — the web login path is untouched.
    FirebaseAuthentication: {
      skipNativeAuth: true,
      // 'apple.com' added 2026-07-16 for native "Sign in with Apple" on iOS (App Store guideline 4.8
      // requires it wherever a third-party login like Google is offered). iOS also needs the "Sign in
      // with Apple" capability in Xcode + the Apple provider enabled in Firebase (Console-side setup).
      providers: ['google.com', 'apple.com'],
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
