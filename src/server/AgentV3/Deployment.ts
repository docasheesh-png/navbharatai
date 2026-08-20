// AgentV3 — Real persistent deployment (ported from Engineer AI's DeploymentService, made
// v5.0-owned so it survives deletion of the old engines).
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
import { ensureSite } from '../lib/firebaseCustomDomain';

const gzip = promisify(zlib.gzip);

const FIREBASE_PROJECT = process.env.FIREBASE_DEPLOY_PROJECT ?? 'gen-lang-client-0866594388';
const HOSTING_API = 'https://firebasehosting.googleapis.com/v1beta1';

/**
 * The public URL a published app is served at. Pure + exported for tests.
 *
 * DEFAULT (no branded domain): the raw Firebase channel URL `https://<site>--<channelId>.web.app`.
 * That host is already on the Public Suffix List, so it is the SAFE default — do not remove it.
 *
 * BRANDED (`PUBLISHED_APP_DOMAIN` set, e.g. `mitrify.in`): `https://<channelId>.<domain>`. This is a
 * pure STRING change — it only produces the right host. It becomes REAL only once a Cloudflare Worker
 * routes `*.<domain>` to the matching Firebase channel (deterministic: `<sub>.<domain>` →
 * `https://<site>--<sub>.web.app`, because `site` is the constant project). Until that Worker is live
 * the env MUST stay unset, or every published URL points at a host that does not resolve. See
 * `infra/cloudflare/mitrify-apps-worker.js` and its runbook.
 *
 * ⚠️ Branded subdomains are NOT isolated from each other for COOKIES until `<domain>` is on the Public
 * Suffix List (a separate, weeks-long registration). localStorage/IndexedDB are already per-origin, so
 * apps are isolated for those from day one; PSL is what closes cookie-tossing between apps. Do not flip
 * this on for apps that set `Domain=.<domain>` cookies before PSL lands.
 */
export function publishedAppUrl(channelId: string, site = FIREBASE_PROJECT, brandedDomain = process.env.PUBLISHED_APP_DOMAIN): string {
  const domain = (brandedDomain || '').trim().replace(/^\.+|\.+$/g, '');
  if (domain) return `https://${channelId}.${domain}`;
  return `https://${site}--${channelId}.web.app`;
}

/** The injected deploy function the dispatcher calls: dist files → permanent public URL. */
export type DeployFn = (workspaceId: string, files: Map<string, Buffer>) => Promise<string>;

export class FirebaseHostingDeployer {
  private readonly auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/firebase'] });

  async deployStatic(workspaceId: string, files: Map<string, Buffer>): Promise<string> {
    if (files.size === 0) {
      throw new Error('No files to deploy. Ensure "npm run build" produced a dist/ directory.');
    }
    const { token, headers } = await this.authHeaders();
    const site = FIREBASE_PROJECT;
    const channelId = makeChannelId(workspaceId);

    await this.ensureChannel(site, channelId, headers);
    const versionName = await this.publishVersion(site, files, token, headers);
    await this.hostingCall('release', () =>
      axios.post(
        `${HOSTING_API}/sites/${site}/channels/${channelId}/releases?versionName=${encodeURIComponent(versionName)}`,
        {},
        { headers },
      ));
    return publishedAppUrl(channelId, site);
  }

  /**
   * Deploy the built dist to the workspace's OWN dedicated Firebase Hosting site (multi-site), and
   * release it to that site's LIVE channel. This is the durable home a Firebase-native custom domain
   * attaches to (a preview channel cannot carry a custom domain). Idempotent: the site is created if
   * absent, reused otherwise. Returns the site's public URL (`https://<siteId>.web.app`).
   *
   * A dedicated site consumes one of the project's site-quota slots, so this is only ever called for
   * workspaces that actually connect a custom domain (never one-per-app — see firebaseCustomDomain.ts).
   */
  async deployToSite(workspaceId: string, files: Map<string, Buffer>): Promise<string> {
    if (files.size === 0) {
      throw new Error('No files to deploy. Ensure "npm run build" produced a dist/ directory.');
    }
    const siteId = await ensureSite(workspaceId); // creates-or-reuses `nbai-<hash>`
    const { token, headers } = await this.authHeaders();
    const versionName = await this.publishVersion(siteId, files, token, headers);
    // Release to the site's default LIVE channel (a site release, not a named preview channel).
    await this.hostingCall('site release', () =>
      axios.post(
        `${HOSTING_API}/sites/${siteId}/releases?versionName=${encodeURIComponent(versionName)}`,
        {},
        { headers },
      ));
    return `https://${siteId}.web.app`;
  }

  /**
   * Every Hosting API call goes through here so a failure NAMES ITSELF.
   *
   * ROOT CAUSE this closes (admin 2026-08-20): publishing died on `Error: Request failed with status
   * code 404` — axios's own words, which say nothing about WHICH of the five deploy calls failed. Only
   * `ensureChannel` had a real message; the four calls after it threw raw. That is why a genuinely
   * simple URL bug (see `publishVersion`) cost a whole round trip to identify instead of being obvious
   * from the first report.
   */
  private async hostingCall<T>(step: string, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      const status = (err as AxiosError)?.response?.status;
      if (status === undefined) throw err; // not an HTTP failure (network/DNS) — keep the original
      const data = (err as AxiosError)?.response?.data;
      const detail = data ? JSON.stringify(data).slice(0, 400) : String((err as Error)?.message ?? err);
      throw new Error(
        `Firebase Hosting ${step} failed (HTTP ${status}): ${detail}`
        + (status === 403 ? '\nEnsure the Cloud Run service account has the "Firebase Hosting Admin" IAM role.' : ''),
      );
    }
  }

  /** Obtain a Google auth token + JSON headers, or throw an honest error (never a fake success). */
  private async authHeaders(): Promise<{ token: string; headers: Record<string, string> }> {
    const token = await this.auth.getAccessToken();
    if (!token) {
      throw new Error(
        'Could not obtain a Google auth token. On Cloud Run this works automatically; locally set ' +
        'GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON with the Firebase Hosting Admin role.',
      );
    }
    return { token, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
  }

  /**
   * Create a version on `site`, upload every required file, finalize it, and return the versionName.
   * Shared by both the channel deploy (deployStatic) and the dedicated-site deploy (deployToSite) so
   * the upload path lives in ONE place (no drift between the two publish flows).
   */
  private async publishVersion(
    site: string,
    files: Map<string, Buffer>,
    token: string,
    headers: Record<string, string>,
  ): Promise<string> {
    const versionName = await this.createVersion(site, headers);
    const versionId = versionName.split('/').pop() ?? '';

    const fileHashes: Record<string, string> = {};
    const hashToBuffer = new Map<string, Buffer>();
    for (const [relPath, buf] of files) {
      const hash = crypto.createHash('sha256').update(buf).digest('hex');
      fileHashes['/' + relPath.replace(/\\/g, '/')] = hash;
      hashToBuffer.set(hash, buf);
    }

    // ⚠️ `:populateFiles`, NOT `/populateFiles`. This is a Google API CUSTOM METHOD, which is addressed
    // with a COLON — the slash form is not a route at all and returns 404. That single character was
    // the "Request failed with status code 404" that killed every publish (admin 2026-08-20). It went
    // unnoticed for so long because the channel-create bug above (#2495) threw first, so execution
    // never reached this line. Docs: sites.versions.populateFiles.
    const populateResp = await this.hostingCall('file registration', () =>
      axios.post<{ uploadRequiredHashes?: string[]; uploadUrl?: string }>(
        `${HOSTING_API}/sites/${site}/versions/${versionId}:populateFiles`,
        { files: fileHashes },
        { headers },
      ));
    const { uploadRequiredHashes = [], uploadUrl } = populateResp.data;

    if (uploadUrl && uploadRequiredHashes.length > 0) {
      for (const hash of uploadRequiredHashes) {
        const buf = hashToBuffer.get(hash);
        if (!buf) continue;
        const gz = await gzip(buf);
        await this.hostingCall('file upload', () =>
          axios.post(`${uploadUrl}/${hash}`, gz, {
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
            maxBodyLength: 50 * 1024 * 1024,
          }));
      }
    }

    // `updateMask` is the documented parameter name (the API also defaults the mask to `status`).
    await this.hostingCall('version finalize', () =>
      axios.patch(
        `${HOSTING_API}/sites/${site}/versions/${versionId}?updateMask=status`,
        { status: 'FINALIZED' },
        { headers },
      ));
    return versionName;
  }

  /**
   * TAKEDOWN — unpublish a workspace's live site by deleting its Firebase Hosting channel (the exact
   * channel the deploy created, keyed by makeChannelId). Real + idempotent: a 404 (already gone) is
   * treated as success; a 403 is surfaced honestly (the service account lacks the Firebase Hosting
   * Admin role). Returns true when the channel is gone (deleted or already absent).
   */
  async deleteChannel(workspaceId: string): Promise<boolean> {
    const token = await this.auth.getAccessToken();
    if (!token) {
      throw new Error(
        'Could not obtain a Google auth token for takedown. On Cloud Run this works automatically; ' +
        'locally set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON with the Firebase Hosting Admin role.',
      );
    }
    const site = FIREBASE_PROJECT;
    const channelId = makeChannelId(workspaceId);
    try {
      await axios.delete(`${HOSTING_API}/sites/${site}/channels/${channelId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return true;
    } catch (err) {
      const status = (err as AxiosError)?.response?.status;
      if (status === 404) return true; // already gone → idempotent success
      const data = (err as AxiosError)?.response?.data;
      const msg = data ? JSON.stringify(data) : String(err);
      throw new Error(
        `Firebase Hosting takedown failed (HTTP ${status}): ${msg}\n` +
        'Ensure the Cloud Run service account has the "Firebase Hosting Admin" IAM role.',
      );
    }
  }

  private async ensureChannel(site: string, channelId: string, headers: Record<string, string>): Promise<void> {
    try {
      // Channel-create payload: ONLY valid `Channel` fields. There is NO `type` field on a Channel —
      // sending `type: 'LIVE'` used to be silently ignored, but Firebase's proto3 JSON parser now
      // REJECTS unknown fields (HTTP 400 "Unknown name \"type\" at 'channel'"), which broke publishing.
      // Omitting `expireTime`/`ttl` is deliberate: per the Hosting API a channel with no expiry "will
      // not be automatically deleted", i.e. the published app URL stays permanent (the whole promise).
      await axios.post(
        `${HOSTING_API}/sites/${site}/channels?channelId=${channelId}`,
        { retainedReleaseCount: 3 },
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
    const resp = await this.hostingCall('version create', () => axios.post<{ name: string }>(
      `${HOSTING_API}/sites/${site}/versions`,
      {
        config: {
          rewrites: [{ glob: '**', path: '/index.html' }],
          headers: [{ glob: '/assets/**', headers: { 'Cache-Control': 'max-age=31536000,immutable' } }],
        },
      },
      { headers },
    ));
    return resp.data.name;
  }
}

/**
 * Convert a workspaceId to a valid Firebase channel ID (≤36 chars, [a-z0-9-]).
 *
 * CRITICAL: the id must be derived from the FULL workspaceId, not a prefix slice. A plain
 * `.slice(0, 30)` dropped the sessionId — `agentv3-` (8) + a 28-char Firebase uid already fills 30
 * chars — so `agentv3-<uid>-sessionA` and `agentv3-<uid>-sessionB` produced the SAME channel, and every
 * project a user deployed silently overwrote their previous live app at one shared URL. A readable
 * prefix + a hash of the full id keeps each workspace's channel unique AND stable (same workspace →
 * same channel on redeploy).
 */
export function makeChannelId(workspaceId: string): string {
  const safe = workspaceId.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase().slice(0, 17);
  const hash = crypto.createHash('sha256').update(workspaceId).digest('hex').slice(0, 12);
  return `v3-${safe}-${hash}`; // ≤ 3 + 17 + 1 + 12 = 33 chars
}

/** The default deploy function the route injects into the dispatcher. */
export function makeDeploy(): DeployFn {
  const deployer = new FirebaseHostingDeployer();
  return (workspaceId, files) => deployer.deployStatic(workspaceId, files);
}
