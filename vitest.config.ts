import { defineConfig } from 'vitest/config';

// Vitest configuration for NavBharatAI.
// As modules are extracted from the server monolith (Phase 1+), colocated
// *.test.ts files will be added and picked up by the include glob below.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.{ts,tsx}'],
    environment: 'node',
    passWithNoTests: true,
  },
});
