import { useEffect, useState } from 'react';

// Explicit light/dark variable overrides — the base index.css follows the SYSTEM preference; setting
// data-theme on <html> pins the app to one side regardless of the device setting.
const OVERRIDES = [
  "[data-theme='light']{--bg:#f6f7fb;--fg:#17171c;--muted:#6b7280;--accent:#4f46e5;--accent-hover:#4338ca;--accent-soft:#eef0ff;--accent-ink:#4338ca;--accent-strong:#4f46e5;--accent-deep:#4338ca;--danger-ink:#b91c1c;--success-ink:#166534;--card:#ffffff;--border:#e5e7eb;color-scheme:light;}",
  "[data-theme='dark']{--bg:#0d0d12;--fg:#ececf1;--muted:#9ca3af;--accent:#7c74ff;--accent-hover:#948dff;--accent-soft:#1c1b2e;--accent-ink:#c4c0ff;--accent-strong:#5b52e0;--accent-deep:#4a3fd6;--danger-ink:#fca5a5;--success-ink:#86efac;--card:#17171f;--border:#2a2a35;color-scheme:dark;}",
].join('');

type Mode = 'auto' | 'light' | 'dark';

export function ThemeToggle() {
  // Storage can be switched off (a private window, a sandboxed frame): reading it then throws, and a throw
  // in the first render blanks the whole app. The choice just is not remembered.
  const [mode, setMode] = useState<Mode>(() => {
    try {
      const saved = localStorage.getItem('theme');
      return saved === 'light' || saved === 'dark' ? saved : 'auto';
    } catch { return 'auto'; }
  });
  useEffect(() => {
    if (mode === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', mode);
    try { localStorage.setItem('theme', mode); } catch { /* storage blocked — the choice lasts this visit */ }
  }, [mode]);
  const next: Record<Mode, Mode> = { auto: 'light', light: 'dark', dark: 'auto' };
  // The icon AND the word: "Auto" alone did not read as a light/dark switch, and a builder replaced it
  // with a hand-rolled one that styled nothing (autopsy 8257ca59).
  const icon = mode === 'light' ? '☀️ Light' : mode === 'dark' ? '🌙 Dark' : '🌓 Auto';
  return (
    <>
      <style>{OVERRIDES}</style>
      <button onClick={() => setMode(next[mode])} title={'Theme: ' + mode + ' (tap to change)'} aria-label="Toggle light/dark theme" style={{ padding: '8px 14px', fontSize: 14, minHeight: 40 }}>
        {icon}
      </button>
    </>
  );
}
export default ThemeToggle;
