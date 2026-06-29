// P-CGE.10 — Bundle Optimization Generator.
//
// Generated Vite+React apps shipped with no bundle optimization — no code-splitting, no vendor
// chunking — so production apps had large initial bundles. This produces real, dependency-free
// optimization artifacts for a generated app:
//   • a `lazyWithRetry` helper (React.lazy route-splitting + auto one-time reload on a stale chunk)
//   • a Rollup `manualChunks` config that splits node_modules into react-vendor / vendor chunks
//
// The manualChunks block is returned as a snippet (so the agent merges it into an existing
// vite.config rather than clobbering it); a complete optimized vite.config is emitted only when the
// app has none. Pure → unit-tested.

export interface BundleOptFile {
  path: string;
  content: string;
  /** A one-line note on how to use this file. */
  wiring: string;
}

export interface BundleOptResult {
  files: BundleOptFile[];
  /** A vite.config Rollup output.manualChunks block to merge into an existing config. */
  manualChunksSnippet: string;
  summary: string;
}

/** React.lazy route-splitting helper with a one-time reload on a failed (stale) chunk load. */
function lazyWithRetryHelper(): string {
  return [
    '// Bundle-splitting helper: wrap page-level components with lazyWithRetry so each route ships',
    '// as its own chunk (smaller initial bundle). It retries ONCE by reloading if a dynamic import',
    '// fails — the common case after a new deploy invalidates the old chunk URLs.',
    "//   const Dashboard = lazyWithRetry(() => import('./pages/Dashboard'));",
    "//   <Suspense fallback={<Spinner/>}><Dashboard/></Suspense>",
    "import { lazy } from 'react';",
    "import type { ComponentType, LazyExoticComponent } from 'react';",
    '',
    'export function lazyWithRetry<T extends ComponentType<any>>(',
    '  factory: () => Promise<{ default: T }>,',
    '): LazyExoticComponent<T> {',
    '  return lazy(async () => {',
    '    try {',
    '      return await factory();',
    '    } catch (err) {',
    "      const KEY = 'lazyWithRetry:reloaded';",
    "      if (typeof window !== 'undefined' && !sessionStorage.getItem(KEY)) {",
    "        sessionStorage.setItem(KEY, '1');",
    '        window.location.reload();',
    '      }',
    '      throw err;',
    '    }',
    '  });',
    '}',
    '',
  ].join('\n');
}

/** The Rollup output.manualChunks function as a config snippet (to merge into vite.config build). */
function manualChunksSnippet(): string {
  return [
    'build: {',
    '  rollupOptions: {',
    '    output: {',
    '      // Split node_modules into stable vendor chunks so app-code changes do not bust the',
    '      // whole vendor bundle (better long-term browser caching).',
    '      manualChunks(id: string) {',
    "        if (id.includes('node_modules')) {",
    "          if (/[\\\\/]react(-dom|-router(-dom)?)?[\\\\/]/.test(id)) return 'react-vendor';",
    "          return 'vendor';",
    '        }',
    '      },',
    '    },',
    '  },',
    '},',
  ].join('\n');
}

/** A complete optimized vite.config.ts (emitted only when the app has none). */
function fullViteConfig(): string {
  return [
    "import { defineConfig } from 'vite';",
    "import react from '@vitejs/plugin-react';",
    '',
    'export default defineConfig({',
    '  plugins: [react()],',
    '  build: {',
    '    rollupOptions: {',
    '      output: {',
    '        manualChunks(id) {',
    "          if (id.includes('node_modules')) {",
    "            if (/[\\\\/]react(-dom|-router(-dom)?)?[\\\\/]/.test(id)) return 'react-vendor';",
    "            return 'vendor';",
    '          }',
    '        },',
    '      },',
    '    },',
    '  },',
    '});',
    '',
  ].join('\n');
}

/**
 * Generate bundle-optimization artifacts. Always emits the `lazyWithRetry` helper and returns the
 * manualChunks snippet; emits a complete vite.config only when the app has none (`hasViteConfig`
 * false). Pure: returns the files; the caller writes them. Never throws.
 */
export function generateBundleOptimization(input: { hasViteConfig?: boolean } = {}): BundleOptResult {
  const files: BundleOptFile[] = [
    {
      path: 'src/lib/lazyWithRetry.tsx',
      content: lazyWithRetryHelper(),
      wiring: "Wrap page components: const Page = lazyWithRetry(() => import('./pages/Page')); render inside <Suspense>.",
    },
  ];
  if (!input.hasViteConfig) {
    files.push({
      path: 'vite.config.ts',
      content: fullViteConfig(),
      wiring: 'New optimized Vite config with vendor code-splitting.',
    });
  }
  const summary = input.hasViteConfig
    ? `Generated ${files.length} optimization file(s); merge the manualChunks snippet into your existing vite.config.ts build block.`
    : `Generated ${files.length} optimization file(s) including a vendor-split vite.config.ts.`;
  return { files, manualChunksSnippet: manualChunksSnippet(), summary };
}
