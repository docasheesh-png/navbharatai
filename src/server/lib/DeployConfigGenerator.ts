// Roadmap "BUILD NOW #7" — deploy-target config recipe (Railway / Render / Fly.io).
//
// The audit's Deployment gap listed AWS/Azure/Railway/Render. Firebase/Vercel/Netlify/Cloudflare already have
// live one-click deploy; the git-push PaaS trio (Railway, Render, Fly.io) had no config. This emits the REAL
// platform config files each needs so the user can deploy their app there with THEIR OWN account (BYO — no
// key stored here, and this recipe generates config, it does not auto-deploy: honest scope). AWS/Azure are
// deliberately NOT here — they are full IaC (many services, no single config) and belong to the Terraform/IaC
// track, not a config drop-in. Each file references PORT + npm build/start with clear "adjust this" comments.
// Dependency-free (plain config), no env keys. PURE builder → the caller writes the files. No TODO stubs.

export type DeployTarget = 'railway' | 'render' | 'fly';

export interface DeployConfigConfig {
  files: Record<string, string>;
  instructions: string;
}

// Render Blueprint (render.yaml) — one web service. Render injects PORT; bind to it.
const RENDER = `# Render Blueprint — deploy at https://dashboard.render.com (New → Blueprint, point at this repo).
# Render sets $PORT; your server MUST listen on process.env.PORT. Adjust buildCommand/startCommand for your app.
services:
  - type: web
    name: app
    runtime: node
    plan: free
    buildCommand: npm ci && npm run build
    startCommand: npm run start
    healthCheckPath: /health
    envVars:
      - key: NODE_ENV
        value: production
      # Add your own secrets in the Render dashboard (never commit them):
      # - key: DATABASE_URL
      #   sync: false
`;

// Railway config (railway.json) — build via Nixpacks (auto-detect) or the repo Dockerfile; restart on failure.
const RAILWAY = `{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "npm run start",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 100,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
`;

// Fly.io (fly.toml) — set your own app name + primary region, then \`fly launch\` / \`fly deploy\`.
const FLY = `# Fly.io config — run \`fly launch\` (first time) or \`fly deploy\`. Set app + primary_region to yours.
app = "your-app-name"
primary_region = "sin"

[build]
  # Uses the repo Dockerfile if present; otherwise Fly's buildpacks.

[http_service]
  internal_port = 3000        # your server's listen port (match process.env.PORT)
  force_https = true
  auto_stop_machines = true
  auto_start_machines = true
  min_machines_running = 0

[[http_service.checks]]
  method = "GET"
  path = "/health"
  interval = "15s"
  timeout = "2s"
`;

const TARGET_FILES: Record<DeployTarget, { path: string; content: string; note: string }> = {
  render: { path: 'render.yaml', content: RENDER, note: 'Render: New → Blueprint → pick this repo. Set your secrets in the dashboard. Your server must listen on process.env.PORT.' },
  railway: { path: 'railway.json', content: RAILWAY, note: 'Railway: New Project → Deploy from repo. Nixpacks auto-builds (or it uses your Dockerfile). Set variables in the Railway dashboard.' },
  fly: { path: 'fly.toml', content: FLY, note: 'Fly.io: install flyctl, then `fly launch` (edit app/region first) or `fly deploy`. Set secrets with `fly secrets set KEY=value`.' },
};

export function isDeployTarget(v: unknown): v is DeployTarget {
  return v === 'railway' || v === 'render' || v === 'fly';
}

/**
 * Generate the deploy config for one PaaS target. Pure. Emits the single platform file the target needs plus
 * honest deploy instructions (BYO account; this generates config, it does not auto-deploy).
 */
export function generateDeployConfig(target: DeployTarget): DeployConfigConfig {
  const t = TARGET_FILES[target];
  return {
    files: { [t.path]: t.content },
    instructions:
      `Deploy config for ${target} wired at ${t.path} (no dependency, no key stored). ${t.note} A /health ` +
      `route is referenced for health checks (the generate_observability injector can add one). This ` +
      `generates the config — you deploy from your own ${target} account (BYO); NavBharatAI does not auto-deploy ` +
      `to these targets. (For one-click deploy use Firebase/Vercel/Netlify/Cloudflare; AWS/Azure need full IaC.)`,
  };
}
