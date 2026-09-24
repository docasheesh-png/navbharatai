// Builds the two harness pages (the whole Code Studio, and the Shortcuts popup alone) into
// scripts/ideShortcutAudit/dist, from which audit.mjs serves them. `npm run build` never runs this.
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { resolve } from 'path';
export default defineConfig({
  root: 'scripts/ideShortcutAudit', base: './', plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: true, rollupOptions: { input: { popup: resolve('scripts/ideShortcutAudit/popup.html'), studio: resolve('scripts/ideShortcutAudit/studio.html') } } },
});
