// Roadmap "BUILD NOW #7/#8" — deploy-target config recipe (Railway / Render / Fly.io / AWS / Azure).
//
// The audit's Deployment gap listed AWS/Azure/Railway/Render. Firebase/Vercel/Netlify/Cloudflare already have
// live one-click deploy; this emits the REAL single platform-config file each container/PaaS target needs so
// the user can deploy their app there with THEIR OWN account (BYO — no key stored here, and this recipe
// generates config, it does not auto-deploy: honest scope). AWS and Azure BOTH now have a simple single-file
// deploy path — AWS App Runner reads `apprunner.yaml`, and the Azure Developer CLI (`azd up`) reads
// `azure.yaml` to provision + deploy Azure Container Apps — so they no longer require hand-rolled IaC for a
// straightforward web deploy (full multi-service IaC still belongs to the Terraform/generate_iac track). Each
// file references PORT + npm build/start with clear "adjust this" comments. Dependency-free (plain config),
// no env keys. PURE builder → the caller writes the files. No TODO stubs.

export type DeployTarget = 'railway' | 'render' | 'fly' | 'aws' | 'azure';

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

// AWS App Runner (apprunner.yaml) — source-based deploy: App Runner builds + runs straight from the repo.
// It routes traffic to run.network.port, so bind your server to that port (or process.env.PORT).
const AWS = `# AWS App Runner config — create a service at https://console.aws.amazon.com/apprunner
# (Source: this repository → "Use a configuration file"). Adjust runtime-version / commands for your app.
version: 1.0
runtime: nodejs18
build:
  commands:
    build:
      - npm ci && npm run build
run:
  runtime-version: 18.20.4
  command: npm run start
  network:
    port: 8080          # App Runner routes here — your server MUST listen on this port (or process.env.PORT)
  env:
    - name: NODE_ENV
      value: production
    - name: PORT
      value: "8080"
    # Add your own secrets in the App Runner console (or via AWS Secrets Manager), never commit them.
`;

// Azure — the Azure Developer CLI (azd) project manifest (azure.yaml). \`azd up\` provisions Azure Container
// Apps and deploys this repo in one step. Needs a Dockerfile (generate_deploy_artifacts can add one).
const AZURE = `# Azure Developer CLI (azd) — install azd, then run \`azd up\` to provision + deploy to Azure
# Container Apps from this repo. Schema: https://aka.ms/azure-dev/schema . Adjust name / language as needed.
name: app
services:
  web:
    project: .
    language: js
    host: containerapp   # deploys as an Azure Container App (needs a Dockerfile); listens on process.env.PORT
`;

const TARGET_FILES: Record<DeployTarget, { path: string; content: string; note: string }> = {
  render: { path: 'render.yaml', content: RENDER, note: 'Render: New → Blueprint → pick this repo. Set your secrets in the dashboard. Your server must listen on process.env.PORT.' },
  railway: { path: 'railway.json', content: RAILWAY, note: 'Railway: New Project → Deploy from repo. Nixpacks auto-builds (or it uses your Dockerfile). Set variables in the Railway dashboard.' },
  fly: { path: 'fly.toml', content: FLY, note: 'Fly.io: install flyctl, then `fly launch` (edit app/region first) or `fly deploy`. Set secrets with `fly secrets set KEY=value`.' },
  aws: { path: 'apprunner.yaml', content: AWS, note: 'AWS App Runner: create a service from this repo and choose "Use a configuration file". Your app must listen on the run.network.port (8080). Add secrets in the App Runner console.' },
  azure: { path: 'azure.yaml', content: AZURE, note: 'Azure: install the Azure Developer CLI (azd), then run `azd up` to provision Azure Container Apps and deploy. Needs a Dockerfile (generate_deploy_artifacts can add one). Set secrets with `azd env set KEY value`.' },
};

export function isDeployTarget(v: unknown): v is DeployTarget {
  return v === 'railway' || v === 'render' || v === 'fly' || v === 'aws' || v === 'azure';
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
      `to these targets. (For one-click deploy use Firebase/Vercel/Netlify/Cloudflare; for multi-service AWS/Azure ` +
      `IaC use generate_iac.)`,
  };
}
