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

export type FrameworkId = 'react' | 'vanilla';

export interface ArchitectureManifest {
  framework: FrameworkId;
  bundler: 'vite' | 'none';
  /** Honor an explicit TypeScript request. */
  language: 'typescript' | 'javascript';
  routing: 'react-router' | 'state' | 'none';
  state: 'context' | 'none';
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

/** Choose ONE architecture from the prompt. Deterministic — scaffold + generator agree. */
export function selectArchitecture(prompt: string): ArchitectureManifest {
  const p = (prompt || '').toLowerCase();
  const wantsStatic = /\b(plain|static|landing page|single html|one html|vanilla)\b/.test(p) && !/\breact\b/.test(p);
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
  // Vanilla app: no React/bundler source tree.
  return [/^src\//i, /\.(jsx|tsx)$/i, /^vite\.config\./i];
}

/** Human-readable contract injected into generation prompts so the model conforms. */
export function manifestContract(m: ArchitectureManifest): string {
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
    `- Load ONLY "${m.entry}" via <script src="${m.entry}"></script>. No React, no JSX, no src/ tree, no vite.config.`,
  ].join('\n');
}
