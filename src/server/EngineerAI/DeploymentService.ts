/**
 * Phase 13 — Real persistent deployment via Firebase Hosting REST API.
 *
 * Builds a static dist/ from the E2B sandbox, uploads it to Firebase Hosting
 * under a per-workspace preview channel, and returns a permanent public URL that
 * survives sandbox pause/resume/deletion.
 *
 * URL format: https://gen-lang-client-0866594388--eng-<workspaceId>.web.app
 *
 * Auth: Application Default Credentials (ADC). On Cloud Run the service-account
 * identity is used automatically — no extra env var needed. Locally set
 * GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON with
 * Firebase Hosting Admin role.
 *
 * If deploy returns 403, grant the Cloud Run service account the
 * "Firebase Hosting Admin" IAM role in the GCP console.
 */
import { GoogleAuth } from 'google-auth-library';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import { promisify } from 'util';
import axios, { AxiosError } from 'axios';

const gzip = promisify(zlib.gzip);

// The real Firebase project — confirmed from firebase-applet-config.json and src/config/firebase.ts.
// navbharatai-3395f in .firebaserc is a stale CLI alias; gen-lang-client-0866594388 is what
// all server code (FirestoreJobStore, VertexAI, frontend) actually uses.
const FIREBASE_PROJECT = process.env.FIREBASE_DEPLOY_PROJECT ?? 'gen-lang-client-0866594388';
const HOSTING_API = 'https://firebasehosting.googleapis.com/v1beta1';

export class DeploymentService {
  private readonly auth = new GoogleAuth({
    scopes: ['https://www.googleapis.com/auth/firebase'],
  });

  /**
   * Deploy a Map<relativePath, fileBuffer> to Firebase Hosting and return
   * the permanent public HTTPS URL. Creates/reuses a per-workspace channel.
   */
  async deployStatic(workspaceId: string, files: Map<string, Buffer>): Promise<string> {
    if (files.size === 0) {
      throw new Error('No files to deploy. Ensure npm run build produced a dist/ directory.');
    }

    const token = await this.auth.getAccessToken();
    if (!token) {
      throw new Error(
        'Could not obtain Google auth token. ' +
        'On Cloud Run this should work automatically. ' +
        'Locally set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON with Firebase Hosting Admin role.',
      );
    }

    const site = FIREBASE_PROJECT;
    const channelId = this.makeChannelId(workspaceId);
    const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

    // 1. Ensure the per-workspace channel exists (idempotent — 409 = already there).
    await this.ensureChannel(site, channelId, authHeaders);

    // 2. Create a new version with SPA rewrite config.
    const versionName = await this.createVersion(site, authHeaders);
    const versionId = versionName.split('/').pop()!;

    // 3. Hash every file (SHA256 hex). Firebase uses hashes as deduplication keys —
    //    only files the server hasn't seen before actually get uploaded.
    const fileHashes: Record<string, string> = {};
    const hashToBuffer = new Map<string, Buffer>();
    for (const [relPath, buf] of files) {
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      const urlPath = '/' + relPath.replace(/\\/g, '/');
      fileHashes[urlPath] = hash;
      hashToBuffer.set(hash, buf);
    }

    // 4. Tell the server which files we have; it returns which hashes still need uploading.
    // `:populateFiles` — a Google API CUSTOM METHOD is addressed with a COLON; the slash form is not a
    // route and 404s. Sibling of the same bug in AgentV3/Deployment.ts (admin 2026-08-20).
    const populateResp = await axios.post<{ uploadRequiredHashes?: string[]; uploadUrl?: string }>(
      `${HOSTING_API}/sites/${site}/versions/${versionId}:populateFiles`,
      { files: fileHashes },
      { headers: authHeaders },
    );
    const { uploadRequiredHashes = [], uploadUrl } = populateResp.data;

    // 5. Upload each required file (gzip-compressed, Content-Type: octet-stream).
    if (uploadUrl && uploadRequiredHashes.length > 0) {
      for (const hash of uploadRequiredHashes) {
        const buf = hashToBuffer.get(hash);
        if (!buf) continue;
        const gz = await gzip(buf);
        await axios.post(`${uploadUrl}/${hash}`, gz, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/octet-stream',
          },
          maxBodyLength: 50 * 1024 * 1024,
        });
      }
    }

    // 6. Finalize the version so it can be released.
    await axios.patch(
      `${HOSTING_API}/sites/${site}/versions/${versionId}?update_mask=status`,
      { status: 'FINALIZED' },
      { headers: authHeaders },
    );

    // 7. Release this version on the workspace's channel.
    await axios.post(
      `${HOSTING_API}/sites/${site}/channels/${channelId}/releases?versionName=${encodeURIComponent(versionName)}`,
      {},
      { headers: authHeaders },
    );

    return `https://${site}--${channelId}.web.app`;
  }

  /** Convert workspaceId to a valid Firebase channel ID (max 36 chars, [a-zA-Z0-9-_]). */
  private makeChannelId(workspaceId: string): string {
    const safe = workspaceId.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase().slice(0, 30);
    return `eng-${safe}`;
  }

  private async ensureChannel(
    site: string,
    channelId: string,
    headers: Record<string, string>,
  ): Promise<void> {
    try {
      // ONLY valid `Channel` fields here — a Channel has no `type` field. `type: 'LIVE'` used to be
      // silently ignored but Firebase's API now REJECTS unknown fields (HTTP 400), which broke publish.
      // No expiry set ⇒ the channel is never auto-deleted (permanent URL). (Sibling of Deployment.ts.)
      await axios.post(
        `${HOSTING_API}/sites/${site}/channels?channelId=${channelId}`,
        { retainedReleaseCount: 3 },
        { headers },
      );
    } catch (err) {
      // 409 Conflict = channel already exists — that's fine, keep going.
      const status = (err as AxiosError)?.response?.status;
      if (status !== 409) {
        const msg = (err as AxiosError)?.response?.data
          ? JSON.stringify((err as AxiosError).response!.data)
          : String(err);
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
          // SPA catch-all rewrite so client-side routing works.
          rewrites: [{ glob: '**', path: '/index.html' }],
          headers: [
            // Immutable cache for hashed JS/CSS bundles (Vite default naming).
            { glob: '/assets/**', headers: { 'Cache-Control': 'max-age=31536000,immutable' } },
          ],
        },
      },
      { headers },
    );
    return resp.data.name; // "sites/{site}/versions/{versionId}"
  }
}

export const deploymentService = new DeploymentService();
