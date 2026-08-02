// backendDeployConfig — generate REAL, host-specific deploy config for a user's SEPARATE backend
// (admin 2026-07-31: "user ko frontend aur backend alag-alag rakhna ho to?"). NavBharatAI can deploy a
// FRONTEND one-click (Firebase/Vercel/Netlify/Cloudflare), but a standalone always-on backend (Express/
// Node) had no target. This module fills the FIRST slice: given the user's chosen host, produce the exact
// config file(s) that make the backend deploy cleanly on THAT host — so "push to GitHub → connect your host"
// actually works instead of the user hand-writing infra.
//
// BYO-TOKEN, PER-USER (architecturally mandated by CLAUDE.md: "user apps run on the user's OWN accounts —
// NavBharatAI's account is never used for user deploys"). So every host here deploys to the USER's own
// account with the USER's own token; we never host user backends on NavBharatAI's billing. Honest by
// construction: this generates config only — it never claims a deploy happened.
//
// PURE + deterministic (no I/O), so the generation is unit-tested independently of any UI.

export type BackendHost = 'cloud-run' | 'render' | 'railway';

/** The supported hosts, in the order the picker should offer them. */
export const BACKEND_HOSTS: readonly BackendHost[] = ['cloud-run', 'render', 'railway'];

export interface BackendAppInfo {
  /** App name (repo/service name); sanitised for the host. */
  name?: string;
  /** The npm script that starts the server (from package.json "scripts.start"); defaults to "npm start". */
  startCommand?: string;
  /** The npm build script if the backend needs compiling (e.g. tsc); omitted when there is none. */
  buildCommand?: string;
  /** Node major version (from "engines.node"); defaults to 20. */
  nodeMajor?: number;
}

export interface BackendDeployPlan {
  host: BackendHost;
  /** Human label for the host. */
  hostLabel: string;
  /** Config file(s) to add to the repo: path → contents. Adding these makes the backend deploy-ready. */
  files: Record<string, string>;
  /** The env var the USER must set (their own account's token) for a real deploy — never faked. */
  tokenEnv: string;
  /** Honest, ordered, user-facing steps (BYO account + token; connect via GitHub). */
  steps: string[];
  /** The port the app must listen on — every host injects PORT; the server must use process.env.PORT. */
  portNote: string;
}

const HOST_LABELS: Record<BackendHost, string> = {
  'cloud-run': 'Google Cloud Run',
  render: 'Render',
  railway: 'Railway',
};

/** True for a value we can safely use as a host service name. */
export function sanitizeServiceName(name: string | undefined | null): string {
  const cleaned = (name || 'backend')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'backend';
}

/**
 * Build the deploy config for one host. Pure. The generated files are REAL and correct for that host;
 * they never assume NavBharatAI infra and always deploy to the user's own account with their own token.
 */
export function backendDeployConfig(host: BackendHost, app: BackendAppInfo = {}): BackendDeployPlan {
  const name = sanitizeServiceName(app.name);
  const node = Number.isFinite(app.nodeMajor) && (app.nodeMajor as number) > 0 ? Math.floor(app.nodeMajor as number) : 20;
  const start = (app.startCommand || 'npm start').trim();
  const build = (app.buildCommand || '').trim();
  const hostLabel = HOST_LABELS[host];
  const portNote = 'Your server MUST listen on process.env.PORT (every host injects it) — e.g. app.listen(process.env.PORT || 3000).';

  if (host === 'cloud-run') {
    // Cloud Run runs a container → a Dockerfile is the honest, portable artifact. Uses PORT (Cloud Run
    // sets it, default 8080). npm ci for a reproducible install; runs the optional build then the start.
    const dockerfile = [
      `# Google Cloud Run — container for the ${name} backend (deploys to YOUR GCP project).`,
      `FROM node:${node}-slim`,
      'WORKDIR /app',
      'COPY package*.json ./',
      'RUN npm ci --omit=dev || npm install --omit=dev',
      'COPY . .',
      ...(build ? [`RUN ${build}`] : []),
      '# Cloud Run provides $PORT (default 8080); the server must read it.',
      'ENV PORT=8080',
      'EXPOSE 8080',
      `CMD ${JSON.stringify(startAsExec(start))}`,
      '',
    ].join('\n');
    const dockerignore = ['node_modules', 'npm-debug.log', '.env', '.git', 'dist/**/*.map', ''].join('\n');
    return {
      host, hostLabel,
      files: { 'Dockerfile': dockerfile, '.dockerignore': dockerignore },
      tokenEnv: 'GCP_SERVICE_ACCOUNT_KEY',
      portNote,
      steps: [
        'Push your project to GitHub (the GitHub target above makes real commits).',
        'In YOUR Google Cloud project, create a Cloud Run service from the repo (or `gcloud run deploy --source .`).',
        'Cloud Run builds this Dockerfile and gives your backend its own https URL — separate from the frontend.',
        'Set your backend secrets (DATABASE_URL, API keys) in Cloud Run → Variables. NavBharatAI never sees them.',
      ],
    };
  }

  if (host === 'render') {
    // Render reads render.yaml (Blueprint). A Node web service: build + start, PORT injected automatically.
    const yaml = [
      '# Render Blueprint — deploys the backend to YOUR Render account.',
      'services:',
      '  - type: web',
      `    name: ${name}`,
      '    runtime: node',
      `    buildCommand: ${build ? `npm ci && ${build}` : 'npm ci'}`,
      `    startCommand: ${start}`,
      '    envVars:',
      '      - key: NODE_VERSION',
      `        value: "${node}"`,
      '      # Add DATABASE_URL and your API keys in the Render dashboard (never commit them).',
      '',
    ].join('\n');
    return {
      host, hostLabel,
      files: { 'render.yaml': yaml },
      tokenEnv: 'RENDER_API_KEY',
      portNote,
      steps: [
        'Push your project to GitHub.',
        'In YOUR Render account → New → Blueprint → pick this repo; Render reads render.yaml.',
        'Render builds & runs the backend on its own https URL — separate from the frontend.',
        'Add DATABASE_URL / API keys under the service’s Environment. NavBharatAI never sees them.',
      ],
    };
  }

  // railway
  const railwayJson = JSON.stringify(
    {
      $schema: 'https://railway.app/railway.schema.json',
      build: { builder: 'NIXPACKS', ...(build ? { buildCommand: build } : {}) },
      deploy: { startCommand: start, restartPolicyType: 'ON_FAILURE', restartPolicyMaxRetries: 3 },
    },
    null,
    2,
  ) + '\n';
  return {
    host, hostLabel,
    files: { 'railway.json': railwayJson },
    tokenEnv: 'RAILWAY_TOKEN',
    portNote,
    steps: [
      'Push your project to GitHub.',
      'In YOUR Railway account → New Project → Deploy from GitHub repo; Railway reads railway.json.',
      'Railway builds & runs the backend on its own https URL — separate from the frontend.',
      'Add DATABASE_URL / API keys under Variables (Railway can also provision a Postgres). NavBharatAI never sees them.',
    ],
  };
}

/** Turn an "npm start"-style command into a Docker exec-form CMD array (["npm","start"]). Pure. */
function startAsExec(start: string): string[] {
  const parts = start.trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts : ['npm', 'start'];
}
