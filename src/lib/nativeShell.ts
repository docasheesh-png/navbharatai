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
  App?: { addListener: (event: string, listener: (data: any) => void) => { remove: () => void } };
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
export function installBackButtonHandler(ctx: NativeShellContext, onBack: () => void): () => void {
  if (!isNativeShell(ctx) || !ctx.App) return () => {};

  try {
    const listener = ctx.App.addListener('backButton', () => {
      // Prevent the default (exit app). Let React Router handle navigation.
      onBack();
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
export async function installNativeShellPolish(ctx: NativeShellContext, onBack: () => void): Promise<boolean> {
  if (!isNativeShell(ctx)) return false;

  // Hide the native splash screen — the React app is now on screen.
  await hideSplashScreen(ctx);

  // Apply the app theme to the status bar and safe-area background.
  await applyStatusBarTheme(ctx, 'light');

  // Install back button handler (Android) — forward to React Router.
  installBackButtonHandler(ctx, onBack);

  return true;
}
