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

export type Framework = 'vite-react' | 'vite-react-ts' | 'vite-vue' | 'vite-svelte' | 'vite-pocketbase' | 'vite-convex' | 'static';

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

/** Explicit PocketBase request. */
function wantsPocketBase(p: string): boolean {
  return /\bpocketbase\b|\bpocket.?base\b/i.test(p);
}

/** Explicit Convex request. */
function wantsConvex(p: string): boolean {
  return /\bconvex(\.?dev)?\b/i.test(p);
}

/** Heuristically choose a starting framework from the user's prompt. */
export function detectFramework(prompt: string): Framework {
  const p = (prompt || '').toLowerCase();
  // PocketBase / Convex — explicit keywords only, checked before React.
  if (wantsPocketBase(p)) return 'vite-pocketbase';
  if (wantsConvex(p)) return 'vite-convex';
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
        autoprefixer: '^10.4.20',
        postcss: '^8.4.47',
        tailwindcss: '^3.4.14',
        vite: '^5.4.0',
      },
    },
    null,
    2,
  ) + '\n',
  // Tailwind bundled into the scaffold (deps + config + @tailwind) — see the vite-react-ts note.
  'postcss.config.js':
    `export default {\n  plugins: {\n    tailwindcss: {},\n    autoprefixer: {},\n  },\n};\n`,
  'tailwind.config.js':
    `/** @type {import('tailwindcss').Config} */\n` +
    `export default {\n  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],\n  theme: { extend: {} },\n  plugins: [],\n};\n`,
  'vite.config.js':
    `import { defineConfig } from 'vite';\n` +
    `import react from '@vitejs/plugin-react';\n\n` +
    `export default defineConfig({\n` +
    `  plugins: [react()],\n` +
    // host:true binds 0.0.0.0 so the cloud-sandbox preview URL is reachable (not just localhost);
    // strictPort stops the silent 5173→5174 drift that points the preview at a dead port; allowedHosts
    // lets the sandbox proxy host through (newer Vite blocks it with "Blocked request … is not allowed").
    `  server: { host: true, port: 5173, strictPort: true, allowedHosts: true },\n` +
    `  preview: { allowedHosts: true },\n` +
    `});\n`,
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
    `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n` +
    `:root { font-family: system-ui, sans-serif; }\n` +
    `body { margin: 0; }\n`,
  // The generator often writes .tsx + CSS-Module imports even in this JS scaffold, and the verify
  // gate runs `tsc --noEmit`. These ambient types stop the recurring `TS2307: Cannot find module
  // '*.module.css'` from tripping the auto-repair loop.
  'src/vite-env.d.ts':
    `/// <reference types="vite/client" />\n` +
    `declare module '*.module.css' { const classes: { readonly [key: string]: string }; export default classes; }\n` +
    `declare module '*.module.scss' { const classes: { readonly [key: string]: string }; export default classes; }\n` +
    `declare module '*.css';\n`,
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
        autoprefixer: '^10.4.20',
        postcss: '^8.4.47',
        tailwindcss: '^3.4.14',
        typescript: '^5.5.3',
        vite: '^5.4.0',
      },
    },
    null,
    2,
  ) + '\n',
  // Tailwind is bundled INTO the scaffold (deps + config + @tailwind directives) because nearly every
  // generated React app uses Tailwind classes. Without it pre-installed, `npm run dev` crashed with
  // "Cannot find module 'tailwindcss'" (PostCSS) and the preview was unstyled. Present-but-unused is harmless.
  'postcss.config.js':
    `export default {\n  plugins: {\n    tailwindcss: {},\n    autoprefixer: {},\n  },\n};\n`,
  'tailwind.config.js':
    `/** @type {import('tailwindcss').Config} */\n` +
    `export default {\n  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],\n  theme: { extend: {} },\n  plugins: [],\n};\n`,
  'vite.config.ts':
    `import { defineConfig } from 'vite';\n` +
    `import react from '@vitejs/plugin-react';\n\n` +
    `export default defineConfig({\n` +
    `  plugins: [react()],\n` +
    // host:true binds 0.0.0.0 so the cloud-sandbox preview URL is reachable (not just localhost);
    // strictPort stops the silent 5173→5174 drift that points the preview at a dead port; allowedHosts
    // lets the sandbox proxy host through (newer Vite blocks it with "Blocked request … is not allowed").
    `  server: { host: true, port: 5173, strictPort: true, allowedHosts: true },\n` +
    `  preview: { allowedHosts: true },\n` +
    `});\n`,
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
    `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n` +
    `:root { font-family: system-ui, sans-serif; }\n` +
    `body { margin: 0; }\n`,
  // Ambient types so `import styles from './X.module.css'` (CSS Modules) and asset imports type-check
  // under `tsc --noEmit`. Without this the verify gate hits `TS2307: Cannot find module '*.module.css'`
  // for every CSS-Module import the generator writes — a recurring, avoidable repair-loop trigger.
  'src/vite-env.d.ts':
    `/// <reference types="vite/client" />\n` +
    `declare module '*.module.css' { const classes: { readonly [key: string]: string }; export default classes; }\n` +
    `declare module '*.module.scss' { const classes: { readonly [key: string]: string }; export default classes; }\n` +
    `declare module '*.css';\n`,
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
    `export default defineConfig({\n` +
    `  plugins: [vue()],\n` +
    `  server: { host: true, port: 5173, strictPort: true, allowedHosts: true },\n` +
    `  preview: { allowedHosts: true },\n` +
    `});\n`,
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
    `export default defineConfig({\n` +
    `  plugins: [svelte()],\n` +
    `  server: { host: true, port: 5173, strictPort: true, allowedHosts: true },\n` +
    `  preview: { allowedHosts: true },\n` +
    `});\n`,
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

const VITE_POCKETBASE_FILES: Record<string, string> = {
  'package.json': JSON.stringify(
    {
      name: 'app',
      private: true,
      version: '0.0.0',
      type: 'module',
      scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
      dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1', pocketbase: '^0.21.0' },
      devDependencies: { '@vitejs/plugin-react': '^4.3.1', vite: '^5.4.0' },
    },
    null,
    2,
  ) + '\n',
  'vite.config.js':
    `import { defineConfig } from 'vite';\n` +
    `import react from '@vitejs/plugin-react';\n\n` +
    `export default defineConfig({\n` +
    `  plugins: [react()],\n` +
    // host:true binds 0.0.0.0 so the cloud-sandbox preview URL is reachable (not just localhost);
    // strictPort stops the silent 5173→5174 drift that points the preview at a dead port; allowedHosts
    // lets the sandbox proxy host through (newer Vite blocks it with "Blocked request … is not allowed").
    `  server: { host: true, port: 5173, strictPort: true, allowedHosts: true },\n` +
    `  preview: { allowedHosts: true },\n` +
    `});\n`,
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
    `import { useState, useEffect } from 'react';\n` +
    `import { pb } from './lib/pb.js';\n\n` +
    `export default function App() {\n` +
    `  const [records, setRecords] = useState([]);\n` +
    `  const [user, setUser] = useState(pb.authStore.model);\n\n` +
    `  useEffect(() => {\n` +
    `    pb.authStore.onChange((token, model) => setUser(model));\n` +
    `  }, []);\n\n` +
    `  async function login(email, password) {\n` +
    `    await pb.collection('users').authWithPassword(email, password);\n` +
    `  }\n\n` +
    `  async function fetchItems() {\n` +
    `    const result = await pb.collection('items').getList(1, 20);\n` +
    `    setRecords(result.items);\n` +
    `  }\n\n` +
    `  if (!user) {\n` +
    `    return (\n` +
    `      <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>\n` +
    `        <h1>PocketBase App</h1>\n` +
    `        <p>Sign in to continue.</p>\n` +
    `        <button onClick={() => login('test@example.com', 'password123')}>Login</button>\n` +
    `        <p style={{ color: '#888', fontSize: '0.8rem' }}>\n` +
    `          Connect your PocketBase server via VITE_PB_URL in .env\n` +
    `        </p>\n` +
    `      </div>\n` +
    `    );\n` +
    `  }\n\n` +
    `  return (\n` +
    `    <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>\n` +
    `      <h1>Hello, {user.email}</h1>\n` +
    `      <button onClick={fetchItems}>Load Items</button>\n` +
    `      <button onClick={() => pb.authStore.clear()}>Logout</button>\n` +
    `      <ul>{records.map(r => <li key={r.id}>{r.id}</li>)}</ul>\n` +
    `    </div>\n` +
    `  );\n` +
    `}\n`,
  'src/lib/pb.js':
    `import PocketBase from 'pocketbase';\n\n` +
    `const url = import.meta.env.VITE_PB_URL || 'http://127.0.0.1:8090';\n` +
    `export const pb = new PocketBase(url);\n`,
  'src/index.css':
    `:root { font-family: system-ui, sans-serif; }\nbody { margin: 0; }\n`,
  '.env.example':
    `# PocketBase server URL\nVITE_PB_URL=https://your-project.pocketbase.io\n`,
};

const VITE_CONVEX_FILES: Record<string, string> = {
  'package.json': JSON.stringify(
    {
      name: 'app',
      private: true,
      version: '0.0.0',
      type: 'module',
      scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
      dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1', convex: '^1.13.0' },
      devDependencies: { '@vitejs/plugin-react': '^4.3.1', vite: '^5.4.0' },
    },
    null,
    2,
  ) + '\n',
  'vite.config.js':
    `import { defineConfig } from 'vite';\n` +
    `import react from '@vitejs/plugin-react';\n\n` +
    `export default defineConfig({\n` +
    `  plugins: [react()],\n` +
    // host:true binds 0.0.0.0 so the cloud-sandbox preview URL is reachable (not just localhost);
    // strictPort stops the silent 5173→5174 drift that points the preview at a dead port; allowedHosts
    // lets the sandbox proxy host through (newer Vite blocks it with "Blocked request … is not allowed").
    `  server: { host: true, port: 5173, strictPort: true, allowedHosts: true },\n` +
    `  preview: { allowedHosts: true },\n` +
    `});\n`,
  'index.html':
    `<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="UTF-8" />\n` +
    `    <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n` +
    `    <title>App</title>\n  </head>\n  <body>\n    <div id="root"></div>\n` +
    `    <script type="module" src="/src/main.jsx"></script>\n  </body>\n</html>\n`,
  'src/main.jsx':
    `import React from 'react';\n` +
    `import { createRoot } from 'react-dom/client';\n` +
    `import { ConvexProvider, ConvexReactClient } from 'convex/react';\n` +
    `import App from './App.jsx';\n` +
    `import './index.css';\n\n` +
    `const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL || '');\n\n` +
    `createRoot(document.getElementById('root')).render(\n` +
    `  <React.StrictMode>\n` +
    `    <ConvexProvider client={convex}>\n` +
    `      <App />\n` +
    `    </ConvexProvider>\n` +
    `  </React.StrictMode>,\n` +
    `);\n`,
  'src/App.jsx':
    `import { useQuery, useMutation } from 'convex/react';\n` +
    `import { api } from '../convex/_generated/api';\n\n` +
    `export default function App() {\n` +
    `  const tasks = useQuery(api.tasks.list);\n` +
    `  const addTask = useMutation(api.tasks.add);\n\n` +
    `  return (\n` +
    `    <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>\n` +
    `      <h1>Convex Tasks</h1>\n` +
    `      <button onClick={() => addTask({ text: 'New task' })}>Add Task</button>\n` +
    `      <ul>\n` +
    `        {tasks?.map(t => <li key={t._id}>{t.text}</li>)}\n` +
    `      </ul>\n` +
    `      {!import.meta.env.VITE_CONVEX_URL && (\n` +
    `        <p style={{ color: '#888', fontSize: '0.8rem' }}>\n` +
    `          Run <code>npx convex dev</code> and set VITE_CONVEX_URL in .env\n` +
    `        </p>\n` +
    `      )}\n` +
    `    </div>\n` +
    `  );\n` +
    `}\n`,
  'src/index.css':
    `:root { font-family: system-ui, sans-serif; }\nbody { margin: 0; }\n`,
  'convex/schema.ts':
    `import { defineSchema, defineTable } from 'convex/server';\n` +
    `import { v } from 'convex/values';\n\n` +
    `export default defineSchema({\n` +
    `  tasks: defineTable({\n` +
    `    text: v.string(),\n` +
    `    completed: v.boolean(),\n` +
    `  }),\n` +
    `});\n`,
  'convex/tasks.ts':
    `import { query, mutation } from './_generated/server';\n` +
    `import { v } from 'convex/values';\n\n` +
    `export const list = query({\n` +
    `  handler: async (ctx) => ctx.db.query('tasks').collect(),\n` +
    `});\n\n` +
    `export const add = mutation({\n` +
    `  args: { text: v.string() },\n` +
    `  handler: async (ctx, args) => {\n` +
    `    await ctx.db.insert('tasks', { text: args.text, completed: false });\n` +
    `  },\n` +
    `});\n`,
  '.env.example':
    `# Get this URL from: npx convex dev (first run)\nVITE_CONVEX_URL=https://your-project.convex.cloud\n`,
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
  'vite-pocketbase': VITE_POCKETBASE_FILES,
  'vite-convex': VITE_CONVEX_FILES,
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
  if (framework === 'vite-pocketbase')
    return 'a Vite + React + PocketBase project: index.html → src/main.jsx → src/App.jsx, PocketBase client singleton in src/lib/pb.js, server URL from VITE_PB_URL env var';
  if (framework === 'vite-convex')
    return 'a Vite + React + Convex project: index.html → src/main.jsx (ConvexProvider) → src/App.jsx, schema in convex/schema.ts, queries/mutations in convex/tasks.ts, VITE_CONVEX_URL from .env';
  return 'a plain static project: index.html + styles.css + app.js';
}
