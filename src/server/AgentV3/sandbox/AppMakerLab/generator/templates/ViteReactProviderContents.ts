import { DESIGN_KIT_CSS } from './designKit';

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
// The design kit lives in ONE place (designKit.ts) so every scaffold ships the same one and they
// cannot drift apart. Re-exported under its original name: nothing that imports `indexCss` changes.
export const indexCss = DESIGN_KIT_CSS;
