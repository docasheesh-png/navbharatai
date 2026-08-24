// backendDeployWiring — the PURE glue between the deploy panel (GitPanel) and the slice-1 config
// generator (backendDeployConfig). Slice 2 of the separate-backend deploy feature.
//
// The panel's platform ids (gcloud / render / railway) map to the generator's BackendHost ids, and the
// app's package.json (already in the workspace `files`) yields the start/build/node info the config needs.
// Kept pure + tested so the panel wiring is trivial and the logic is verified independently of the (large)
// GitPanel UI.

import { backendDeployConfig, type BackendHost, type BackendDeployPlan, type BackendAppInfo } from './backendDeployConfig';

/** Map a GitPanel deploy-platform id to a backend host, or null if it isn't a separate-backend host. */
export function gitPanelBackendHost(platformId: string): BackendHost | null {
  switch (platformId) {
    case 'gcloud': return 'cloud-run';
    case 'render': return 'render';
    case 'railway': return 'railway';
    default: return null;
  }
}

/** True when this deploy-platform id is one of the separate-backend hosts. */
export function isBackendDeployHost(platformId: string): boolean {
  return gitPanelBackendHost(platformId) !== null;
}

/** Read the backend app info (name, start/build scripts, node major) out of the workspace's package.json. Pure. */
export function parseBackendAppInfo(files: Record<string, string>): BackendAppInfo {
  const raw = files?.['package.json'];
  if (!raw) return {};
  let pkg: any;
  try { pkg = JSON.parse(raw); } catch { return {}; }
  const scripts = (pkg && typeof pkg.scripts === 'object' && pkg.scripts) || {};
  const info: BackendAppInfo = {};
  if (typeof pkg.name === 'string' && pkg.name.trim()) info.name = pkg.name.trim();
  if (typeof scripts.start === 'string' && scripts.start.trim()) info.startCommand = 'npm start';
  if (typeof scripts.build === 'string' && scripts.build.trim()) info.buildCommand = 'npm run build';
  const nodeReq = pkg?.engines?.node;
  if (typeof nodeReq === 'string') {
    const m = nodeReq.match(/(\d+)/);
    if (m) info.nodeMajor = Number(m[1]);
  }
  return info;
}

export interface BackendConfigInjection {
  plan: BackendDeployPlan;
  /** The project files AFTER adding the config — hand straight to onFilesChange. */
  nextFiles: Record<string, string>;
  /** Honest, ready-to-print console lines (what was added + the BYO-account steps). */
  logLines: string[];
}

/**
 * Build the complete injection for a backend host: the config plan, the merged file map (existing files +
 * the new config files), and honest log lines. Pure — the panel just applies `nextFiles` via onFilesChange
 * and prints `logLines`. Never claims a deploy happened; it makes the backend deploy-READY on the user's host.
 */
export function buildBackendConfigInjection(
  platformId: string,
  files: Record<string, string>,
): BackendConfigInjection | null {
  const host = gitPanelBackendHost(platformId);
  if (!host) return null;
  const plan = backendDeployConfig(host, parseBackendAppInfo(files));
  const nextFiles = { ...files, ...plan.files };
  const added = Object.keys(plan.files).join(', ');
  const managed = canOfferManagedDeploy(platformId);
  const logLines = [
    `✅ Added ${host === 'cloud-run' ? 'Cloud Run' : plan.hostLabel} deploy config to your project: ${added}.`,
    `ℹ️ This makes your BACKEND deploy-ready on ${plan.hostLabel} — separate from your frontend. We don't fake a deploy.`,
    `🔑 It deploys to YOUR ${plan.hostLabel} account, never NavBharatAI's.`,
    // The old line said NavBharatAI deploying it for you was "coming next". It arrived — and for Render
    // it is wired to this panel now, so saying "coming next" would be a promise the app is already
    // keeping. For the hosts where no engine exists yet, the honest answer is still "you deploy it".
    managed
      ? `🚀 NavBharatAI can trigger the deploy for you — save your ${plan.tokenEnv} in Settings → Secrets & API Keys, then use "Deploy it for me" below.`
      : `   NavBharatAI cannot trigger a ${plan.hostLabel} deploy yet — set ${plan.tokenEnv} on your host and deploy from there.`,
    `📌 ${plan.portNote}`,
    ...plan.steps.map((s, i) => `${i + 1}. ${s}`),
  ];
  return { plan, nextFiles, logLines };
}

// ---------------------------------------------------------------------------------------------------
// MANAGED DEPLOY — the half that existed on the server and was never reachable (verified 2026-08-07).
//
// `renderDeploy.ts` really deploys a user's backend through the Render API, `POST
// /api/agentv3/deploy-backend` really exposes it, and the admin really set `RENDER_API_KEY` in Cloud Run
// on 2026-08-02. But NOTHING in the client ever called that route — a repo-wide grep for
// 'deploy-backend' found the route definition and no caller at all. So the panel kept telling every user
// "config added, now go and deploy it yourself", while the button that could do it for them did not
// exist. Worse, the injection text above literally promised it was "coming next" — after it had shipped.
//
// A real capability with no way to reach it is the same rule-2 failure as a button that does nothing;
// it just fails in the quieter direction. These pure helpers are that missing half.
// ---------------------------------------------------------------------------------------------------

/**
 * Can NavBharatAI itself trigger the deploy for this host, or is it the user's own next step?
 *
 * Render ONLY, deliberately. Cloud Run and Railway have config generators but no server-side deploy
 * engine, and offering a button that cannot deliver would be worse than the honest steps they get today.
 * When their engines ship, they are added here — one place, not per call site. PURE.
 */
export function canOfferManagedDeploy(platformId: string): boolean {
  return platformId === 'render';
}

/**
 * The request body for `POST /api/agentv3/deploy-backend`, or null when this host has no engine.
 *
 * `repoUrl` is what Render matches a service by, so a missing/misshapen `owner/repo` yields null rather
 * than a call that would come back "no matching service" for a reason the user cannot act on. PURE.
 */
export function managedDeployRequest(
  platformId: string,
  opts: { repoPath?: string; files?: Record<string, string>; workspaceId?: string; userId?: string | null; email?: string | null },
): { platform: string; repoUrl: string; appName?: string; workspaceId: string; userId?: string; email?: string } | null {
  if (!canOfferManagedDeploy(platformId)) return null;
  const repoPath = String(opts.repoPath ?? '').trim().replace(/^\/+|\/+$/g, '');
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repoPath)) return null;
  const workspaceId = String(opts.workspaceId ?? '').trim();
  if (!workspaceId) return null;
  const appName = parseBackendAppInfo(opts.files ?? {}).name;
  return {
    platform: platformId,
    repoUrl: `https://github.com/${repoPath}`,
    ...(appName ? { appName } : {}),
    workspaceId,
    ...(opts.userId ? { userId: opts.userId } : {}),
    ...(opts.email ? { email: opts.email } : {}),
  };
}

export type ManagedDeployKind = 'deployed' | 'not-configured' | 'needs-connect' | 'failed';

/**
 * Turn the route's response into an honest outcome + printable lines.
 *
 * Four outcomes, each needing DIFFERENT words because each has a different next action: it worked
 * (here is the URL), the server has no key (an admin/setup matter, not the user's fault), the repo is
 * not connected on Render yet (a genuine one-time step only the user can do), or it failed (say so).
 * The server's own message is passed through — it names the exact step — and is never replaced by a
 * generic line. PURE.
 */
export function managedDeployOutcome(
  status: number,
  body: { ok?: boolean; url?: string; serviceName?: string; reason?: string; error?: string; message?: string } | null,
): { kind: ManagedDeployKind; lines: string[] } {
  const serverSaid = String(body?.error ?? body?.message ?? '').trim();
  if (status >= 200 && status < 300 && body?.ok && body.url) {
    return {
      kind: 'deployed',
      lines: [
        `🚀 Deploy triggered on your own Render account${body.serviceName ? ` for "${body.serviceName}"` : ''}.`,
        `🔗 ${body.url}`,
        'ℹ️ Render is building it now — the URL goes live when that finishes. Your account, your billing.',
      ],
    };
  }
  if (body?.reason === 'not-configured' || status === 503) {
    return {
      kind: 'not-configured',
      lines: [
        '⚠️ NavBharatAI cannot trigger Render deploys right now — the server has no Render key configured.',
        serverSaid || 'Deploy from your Render dashboard instead; your render.yaml is already in the project.',
      ],
    };
  }
  if (body?.reason === 'no-service' || status === 409) {
    return {
      kind: 'needs-connect',
      lines: [
        'ℹ️ One step is still yours — Render needs the repo connected once before anything can deploy it.',
        serverSaid || 'In Render → New → Blueprint, pick your repo (it already has render.yaml). Then try again.',
      ],
    };
  }
  return {
    kind: 'failed',
    lines: [
      '❌ The Render deploy could not be started.',
      serverSaid || 'Please try again in a moment, or deploy from your Render dashboard.',
    ],
  };
}

/**
 * THE ONE-TIME CONNECT, SPELLED OUT — because "in Render → New → Blueprint, pick your repo" is a
 * sentence, and the person reading it has never opened Render (2026-08-24).
 *
 * `managedDeployOutcome`'s `needs-connect` branch is honest about WHAT is left but assumes the reader
 * knows their way around somebody else's dashboard. The admin asked to be guided through exactly this
 * step, which is the tell: if the person who commissioned the feature needs a walkthrough, every user
 * does. So the same outcome now carries numbered steps with their OWN repo named in them.
 *
 * 🔒 THE LINK IS AN ACCELERATOR, NEVER THE ONLY PATH. Render's `render.com/deploy?repo=…` flow reads
 * the `render.yaml` we already generated, which is exactly this case — but it is somebody else's URL
 * and we do not control it. So the manual route ("New → Blueprint") is listed as a real step beside
 * it, not as a fallback in small print: if the link ever changes, the guide still works. Claiming a
 * third party's URL is guaranteed would be the same overreach as claiming a build passed without
 * running it.
 *
 * Returns [] when there is no usable repo — a numbered guide that cannot name your repository is worse
 * than the plain sentence, because it looks like it was written for someone else. PURE.
 */
export function renderConnectSteps(repoUrl: string): string[] {
  const url = String(repoUrl ?? '').trim().replace(/\/+$/, '');
  if (!/^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(url)) return [];
  const repoPath = url.slice('https://github.com/'.length);
  return [
    `1. Open ${url.replace('https://github.com/', 'render.com/deploy?repo=https://github.com/')} — or go to Render and choose New → Blueprint.`,
    `2. Pick the repository ${repoPath}. Your project already contains render.yaml, so Render reads the settings from it — you do not have to fill anything in.`,
    '3. Give it a name and press Apply / Create. Render builds it once; this is the only time you do this.',
    '4. Come back here and press Deploy backend again. From now on every deploy runs from NavBharatAI.',
  ];
}
