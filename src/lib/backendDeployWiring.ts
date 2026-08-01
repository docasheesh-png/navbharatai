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
  const logLines = [
    `✅ Added ${host === 'cloud-run' ? 'Cloud Run' : plan.hostLabel} deploy config to your project: ${added}.`,
    `ℹ️ This makes your BACKEND deploy-ready on ${plan.hostLabel} — separate from your frontend. We don't fake a deploy.`,
    `🔑 It deploys to YOUR ${plan.hostLabel} account (set ${plan.tokenEnv} there — never on NavBharatAI's account).`,
    `📌 ${plan.portNote}`,
    ...plan.steps.map((s, i) => `${i + 1}. ${s}`),
  ];
  return { plan, nextFiles, logLines };
}
