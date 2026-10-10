// Project kit for the vite-react starter (owner decision D-7, 2026-10): a new app should open like a
// real engineered project — a README, an `.env.example`, a typed env helper with a passing unit test,
// and the conventional `src/components` / `src/pages` / `src/lib` folders.
//
// BEHIND A FLAG, DEFAULT OFF: `AGENTV3_SCAFFOLD_PROJECT_KIT=on`. Declaring vitest adds an install to
// sandboxes whose node_modules were baked without it, so this ships dark until a before/after
// reliability bench shows no regression in build success. PURE apart from the env read in the flag.

import { withVitestDeclared } from '../../../../TestGenerationAgent';

export function projectKitEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return String(env.AGENTV3_SCAFFOLD_PROJECT_KIT || '').trim().toLowerCase() === 'on';
}

const readme = `# App

Built with React, TypeScript and Vite.

## Getting started

\`\`\`bash
npm install
cp .env.example .env   # then fill in the values you need
npm run dev            # http://localhost:5173
\`\`\`

## Scripts

| Script | What it does |
| --- | --- |
| \`npm run dev\` | Start the dev server |
| \`npm run build\` | Type-check and build for production into \`dist/\` |
| \`npm run preview\` | Serve the production build locally |
| \`npm test\` | Run the unit tests (Vitest) |

## Project structure

\`\`\`
src/
  App.tsx            app shell and top-level layout
  main.tsx           entry point
  components/        reusable UI components
  pages/             one file per screen
  lib/               non-UI code: API clients, helpers, env access
  index.css          design tokens and base styles
\`\`\`

## Environment variables

Copy \`.env.example\` to \`.env\`. Only variables prefixed with \`VITE_\` are exposed to the browser,
so never put a secret key there. Read them through \`src/lib/env.ts\`.
`;

const envExample = `# Copy this file to .env and fill in real values. .env is not committed.
# Only VITE_-prefixed variables reach the browser; never put secrets here.
VITE_API_BASE_URL=
`;

const envTs = `/** Typed access to build-time environment variables. Add new keys here and to .env.example. */
export function readEnv(source: Record<string, string | undefined>, key: string, fallback = ''): string {
  const value = source[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

export const env = {
  apiBaseUrl: readEnv(import.meta.env as Record<string, string | undefined>, 'VITE_API_BASE_URL'),
};
`;

const envTestTs = `import { describe, it, expect } from 'vitest';
import { readEnv } from './env';

describe('readEnv', () => {
  it('returns a trimmed value when present', () => {
    expect(readEnv({ VITE_X: '  https://api.example.com ' }, 'VITE_X')).toBe('https://api.example.com');
  });
  it('falls back when missing or blank', () => {
    expect(readEnv({}, 'VITE_X', 'fallback')).toBe('fallback');
    expect(readEnv({ VITE_X: '   ' }, 'VITE_X', 'fallback')).toBe('fallback');
  });
});
`;

/** The extra files (and the package.json with a test script + vitest) the kit adds. Pure. */
export function projectKitFiles(packageJson: string): Record<string, string> {
  const files: Record<string, string> = {
    'README.md': readme,
    '.env.example': envExample,
    'src/lib/env.ts': envTs,
    'src/lib/env.test.ts': envTestTs,
    'src/components/.gitkeep': '',
    'src/pages/.gitkeep': '',
  };
  const withVitest = withVitestDeclared(packageJson) ?? packageJson;
  try {
    const pkg = JSON.parse(withVitest) as { scripts?: Record<string, string> };
    pkg.scripts = { ...(pkg.scripts || {}), test: pkg.scripts?.test || 'vitest run' };
    files['package.json'] = `${JSON.stringify(pkg, null, 2)}\n`;
  } catch { /* unparseable package.json: leave it exactly as shipped */ }
  return files;
}
