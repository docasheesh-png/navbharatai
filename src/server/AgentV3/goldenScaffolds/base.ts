// AgentV3 — Golden Scaffolds: shared base files (admin 2026-08-02, "starter apps pre-built & instant").
//
// Every golden scaffold app sits on the SAME base the platform's vite-react scaffold ships
// (ViteReactProviderContents) — package.json pins, vite/tsconfig, ErrorBoundary, the coloured
// index.css design system. Reusing those exports (instead of copying them) means a scaffold can
// never drift from the platform: when the base scaffold is improved, every golden app inherits it.
//
// SIZE NOTE (admin: "app ka size improve na ho"): this whole goldenScaffolds/ directory is
// SERVER-ONLY code — it is imported exclusively from the server build path, so the client bundle
// (the app users download / the Play Store build) grows by ZERO bytes. Only the Cloud Run server
// image carries these template strings (a few tens of KB of text).

import {
  packageJson, viteConfig, tsconfig, tsconfigNode, indexHtml, mainTsx, errorBoundaryTsx, indexCss,
} from '../sandbox/AppMakerLab/generator/templates/ViteReactProviderContents';

/**
 * Shared theme toggle every golden app can use: cycles auto → light → dark, persists the choice, and
 * overrides the index.css variables via a data-theme attribute (the base css only follows the system
 * preference). Shipped as its own file so App.tsx stays focused on the app itself.
 */
export const themeTsx = `import { useEffect, useState } from 'react';

// Explicit light/dark variable overrides — the base index.css follows the SYSTEM preference; setting
// data-theme on <html> pins the app to one side regardless of the device setting.
const OVERRIDES = [
  "[data-theme='light']{--bg:#f6f7fb;--fg:#17171c;--muted:#6b7280;--accent:#4f46e5;--accent-hover:#4338ca;--accent-soft:#eef0ff;--card:#ffffff;--border:#e5e7eb;color-scheme:light;}",
  "[data-theme='dark']{--bg:#0d0d12;--fg:#ececf1;--muted:#9ca3af;--accent:#7c74ff;--accent-hover:#948dff;--accent-soft:#1c1b2e;--card:#17171f;--border:#2a2a35;color-scheme:dark;}",
].join('');

type Mode = 'auto' | 'light' | 'dark';

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>(() => {
    const saved = localStorage.getItem('theme');
    return saved === 'light' || saved === 'dark' ? saved : 'auto';
  });
  useEffect(() => {
    if (mode === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', mode);
    localStorage.setItem('theme', mode);
  }, [mode]);
  const next: Record<Mode, Mode> = { auto: 'light', light: 'dark', dark: 'auto' };
  const icon = mode === 'light' ? 'Light' : mode === 'dark' ? 'Dark' : 'Auto';
  return (
    <>
      <style>{OVERRIDES}</style>
      <button onClick={() => setMode(next[mode])} title={'Theme: ' + mode} aria-label="Toggle light/dark theme" style={{ padding: '6px 12px', fontSize: 13 }}>
        {icon}
      </button>
    </>
  );
}
export default ThemeToggle;
`;

const viteEnvDts = `/// <reference types="vite/client" />
`;

/**
 * The complete runnable file set for one golden app: the platform base + this app's App.tsx.
 * `title` lands in index.html's <title>. Pure — same inputs, same files.
 */
export function goldenBaseFiles(title: string, appTsx: string): Record<string, string> {
  return {
    'package.json': packageJson,
    'vite.config.ts': viteConfig,
    'tsconfig.json': tsconfig,
    'tsconfig.node.json': tsconfigNode,
    'index.html': indexHtml.replace('<title>App</title>', `<title>${title}</title>`),
    'src/vite-env.d.ts': viteEnvDts,
    'src/index.css': indexCss,
    'src/main.tsx': mainTsx,
    'src/ErrorBoundary.tsx': errorBoundaryTsx,
    'src/theme.tsx': themeTsx,
    'src/App.tsx': appTsx,
  };
}
