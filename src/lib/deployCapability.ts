// Deploy-target capability map for the Code Studio DevOps panel.
//
// HONESTY RULE (NavBharatAI absolute rule #2 — real features only): the panel must NEVER fabricate a
// "deployment successful" for a target it cannot actually deploy to. Only two paths are real today:
//   • 'github-push'  — a real commit/push to GitHub (server: /api/github/push-enhanced),
//   • 'static-zip'   — a real ZIP of the workspace files, downloaded in the browser (JSZip).
// Every other platform is 'unavailable': the panel shows an honest "not available yet + here's the
// real path" message instead of a faked success URL.
//
// This is a pure module so the honesty decision is unit-tested independently of the (large) UI.

export type DeployCapability = 'github-push' | 'static-zip' | 'unavailable';

/** What can this platform id ACTUALLY do right now? Anything not genuinely wired is 'unavailable'. */
export function deployCapability(platformId: string): DeployCapability {
  if (platformId === 'github') return 'github-push';
  if (platformId === 'static') return 'static-zip';
  return 'unavailable';
}

/** Sanitise a user-supplied ZIP filename to a safe, lowercase, .zip-suffixed name. Pure. */
export function sanitizeZipName(name: string | undefined | null): string {
  const cleaned = (name || 'navbharat-export.zip')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  const base = cleaned || 'navbharat-export';
  return base.endsWith('.zip') ? base : `${base}.zip`;
}

// Platforms that NavBharatAI Pro v5.0's REAL build+deploy engine can publish to right now (each has a
// genuine server-side DeployProvider: Firebase/Vercel/Netlify/Cloudflare). Selecting one of these in
// the Git panel hands off to v5's real pipeline (build in the sandbox → deploy → live URL), instead of
// showing 'unavailable'. Token-gated per provider: without the provider's API token the real engine
// returns an honest 'set <TOKEN>' message — never a fake success. Kept in sync with the server registry
// (DeployProviders.ts + the provider modules registered in routes/agentv3.ts).
export const V5_DEPLOY_PROVIDERS = ['firebase', 'vercel', 'netlify', 'cloudflare'] as const;

/** True when a Git-panel platform id maps to a real v5 deploy provider (so the panel can really deploy it). */
export function isV5DeployProvider(platformId: string): boolean {
  return (V5_DEPLOY_PROVIDERS as readonly string[]).includes(platformId);
}

/** The honest, user-facing console lines shown when a platform isn't directly deployable yet. Pure. */
export function unavailableDeployMessage(platformName: string): string[] {
  return [
    `ℹ️ One-click deploy to ${platformName} isn't available from NavBharatAI yet — and we won't fake it.`,
    `✅ Live right now: push your code to GitHub (real commits) using the GitHub target above.`,
    `👉 Then connect ${platformName} to that GitHub repo for automatic deploys — the real, supported path.`,
    `📦 Or pick "Static Export Store" to download your built files as a real ZIP.`,
  ];
}
