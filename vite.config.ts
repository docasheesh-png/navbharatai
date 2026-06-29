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
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
