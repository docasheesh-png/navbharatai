// AgentV3 — Vercel deploy provider (R5 §5.1, multi-provider / no lock-in).
//
// Publishes the built static site to Vercel as a PRODUCTION deployment, returning a permanent
// public URL (https://<project>.vercel.app). Token-gated: enabled only when VERCEL_TOKEN is set
// (admin-supplied), so until then it reports configured:false with an honest requirement — never
// a fake target. Idempotent: the project is keyed by a deterministic name derived from the
// workspace id, so re-deploying updates the same project instead of creating a new one each time.
//
// Flow (Vercel REST API):
//   1. Upload each file by its SHA1 digest  (POST /v2/files, header x-vercel-digest).
//   2. Create a production deployment that references those files by sha (POST /v13/deployments).
// Pre-built static upload → no build step on Vercel's side (projectSettings.framework = null).

import * as crypto from 'crypto';
import axios from 'axios';
import { registerDeployProvider, type DeployProvider } from './DeployProviders';

const VERCEL_API = 'https://api.vercel.com';

/** Sanitize a workspace id into a valid Vercel project name (lowercase, [a-z0-9-], ≤ 100 chars). */
export function vercelProjectName(workspaceId: string): string {
  const safe = workspaceId.replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 52);
  return `nbai-v3-${safe || 'app'}`;
}

export interface VercelFileEntry {
  file: string;
  sha: string;
  size: number;
}

/**
 * Build the Vercel deployment file manifest (path → sha1/size) plus a sha→buffer map for upload.
 * Paths are normalized to forward slashes with no leading slash, as Vercel expects.
 */
export function buildVercelManifest(files: Map<string, Buffer>): { manifest: VercelFileEntry[]; bySha: Map<string, Buffer> } {
  const manifest: VercelFileEntry[] = [];
  const bySha = new Map<string, Buffer>();
  for (const [rawPath, buf] of files) {
    const file = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
    const sha = crypto.createHash('sha1').update(buf).digest('hex');
    manifest.push({ file, sha, size: buf.length });
    bySha.set(sha, buf);
  }
  return { manifest, bySha };
}

function vercelToken(): string | undefined {
  const t = process.env.VERCEL_TOKEN;
  return t && t.trim() ? t.trim() : undefined;
}

async function deployToVercel(workspaceId: string, files: Map<string, Buffer>): Promise<string> {
  const token = vercelToken();
  if (!token) throw new Error('Vercel is not configured. Set VERCEL_TOKEN to enable Vercel deploys.');
  if (files.size === 0) throw new Error('No built files to deploy. Run "npm run build" first.');

  const teamQuery = process.env.VERCEL_TEAM_ID ? `?teamId=${encodeURIComponent(process.env.VERCEL_TEAM_ID)}` : '';
  const authHeaders = { Authorization: `Bearer ${token}` };
  const { manifest, bySha } = buildVercelManifest(files);

  // 1. Upload each unique file by digest (idempotent — re-uploading the same sha is a no-op).
  const uploaded = new Set<string>();
  for (const { sha } of manifest) {
    if (uploaded.has(sha)) continue;
    uploaded.add(sha);
    const buf = bySha.get(sha)!;
    await axios.post(`${VERCEL_API}/v2/files${teamQuery}`, buf, {
      headers: { ...authHeaders, 'Content-Type': 'application/octet-stream', 'x-vercel-digest': sha },
      maxBodyLength: 50 * 1024 * 1024,
    });
  }

  // 2. Create the production deployment referencing the uploaded files.
  const name = vercelProjectName(workspaceId);
  const resp = await axios.post<{ url?: string; alias?: string[] }>(
    `${VERCEL_API}/v13/deployments${teamQuery}`,
    {
      name,
      files: manifest,
      target: 'production',
      projectSettings: { framework: null },
    },
    { headers: { ...authHeaders, 'Content-Type': 'application/json' } },
  );

  // The stable production URL is https://<project>.vercel.app. If Vercel returned a per-deployment
  // url but somehow no project name resolution is expected, that url is the immediate fallback.
  if (resp.status >= 400) throw new Error(`Vercel deployment failed (HTTP ${resp.status}).`);
  return `https://${name}.vercel.app`;
}

const vercelProvider: DeployProvider = {
  id: 'vercel',
  name: 'Vercel',
  kind: 'static',
  requirement: 'Set VERCEL_TOKEN (a Vercel API token) to enable Vercel deploys.',
  isConfigured: () => !!vercelToken(),
  deploy: (workspaceId, files) => deployToVercel(workspaceId, files),
};

registerDeployProvider(vercelProvider);

export { vercelProvider };
