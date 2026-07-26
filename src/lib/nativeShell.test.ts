import { describe, it, expect, vi } from 'vitest';
import { isNativeShell, hideSplashScreen, applyStatusBarTheme, triggerHaptic, installBackButtonHandler, installNativeShellPolish, type NativeShellContext } from './nativeShell';

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
    expect(setStyle).toHaveBeenCalledWith('light');
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
