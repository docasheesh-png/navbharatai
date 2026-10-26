// Read-only template config; project-supplied Vite config and package scripts are never loaded.
export default { root: '/home/user/canary-app', build: { outDir: 'dist', emptyOutDir: true }, server: { host: '127.0.0.1', port: 4173, strictPort: true } };
