/**
 * Phase 4 — Framework scaffolds.
 *
 * For a FRESH build, seeding a real, runnable project skeleton before the AI
 * generates feature code dramatically improves reliability for complex apps:
 * the model edits a working foundation (correct package.json, entry point,
 * build config, wiring) instead of inventing all of it from scratch and often
 * leaving dangling references.
 *
 * `detectFramework(prompt)` picks a skeleton from the request; `scaffold(vfs,
 * framework)` writes the skeleton files INTO an empty VFS only (it never
 * overwrites an existing project). The chosen framework is surfaced so the
 * generator prompt can tell the model what foundation it is building on.
 */
import type { VirtualFileSystem } from './ProjectModel';

export type Framework = 'vite-react' | 'vite-react-ts' | 'vite-vue' | 'vite-svelte' | 'static';

const REACT_HINTS = [
  'react', 'vite', 'jsx', 'tsx', 'component', 'spa', 'single page',
  'dashboard', 'router', 'usestate', 'hook',
];

/** Does the prompt explicitly ask for TypeScript? */
function wantsTypeScript(p: string): boolean {
  return /\btypescript\b|\bts\b|\.tsx?\b|\btsx\b/i.test(p);
}

/** Explicit Vue request — must be checked before React. */
function wantsVue(p: string): boolean {
  return /\bvue(\.?js| 3| three)?\b|\bvuejs\b|\bpinia\b|\bvue-router\b|\bnuxt\b/i.test(p);
}

/** Explicit Svelte request — checked before React/Vue. */
function wantsSvelte(p: string): boolean {
  return /\bsvelte(\.?js| kit| store| 4| 5)?\b|\bsveltekit\b/i.test(p);
}

/** Heuristically choose a starting framework from the user's prompt. */
export function detectFramework(prompt: string): Framework {
  const p = (prompt || '').toLowerCase();
  // Svelte first (explicit keyword only).
  if (wantsSvelte(p)) return 'vite-svelte';
  // Vue second (explicit request only) — even "vue dashboard" must pick Vue, not React.
  if (wantsVue(p)) return 'vite-vue';
  // Explicit "plain html"/"static" requests stay static.
  if (/\b(plain|static|simple|landing page|single html|one html)\b/.test(p)) {
    // ...unless they also explicitly asked for react.
    if (!/\breact\b/.test(p)) return 'static';
  }
  const isReact = REACT_HINTS.some((h) => p.includes(h));
  if (!isReact) return 'static';
  return wantsTypeScript(prompt) ? 'vite-react-ts' : 'vite-react';
}

const VITE_REACT_FILES: Record<string, string> = {
  'package.json': JSON.stringify(
    {
      name: 'app',
      private: true,
      version: '0.0.0',
      type: 'module',
      scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
      dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' },
      devDependencies: {
        '@vitejs/plugin-react': '^4.3.1',
        vite: '^5.4.0',
      },
    },
    null,
    2,
  ) + '\n',
  'vite.config.js':
    `import { defineConfig } from 'vite';\n` +
    `import react from '@vitejs/plugin-react';\n\n` +
    `export default defineConfig({ plugins: [react()] });\n`,
  'index.html':
    `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n` +
    `    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n` +
    `    <title>App</title>\n  </head>\n  <body>\n    <div id="root"></div>\n` +
    `    <script type="module" src="/src/main.jsx"></script>\n  </body>\n</html>\n`,
  'src/main.jsx':
    `import React from 'react';\n` +
    `import { createRoot } from 'react-dom/client';\n` +
    `import App from './App.jsx';\n` +
    `import './index.css';\n\n` +
    `createRoot(document.getElementById('root')).render(\n` +
    `  <React.StrictMode>\n    <App />\n  </React.StrictMode>,\n);\n`,
  'src/App.jsx':
    `export default function App() {\n` +
    `  return <h1>Hello from App</h1>;\n` +
    `}\n`,
  'src/index.css':
    `:root { font-family: system-ui, sans-serif; }\n` +
    `body { margin: 0; }\n`,
};

const VITE_REACT_TS_FILES: Record<string, string> = {
  'package.json': JSON.stringify(
    {
      name: 'app',
      private: true,
      version: '0.0.0',
      type: 'module',
      scripts: { dev: 'vite', build: 'tsc -b && vite build', preview: 'vite preview' },
      dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' },
      devDependencies: {
        '@types/react': '^18.3.3',
        '@types/react-dom': '^18.3.0',
        '@vitejs/plugin-react': '^4.3.1',
        typescript: '^5.5.3',
        vite: '^5.4.0',
      },
    },
    null,
    2,
  ) + '\n',
  'vite.config.ts':
    `import { defineConfig } from 'vite';\n` +
    `import react from '@vitejs/plugin-react';\n\n` +
    `export default defineConfig({ plugins: [react()] });\n`,
  'tsconfig.json': JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2020', useDefineForClassFields: true, lib: ['ES2020', 'DOM', 'DOM.Iterable'],
        module: 'ESNext', skipLibCheck: true, moduleResolution: 'bundler',
        allowImportingTsExtensions: true, resolveJsonModule: true, isolatedModules: true,
        noEmit: true, jsx: 'react-jsx', strict: true,
      },
      include: ['src'],
    },
    null,
    2,
  ) + '\n',
  'index.html':
    `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n` +
    `    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n` +
    `    <title>App</title>\n  </head>\n  <body>\n    <div id="root"></div>\n` +
    `    <script type="module" src="/src/main.tsx"></script>\n  </body>\n</html>\n`,
  'src/main.tsx':
    `import React from 'react';\n` +
    `import { createRoot } from 'react-dom/client';\n` +
    `import App from './App';\n` +
    `import './index.css';\n\n` +
    `createRoot(document.getElementById('root')!).render(\n` +
    `  <React.StrictMode>\n    <App />\n  </React.StrictMode>,\n);\n`,
  'src/App.tsx':
    `export default function App() {\n` +
    `  return <h1>Hello from App</h1>;\n` +
    `}\n`,
  'src/index.css':
    `:root { font-family: system-ui, sans-serif; }\n` +
    `body { margin: 0; }\n`,
};

const VITE_VUE_FILES: Record<string, string> = {
  'package.json': JSON.stringify(
    {
      name: 'app',
      private: true,
      version: '0.0.0',
      type: 'module',
      scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
      dependencies: { vue: '^3.4.0' },
      devDependencies: {
        '@vitejs/plugin-vue': '^5.1.0',
        vite: '^5.4.0',
      },
    },
    null,
    2,
  ) + '\n',
  'vite.config.js':
    `import { defineConfig } from 'vite';\n` +
    `import vue from '@vitejs/plugin-vue';\n\n` +
    `export default defineConfig({ plugins: [vue()] });\n`,
  'index.html':
    `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n` +
    `    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n` +
    `    <title>App</title>\n  </head>\n  <body>\n    <div id="app"></div>\n` +
    `    <script type="module" src="/src/main.js"></script>\n  </body>\n</html>\n`,
  'src/main.js':
    `import { createApp } from 'vue';\n` +
    `import App from './App.vue';\n` +
    `import './style.css';\n\n` +
    `createApp(App).mount('#app');\n`,
  'src/App.vue':
    `<template>\n  <h1>Hello from App</h1>\n</template>\n\n` +
    `<script setup>\n</script>\n\n` +
    `<style scoped>\n</style>\n`,
  'src/style.css':
    `:root { font-family: system-ui, sans-serif; }\n` +
    `body { margin: 0; }\n`,
};

const VITE_SVELTE_FILES: Record<string, string> = {
  'package.json': JSON.stringify(
    {
      name: 'app',
      private: true,
      version: '0.0.0',
      type: 'module',
      scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
      dependencies: { svelte: '^4.2.19' },
      devDependencies: {
        '@sveltejs/vite-plugin-svelte': '^3.1.2',
        vite: '^5.4.0',
      },
    },
    null,
    2,
  ) + '\n',
  'vite.config.js':
    `import { defineConfig } from 'vite';\n` +
    `import { svelte } from '@sveltejs/vite-plugin-svelte';\n\n` +
    `export default defineConfig({ plugins: [svelte()] });\n`,
  'index.html':
    `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n` +
    `    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n` +
    `    <title>App</title>\n  </head>\n  <body>\n    <div id="app"></div>\n` +
    `    <script type="module" src="/src/main.js"></script>\n  </body>\n</html>\n`,
  'src/main.js':
    `import App from './App.svelte';\n` +
    `import './app.css';\n\n` +
    `const app = new App({ target: document.getElementById('app') });\n` +
    `export default app;\n`,
  'src/App.svelte':
    `<script>\n  let count = 0;\n</script>\n\n` +
    `<main>\n  <h1>Hello from Svelte</h1>\n` +
    `  <button on:click={() => count++}>Clicked {count} times</button>\n</main>\n\n` +
    `<style>\n  main { font-family: system-ui, sans-serif; }\n</style>\n`,
  'src/app.css':
    `body { margin: 0; }\n`,
};

const STATIC_FILES: Record<string, string> = {
  'index.html':
    `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n` +
    `    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n` +
    `    <title>App</title>\n    <link rel="stylesheet" href="styles.css" />\n` +
    `  </head>\n  <body>\n    <main id="app"></main>\n` +
    `    <script src="app.js"></script>\n  </body>\n</html>\n`,
  'styles.css':
    `:root { font-family: system-ui, sans-serif; }\n` +
    `body { margin: 0; }\n`,
  'app.js':
    `document.getElementById('app').innerHTML = '<h1>Hello</h1>';\n`,
};

const SKELETONS: Record<Framework, Record<string, string>> = {
  'vite-react': VITE_REACT_FILES,
  'vite-react-ts': VITE_REACT_TS_FILES,
  'vite-vue': VITE_VUE_FILES,
  'vite-svelte': VITE_SVELTE_FILES,
  static: STATIC_FILES,
};

/**
 * Seed a framework skeleton into an EMPTY vfs. Returns the framework that was
 * applied, or null if the project already had files (never overwrites).
 */
export function scaffold(vfs: VirtualFileSystem, framework: Framework): Framework | null {
  if (vfs.count > 0) return null;
  const files = SKELETONS[framework];
  for (const [path, content] of Object.entries(files)) {
    vfs.write(path, content);
  }
  return framework;
}

/** One-line description of the seeded foundation, for the generator prompt. */
export function scaffoldSummary(framework: Framework): string {
  if (framework === 'vite-react-ts')
    return 'a Vite + React + TypeScript project: index.html → src/main.tsx → src/App.tsx, tsconfig.json, styles in src/index.css';
  if (framework === 'vite-react')
    return 'a Vite + React (JSX) project: index.html → src/main.jsx → src/App.jsx, styles in src/index.css, deps in package.json';
  if (framework === 'vite-vue')
    return 'a Vite + Vue 3 project: index.html → src/main.js → src/App.vue (SFC, <script setup>), styles in src/style.css, deps in package.json';
  if (framework === 'vite-svelte')
    return 'a Vite + Svelte 4 project: index.html → src/main.js → src/App.svelte (SFC, on: events), styles in src/app.css, deps in package.json';
  return 'a plain static project: index.html + styles.css + app.js';
}
