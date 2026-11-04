import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['scripts/chatLoad.bench.ts'], environment: 'node', testTimeout: 20_000, env: { IMAGE_GEN_ANON_PROBE: 'off' } } });
