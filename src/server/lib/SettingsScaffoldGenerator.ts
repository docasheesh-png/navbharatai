// Roadmap "BUILD NOW #10 (other half)" — settings scaffold recipe (dependency-free React).
//
// The audit's Feature-Completeness gap listed "settings" with no generator. Every real app has a settings
// screen (theme, preferences, account) — hand-rolled each time, usually forgetting persistence and forgetting
// to actually APPLY the theme. This emits a REAL settings scaffold: a SettingsProvider that persists prefs to
// localStorage AND applies the theme to <html data-theme> so dark mode actually works, a useSettings hook,
// and a SettingsPage with grouped sections + working controls (theme select, toggle prefs). Frontend-only, no
// dependency, no env keys. PURE builder → the caller writes the files. Real, complete code — no TODO stubs.

export interface SettingsScaffoldConfig {
  files: Record<string, string>;
  instructions: string;
}

const PROVIDER = `import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';

export type Theme = 'light' | 'dark' | 'system';

export interface Settings {
  theme: Theme;
  emailNotifications: boolean;
  compactMode: boolean;
}

const DEFAULTS: Settings = { theme: 'system', emailNotifications: true, compactMode: false };
const STORAGE_KEY = 'app.settings';

interface SettingsContextValue {
  settings: Settings;
  update: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  reset: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function applyTheme(theme: Theme) {
  if (typeof document === 'undefined') return;
  const resolved =
    theme === 'system'
      ? (typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      : theme;
  document.documentElement.setAttribute('data-theme', resolved);
}

// Provider — loads persisted settings, applies the theme immediately (so dark mode really takes effect), and
// re-persists + re-applies on every change. Wrap your app in this near the root.
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(() => {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
      return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULTS;
    } catch { return DEFAULTS; }
  });

  useEffect(() => {
    applyTheme(settings.theme);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* quota/SSR — ignore */ }
  }, [settings]);

  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);
  const reset = useCallback(() => setSettings(DEFAULTS), []);

  return <SettingsContext.Provider value={{ settings, update, reset }}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within a <SettingsProvider>');
  return ctx;
}
`;

const PAGE = `import { useSettings, type Theme } from './SettingsProvider';

// A real settings page: grouped sections with working controls wired to the SettingsProvider. Every change
// persists and (for theme) applies immediately. Extend with your own sections (Account, Billing, …).
export function SettingsPage() {
  const { settings, update, reset } = useSettings();

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: 24 }}>
      <h1>Settings</h1>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 16 }}>Appearance</h2>
        <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0' }}>
          <span>Theme</span>
          <select
            value={settings.theme}
            onChange={(e) => update('theme', e.target.value as Theme)}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0' }}>
          <span>Compact mode</span>
          <input type="checkbox" checked={settings.compactMode} onChange={(e) => update('compactMode', e.target.checked)} />
        </label>
      </section>

      <section style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 16 }}>Notifications</h2>
        <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0' }}>
          <span>Email notifications</span>
          <input type="checkbox" checked={settings.emailNotifications} onChange={(e) => update('emailNotifications', e.target.checked)} />
        </label>
      </section>

      <button type="button" onClick={reset} style={{ marginTop: 24 }}>Reset to defaults</button>
    </div>
  );
}
`;

const INSTRUCTIONS =
  'Settings scaffold wired at src/settings/SettingsProvider.tsx + SettingsPage.tsx (dependency-free React). ' +
  'Wrap your app near the root in <SettingsProvider> — it persists preferences to localStorage AND applies ' +
  "the theme to <html data-theme> so dark mode actually works (target it in CSS with :root[data-theme='dark']). " +
  'Render <SettingsPage /> on a /settings route: it has grouped sections (Appearance: theme + compact mode; ' +
  'Notifications: email toggle) with working controls that persist on change, plus a Reset. Read a preference ' +
  'anywhere with const { settings } = useSettings(). Extend with your own sections. No env key.';

export function generateSettingsScaffoldIntegration(): SettingsScaffoldConfig {
  return {
    files: {
      'src/settings/SettingsProvider.tsx': PROVIDER,
      'src/settings/SettingsPage.tsx': PAGE,
    },
    instructions: INSTRUCTIONS,
  };
}
