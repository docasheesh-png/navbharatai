export const packageJson = JSON.stringify({
  "name": "project",
  "version": "0.1.0",
  // ShopKhata autopsy 2026-07-17: "type": "module" is LOAD-BEARING, not style. vite.config.ts imports
  // vite-tsconfig-paths, whose newer 5.x builds are ESM-only; without type:module Vite loads the
  // bundled config via require() and the whole dev server dies on boot ("resolved to an ESM file.
  // ESM file cannot be loaded by `require`") — the app never gets a preview. This is also the
  // create-vite standard. The version is EXACT-pinned for the same reason (Decision-A discipline:
  // a ^range let a fresh npm install drift onto an incompatible build the baked sandbox never saw).
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.5.3",
    "vite": "^5.4.1",
    "vite-tsconfig-paths": "5.1.4"
  }
}, null, 2);

export const viteConfig = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Mirror tsconfig's baseUrl/paths into Vite so a root-relative import such as
// \`import { useStore } from 'stores/useStore'\` resolves at BUILD & RUNTIME too — not just in
// tsc. Without this, tsc (baseUrl) resolves it but Vite/esbuild can't, so the app type-checks
// clean yet the preview crashes with "Failed to resolve import". This plugin closes that gap.
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  // Bind to 0.0.0.0 so the dev server is reachable through the cloud sandbox's
  // preview URL (e.g. https://5173-<sandbox>.e2b.app). A localhost-only bind makes
  // the preview show "connection refused" even though the server is running.
  // allowedHosts:true disables Vite's host check — newer Vite otherwise BLOCKS the
  // sandbox proxy host with "Blocked request. This host is not allowed", breaking the preview.
  server: { host: true, port: 5173, allowedHosts: true },
  preview: { host: true, port: 5173, allowedHosts: true },
});
`;

export const tsconfig = JSON.stringify({
  "compilerOptions": {
    "target": "ESNext",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    // ROOT-CAUSE FIX (Kanban build autopsy 2026-07-13): generated code overwhelmingly uses the
    // baseUrl-"src" import convention (e.g. \`from 'stores/useBoardStore'\`, \`from 'types'\`,
    // \`from 'components/ui/Button'\`) — the single most common style LLMs emit. Without a baseUrl the
    // scaffold rejected EVERY such import (TS2307 → TYPECHECK_FAILED) even though the target file was
    // written under src/. baseUrl:"src" makes \`stores/x\` resolve to \`src/stores/x\` (packages still
    // fall through to node_modules); paths adds the \`@/…\` alias many generators also use. Vite mirrors
    // this via the vite-tsconfig-paths plugin above, so it holds at build & runtime, not just in tsc.
    "baseUrl": "src",
    "paths": { "@/*": ["*"] }
  },
  "include": ["src"]
}, null, 2);

export const tsconfigNode = JSON.stringify({
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}, null, 2);

export const indexHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;

export const mainTsx = `import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import ErrorBoundary from './ErrorBoundary';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
`;

// Ships in EVERY vite-react app so a single component crash shows a friendly fallback instead of a
// blank white screen (the #1 "built but the preview is blank" class), and the readiness gate's
// "no error boundary" warning never fires. A real class boundary (getDerivedStateFromError +
// componentDidCatch) — the exact signals ErrorBoundaryAnalysis looks for.
export const errorBoundaryTsx = `import React from 'react';

interface Props { children: React.ReactNode; }
interface State { error: Error | null; }

/** Catches render errors in the tree below so one broken component can't white-screen the whole app. */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) { console.error('App crashed:', error, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '40px auto' }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ color: '#666', marginBottom: 16 }}>{this.state.error.message}</p>
          <button onClick={() => this.setState({ error: null })} style={{ padding: '8px 16px', cursor: 'pointer' }}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
export default ErrorBoundary;
`;

export const appTsx = `function App() {
  return (
    <div>
      <h1>Hello World</h1>
    </div>
  );
}
export default App;
`;

// STARTER GLOBAL STYLESHEET (NotesNest autopsy 2026-07-16): the scaffold used to ship NO stylesheet
// and main.tsx imported none — so when a build's generated CSS never got wired in, the app rendered
// as raw unstyled HTML and nothing anywhere caught it. Shipping index.css + the main.tsx import makes
// "styled" the default by construction: generators OVERWRITE this file's content freely (the import
// is already in place), and a modern base (font stack, box-sizing, color-scheme) is the floor even
// if they never touch it.
// COLOUR-BY-DEFAULT (design autopsy 2026-08-01, "b/w app bani hai, koi colour nahi"): the old starter
// DEFINED --accent but barely USED it — buttons were white cards with grey borders and black text, so
// the baseline every build inherited was essentially black-and-white, and a weak model that lightly
// styled shipped a colourless app. This starter puts REAL, visible colour on the surfaces the eye lands
// on by construction: a saturated brand accent, FILLED primary/submit buttons (white text), coloured
// links, a subtle card shadow and semantic status colours — so even an app the generator barely touches
// looks designed, not raw. Generators still OVERWRITE this file freely; it is the floor, not a ceiling.
export const indexCss = `:root {
  color-scheme: light dark;
  --bg: #f6f7fb;
  --fg: #17171c;
  --muted: #6b7280;
  --accent: #4f46e5;
  --accent-hover: #4338ca;
  --accent-fg: #ffffff;
  --accent-soft: #eef0ff;
  --success: #16a34a;
  --danger: #dc2626;
  --warning: #d97706;
  --card: #ffffff;
  --border: #e5e7eb;
  --radius: 12px;
  --shadow: 0 1px 2px rgba(16, 17, 28, 0.06), 0 8px 24px rgba(16, 17, 28, 0.06);
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d0d12;
    --fg: #ececf1;
    --muted: #9ca3af;
    --accent: #7c74ff;
    --accent-hover: #948dff;
    --accent-soft: #1c1b2e;
    --card: #17171f;
    --border: #2a2a35;
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.35);
  }
}

*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  min-height: 100vh;
  background: var(--bg);
  color: var(--fg);
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans', sans-serif;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

::selection { background: var(--accent); color: var(--accent-fg); }

/* Buttons: the default is a subtle secondary; submit / .primary / .btn-primary get the SATURATED
   brand colour so every form and CTA has visible colour out of the box — never a grey-on-grey button. */
button, .btn {
  font: inherit;
  cursor: pointer;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 9px 16px;
  background: var(--card);
  color: var(--fg);
  transition: background 0.15s, border-color 0.15s, color 0.15s, box-shadow 0.15s;
}
button:hover, .btn:hover { border-color: var(--accent); }

button[type="submit"], .btn-primary, .primary, button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-fg);
  font-weight: 600;
}
button[type="submit"]:hover, .btn-primary:hover, .primary:hover, button.primary:hover {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
  color: var(--accent-fg);
}

input, textarea, select {
  font: inherit;
  color: var(--fg);
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 9px 12px;
}
input:focus-visible, textarea:focus-visible, select:focus-visible, button:focus-visible, a:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

/* A styled card surface so panels never look like raw HTML even before the generator styles them. */
.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px;
  box-shadow: var(--shadow);
}

/* PREMIUM DEFAULTS (M2-S2.1 design system): a small, tasteful component kit so every app looks
   designed out of the box — a floor, not a ceiling (generators override freely). Theme-aware. */

/* Typographic scale — clear hierarchy instead of raw browser <h1..h6>/<p> sizing. */
h1 { font-size: 2rem;    line-height: 1.2;  font-weight: 800; letter-spacing: -0.02em; margin: 0 0 0.5em; }
h2 { font-size: 1.5rem;  line-height: 1.25; font-weight: 700; letter-spacing: -0.01em; margin: 0 0 0.5em; }
h3 { font-size: 1.25rem; line-height: 1.3;  font-weight: 700; margin: 0 0 0.4em; }
h4 { font-size: 1.05rem; line-height: 1.35; font-weight: 600; margin: 0 0 0.4em; }
p  { margin: 0 0 1em; }
small, .muted { color: var(--muted); }

/* Ghost button — a third, quieter action next to the primary/secondary. */
.btn-ghost {
  background: transparent;
  border-color: transparent;
  color: var(--accent);
}
.btn-ghost:hover { background: var(--accent-soft); border-color: transparent; }

/* Badges — small status pills using the semantic colours. */
.badge {
  display: inline-flex; align-items: center; gap: 0.35em;
  font-size: 0.75rem; font-weight: 700; line-height: 1;
  padding: 0.3em 0.6em; border-radius: 999px;
  background: var(--accent-soft); color: var(--accent);
}
.badge-success { background: color-mix(in srgb, var(--success) 15%, transparent); color: var(--success); }
.badge-danger  { background: color-mix(in srgb, var(--danger) 15%, transparent);  color: var(--danger); }
.badge-warning { background: color-mix(in srgb, var(--warning) 15%, transparent); color: var(--warning); }

/* Alerts — a tinted, bordered message block for info/success/error/warning states. */
.alert {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 12px 14px;
  background: var(--card);
}
.alert-success { border-color: var(--success); background: color-mix(in srgb, var(--success) 8%, var(--card)); }
.alert-danger  { border-color: var(--danger);  background: color-mix(in srgb, var(--danger) 8%, var(--card)); }
.alert-warning { border-color: var(--warning); background: color-mix(in srgb, var(--warning) 8%, var(--card)); }

/* Layout helpers — a centred page container and tiny flex utilities so structure is easy and consistent. */
.container { width: 100%; max-width: 1080px; margin-inline: auto; padding-inline: 16px; }
.stack { display: flex; flex-direction: column; gap: 12px; }
.row   { display: flex; align-items: center; gap: 12px; }

/* Labelled field — vertical label + input spacing so forms read cleanly. */
.field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.field > label { font-size: 0.85rem; font-weight: 600; color: var(--muted); }
`;
