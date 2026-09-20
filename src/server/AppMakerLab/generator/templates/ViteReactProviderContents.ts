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
    // 🔴 VITE 8 / PLUGIN-REACT 5 — a SECURITY pin, not a version-chase (autopsy 31dc61fd, 2026-09-20).
    //
    // `^5.4.1` resolves to 5.4.21, the LAST 5.4.x, and it still carries advisories — so
    // `npm audit fix` (compatible-only, which is what AGENTV3_AUDIT_FIX runs) could NEVER clear
    // them. Every vite-react app we generated shipped them. MEASURED on this exact scaffold:
    //
    //     before: 2 vulnerabilities (1 high, 1 moderate)   ← vite path traversal, esbuild dev server
    //     after : 0 vulnerabilities
    //
    // ⚠️ AND THEY ARE NOT MERELY COSMETIC HERE. They are dev-server flaws — path traversal in
    // optimized-deps `.map` files and a `server.fs.deny` bypass — and NavBharatAI publishes the vite
    // DEV SERVER on a public preview host. A dev-server path traversal on a publicly reachable port
    // is exposure of the sandbox filesystem, not a lint.
    //
    // 🔒 PROVEN, NOT ASSUMED, before it was written: this scaffold was emitted to disk verbatim and
    // built on the new pins — `npm run build` clean (and faster, 947ms → 444ms), `npm run dev` boots
    // and serves HTTP 200 with #root and the module script, and `vite-tsconfig-paths@5.1.4` (exact-
    // pinned above, load-bearing) still resolves. Node in the sandbox image is `node:22-bookworm`,
    // which satisfies vite 8's `^20.19.0 || >=22.12.0`.
    //
    // ⚠️ Vite 8 supports tsconfig paths natively (`resolve.tsconfigPaths: true`) and says so in a
    // startup notice. The plugin is DELIBERATELY kept: dropping it is a second change with its own
    // risk, and this one is about the advisories. Follow-up, not scope creep.
    "@vitejs/plugin-react": "^5.2.0",
    "typescript": "^5.5.3",
    "vite": "^8.3.0",
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
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
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
