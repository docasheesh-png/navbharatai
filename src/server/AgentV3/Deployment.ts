// AgentV3 — Real persistent deployment (ported from Engineer AI's DeploymentService, made
// v3.0-owned so it survives deletion of the old engines).
//
// Builds → Firebase Hosting: takes the static dist/ files from the sandbox and publishes them to a
// per-workspace Hosting channel, returning a PERMANENT public URL that survives sandbox
// pause/resume/deletion (unlike the ephemeral dev-server preview).
//
// URL format: https://gen-lang-client-0866594388--v3-<workspaceId>.web.app
//
// Auth: Application Default Credentials (ADC). On Cloud Run the service-account identity is used
// automatically — no env var needed. Locally set GOOGLE_APPLICATION_CREDENTIALS to a
// service-account JSON with the "Firebase Hosting Admin" role. A 403 means that role is missing.

import { GoogleAuth } from 'google-auth-library';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { promisify } from 'util';
import axios, { AxiosError } from 'axios';

const gzip = promisify(zlib.gzip);

const FIREBASE_PROJECT = process.env.FIREBASE_DEPLOY_PROJECT ?? 'gen-lang-client-0866594388';
const HOSTING_API = 'https://firebasehosting.googleapis.com/v1beta1';

/** The injected deploy function the dispatcher calls: dist files → permanent public URL. */
export type DeployFn = (workspaceId: string, files: Map<string, Buffer>) => Promise<string>;

export class FirebaseHostingDeployer {
  private readonly auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/firebase'] });

  async deployStatic(workspaceId: string, files: Map<string, Buffer>): Promise<string> {
    if (files.size === 0) {
      throw new Error('No files to deploy. Ensure "npm run build" produced a dist/ directory.');
    }
    const token = await this.auth.getAccessToken();
    if (!token) {
      throw new Error(
        'Could not obtain a Google auth token. On Cloud Run this works automatically; locally set ' +
        'GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON with the Firebase Hosting Admin role.',
      );
    }
    const site = FIREBASE_PROJECT;
    const channelId = makeChannelId(workspaceId);
    const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    await this.ensureChannel(site, channelId, authHeaders);
    const versionName = await this.createVersion(site, authHeaders);
    const versionId = versionName.split('/').pop() ?? '';

    const fileHashes: Record<string, string> = {};
    const hashToBuffer = new Map<string, Buffer>();
    for (const [relPath, buf] of files) {
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      fileHashes['/' + relPath.replace(/\\/g, '/')] = hash;
      hashToBuffer.set(hash, buf);
    }

    const populateResp = await axios.post<{ uploadRequiredHashes?: string[]; uploadUrl?: string }>(
      `${HOSTING_API}/sites/${site}/versions/${versionId}/populateFiles`,
      { files: fileHashes },
      { headers: authHeaders },
    );
    const { uploadRequiredHashes = [], uploadUrl } = populateResp.data;

    if (uploadUrl && uploadRequiredHashes.length > 0) {
      for (const hash of uploadRequiredHashes) {
        const buf = hashToBuffer.get(hash);
        if (!buf) continue;
        const gz = await gzip(buf);
        await axios.post(`${uploadUrl}/${hash}`, gz, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
          maxBodyLength: 50 * 1024 * 1024,
        });
      }
    }

    await axios.patch(
      `${HOSTING_API}/sites/${site}/versions/${versionId}?update_mask=status`,
      { status: 'FINALIZED' },
      { headers: authHeaders },
    );
    await axios.post(
      `${HOSTING_API}/sites/${site}/channels/${channelId}/releases?versionName=${encodeURIComponent(versionName)}`,
      {},
      { headers: authHeaders },
    );
    return `https://${site}--${channelId}.web.app`;
  }

  private async ensureChannel(site: string, channelId: string, headers: Record<string, string>): Promise<void> {
    try {
      await axios.post(
        `${HOSTING_API}/sites/${site}/channels?channelId=${channelId}`,
        { type: 'LIVE', retainedReleaseCount: 3 },
        { headers },
      );
    } catch (err) {
      const status = (err as AxiosError)?.response?.status;
      if (status !== 409) {
        const data = (err as AxiosError)?.response?.data;
        const msg = data ? JSON.stringify(data) : String(err);
        throw new Error(
          `Firebase Hosting channel creation failed (HTTP ${status}): ${msg}\n` +
          'Ensure the Cloud Run service account has the "Firebase Hosting Admin" IAM role.',
        );
      }
    }
  }

  private async createVersion(site: string, headers: Record<string, string>): Promise<string> {
    const resp = await axios.post<{ name: string }>(
      `${HOSTING_API}/sites/${site}/versions`,
      {
        config: {
          rewrites: [{ glob: '**', path: '/index.html' }],
          headers: [{ glob: '/assets/**', headers: { 'Cache-Control': 'max-age=31536000,immutable' } }],
        },
      },
      { headers },
    );
    return resp.data.name;
  }
}

/** Convert a workspaceId to a valid Firebase channel ID (max 36 chars, [a-z0-9-_]). */
export function makeChannelId(workspaceId: string): string {
  const safe = workspaceId.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase().slice(0, 30);
  return `v3-${safe}`;
}

/** The default deploy function the route injects into the dispatcher. */
export function makeDeploy(): DeployFn {
  const deployer = new FirebaseHostingDeployer();
  return (workspaceId, files) => deployer.deployStatic(workspaceId, files);
}
