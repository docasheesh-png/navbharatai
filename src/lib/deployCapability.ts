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

/** The honest, user-facing console lines shown when a platform isn't directly deployable yet. Pure. */
export function unavailableDeployMessage(platformName: string): string[] {
  return [
    `ℹ️ One-click deploy to ${platformName} isn't available from NavBharatAI yet — and we won't fake it.`,
    `✅ Live right now: push your code to GitHub (real commits) using the GitHub target above.`,
    `👉 Then connect ${platformName} to that GitHub repo for automatic deploys — the real, supported path.`,
    `📦 Or pick "Static Export Store" to download your built files as a real ZIP.`,
  ];
}
