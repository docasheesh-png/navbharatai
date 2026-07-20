// Roadmap "BUILD NOW #15" — developer-guide generator.
//
// generate_readme (DocGenerator.ts) emits a README (what the app IS) and generate_architecture_docs
// covers structure. Neither produces a human ONBOARDING guide — "how do I run this, where does code live,
// how do I add a page / route / component, how do I test, how do I deploy, what breaks and how to fix it".
// This fills that gap with a DEVELOPER_GUIDE.md derived from the app's real stack + scripts, with
// framework-aware "add a X" recipes. HONESTY: every section is derived from the supplied input; unknown
// frameworks get correct generic guidance, never invented file paths. Pure builder → the caller writes it.

export type GuideFramework =
  | 'react'
  | 'next'
  | 'vue'
  | 'svelte'
  | 'solid'
  | 'express'
  | 'node'
  | 'python'
  | 'generic';

export interface DevGuideScript {
  name: string;
  cmd: string;
  purpose?: string;
}

export interface DevGuideInput {
  name?: string;
  framework?: GuideFramework | string;
  packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun' | string;
  scripts?: DevGuideScript[];
  envKeys?: string[];
  nodeVersion?: string;
}

export interface DevGuideConfig {
  files: Record<string, string>;
  instructions: string;
}

const clean = (s: unknown): string => (typeof s === 'string' ? s.trim() : '');
const list = (xs: unknown): string[] => (Array.isArray(xs) ? xs.map(clean).filter(Boolean) : []);

const FRAMEWORKS: Record<string, GuideFramework> = {
  react: 'react', 'react-vite': 'react', vite: 'react',
  next: 'next', nextjs: 'next', 'next.js': 'next',
  vue: 'vue', svelte: 'svelte', sveltekit: 'svelte',
  solid: 'solid', solidjs: 'solid',
  express: 'express', node: 'node', nodejs: 'node',
  python: 'python', flask: 'python', django: 'python', fastapi: 'python',
};

function normFramework(f: unknown): GuideFramework {
  const key = clean(f).toLowerCase();
  return FRAMEWORKS[key] || 'generic';
}

/** The install/run command form for the chosen package manager. */
function pmRun(pm: string, script: string): string {
  if (pm === 'yarn') return `yarn ${script}`;
  if (pm === 'pnpm') return `pnpm ${script}`;
  if (pm === 'bun') return `bun run ${script}`;
  return `npm run ${script}`;
}
function pmInstall(pm: string): string {
  if (pm === 'yarn') return 'yarn';
  if (pm === 'pnpm') return 'pnpm install';
  if (pm === 'bun') return 'bun install';
  return 'npm install';
}

/** Framework-aware "how do I add a…" recipes. Real paths for known frameworks; honest generic otherwise. */
function addRecipes(fw: GuideFramework): string[] {
  switch (fw) {
    case 'react':
      return [
        '### Add a page / route',
        'This app uses React. If it uses react-router, add a `<Route>` in your router (often `src/App.tsx` or `src/main.tsx`) pointing at a new component under `src/pages/`.',
        '',
        '### Add a component',
        'Create `src/components/MyThing.tsx`, export a function component, and import it where needed. Keep one component per file.',
        '',
        '### Add an API call',
        'Put fetch/axios logic in `src/services/` or a `src/hooks/useX.ts` hook, not inside the component body — components stay declarative.',
      ];
    case 'next':
      return [
        '### Add a page / route',
        'Next.js is file-routed. App Router: add `app/<segment>/page.tsx`. Pages Router: add `pages/<segment>.tsx`. The file path IS the URL.',
        '',
        '### Add an API endpoint',
        'App Router: `app/api/<name>/route.ts` exporting `GET`/`POST`. Pages Router: `pages/api/<name>.ts`.',
        '',
        '### Add a component',
        'Create it under `components/` and import it. Mark it `"use client"` at the top only if it needs browser state/effects.',
      ];
    case 'vue':
      return [
        '### Add a page / route',
        'Add a `.vue` component under `src/views/` and register it in your router (`src/router/index.ts`).',
        '',
        '### Add a component',
        'Create `src/components/MyThing.vue` with `<template>`, `<script setup>` and `<style scoped>`, then import it.',
      ];
    case 'svelte':
      return [
        '### Add a page / route',
        'SvelteKit is file-routed: add `src/routes/<segment>/+page.svelte`. Server logic goes in `+page.server.ts` or `+server.ts`.',
        '',
        '### Add a component',
        'Create `src/lib/components/MyThing.svelte` and import it via the `$lib` alias.',
      ];
    case 'solid':
      return [
        '### Add a page / route',
        'Add a component under `src/routes/` (if using @solidjs/router) or register a `<Route>` in your router setup.',
        '',
        '### Add a component',
        'Create `src/components/MyThing.tsx` — Solid uses JSX but fine-grained signals; call `createSignal` for state.',
      ];
    case 'express':
    case 'node':
      return [
        '### Add an API endpoint',
        'Create a router file (e.g. `src/routes/things.ts`), define `router.get(...) / router.post(...)`, and mount it in your app entry with `app.use("/things", thingsRouter)`.',
        '',
        '### Add middleware',
        'Write `(req, res, next) => { …; next(); }` and register it with `app.use(...)` before your routes.',
        '',
        '### Add a service',
        'Keep DB/business logic in `src/services/`, not in the route handler — handlers should validate input, call a service, and shape the response.',
      ];
    case 'python':
      return [
        '### Add an endpoint',
        'Add a route/view in your app module (Flask: `@app.route(...)`; FastAPI: `@app.get(...)`; Django: a view + a `urls.py` entry).',
        '',
        '### Add a dependency',
        'Add it to `requirements.txt` (or `pyproject.toml`) and reinstall in your virtualenv.',
      ];
    default:
      return [
        '### Add a feature',
        'Follow the existing folder layout: put new UI next to existing UI, new server logic next to existing routes/services, and wire it where similar features are wired. Match the surrounding code style.',
      ];
  }
}

function troubleshooting(fw: GuideFramework, pm: string): string[] {
  const installCmd = fw === 'python' ? 'pip install -r requirements.txt' : pmInstall(pm);
  const rows = [
    '| Symptom | Likely cause | Fix |',
    '| --- | --- | --- |',
    `| \`command not found\` on install | wrong package manager | use \`${installCmd}\` |`,
    '| Port already in use | a previous dev server is still running | stop it, or set a different `PORT` |',
    '| Env var is `undefined` | missing `.env` entry | copy `.env.example` → `.env` and fill it |',
    '| Blank page / white screen | a runtime error | open the browser console; fix the first error shown |',
  ];
  if (fw === 'react' || fw === 'next' || fw === 'vue' || fw === 'svelte' || fw === 'solid') {
    rows.push('| Styles/assets 404 in a build | wrong base path | set the correct base/`homepage` for where it is hosted |');
  }
  if (fw === 'express' || fw === 'node') {
    rows.push('| `Cannot find module X` | dependency not installed | add it to package.json and reinstall |');
  }
  return rows;
}

export function generateDevGuide(input: DevGuideInput = {}): DevGuideConfig {
  const name = clean(input.name) || 'This app';
  const fw = normFramework(input.framework);
  const pm = clean(input.packageManager) || 'npm';
  const node = clean(input.nodeVersion) || '18+';
  const scripts = (input.scripts || []).filter((s) => clean(s?.name) && clean(s?.cmd));
  const envKeys = list(input.envKeys);
  const isNode = fw !== 'python';

  const runScript = scripts.find((s) => /^(dev|start|serve)$/i.test(clean(s.name)));
  const testScript = scripts.find((s) => /test/i.test(clean(s.name)));
  const buildScript = scripts.find((s) => /build/i.test(clean(s.name)));

  const L: string[] = [];
  L.push(`# Developer Guide — ${name}`, '');
  L.push('This guide is for developers working ON this app: how to run it locally, where the code lives, how to add features, test, and deploy. (For an end-user overview, see the README.)', '');

  // Prerequisites
  L.push('## Prerequisites', '');
  if (isNode) {
    L.push(`- Node.js ${node} and a package manager (\`${pm}\`)`);
  } else {
    L.push('- Python 3.10+ and a virtual environment (`python -m venv .venv`)');
  }
  L.push('- Git', '');

  // Local setup
  L.push('## Local setup', '');
  L.push('```bash');
  if (isNode) {
    L.push('# 1. install dependencies');
    L.push(pmInstall(pm));
    if (envKeys.length) { L.push('# 2. configure env'); L.push('cp .env.example .env   # then fill in the values'); }
    L.push('# run the app');
    L.push(runScript ? pmRun(pm, clean(runScript.name)) : pmRun(pm, 'dev'));
  } else {
    L.push('python -m venv .venv && source .venv/bin/activate');
    L.push('pip install -r requirements.txt');
    if (envKeys.length) L.push('cp .env.example .env   # then fill in the values');
  }
  L.push('```', '');

  // Env
  if (envKeys.length) {
    L.push('### Environment variables', '');
    L.push('The app reads these — set them in `.env` (never commit real secrets):', '');
    for (const k of envKeys) L.push(`- \`${k}\``);
    L.push('');
  }

  // Scripts
  if (scripts.length) {
    L.push('## Scripts', '');
    L.push('| Command | What it does |', '| --- | --- |');
    for (const s of scripts) {
      const cmd = isNode ? pmRun(pm, clean(s.name)) : clean(s.cmd);
      const purpose = clean(s.purpose) || clean(s.cmd);
      L.push(`| \`${cmd}\` | ${purpose.replace(/\|/g, '\\|')} |`);
    }
    L.push('');
  }

  // Common tasks
  L.push('## Common tasks', '');
  for (const line of addRecipes(fw)) L.push(line);
  L.push('');

  // Testing
  L.push('## Testing', '');
  if (testScript) {
    L.push(`Run the test suite:`, '', '```bash', isNode ? pmRun(pm, clean(testScript.name)) : clean(testScript.cmd), '```', '');
  } else {
    L.push('Add tests next to the code they cover (e.g. `Thing.test.ts` beside `Thing.ts`) and run your test runner. Every new feature should ship with at least one test.', '');
  }

  // Build & deploy
  L.push('## Build & deploy', '');
  if (buildScript) {
    L.push('Produce a production build:', '', '```bash', isNode ? pmRun(pm, clean(buildScript.name)) : clean(buildScript.cmd), '```', '');
  }
  L.push('Deploy the built output to your host (Vercel/Netlify/Cloudflare for static/frontend; Render/Railway/Fly or your own server for a backend). Keep secrets in the host\'s env settings, not in the repo.', '');

  // Conventions
  L.push('## Conventions', '');
  L.push('- Match the surrounding code style — naming, imports, formatting.');
  L.push('- One responsibility per file; keep functions small.');
  L.push('- Validate external input at the boundary; never trust request bodies.');
  L.push('- Small, focused commits with clear messages.', '');

  // Troubleshooting
  L.push('## Troubleshooting', '');
  for (const line of troubleshooting(fw, pm)) L.push(line);
  L.push('', '---', '_Generated by NavBharatAI._', '');

  return {
    files: { 'DEVELOPER_GUIDE.md': L.join('\n') },
    instructions:
      `Developer onboarding guide written to DEVELOPER_GUIDE.md — how to run locally, where code lives, ` +
      `framework-aware "how to add a page/route/component/endpoint" recipes, testing, build/deploy, ` +
      `conventions and a troubleshooting table. Derived from the app's real stack (${fw}) and scripts; ` +
      `distinct from the README (what the app is) and architecture docs (structure). No API key.`,
  };
}
