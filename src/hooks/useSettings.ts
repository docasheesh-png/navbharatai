// useSettings — theme, hinglishMode, mode, enabledModules (Task 1.1 module extraction)
// localStorage keys match App.tsx exactly so existing user data is preserved.
import { useState, useEffect } from 'react';
import { ThemeMode, normalizeThemeMode } from '../lib/theme';
import type { AgentMode } from '../types';
import { safeLocalJson } from '../lib/safeLocalJson';

const DEFAULT_MODULES: Record<string, boolean> = {
  chat: true, history: true, files: true, preview: true, shell: true,
  git: true, logs: true, templates: true, donation: true,
  studio: true, security: true,
};

export type PreferredLanguage = 'hindi' | 'hinglish' | 'english' | 'auto';

export function useSettings() {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    const raw = localStorage.getItem('theme');
    const saved = normalizeThemeMode(raw);
    // A retired theme name (dim / comfort) is carried to its successor AND written back, so the
    // migration happens once per device instead of on every load — and so the pre-paint script in
    // index.html, which reads the same key, stamps a theme that exists on the next visit.
    if (saved && saved !== raw) localStorage.setItem('theme', saved);
    if (saved) return saved;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [hinglishMode, setHinglishModeState] = useState<boolean>(
    () => localStorage.getItem('navbharat_hinglish') === 'true'
  );
  const [preferredLanguage, setPreferredLanguageState] = useState<PreferredLanguage | null>(() => {
    const saved = localStorage.getItem('navbharat_language') as PreferredLanguage | null;
    return saved || null;
  });
  const [mode, setMode] = useState<AgentMode>('auto');
  const [enabledModules, setEnabledModules] = useState<Record<string, boolean>>(() =>
    ({ ...DEFAULT_MODULES, ...safeLocalJson<Record<string, boolean>>('navbharat_modules', {}) }));
  const [isThemePickerOpen, setIsThemePickerOpen] = useState(false);

  const setTheme = (t: ThemeMode) => {
    setThemeState(t);
    localStorage.setItem('theme', t);
  };

  const setHinglishMode = (v: boolean) => {
    setHinglishModeState(v);
    localStorage.setItem('navbharat_hinglish', v.toString());
  };

  const setPreferredLanguage = (v: PreferredLanguage) => {
    setPreferredLanguageState(v);
    localStorage.setItem('navbharat_language', v);
  };

  useEffect(() => {
    localStorage.setItem('navbharat_modules', JSON.stringify(enabledModules));
  }, [enabledModules]);

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const handler = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem('theme')) {
        setThemeState(e.matches ? 'dark' : 'light');
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return {
    theme, setTheme,
    hinglishMode, setHinglishMode,
    preferredLanguage, setPreferredLanguage,
    mode, setMode,
    enabledModules, setEnabledModules,
    isThemePickerOpen, setIsThemePickerOpen,
  };
}
