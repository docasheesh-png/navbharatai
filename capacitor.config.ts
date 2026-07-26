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
      // 'github.com' added 2026-07-18 (admin: "github login bhi fix karo") — the native GitHub OAuth
      // flow (Firebase SDK in-app browser sheet); the web popup cannot run inside the WebView.
      providers: ['google.com', 'apple.com', 'github.com'],
    },
    // Splash screen: show app icon while loading, auto-hide once React mounts.
    //
    // WHITE-FLASH FIX (admin 2026-07-26). `launchAutoHide: false` means the splash stays until the app
    // hides it — but the hide call lived in a module that never ran (see src/lib/nativeShell.ts), so
    // this config had no working counterpart. With the hide now wired, two things matter:
    //   • backgroundColor must match the app's own dark surface. Left unset it defaults to WHITE, so
    //     users saw a white sheet flash between the splash and the dark UI — the single most obvious
    //     "this is a web page loading" moment in the whole launch.
    //   • launchAutoHide stays false so the splash covers the WebView until React has actually painted,
    //     instead of revealing a blank shell mid-boot. `launchFadeOutDuration` makes the hand-off a
    //     fade rather than a hard cut, which is what a native launch looks like.
    // ⚠️ launchAutoHide MUST stay true. This bricked the app once — do not "optimise" it back.
    //
    // WHAT HAPPENED (admin, TestFlight, 2026-07-26): the app launched and never got past the splash.
    // `launchAutoHide: false` had sat here harmlessly for months ONLY because @capacitor/splash-screen
    // was not installed, so the whole config was inert. Installing the plugin brought this line to life:
    // the splash now genuinely waited forever for a JS hide() call, and that call sat behind an awaited
    // status-bar call which can hang in a WKWebView. One hang anywhere in that chain = a permanently
    // frozen app, with no fallback.
    //
    // `true` makes the NATIVE side hide the splash on its own timer no matter what JavaScript does. The
    // explicit hide() in nativeShell still runs and still fires earlier than this on a healthy launch —
    // it just is no longer the ONLY thing standing between the user and their app. A visible splash for
    // a moment too long is a blemish; a splash that never leaves is a dead app.
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#0d1117',
      launchFadeOutDuration: 200,
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
    },
    // Status bar: match app theme (dark text on light background, or vice versa).
    // NOTE: this is only the LAUNCH value. The live bar follows the user's theme at runtime via
    // syncStatusBarToTheme (src/lib/nativeShell.ts) — pinning it here alone left a bright bar above a
    // dark app whenever the user chose dark mode.
    StatusBar: {
      style: 'dark',
      backgroundColor: '#ffffff',
    },
    // KEYBOARD (admin 2026-07-26) — the loudest WebView giveaway in a chat app.
    //
    // `resize: 'native'` makes the WEBVIEW ITSELF shrink when the keyboard opens, exactly like a
    // native view: the composer ends up sitting on the keyboard and the header stays put. The web
    // default instead SCROLLS the document to reveal the focused input, which visibly jerks the whole
    // page and slides the header away — the moment everyone recognises as "this is a web page".
    //
    // Deliberately NOT combined with extra bottom padding on the composer: with native resize the
    // viewport is already shorter, so adding the keyboard height again would double-count it and open
    // a dead gap above the keyboard. The keyboard height is still published as a CSS variable
    // (--nb-keyboard-height) for the few components that genuinely need to measure it.
    Keyboard: {
      resize: 'native',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
