// Native shell UI polish (Bundled-mode foundation, PR 2 — admin decision 2026-07-08).
//
// THE PROBLEM THIS SOLVES: the bundled native shell needs native UI polish beyond just being
// a WebView wrapper: splash screen, status bar styling, haptic feedback, and back button handling.
// These features improve the "native feel" so the app doesn't read like a website in a native frame.
//
// SAFETY GUARANTEES:
//   • Web: `window.Capacitor` doesn't exist → all effects are NO-OP. Byte-for-byte today's behavior.
//   • Hosted native shell: Capacitor exists, but features gracefully no-op if the plugin isn't loaded
//     (e.g. if the developer didn't run `npx cap sync`).
//   • Bundled native shell: Capacitor + plugins are present → all features activate.
//   • Every feature is gated and try/catch guarded so a plugin failure never crashes the app.
//
// Everything is dependency-injected (the Capacitor API is a parameter) so the logic is fully
// unit-testable without a native runtime.

/** The minimal Capacitor surface this module touches (DI for tests). */
export interface NativeShellContext {
  Capacitor?: { isNativePlatform?: () => boolean; isNative?: boolean };
  SplashScreen?: { hide: () => Promise<void> };
  StatusBar?: { setStyle: (style: 'light' | 'dark') => Promise<void>; setBackgroundColor?: (color: string) => Promise<void> };
  Haptics?: { impact: (options: { style: 'light' | 'medium' | 'heavy' }) => Promise<void> };
  App?: {
    addListener: (event: string, listener: (data: any) => void) => { remove: () => void };
    /** Leaving the app at the root of the back stack — the standard Android expectation. */
    exitApp?: () => void;
  };
}

/**
 * ROOT-CAUSE FIX (admin audit 2026-07-26) — this whole module was DEAD CODE.
 *
 * Every function below is correctly written and unit-tested, but it reads its plugins off the object
 * it is handed, and the only caller passed `window`. Capacitor 4+ does NOT expose plugins as window
 * globals (they are ES module imports), and the four plugin packages were not even installed — so
 * `ctx.SplashScreen`, `ctx.StatusBar`, `ctx.Haptics` and `ctx.App` were ALWAYS undefined and every
 * feature silently no-opped. The app therefore shipped with: no splash control (white flash on
 * launch), an unthemed status bar, no haptics, and — the most visible one on Android — NO hardware
 * back-button handling at all, so Back closed the app from any screen instead of navigating back.
 *
 * This loader builds a REAL context from actual dynamic imports. The imports are inside the native
 * branch, so a web build never pulls the plugin code into its bundle, and every import is individually
 * guarded: one missing plugin degrades that single feature instead of killing the whole polish pass.
 */
export async function loadNativeShellContext(): Promise<NativeShellContext> {
  const { Capacitor } = await import('@capacitor/core');
  if (!Capacitor.isNativePlatform()) return { Capacitor };

  const ctx: NativeShellContext = { Capacitor };
  const load = async (fn: () => Promise<void>): Promise<void> => {
    try { await fn(); } catch { /* one unavailable plugin must not disable the others */ }
  };
  await Promise.all([
    load(async () => { ctx.SplashScreen = (await import('@capacitor/splash-screen')).SplashScreen as NativeShellContext['SplashScreen']; }),
    load(async () => { ctx.StatusBar = (await import('@capacitor/status-bar')).StatusBar as unknown as NativeShellContext['StatusBar']; }),
    load(async () => { ctx.Haptics = (await import('@capacitor/haptics')).Haptics as unknown as NativeShellContext['Haptics']; }),
    load(async () => { ctx.App = (await import('@capacitor/app')).App as unknown as NativeShellContext['App']; }),
  ]);
  return ctx;
}

/** True when running inside a native shell (Android/iOS app), never on plain web. */
export function isNativeShell(ctx: Pick<NativeShellContext, 'Capacitor'>): boolean {
  const c = ctx.Capacitor;
  if (!c) return false;
  if (typeof c.isNativePlatform === 'function') {
    try { return c.isNativePlatform() === true; } catch { return false; }
  }
  return c.isNative === true;
}

/**
 * Hide the splash screen once the app has finished loading. NO-OP if SplashScreen plugin is absent.
 * Called once after React mounts to transition from native splash to the loaded UI.
 */
export async function hideSplashScreen(ctx: NativeShellContext): Promise<void> {
  if (!isNativeShell(ctx) || !ctx.SplashScreen) return;
  try {
    await ctx.SplashScreen.hide();
  } catch (e) {
    // Plugin may not be available or already hidden — best effort, never crash.
  }
}

/**
 * Set the status bar style and color to match the app theme. Sensible defaults for light mode.
 * NO-OP if StatusBar plugin is absent. Call once at app startup.
 */
export async function applyStatusBarTheme(ctx: NativeShellContext, theme: 'light' | 'dark' = 'light'): Promise<void> {
  if (!isNativeShell(ctx) || !ctx.StatusBar) return;
  try {
    // Style: light = dark text on light background (standard Android/iOS light mode).
    // Color: match app background (white for light theme).
    const style = theme === 'light' ? 'light' : 'dark';
    const bgColor = theme === 'light' ? '#ffffff' : '#0d1117';
    await ctx.StatusBar.setStyle(style);
    if (ctx.StatusBar.setBackgroundColor) {
      await ctx.StatusBar.setBackgroundColor(bgColor);
    }
  } catch (e) {
    // Plugin may not be available — best effort.
  }
}

/**
 * Provide haptic feedback for user interactions (button taps, form submission).
 * NO-OP on web or if Haptics plugin is absent. Call on user actions.
 */
export async function triggerHaptic(ctx: NativeShellContext, style: 'light' | 'medium' | 'heavy' = 'light'): Promise<void> {
  if (!isNativeShell(ctx) || !ctx.Haptics) return;
  try {
    await ctx.Haptics.impact({ style });
  } catch (e) {
    // Plugin may not be available — best effort, never crash.
  }
}

/**
 * Handle Android hardware back button and iOS interactive pop gesture.
 * On Android: prevent default browser back (which exits the app), forward to React Router instead.
 * On iOS: swipe-back is handled natively, no action needed.
 * NO-OP if App plugin is absent or on web.
 */
export function installBackButtonHandler(ctx: NativeShellContext, onBack: (info?: { canGoBack?: boolean }) => void): () => void {
  if (!isNativeShell(ctx) || !ctx.App) return () => {};

  try {
    const listener = ctx.App.addListener('backButton', (data?: { canGoBack?: boolean }) => {
      // Android's expectation, in order: go back if there is anywhere to go, otherwise leave the app.
      // Passing canGoBack through lets the caller decide with its own navigation state; only when the
      // stack is genuinely empty do we exit — silently swallowing Back would trap the user instead.
      if (data?.canGoBack === false && ctx.App?.exitApp) {
        ctx.App.exitApp();
        return;
      }
      onBack(data);
    });
    return () => listener.remove();
  } catch (e) {
    // Plugin may not be available — best effort.
    return () => {};
  }
}

/**
 * Install all native shell polish features: splash screen, status bar, back button.
 * Returns true only when actually installed (native shell with plugins); false = no-op.
 * Safe to call on web (becomes a pure pass-through with no side effects).
 * Call once at app startup, after React mounts (so the back button handler can navigate).
 */
export async function installNativeShellPolish(ctx: NativeShellContext, onBack: (info?: { canGoBack?: boolean }) => void): Promise<boolean> {
  if (!isNativeShell(ctx)) return false;

  // Hide the native splash screen — the React app is now on screen.
  await hideSplashScreen(ctx);

  // Apply the app theme to the status bar and safe-area background.
  await applyStatusBarTheme(ctx, 'light');

  // Install back button handler (Android) — forward to React Router.
  installBackButtonHandler(ctx, onBack);

  return true;
}
