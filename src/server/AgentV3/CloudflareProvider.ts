// AgentV3 — Cloudflare Pages deploy provider (R5 §5.1, multi-provider / no lock-in).
//
// Publishes the built static site to Cloudflare Pages, returning a permanent https://<project>.pages.dev
// URL. First-party (platform-paid) host — 'cloudflare' is in FIRST_PARTY_PROVIDERS (HostingQuota.ts), so
// the Phase 0 hosting quota (per-publish size ceiling + monthly count cap), the takedown guard and the
// content-safety scan all apply automatically when deployProvider='cloudflare'. No extra wiring.
//
// Token-gated: enabled ONLY when CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID are set (admin-supplied,
// via Cloud Run secrets — never hardcoded). Until then it reports configured:false with an honest
// requirement string and deploy() throws an honest "not configured" error — never a fake URL.
//
// BINARY-SAFE (the whole reason this is its own module, not a call into ProDeploy.deployCloudflarePages
// which is string-based): a real dist has images/fonts/favicons. We hash the RAW Buffer and upload the
// RAW bytes (new Blob([buffer])) — a utf8 round-trip would corrupt every non-text asset and serve a
// broken site while reporting success (a rule-#2 "looks done but doesn't work" fake). Mirrors the
// binary-native pattern of NetlifyProvider / VercelProvider.

import * as crypto from 'crypto';
import { registerDeployProvider, type DeployProvider } from './DeployProviders';

const CF_API = 'https://api.cloudflare.com/client/v4';

/** Deterministic, DNS-safe Cloudflare Pages project name for a workspace (stable URL across re-deploys).
 *  Cloudflare Pages project names are ≤ 58 chars — 'nbai-v3-' (8) + ≤ 48 keeps a safe margin. */
export function cloudflareProjectName(workspaceId: string): string {
  const safe = String(workspaceId)
    .replace(/[^a-zA-Z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 48)
    .replace(/-$/, '');
  return `nbai-v3-${safe || 'app'}`;
}

/**
 * Build the Cloudflare Pages upload manifest ({ "/path": sha256hex }) plus a sha→Buffer map, hashing
 * the RAW bytes (binary-safe). Pure + unit-tested — this is the byte-integrity boundary.
 */
export function buildCloudflareManifest(files: Map<string, Buffer>): { manifest: Record<string, string>; bySha: Map<string, Buffer> } {
  const manifest: Record<string, string> = {};
  const bySha = new Map<string, Buffer>();
  for (const [rawPath, buf] of files) {
    const path = '/' + rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    manifest[path] = sha;
    bySha.set(sha, buf);
  }
  return { manifest, bySha };
}

function cloudflareToken(): string | undefined {
  const t = process.env.CLOUDFLARE_API_TOKEN;
  return t && t.trim() ? t.trim() : undefined;
}
function cloudflareAccountId(): string | undefined {
  const a = process.env.CLOUDFLARE_ACCOUNT_ID;
  return a && a.trim() ? a.trim() : undefined;
}

/** Create the Pages project if it doesn't exist yet (idempotent — 200/409/already-exists are all fine). */
async function ensureProject(projectName: string, token: string, accountId: string): Promise<void> {
  const base = `${CF_API}/accounts/${accountId}/pages/projects`;
  const check = await fetch(`${base}/${projectName}`, { headers: { Authorization: `Bearer ${token}` } });
  if (check.ok) return;
  if (check.status === 404) {
    const create = await fetch(base, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: projectName, production_branch: 'main' }),
    });
    // 409 = created concurrently / already exists — fine. Any other failure is honest below.
    if (!create.ok && create.status !== 409) {
      const text = await create.text().catch(() => '');
      throw new Error(`Cloudflare Pages: could not create project "${projectName}" (${create.status}): ${text.slice(0, 200)}`);
    }
  }
  // Non-404 error on the existence check (e.g. 403 bad token) → surface honestly on deploy below.
}

async function deployToCloudflare(workspaceId: string, files: Map<string, Buffer>): Promise<string> {
  const token = cloudflareToken();
  const accountId = cloudflareAccountId();
  if (!token || !accountId) {
    throw new Error('Cloudflare Pages is not configured. Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID to enable Cloudflare Pages deploys.');
  }
  if (files.size === 0) throw new Error('No built files to deploy. Run "npm run build" first.');

  const projectName = cloudflareProjectName(workspaceId);
  await ensureProject(projectName, token, accountId);

  const { manifest, bySha } = buildCloudflareManifest(files);
  const form = new FormData();
  form.append('manifest', new Blob([JSON.stringify(manifest)], { type: 'application/json' }), 'manifest.json');
  for (const [sha, buf] of bySha) {
    // new Blob([buf]) uploads the RAW bytes — binary-safe (images/fonts survive intact).
    form.append(sha, new Blob([buf]), sha);
  }

  const resp = await fetch(`${CF_API}/accounts/${accountId}/pages/projects/${projectName}/deployments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }, // fetch sets the multipart boundary itself
    body: form,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Cloudflare Pages deploy failed (${resp.status}): ${text.slice(0, 300)}`);
  }
  const data = (await resp.json().catch(() => ({}))) as { success?: boolean; result?: { url?: string } };
  if (data && data.success === false) {
    throw new Error(`Cloudflare Pages deploy failed: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data?.result?.url ? `https://${String(data.result.url).replace(/^https?:\/\//, '')}` : `https://${projectName}.pages.dev`;
}

const cloudflareProvider: DeployProvider = {
  id: 'cloudflare',
  name: 'Cloudflare Pages',
  kind: 'static',
  requirement: 'Set CLOUDFLARE_API_TOKEN (a Cloudflare API token with Pages:Edit) and CLOUDFLARE_ACCOUNT_ID to enable Cloudflare Pages deploys.',
  isConfigured: () => !!cloudflareToken() && !!cloudflareAccountId(),
  deploy: (workspaceId, files) => deployToCloudflare(workspaceId, files),
};

registerDeployProvider(cloudflareProvider);

export { cloudflareProvider };
