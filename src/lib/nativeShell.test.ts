import { describe, it, expect, vi } from 'vitest';
import {
  isNativeShell, hideSplashScreen, applyStatusBarTheme, triggerHaptic, installBackButtonHandler,
  installNativeShellPolish, type NativeShellContext,
  KEYBOARD_HEIGHT_VAR, HAPTIC_MIN_GAP_MS, installKeyboardBehaviour, installTapHaptics,
  statusBarStyleForTheme, statusBarColorForTheme, syncStatusBarToTheme,
} from './nativeShell';

const fakeContext = (over: Partial<NativeShellContext> = {}): NativeShellContext => ({
  Capacitor: over.Capacitor,
  SplashScreen: over.SplashScreen,
  StatusBar: over.StatusBar,
  Haptics: over.Haptics,
  App: over.App,
});

describe('isNativeShell — only a real Capacitor native runtime counts', () => {
  it('web (no Capacitor global) → false', () => {
    expect(isNativeShell({})).toBe(false);
  });
  it('native platform → true; web build of the plugin (isNativePlatform false) → false', () => {
    expect(isNativeShell({ Capacitor: { isNativePlatform: () => true } })).toBe(true);
    expect(isNativeShell({ Capacitor: { isNativePlatform: () => false } })).toBe(false);
  });
  it('legacy isNative flag works; a throwing detector fails CLOSED (false)', () => {
    expect(isNativeShell({ Capacitor: { isNative: true } })).toBe(true);
    expect(isNativeShell({ Capacitor: { isNativePlatform: () => { throw new Error('x'); } } })).toBe(false);
  });
});

describe('hideSplashScreen — only native with plugin', () => {
  it('web (no Capacitor) → NO-OP, no error', async () => {
    const ctx = fakeContext({ Capacitor: undefined });
    await expect(hideSplashScreen(ctx)).resolves.toBeUndefined();
  });

  it('native without SplashScreen plugin → NO-OP, no error', async () => {
    const ctx = fakeContext({ Capacitor: { isNativePlatform: () => true }, SplashScreen: undefined });
    await expect(hideSplashScreen(ctx)).resolves.toBeUndefined();
  });

  it('native with SplashScreen → calls hide()', async () => {
    const hide = vi.fn(async () => {});
    const ctx = fakeContext({ Capacitor: { isNativePlatform: () => true }, SplashScreen: { hide } });
    await hideSplashScreen(ctx);
    expect(hide).toHaveBeenCalledOnce();
  });

  it('plugin error → catches and does not throw', async () => {
    const hide = vi.fn(async () => { throw new Error('Plugin error'); });
    const ctx = fakeContext({ Capacitor: { isNativePlatform: () => true }, SplashScreen: { hide } });
    await expect(hideSplashScreen(ctx)).resolves.toBeUndefined();
  });
});

describe('applyStatusBarTheme — light/dark theme, safe if plugin absent', () => {
  it('web (no Capacitor) → NO-OP', async () => {
    const ctx = fakeContext({ Capacitor: undefined });
    await expect(applyStatusBarTheme(ctx, 'light')).resolves.toBeUndefined();
  });

  it('native without StatusBar → NO-OP', async () => {
    const ctx = fakeContext({ Capacitor: { isNativePlatform: () => true }, StatusBar: undefined });
    await expect(applyStatusBarTheme(ctx, 'light')).resolves.toBeUndefined();
  });

  it('light theme → setStyle("light"), setBackgroundColor("#ffffff")', async () => {
    const setStyle = vi.fn(async () => {});
    const setBackgroundColor = vi.fn(async () => {});
    const ctx = fakeContext({
      Capacitor: { isNativePlatform: () => true },
      StatusBar: { setStyle, setBackgroundColor },
    });
    await applyStatusBarTheme(ctx, 'light');
    expect(setStyle).toHaveBeenCalledWith('light');
    expect(setBackgroundColor).toHaveBeenCalledWith('#ffffff');
  });

  it('dark theme → setStyle("dark"), setBackgroundColor("#0d1117")', async () => {
    const setStyle = vi.fn(async () => {});
    const setBackgroundColor = vi.fn(async () => {});
    const ctx = fakeContext({
      Capacitor: { isNativePlatform: () => true },
      StatusBar: { setStyle, setBackgroundColor },
    });
    await applyStatusBarTheme(ctx, 'dark');
    expect(setStyle).toHaveBeenCalledWith('dark');
    expect(setBackgroundColor).toHaveBeenCalledWith('#0d1117');
  });

  it('setBackgroundColor absent → only calls setStyle', async () => {
    const setStyle = vi.fn(async () => {});
    const ctx = fakeContext({
      Capacitor: { isNativePlatform: () => true },
      StatusBar: { setStyle },
    });
    await applyStatusBarTheme(ctx, 'light');
    expect(setStyle).toHaveBeenCalledWith('light');
  });

  it('plugin error → catches and does not throw', async () => {
    const setStyle = vi.fn(async () => { throw new Error('Plugin error'); });
    const ctx = fakeContext({
      Capacitor: { isNativePlatform: () => true },
      StatusBar: { setStyle },
    });
    await expect(applyStatusBarTheme(ctx, 'light')).resolves.toBeUndefined();
  });
});

describe('triggerHaptic — optional feedback, safe if absent', () => {
  it('web (no Capacitor) → NO-OP', async () => {
    const ctx = fakeContext({ Capacitor: undefined });
    await expect(triggerHaptic(ctx, 'light')).resolves.toBeUndefined();
  });

  it('native without Haptics → NO-OP', async () => {
    const ctx = fakeContext({ Capacitor: { isNativePlatform: () => true }, Haptics: undefined });
    await expect(triggerHaptic(ctx, 'light')).resolves.toBeUndefined();
  });

  it('light impact → calls impact({ style: "light" })', async () => {
    const impact = vi.fn(async () => {});
    const ctx = fakeContext({ Capacitor: { isNativePlatform: () => true }, Haptics: { impact } });
    await triggerHaptic(ctx, 'light');
    expect(impact).toHaveBeenCalledWith({ style: 'light' });
  });

  it('medium impact → calls impact({ style: "medium" })', async () => {
    const impact = vi.fn(async () => {});
    const ctx = fakeContext({ Capacitor: { isNativePlatform: () => true }, Haptics: { impact } });
    await triggerHaptic(ctx, 'medium');
    expect(impact).toHaveBeenCalledWith({ style: 'medium' });
  });

  it('plugin error → catches and does not throw', async () => {
    const impact = vi.fn(async () => { throw new Error('Plugin error'); });
    const ctx = fakeContext({ Capacitor: { isNativePlatform: () => true }, Haptics: { impact } });
    await expect(triggerHaptic(ctx, 'light')).resolves.toBeUndefined();
  });
});

describe('installBackButtonHandler — Android back button forwarding', () => {
  it('web (no Capacitor) → returns empty cleanup function', () => {
    const ctx = fakeContext({ Capacitor: undefined });
    const onBack = vi.fn();
    const cleanup = installBackButtonHandler(ctx, onBack);
    cleanup();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('native without App → returns empty cleanup', () => {
    const ctx = fakeContext({ Capacitor: { isNativePlatform: () => true }, App: undefined });
    const onBack = vi.fn();
    const cleanup = installBackButtonHandler(ctx, onBack);
    cleanup();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('native with App → installs backButton listener, calls onBack when fired', () => {
    let listener: (() => void) | null = null;
    const addListener = vi.fn((event: string, cb: () => void) => {
      if (event === 'backButton') listener = cb;
      return { remove: vi.fn() };
    });
    const ctx = fakeContext({ Capacitor: { isNativePlatform: () => true }, App: { addListener } });
    const onBack = vi.fn();
    installBackButtonHandler(ctx, onBack);
    expect(addListener).toHaveBeenCalledWith('backButton', expect.any(Function));
    if (listener) listener();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('cleanup function calls listener.remove()', () => {
    const remove = vi.fn();
    const addListener = vi.fn(() => ({ remove }));
    const ctx = fakeContext({ Capacitor: { isNativePlatform: () => true }, App: { addListener } });
    const onBack = vi.fn();
    const cleanup = installBackButtonHandler(ctx, onBack);
    cleanup();
    expect(remove).toHaveBeenCalledOnce();
  });

  it('addListener error → returns empty cleanup', () => {
    const addListener = vi.fn(() => { throw new Error('Plugin error'); });
    const ctx = fakeContext({ Capacitor: { isNativePlatform: () => true }, App: { addListener } });
    const onBack = vi.fn();
    const cleanup = installBackButtonHandler(ctx, onBack);
    cleanup(); // should not throw
    expect(onBack).not.toHaveBeenCalled();
  });
});

describe('installNativeShellPolish — all features coordinated', () => {
  it('web (no Capacitor) → returns false, NO-OP', async () => {
    const ctx = fakeContext({ Capacitor: undefined });
    const onBack = vi.fn();
    const result = await installNativeShellPolish(ctx, onBack);
    expect(result).toBe(false);
    expect(onBack).not.toHaveBeenCalled();
  });

  it('native with all plugins → hides splash, applies theme, installs back button → returns true', async () => {
    const hide = vi.fn(async () => {});
    const setStyle = vi.fn(async () => {});
    const setBackgroundColor = vi.fn(async () => {});
    const addListener = vi.fn(() => ({ remove: vi.fn() }));
    const ctx = fakeContext({
      Capacitor: { isNativePlatform: () => true },
      SplashScreen: { hide },
      StatusBar: { setStyle, setBackgroundColor },
      App: { addListener },
    });
    const onBack = vi.fn();
    const result = await installNativeShellPolish(ctx, onBack);
    expect(result).toBe(true);
    expect(hide).toHaveBeenCalledOnce();
    // CORRECTED (admin 2026-07-26): this used to assert setStyle('light') for the light theme, which
    // encoded a real bug. In Capacitor, Style.Light means LIGHT TEXT — what you need on a DARK bar.
    // Asking for it on a white bar painted white-on-white icons. The startup pass now goes through
    // syncStatusBarToTheme, which maps a light theme to DARK text. The old expectation was locking in
    // the defect, so it is replaced rather than preserved.
    expect(setStyle).toHaveBeenCalledWith('dark');
    expect(setBackgroundColor).toHaveBeenCalledWith('#ffffff');
    expect(addListener).toHaveBeenCalledWith('backButton', expect.any(Function));
  });

  it('partial plugins (e.g., no Haptics) → still works, just skips missing ones', async () => {
    const hide = vi.fn(async () => {});
    const setStyle = vi.fn(async () => {});
    const addListener = vi.fn(() => ({ remove: vi.fn() }));
    const ctx = fakeContext({
      Capacitor: { isNativePlatform: () => true },
      SplashScreen: { hide },
      StatusBar: { setStyle },
      Haptics: undefined,
      App: { addListener },
    });
    const onBack = vi.fn();
    const result = await installNativeShellPolish(ctx, onBack);
    expect(result).toBe(true);
    expect(hide).toHaveBeenCalledOnce();
    expect(setStyle).toHaveBeenCalledOnce();
    expect(addListener).toHaveBeenCalledOnce();
  });

  it('plugin errors → catches individually, returns true anyway', async () => {
    const hide = vi.fn(async () => { throw new Error('Splash error'); });
    const setStyle = vi.fn(async () => { throw new Error('StatusBar error'); });
    const addListener = vi.fn(() => { throw new Error('App error'); });
    const ctx = fakeContext({
      Capacitor: { isNativePlatform: () => true },
      SplashScreen: { hide },
      StatusBar: { setStyle },
      App: { addListener },
    });
    const onBack = vi.fn();
    const result = await installNativeShellPolish(ctx, onBack);
    expect(result).toBe(true); // still returns true because native shell is present
    expect(hide).toHaveBeenCalledOnce();
    expect(setStyle).toHaveBeenCalledOnce();
    expect(addListener).toHaveBeenCalledOnce();
  });
});

// THE bug (admin audit 2026-07-26): this whole module was DEAD CODE. Every function was correct and
// tested, but the only caller passed `window` — and Capacitor 4+ does not expose plugins as window
// globals, nor were the plugin packages installed. So ctx.SplashScreen/StatusBar/Haptics/App were
// ALWAYS undefined and every feature silently no-opped: white flash on launch, unthemed status bar,
// no haptics, and no hardware Back handling at all (Back closed the app from any screen). Unit tests
// could never catch it because they inject a perfect ctx — so these lock the WIRING instead.
describe('native shell wiring — the plugins must actually reach the module', () => {
  it('the caller passes a real loaded context, never the window object', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(join(__dirname, '../main.tsx'), 'utf8');
    expect(src).toContain('loadNativeShellContext()');
    // `installNativeShellPolish(window as any, …)` is precisely the dead-code bug.
    expect(src).not.toMatch(/installNativeShellPolish\(\s*window/);
  });

  it('every plugin the module reads is a real installed dependency', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));
    for (const p of ['@capacitor/app', '@capacitor/splash-screen', '@capacitor/status-bar', '@capacitor/haptics']) {
      expect(pkg.dependencies[p], `${p} must be installed or the feature silently no-ops`).toBeTruthy();
    }
  });
});

describe('hardware back button — Android must not exit from a screen you can go back from', () => {
  function ctxWith(exitApp?: () => void) {
    const listeners: Record<string, (d?: unknown) => void> = {};
    return {
      ctx: {
        Capacitor: { isNativePlatform: () => true },
        App: {
          addListener: (ev: string, cb: (d?: unknown) => void) => {
            listeners[ev] = cb;
            return { remove: () => { delete listeners[ev]; } };
          },
          exitApp,
        },
      } as never,
      fire: (data?: unknown) => listeners.backButton?.(data),
      has: () => Boolean(listeners.backButton),
    };
  }

  it('navigates back when there IS somewhere to go', () => {
    const onBack = vi.fn();
    const exitApp = vi.fn();
    const { ctx, fire } = ctxWith(exitApp);
    installBackButtonHandler(ctx, onBack);
    fire({ canGoBack: true });
    expect(onBack).toHaveBeenCalledOnce();
    expect(exitApp).not.toHaveBeenCalled();
  });

  it('exits the app at the root instead of trapping the user on the screen', () => {
    const onBack = vi.fn();
    const exitApp = vi.fn();
    const { ctx, fire } = ctxWith(exitApp);
    installBackButtonHandler(ctx, onBack);
    fire({ canGoBack: false });
    expect(exitApp).toHaveBeenCalledOnce();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('falls back to navigating when the platform reports nothing', () => {
    const onBack = vi.fn();
    const { ctx, fire } = ctxWith(vi.fn());
    installBackButtonHandler(ctx, onBack);
    fire(undefined);
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('removing the handler detaches the listener', () => {
    const { ctx, has } = ctxWith(vi.fn());
    const remove = installBackButtonHandler(ctx, vi.fn());
    expect(has()).toBe(true);
    remove();
    expect(has()).toBe(false);
  });
});

describe('status bar follows the app theme', () => {
  it('dark theme needs LIGHT text — Capacitor\'s naming is inverted and getting it wrong hides the icons', () => {
    expect(statusBarStyleForTheme('dark')).toBe('light');
    expect(statusBarColorForTheme('dark')).toBe('#0d1117');
  });

  it('light theme needs DARK text on a light bar', () => {
    expect(statusBarStyleForTheme('light')).toBe('dark');
    expect(statusBarColorForTheme('light')).toBe('#ffffff');
  });

  it('an unknown or missing theme falls back to the light treatment, never to nothing', () => {
    for (const t of [null, undefined, '', 'sepia']) {
      expect(statusBarStyleForTheme(t)).toBe('dark');
      expect(statusBarColorForTheme(t)).toBe('#ffffff');
    }
  });

  it('applies both style and colour on native', async () => {
    const setStyle = vi.fn(() => Promise.resolve());
    const setBackgroundColor = vi.fn(() => Promise.resolve());
    await syncStatusBarToTheme({ Capacitor: { isNativePlatform: () => true }, StatusBar: { setStyle, setBackgroundColor } } as never, 'dark');
    expect(setStyle).toHaveBeenCalledWith('light');
    expect(setBackgroundColor).toHaveBeenCalledWith('#0d1117');
  });

  it('is a no-op on web — the browser owns its own chrome', async () => {
    const setStyle = vi.fn(() => Promise.resolve());
    await syncStatusBarToTheme({ Capacitor: { isNativePlatform: () => false }, StatusBar: { setStyle } } as never, 'dark');
    expect(setStyle).not.toHaveBeenCalled();
  });

  it('a throwing plugin never breaks the theme switch', async () => {
    const setStyle = vi.fn(() => Promise.reject(new Error('no bar')));
    await expect(syncStatusBarToTheme({ Capacitor: { isNativePlatform: () => true }, StatusBar: { setStyle } } as never, 'dark')).resolves.toBeUndefined();
  });
});

describe('keyboard behaviour — the loudest WebView giveaway', () => {
  function kbCtx() {
    const listeners: Record<string, (i?: unknown) => void> = {};
    const calls: string[] = [];
    return {
      calls,
      listeners,
      ctx: {
        Capacitor: { isNativePlatform: () => true },
        Keyboard: {
          setScroll: (o: { isDisabled: boolean }) => { calls.push(`scroll:${o.isDisabled}`); return Promise.resolve(); },
          setAccessoryBarVisible: (o: { isVisible: boolean }) => { calls.push(`bar:${o.isVisible}`); return Promise.resolve(); },
          addListener: (ev: string, cb: (i?: unknown) => void) => {
            listeners[ev] = cb;
            return { remove: () => { delete listeners[ev]; } };
          },
        },
      } as never,
    };
  }

  it('stops the document scrolling to reveal the input, and removes the iOS accessory bar', () => {
    const { ctx, calls } = kbCtx();
    installKeyboardBehaviour(ctx, vi.fn());
    expect(calls).toContain('scroll:true');
    expect(calls).toContain('bar:false');
  });

  it('publishes the real keyboard height so a layout can move WITH the animation', () => {
    const setVar = vi.fn();
    const { ctx, listeners } = kbCtx();
    installKeyboardBehaviour(ctx, setVar);
    listeners.keyboardWillShow({ keyboardHeight: 336 });
    expect(setVar).toHaveBeenCalledWith(KEYBOARD_HEIGHT_VAR, '336px');
    listeners.keyboardWillHide();
    expect(setVar).toHaveBeenCalledWith(KEYBOARD_HEIGHT_VAR, '0px');
  });

  it('uses willShow/willHide, not the frame-late didShow/didHide', () => {
    const { ctx, listeners } = kbCtx();
    installKeyboardBehaviour(ctx, vi.fn());
    expect(Object.keys(listeners).sort()).toEqual(['keyboardWillHide', 'keyboardWillShow']);
  });

  it('a garbage height never writes a broken CSS value', () => {
    const setVar = vi.fn();
    const { ctx, listeners } = kbCtx();
    installKeyboardBehaviour(ctx, setVar);
    listeners.keyboardWillShow({ keyboardHeight: -5 });
    expect(setVar).toHaveBeenCalledWith(KEYBOARD_HEIGHT_VAR, '0px');
    listeners.keyboardWillShow({});
    expect(setVar).toHaveBeenCalledWith(KEYBOARD_HEIGHT_VAR, '0px');
  });

  it('teardown removes every listener', () => {
    const { ctx, listeners } = kbCtx();
    installKeyboardBehaviour(ctx, vi.fn())();
    expect(Object.keys(listeners)).toHaveLength(0);
  });

  it('is a no-op on web', () => {
    const setVar = vi.fn();
    installKeyboardBehaviour({ Capacitor: { isNativePlatform: () => false }, Keyboard: {} } as never, setVar);
    expect(setVar).not.toHaveBeenCalled();
  });
});

describe('tap haptics — one delegated listener, never 200 call sites', () => {
  function hapticCtx() {
    const impacts: string[] = [];
    let handler: ((e: Event) => void) | null = null;
    const root = {
      addEventListener: (_t: string, cb: (e: Event) => void) => { handler = cb; },
      removeEventListener: () => { handler = null; },
    };
    return {
      impacts,
      root,
      fire: (matches: boolean) => handler?.({ target: { closest: () => (matches ? {} : null) } } as unknown as Event),
      attached: () => handler !== null,
      ctx: { Capacitor: { isNativePlatform: () => true }, Haptics: { impact: (o: { style: string }) => { impacts.push(o.style); return Promise.resolve(); } } } as never,
    };
  }

  it('ticks on a real control, and stays silent on plain content', () => {
    const h = hapticCtx();
    installTapHaptics(h.ctx, h.root, () => 1000);
    h.fire(true);
    expect(h.impacts).toEqual(['light']);
    h.fire(false);
    expect(h.impacts).toEqual(['light']); // untouched — body text must not buzz
  });

  it('throttles a fast tapper into one tick instead of a buzz storm', () => {
    const h = hapticCtx();
    let t = 1000;
    installTapHaptics(h.ctx, h.root, () => t);
    h.fire(true);
    t += HAPTIC_MIN_GAP_MS - 1;
    h.fire(true);
    expect(h.impacts).toHaveLength(1);
    t += HAPTIC_MIN_GAP_MS;
    h.fire(true);
    expect(h.impacts).toHaveLength(2);
  });

  it('teardown detaches the listener', () => {
    const h = hapticCtx();
    const off = installTapHaptics(h.ctx, h.root, () => 1);
    expect(h.attached()).toBe(true);
    off();
    expect(h.attached()).toBe(false);
  });

  it('is a no-op on web — a browser has no haptics to give', () => {
    const h = hapticCtx();
    const impact = vi.fn(() => Promise.resolve());
    installTapHaptics({ Capacitor: { isNativePlatform: () => false }, Haptics: { impact } } as never, h.root, () => 1);
    expect(h.attached()).toBe(false);
    expect(impact).not.toHaveBeenCalled();
  });
});

describe('splash screen — no white flash on launch', () => {
  it('capacitor.config pins the splash background to the app surface, not the default white', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const cfg = readFileSync(join(__dirname, '../../capacitor.config.ts'), 'utf8');
    expect(cfg).toMatch(/backgroundColor:\s*'#0d1117'/);
    // The splash must not vanish before React paints, or the user sees the blank shell underneath.
    expect(cfg).toMatch(/launchAutoHide:\s*false/);
  });

  it('the keyboard resizes the webview natively instead of scrolling the document', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const cfg = readFileSync(join(__dirname, '../../capacitor.config.ts'), 'utf8');
    expect(cfg).toMatch(/resize:\s*'native'/);
  });
});

describe('app shell overscroll — a swipe down must not reload the app', () => {
  it('the document does not arm the browser pull-to-refresh or rubber-band', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const css = readFileSync(join(__dirname, '../index.css'), 'utf8');
    // `overscroll-behavior-y: auto` on html/body is what let a downward drag at the top of a chat
    // reload the entire app — losing whatever build the user was watching.
    expect(css).not.toMatch(/overscroll-behavior-y:\s*auto/);
    expect(css).toMatch(/overscroll-behavior-y:\s*none/);
  });

  it('the mobile tap-highlight rectangle stays suppressed', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const css = readFileSync(join(__dirname, '../index.css'), 'utf8');
    expect(css).toMatch(/-webkit-tap-highlight-color:\s*transparent/);
  });

  it('touch devices still get 16px inputs, so focusing one never zooms the viewport', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const css = readFileSync(join(__dirname, '../index.css'), 'utf8');
    // Pre-existing and correct — locked so a later refactor cannot quietly drop it.
    expect(css).toMatch(/font-size:\s*16px\s*!important/);
  });
});

// THE INCIDENT (admin, TestFlight, 2026-07-26): the app launched and never got past the splash.
// `launchAutoHide: false` had been inert for months because @capacitor/splash-screen was not installed.
// Installing the plugin brought it to life — the splash now genuinely waited for a JS hide() that sat
// behind an AWAITED status-bar call, and a plugin call that hangs in a WKWebView never settles. One
// hang = a permanently frozen app with no fallback. These tests make that shape impossible to reship.
describe('launch must never be able to freeze on the splash', () => {
  /** Config with comment lines stripped — the incident write-up quotes the old value, so a raw
   *  text search would match the explanation rather than the setting actually in force. */
  const cfg = async (): Promise<string> => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    return readFileSync(join(__dirname, '../../capacitor.config.ts'), 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
  };

  it('the native side auto-hides the splash on its own timer — JS is never the only way out', async () => {
    const c = await cfg();
    expect(c).toMatch(/launchAutoHide:\s*true/);
    expect(c).not.toMatch(/launchAutoHide:\s*false/);
  });

  it('nothing is awaited before the splash hide — it must be the first thing that runs', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(join(__dirname, 'nativeShell.ts'), 'utf8');
    const body = src.slice(src.indexOf('export async function installNativeShellPolish'));
    const hideAt = body.indexOf('hideSplashScreen(ctx)');
    const statusAt = body.indexOf('syncStatusBarToTheme(ctx');
    expect(hideAt).toBeGreaterThan(-1);
    // The status bar (or anything else) placed BEFORE the hide is exactly the bug.
    expect(hideAt).toBeLessThan(statusAt);
    // And it must not be awaited — an awaited hang would hold the splash hostage again.
    expect(body).toMatch(/void hideSplashScreen\(ctx\)/);
    expect(body).not.toMatch(/await hideSplashScreen\(ctx\)/);
  });

  it('a hung status-bar plugin no longer blocks the launch', async () => {
    const hide = vi.fn(async () => {});
    const ctx = fakeContext({
      Capacitor: { isNativePlatform: () => true },
      SplashScreen: { hide },
      // Never settles — the WKWebView hang that caused the incident.
      StatusBar: { setStyle: () => new Promise<void>(() => {}) },
      App: { addListener: () => ({ remove: vi.fn() }) },
    });
    await expect(installNativeShellPolish(ctx, vi.fn())).resolves.toBe(true);
    expect(hide).toHaveBeenCalledOnce();
  });

  it('a hung splash plugin does not stop the rest of the launch either', async () => {
    const addListener = vi.fn(() => ({ remove: vi.fn() }));
    const ctx = fakeContext({
      Capacitor: { isNativePlatform: () => true },
      SplashScreen: { hide: () => new Promise<void>(() => {}) },
      App: { addListener },
    });
    await expect(installNativeShellPolish(ctx, vi.fn())).resolves.toBe(true);
    expect(addListener).toHaveBeenCalled(); // back button still wired
  });

  it('the plugin loader is bounded, so a hanging import cannot stall the caller', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(join(__dirname, 'nativeShell.ts'), 'utf8');
    const loader = src.slice(src.indexOf('export async function loadNativeShellContext'));
    expect(loader).toContain('withinDeadline');
  });
});
