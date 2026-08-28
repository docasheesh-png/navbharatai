import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      // Build-time stamp so a deployed version is verifiable at a glance (shown in
      // the v3.0 header). If it doesn't change after a deploy, the browser is serving
      // cached code, not a code problem.
      // P-BRE.13 — honor SOURCE_DATE_EPOCH (the reproducible-builds standard) when set, so two
      // builds of the SAME commit produce byte-identical output; fall back to now() for local dev
      // (each deploy is a new commit, so the deploy-freshness indicator still changes per deploy).
      '__BUILD_TIME__': JSON.stringify(
        process.env.SOURCE_DATE_EPOCH
          ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
          : new Date().toISOString()
      ),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          // Give the on-device LLM (web-llm) its OWN named chunk. It is a LAZY, OPT-IN dependency —
          // fetched only when a user turns on the Offline-Thinking beta, never part of the main app
          // load — so naming it lets the bundle-size budget exclude it (see scripts/bundleBudget.mjs)
          // instead of counting a ~2 MB beta-only chunk against the main-app ceiling.
          //
          // REACT VENDOR SPLIT (admin 2026-08-16, "app ki speed badhao"). React + react-dom + scheduler +
          // the router are ALWAYS on the first-paint path and change the LEAST between deploys, yet they
          // were welded into the main entry chunk — so every app UPDATE forced the user to re-download
          // them along with the changed app code. Pulling ONLY React into its own chunk means: after a
          // deploy the ~60 KB gz react-vendor chunk is served from cache and only the app chunk (which
          // actually changed) re-downloads, and the two load in parallel on a cold visit. This project
          // ships several times a day, so those cached bytes add up for returning web users.
          //
          // DELIBERATELY REACT-ONLY, not "all node_modules → vendor": the per-view chunks (CodeStudio,
          // NavAppStore, …) are ALREADY lazy, and forcing every dependency into one eager vendor chunk
          // HOISTS libs that today live only inside those lazy chunks onto the first-paint path — a
          // measured ~170 KB gz first-paint REGRESSION (exactly the trap scripts/bundleBudget.mjs warns
          // about: "split first, measure"). React is the one extraction that is provably eager already,
          // so relocating it cannot regress first paint — it only makes it cacheable.
          manualChunks(id: string) {
            if (id.includes('@mlc-ai/web-llm')) return 'webllm';
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(id)) {
              return 'react-vendor';
            }
            // FIREBASE IN ITS OWN CHUNK (2026-08-28). It was landing in the first-paint `index`
            // chunk, so a routine firebase MINOR bump (12.14 -> 12.18) grew that chunk by ~57 KB
            // gzipped and broke the bundle budget on `main` — the SDK is ~109 import sites and had
            // no chunk of its own. Splitting it keeps the critical path small AND stops every future
            // firebase release from being a budget event. Still statically imported (auth runs at
            // boot), so this is one more parallel request, never a lazy-load that could delay login.
            if (/[\\/]node_modules[\\/](firebase|@firebase)[\\/]/.test(id)) {
              return 'firebase-vendor';
            }
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
