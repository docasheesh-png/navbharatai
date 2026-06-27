// AgentV3 — Netlify deploy provider (R5 §5.1, multi-provider / no lock-in).
//
// Publishes the built static site to Netlify, returning a permanent https://<site>.netlify.app
// URL. Token-gated: enabled only when NETLIFY_AUTH_TOKEN is set (admin-supplied); until then it
// reports configured:false with an honest requirement — never a fake target.
//
// Flow (Netlify REST API, digest-based — no zip):
//   1. Ensure a stable site for this workspace (create once; remember its id via ProviderStateStore
//      so re-deploys keep the SAME URL).
//   2. Create a deploy with a {path: sha1} digest map → Netlify returns which shas it still needs.
//   3. PUT each required file's bytes. The deploy then goes live at the site's URL.

import * as crypto from 'crypto';
import axios, { AxiosError } from 'axios';
import { registerDeployProvider, type DeployProvider } from './DeployProviders';
import { providerStateStore } from './ProviderStateStore';

const NETLIFY_API = 'https://api.netlify.com/api/v1';

/** Deterministic, DNS-safe Netlify site name for a workspace (used on first creation). */
export function netlifySiteName(workspaceId: string): string {
  const safe = workspaceId.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 50);
  return `nbai-v3-${safe || 'app'}`;
}

/** Build Netlify's {"/path": sha1hex} digest map plus a sha→buffer map for the upload step. */
export function buildNetlifyDigest(files: Map<string, Buffer>): { digest: Record<string, string>; bySha: Map<string, Buffer>; byPath: Map<string, Buffer> } {
  const digest: Record<string, string> = {};
  const bySha = new Map<string, Buffer>();
  const byPath = new Map<string, Buffer>();
  for (const [rawPath, buf] of files) {
    const path = '/' + rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
    const sha = crypto.createHash('sha1').update(buf).digest('hex');
    digest[path] = sha;
    bySha.set(sha, buf);
    byPath.set(path, buf);
  }
  return { digest, bySha, byPath };
}

function netlifyToken(): string | undefined {
  const t = process.env.NETLIFY_AUTH_TOKEN;
  return t && t.trim() ? t.trim() : undefined;
}

/** Create-or-reuse a Netlify site for this workspace, returning { id, url }. */
async function ensureNetlifySite(workspaceId: string, token: string): Promise<{ id: string; url: string }> {
  const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // Reuse a previously-created site so the URL stays stable across re-deploys.
  const prior = await providerStateStore.get(workspaceId, 'netlify');
  if (prior?.siteId) {
    return { id: prior.siteId, url: prior.url || '' };
  }

  const name = netlifySiteName(workspaceId);
  const createSite = async (body: Record<string, unknown>) =>
    axios.post<{ id: string; name: string; ssl_url?: string; url?: string }>(`${NETLIFY_API}/sites`, body, { headers: authHeaders });

  let resp;
  try {
    resp = await createSite({ name });
  } catch (err) {
    // 422 = the subdomain is taken (possibly by another account). Fall back to a Netlify-assigned
    // random subdomain so the deploy always succeeds; we remember its id for stable future deploys.
    if ((err as AxiosError)?.response?.status === 422) {
      resp = await createSite({});
    } else {
      throw err;
    }
  }
  const id = resp.data.id;
  const url = resp.data.ssl_url || resp.data.url || `https://${resp.data.name}.netlify.app`;
  await providerStateStore.set(workspaceId, 'netlify', { siteId: id, url });
  return { id, url };
}

async function deployToNetlify(workspaceId: string, files: Map<string, Buffer>): Promise<string> {
  const token = netlifyToken();
  if (!token) throw new Error('Netlify is not configured. Set NETLIFY_AUTH_TOKEN to enable Netlify deploys.');
  if (files.size === 0) throw new Error('No built files to deploy. Run "npm run build" first.');

  const authHeaders = { Authorization: `Bearer ${token}` };
  const { id: siteId, url } = await ensureNetlifySite(workspaceId, token);
  const { digest, byPath } = buildNetlifyDigest(files);

  // Create a deploy with the digest; Netlify replies with the shas it still needs uploaded.
  const deployResp = await axios.post<{ id: string; required?: string[] }>(
    `${NETLIFY_API}/sites/${siteId}/deploys`,
    { files: digest },
    { headers: { ...authHeaders, 'Content-Type': 'application/json' } },
  );
  const deployId = deployResp.data.id;
  const required = new Set(deployResp.data.required ?? []);

  // Upload each required file's raw bytes (matched back to its path via the digest map).
  for (const [path, sha] of Object.entries(digest)) {
    if (required.size > 0 && !required.has(sha)) continue;
    const buf = byPath.get(path);
    if (!buf) continue;
    await axios.put(`${NETLIFY_API}/deploys/${deployId}/files${path}`, buf, {
      headers: { ...authHeaders, 'Content-Type': 'application/octet-stream' },
      maxBodyLength: 50 * 1024 * 1024,
    });
  }

  return url || `https://${netlifySiteName(workspaceId)}.netlify.app`;
}

const netlifyProvider: DeployProvider = {
  id: 'netlify',
  name: 'Netlify',
  kind: 'static',
  requirement: 'Set NETLIFY_AUTH_TOKEN (a Netlify personal access token) to enable Netlify deploys.',
  isConfigured: () => !!netlifyToken(),
  deploy: (workspaceId, files) => deployToNetlify(workspaceId, files),
};

registerDeployProvider(netlifyProvider);

export { netlifyProvider };
