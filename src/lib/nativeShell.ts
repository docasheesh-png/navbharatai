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
  /** Keyboard behaviour (see installKeyboardBehaviour) — the loudest WebView giveaway in the app. */
  Keyboard?: KeyboardPlugin;
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
  // BOUNDED (2026-07-26, after the frozen-splash incident): a plugin import that never settles must not
  // be able to stop this function returning, because the caller's splash-hide runs only once it does.
  // Whatever has loaded by the deadline is used; a straggler simply leaves its feature inactive.
  const load = async (fn: () => Promise<void>): Promise<void> => {
    try { await fn(); } catch { /* one unavailable plugin must not disable the others */ }
  };
  const withinDeadline = <T,>(p: Promise<T>, ms = 4000): Promise<T | void> =>
    Promise.race([p, new Promise<void>((resolve) => setTimeout(resolve, ms))]);

  await withinDeadline(Promise.all([
    load(async () => { ctx.SplashScreen = (await import('@capacitor/splash-screen')).SplashScreen as NativeShellContext['SplashScreen']; }),
    load(async () => { ctx.StatusBar = (await import('@capacitor/status-bar')).StatusBar as unknown as NativeShellContext['StatusBar']; }),
    load(async () => { ctx.Haptics = (await import('@capacitor/haptics')).Haptics as unknown as NativeShellContext['Haptics']; }),
    load(async () => { ctx.App = (await import('@capacitor/app')).App as unknown as NativeShellContext['App']; }),
    load(async () => { ctx.Keyboard = (await import('@capacitor/keyboard')).Keyboard as unknown as KeyboardPlugin; }),
  ]));
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

  // ⚠️ ORDERING IS LOAD-BEARING — hiding the splash comes FIRST and is never awaited behind anything.
  //
  // This previously ran the status-bar call first and awaited it, then hid the splash. That looked
  // harmless (one less frame of colour mismatch) and it bricked the app on TestFlight: a plugin call
  // that hangs in a WKWebView never settles, so the awaited chain never reached hide() and the splash
  // stayed up forever. Anything placed before the hide becomes a single point of failure for the entire
  // app starting, which is never a trade worth making for a cosmetic frame.
  //
  // Fire-and-forget, not awaited: the splash comes down as soon as the plugin responds, and a hang in
  // any LATER step can no longer hold it hostage. (capacitor.config also auto-hides on a native timer,
  // so there are now two independent ways out instead of zero.)
  void hideSplashScreen(ctx);

  // Everything below is polish. Each is launched independently and never awaited by the others, so one
  // unresponsive plugin degrades exactly one feature instead of stalling the rest.
  void syncStatusBarToTheme(ctx, typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') : null);

  // Install back button handler (Android) — forward to React Router.
  installBackButtonHandler(ctx, onBack);

  // Keyboard + touch feedback: the two behaviours users read as "app" vs "web page" without ever
  // being able to name why. Both no-op when their plugin is unavailable.
  if (typeof document !== 'undefined') {
    installKeyboardBehaviour(ctx, (name, value) => document.documentElement.style.setProperty(name, value));
    installTapHaptics(ctx, document);
  }

  return true;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// NATIVE FEEL, PASS 2 (admin 2026-07-26: "koi na pehchan paye ki yeh Capacitor hai").
//
// Pass 1 made the existing module actually run. These are the remaining behaviours where a WebView
// still betrays itself to anyone who has used a real Android/iOS app for five minutes. Each one is a
// SPECIFIC observable difference, not a vague "make it feel native":
//
//   • The keyboard. On the web the page SCROLLS to reveal a focused field and an iOS input shows a
//     grey "Done / ‹ ›" accessory bar. Native apps do neither — the layout resizes and there is no
//     bar. This is the loudest giveaway in the whole app because every chat message goes through it.
//   • Touch. Native controls answer a finger with a tick of haptic feedback. A web page never does.
//   • The status bar. Ours was pinned to light regardless of the app's theme, so in dark mode the
//     bar stayed bright — something no real app does.
//
// All native-only and individually guarded: on web every function returns immediately, and a missing
// plugin degrades that one behaviour instead of the whole pass.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Keyboard surface we depend on (DI for tests). */
export interface KeyboardPlugin {
  setAccessoryBarVisible?: (o: { isVisible: boolean }) => Promise<void>;
  setScroll?: (o: { isDisabled: boolean }) => Promise<void>;
  addListener?: (event: string, cb: (info?: { keyboardHeight?: number }) => void) => { remove: () => void };
}

/** CSS variable the layout reads so it can move with the keyboard instead of being scrolled by it. */
export const KEYBOARD_HEIGHT_VAR = '--nb-keyboard-height';

/**
 * Make the keyboard behave the way it does in a native app.
 *
 * Three separate fixes:
 *  1. `setScroll({ isDisabled: true })` stops the WebView scrolling the entire document to reveal the
 *     focused input — the single most web-like moment in the app, because the header slides away and
 *     the page visibly jumps.
 *  2. `setAccessoryBarVisible(false)` removes iOS's grey "Done / ‹ ›" bar above the keyboard, which
 *     only ever appears over web inputs and instantly identifies a WebView.
 *  3. The show/hide listeners publish the real keyboard height as a CSS variable, so the composer can
 *     sit exactly on top of the keyboard and animate with it, the way a native chat app does.
 *
 * Returns a teardown. Best-effort throughout: never throws, never blocks input.
 */
export function installKeyboardBehaviour(
  ctx: { Capacitor?: NativeShellContext['Capacitor']; Keyboard?: KeyboardPlugin },
  setVar: (name: string, value: string) => void,
): () => void {
  if (!isNativeShell(ctx) || !ctx.Keyboard) return () => {};
  const kb = ctx.Keyboard;
  const subs: Array<{ remove: () => void }> = [];

  try { void kb.setScroll?.({ isDisabled: true })?.catch?.(() => {}); } catch { /* best effort */ }
  try { void kb.setAccessoryBarVisible?.({ isVisible: false })?.catch?.(() => {}); } catch { /* iOS-only; Android throws */ }

  try {
    // `willShow`/`willHide` (not didShow/didHide) so our layout moves WITH the keyboard animation
    // rather than snapping a frame late — late is exactly what reads as "web".
    const show = kb.addListener?.('keyboardWillShow', (info) => {
      setVar(KEYBOARD_HEIGHT_VAR, `${Math.max(0, Number(info?.keyboardHeight) || 0)}px`);
    });
    if (show) subs.push(show);
    const hide = kb.addListener?.('keyboardWillHide', () => setVar(KEYBOARD_HEIGHT_VAR, '0px'));
    if (hide) subs.push(hide);
  } catch { /* best effort */ }

  return () => { for (const s of subs) { try { s.remove(); } catch { /* ignore */ } } };
}

/**
 * Which status-bar style suits a theme.
 *
 * Capacitor's naming is a genuine trap worth stating: `Style.Light` means LIGHT TEXT, which you need
 * on a DARK background. Getting this backwards yields dark-on-dark — invisible icons. Pure, so the
 * mapping is locked by a test rather than by whoever last touched it.
 */
export function statusBarStyleForTheme(theme: string | null | undefined): 'light' | 'dark' {
  return theme === 'dark' ? 'light' : 'dark';
}

/** Status-bar background matching the app's own surface, so the bar never looks bolted on. */
export function statusBarColorForTheme(theme: string | null | undefined): string {
  return theme === 'dark' ? '#0d1117' : '#ffffff';
}

/**
 * Keep the status bar in step with the app's theme.
 *
 * Previously pinned to 'light' at startup, so switching to dark mode left a bright status bar above a
 * dark app — a mismatch no real app has. Re-applied on every theme change.
 */
export async function syncStatusBarToTheme(ctx: NativeShellContext, theme: string | null | undefined): Promise<void> {
  if (!isNativeShell(ctx) || !ctx.StatusBar) return;
  try {
    await ctx.StatusBar.setStyle(statusBarStyleForTheme(theme));
    await ctx.StatusBar.setBackgroundColor?.(statusBarColorForTheme(theme));
  } catch { /* best effort — a themed bar is polish, never a blocker */ }
}

/** Elements that should answer a touch the way a native control does. */
const HAPTIC_TARGET = 'button, [role="button"], a[href], input[type="submit"]';
/** Two taps inside this window are one interaction; without it a fast tapper gets a buzz storm. */
export const HAPTIC_MIN_GAP_MS = 60;

/**
 * App-wide haptic feedback on tap.
 *
 * Deliberately ONE delegated listener rather than a prop threaded through ~200 components: a single
 * implementation cannot drift, and adding a button later gets the behaviour for free instead of
 * needing to remember. `pointerdown` (not click) so the tick lands on touch-down like a native
 * control, and 'light' because anything stronger becomes irritating at chat-typing frequency.
 */
export function installTapHaptics(
  ctx: NativeShellContext,
  root: { addEventListener: (t: string, cb: (e: Event) => void, o?: unknown) => void; removeEventListener: (t: string, cb: (e: Event) => void, o?: unknown) => void },
  now: () => number = () => Date.now(),
): () => void {
  if (!isNativeShell(ctx) || !ctx.Haptics) return () => {};
  let last = 0;
  const onDown = (e: Event): void => {
    const target = e.target as { closest?: (s: string) => unknown } | null;
    if (!target?.closest?.(HAPTIC_TARGET)) return;
    const t = now();
    if (t - last < HAPTIC_MIN_GAP_MS) return;
    last = t;
    try { void ctx.Haptics?.impact({ style: 'light' }); } catch { /* best effort */ }
  };
  root.addEventListener('pointerdown', onDown, { passive: true });
  return () => root.removeEventListener('pointerdown', onDown, { passive: true } as unknown);
}
