/**
 * Deploy request validation + body construction.
 * Pure logic extracted from App.tsx's handleDeployApp so the per-platform
 * branching (Vercel / Netlify / GitHub / Cloudflare) is unit-testable.
 */

export type DeployPlatform = 'vercel' | 'netlify' | 'github' | 'cloudflare';

export interface DeployInput {
  platform: DeployPlatform;
  token: string;
  projectName: string;
  owner: string;
  repo: string;
  hasFiles: boolean;
}

/**
 * Validate deploy inputs. Returns an error message string, or null when valid.
 * Mirrors the exact checks the deploy panel enforces before calling the API.
 */
export function validateDeployInput(input: DeployInput): string | null {
  if (!input.hasFiles) return 'No files to deploy. Build an app first.';
  if (!input.token.trim()) return 'Please enter your API token.';
  if (input.platform === 'vercel' && !input.projectName.trim()) return 'Please enter a project name.';
  if (input.platform === 'github' && (!input.owner.trim() || !input.repo.trim())) return 'Please enter owner and repo.';
  if (input.platform === 'cloudflare' && (!input.owner.trim() || !input.projectName.trim())) return 'Please enter Account ID and project name.';
  return null;
}

/**
 * Build the POST body for /api/pro/deploy for a given platform.
 * Caller must have already validated via validateDeployInput().
 */
export function buildDeployBody(
  platform: DeployPlatform,
  token: string,
  files: Record<string, string>,
  opts: { projectName: string; owner: string; repo: string },
): Record<string, string | Record<string, string>> {
  const body: Record<string, string | Record<string, string>> = { provider: platform, token, files };
  if (platform === 'vercel') body.name = opts.projectName.trim();
  else if (platform === 'netlify') body.siteId = opts.projectName.trim();
  else if (platform === 'github') { body.owner = opts.owner.trim(); body.repo = opts.repo.trim(); }
  else if (platform === 'cloudflare') { body.accountId = opts.owner.trim(); body.name = opts.projectName.trim(); }
  return body;
}
