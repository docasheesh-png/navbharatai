/**
 * Architecture Manifest (NavBharatAI generation engine).
 *
 * The #1 cause of broken generated apps is MIXED ARCHITECTURE — e.g. a React
 * entry (`src/main.jsx` mounting `#root`) shipped alongside legacy vanilla JS
 * (`js/router.js`, `pages/*.js`) and an `index.html` whose mount node is `#app`
 * with legacy <script> tags. The browser then throws React #299.
 *
 * The fix: pick EXACTLY ONE architecture up front, express it as a manifest, and
 * make every later stage (scaffold, generation prompt, validator) conform to it.
 * Generation that violates the manifest is rejected, not previewed.
 */

export type FrameworkId = 'react' | 'vue' | 'svelte' | 'vanilla';

export interface ArchitectureManifest {
  framework: FrameworkId;
  bundler: 'vite' | 'none';
  /** Honor an explicit TypeScript request. */
  language: 'typescript' | 'javascript';
  routing: 'react-router' | 'vue-router' | 'state' | 'none';
  state: 'context' | 'pinia' | 'none';
  storage: 'localStorage';
  /** The single module/script entry the HTML must load. */
  entry: string;
  /** The HTML document. */
  html: string;
  /** The single DOM mount node id (must match what the entry mounts to). */
  mountId: string;
}

const REACT_HINTS = [
  'react', 'vite', 'jsx', 'tsx', 'component', 'spa', 'single page',
  'dashboard', 'router', 'routing', 'usestate', 'hook', 'multi-page', 'pages',
  'kanban', 'todo', 'task', 'crud',
];

/** Explicit Vue request — checked BEFORE React so a "vue dashboard" picks Vue, not React. */
function wantsVue(p: string): boolean {
  return /\bvue(\.?js| 3| three)?\b|\bvuejs\b|\bpinia\b|\bvue-router\b|\bnuxt\b/i.test(p);
}

/** Explicit Svelte request — checked before Vue/React. */
function wantsSvelte(p: string): boolean {
  return /\bsvelte(\.?js| kit| store| 4| 5)?\b|\bsveltekit\b/i.test(p);
}

/** Choose ONE architecture from the prompt. Deterministic — scaffold + generator agree. */
export function selectArchitecture(prompt: string): ArchitectureManifest {
  const p = (prompt || '').toLowerCase();
  const wantsStatic = /\b(plain|static|landing page|single html|one html|vanilla)\b/.test(p) && !/\breact\b/.test(p) && !wantsVue(p) && !wantsSvelte(p);

  // Svelte first (explicit keyword only).
  if (!wantsStatic && wantsSvelte(p)) {
    return {
      framework: 'svelte',
      bundler: 'vite',
      language: 'javascript',
      routing: 'none',
      state: 'none',
      storage: 'localStorage',
      entry: 'src/main.js',
      html: 'index.html',
      mountId: 'app',
    };
  }

  // Vue second (explicit request only) — Vue 3 + Vite, SFC components, #app mount.
  if (!wantsStatic && wantsVue(p)) {
    const ts = /\btypescript\b|\bts\b|\.tsx?\b/i.test(p);
    return {
      framework: 'vue',
      bundler: 'vite',
      language: ts ? 'typescript' : 'javascript',
      routing: /\brouter\b|\bvue-router\b|\bmulti-page\b|\bpages\b/.test(p) ? 'vue-router' : 'none',
      state: /\bpinia\b|\bstore\b|\bstate management\b/.test(p) ? 'pinia' : 'none',
      storage: 'localStorage',
      entry: ts ? 'src/main.ts' : 'src/main.js',
      html: 'index.html',
      mountId: 'app',
    };
  }

  const isReact = !wantsStatic && REACT_HINTS.some((h) => p.includes(h));

  if (isReact) {
    const ts = /\btypescript\b|\bts\b|\.tsx?\b|\btsx\b/i.test(p);
    return {
      framework: 'react',
      bundler: 'vite',
      language: ts ? 'typescript' : 'javascript',
      routing: 'state', // state-based view switching (or react-router if the model adds it)
      state: 'context',
      storage: 'localStorage',
      entry: ts ? 'src/main.tsx' : 'src/main.jsx',
      html: 'index.html',
      mountId: 'root',
    };
  }
  return {
    framework: 'vanilla',
    language: 'javascript',
    bundler: 'none',
    routing: 'none',
    state: 'none',
    storage: 'localStorage',
    entry: 'app.js',
    html: 'index.html',
    mountId: 'app',
  };
}

/** Paths that MUST NOT exist under the chosen architecture (anti-mixing). */
export function forbiddenPathPatterns(m: ArchitectureManifest): RegExp[] {
  if (m.framework === 'react') {
    // No vanilla legacy entry layers in a React app. (pages/*.js is intentionally
    // NOT banned — React projects legitimately have .js helpers; a genuinely mixed
    // vanilla page is caught by the legacy <script src> check instead.)
    return [/^js\//i, /^router\.js$/i, /^dashboard\.js$/i];
  }
  if (m.framework === 'vue') {
    // No React (JSX/TSX) tree and no vanilla legacy layers in a Vue app.
    return [/\.(jsx|tsx)$/i, /^js\//i, /^router\.js$/i, /^dashboard\.js$/i];
  }
  if (m.framework === 'svelte') {
    // No React/Vue SFCs in a Svelte project.
    return [/\.(jsx|tsx|vue)$/i, /^js\//i];
  }
  // Vanilla app: no React/Vue/Svelte/bundler source tree.
  return [/^src\//i, /\.(jsx|tsx|vue|svelte)$/i, /^vite\.config\./i];
}

/** Human-readable contract injected into generation prompts so the model conforms. */
export function manifestContract(m: ArchitectureManifest): string {
  if (m.framework === 'svelte') {
    return [
      `ARCHITECTURE (MANDATORY — do not mix): Svelte 4 + Vite, Single-File Components (.svelte), ${m.storage}.`,
      `- Build the UI as Svelte SFCs (.svelte) under src/. NO React, NO Vue, NO JSX/TSX.`,
      `- The HTML entry is "${m.html}" and MUST contain exactly ONE mount node: <div id="${m.mountId}"></div>.`,
      `- "${m.html}" MUST load ONLY: <script type="module" src="/${m.entry}"></script>. No other <script src> tags.`,
      `- "${m.entry}" MUST be: import App from './App.svelte'; const app = new App({ target: document.getElementById('${m.mountId}') }); export default app;`,
      `- Use Svelte 4 syntax: reactive with $:, events with on:click, stores from svelte/store.`,
      `- FORBIDDEN: React, Vue, JSX/TSX, any js/ vanilla folder, or extra legacy <script> tags.`,
      `- NOTE: In-browser preview is not available for Svelte — users can download the ZIP and run "npm install && npm run dev" locally.`,
    ].join('\n');
  }
  if (m.framework === 'vue') {
    const ts = m.language === 'typescript';
    return [
      `ARCHITECTURE (MANDATORY — do not mix): Vue 3 + Vite, Single-File Components (.vue), ${m.storage}.`,
      `- Build the UI as Vue 3 SFCs (.vue) under src/ using <script setup>. NO React, NO JSX/TSX.`,
      `- The HTML entry is "${m.html}" and MUST contain exactly ONE mount node: <div id="${m.mountId}"></div>.`,
      `- "${m.html}" MUST load ONLY: <script type="module" src="/${m.entry}"></script>. No other <script src> tags.`,
      `- "${m.entry}" MUST be: import { createApp } from 'vue'; import App from './App.vue'; createApp(App).mount('#${m.mountId}').`,
      m.routing === 'vue-router' ? `- Use vue-router for navigation and add "vue-router" to package.json dependencies.` : `- Single-view app unless the user asks for routing.`,
      m.state === 'pinia' ? `- Use pinia for shared state and add "pinia" to package.json dependencies.` : `- Keep state in components (ref/reactive) unless asked otherwise.`,
      `- FORBIDDEN: React, JSX/TSX, any js/ vanilla folder, router.js/dashboard.js, or extra legacy <script> tags.`,
    ].join('\n');
  }
  if (m.framework === 'react') {
    const ts = m.language === 'typescript';
    return [
      `ARCHITECTURE (MANDATORY — do not mix): React 18 + Vite, ${ts ? 'TypeScript (.tsx/.ts)' : 'JSX (.jsx)'}, ${m.state} state, ${m.storage}.`,
      ts
        ? `- LANGUAGE IS TYPESCRIPT: every component file MUST be .tsx (or .ts), include a tsconfig.json, and use real types — NEVER plain .jsx/.js.`
        : `- LANGUAGE IS JAVASCRIPT: component files are .jsx.`,
      `- The HTML entry is "${m.html}" and MUST contain exactly ONE mount node: <div id="${m.mountId}"></div>.`,
      `- "${m.html}" MUST load ONLY: <script type="module" src="/${m.entry}"></script>. No other <script src> tags.`,
      `- "${m.entry}" MUST mount with createRoot(document.getElementById('${m.mountId}')${ts ? '!' : ''}). The id MUST be "${m.mountId}".`,
      `- Build the UI as React components/pages under src/. If the user asked for routing/state libs (react-router-dom, zustand), USE them and add them to package.json dependencies.`,
      `- FORBIDDEN: any js/ folder, pages/*.js vanilla files, router.js/dashboard.js, or extra legacy <script> tags. NO vanilla DOM apps.`,
    ].join('\n');
  }
  return [
    `ARCHITECTURE (MANDATORY — do not mix): Vanilla JavaScript, no bundler, ${m.storage}.`,
    `- The HTML entry is "${m.html}" with a single mount node <main id="${m.mountId}"></main>.`,
    `- Load ONLY "${m.entry}" via <script type="module" src="${m.entry}"></script>. ALWAYS use type="module" — without it, import/export statements throw SyntaxError in the browser.`,
    `- No React, no JSX, no src/ tree, no vite.config.`,
  ].join('\n');
}
