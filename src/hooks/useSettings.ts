// useSettings — theme, hinglishMode, mode, enabledModules (Task 1.1 module extraction)
// localStorage keys match App.tsx exactly so existing user data is preserved.
import { useState, useEffect } from 'react';
import { ThemeMode } from '../lib/theme';
import type { AgentMode } from '../types';

const DEFAULT_MODULES: Record<string, boolean> = {
  chat: true, history: true, files: true, preview: true, shell: true,
  git: true, logs: true, templates: true, donation: true,
  entertainment: true, studio: true, security: true,
};

export function useSettings() {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('theme') as ThemeMode | null;
    if (saved) return saved;
    // 10.7 — auto-detect system theme on first visit
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [hinglishMode, setHinglishModeState] = useState<boolean>(
    () => localStorage.getItem('navbharat_hinglish') === 'true'
  );
  const [mode, setMode] = useState<AgentMode>('planning');
  const [enabledModules, setEnabledModules] = useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem('navbharat_modules');
    return saved ? { ...DEFAULT_MODULES, ...JSON.parse(saved) } : DEFAULT_MODULES;
  });
  const [isThemePickerOpen, setIsThemePickerOpen] = useState(false);

  const setTheme = (t: ThemeMode) => {
    setThemeState(t);
    localStorage.setItem('theme', t);
  };

  const setHinglishMode = (v: boolean) => {
    setHinglishModeState(v);
    localStorage.setItem('navbharat_hinglish', v.toString());
  };

  useEffect(() => {
    localStorage.setItem('navbharat_modules', JSON.stringify(enabledModules));
  }, [enabledModules]);

  // 10.7 — follow system theme changes (only if user hasn't manually set one)
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
    mode, setMode,
    enabledModules, setEnabledModules,
    isThemePickerOpen, setIsThemePickerOpen,
  };
}
