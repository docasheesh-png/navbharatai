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
 * ⚠️ TAKES FIREBASE'S OWN CHANNEL URL, and never rebuilds one. This used to take a channelId and
 * construct `<site>--<channelId>.web.app`, which is NOT where a preview channel lives: the real host
 * is `SITE_ID--CHANNEL_ID-RANDOM_HASH.web.app`, with a hash Firebase generates and a channel id it
 * TRUNCATES past the 63-char DNS limit. A publish therefore succeeded and still handed the user a
 * "Site Not Found" (admin 2026-08-20). See `ensureChannel`, which reads the URL from the API.
 *
 * DEFAULT (no branded domain): that real Firebase URL, unchanged. Its host is already on the Public
 * Suffix List, so it is the SAFE default — do not replace it with anything computed.
 *
 * BRANDED (`PUBLISHED_APP_DOMAIN` set, e.g. `mitrify.in`): the SAME host, re-labelled —
 * `https://<sub>.<domain>` where `<sub>` is exactly what follows `<site>--` in the real host. The
 * Cloudflare Worker reverses that mapping (`<sub>.<domain>` → `<site>--<sub>.web.app`), so the two
 * halves stay in step by construction. Anything unparseable falls back to the Firebase URL, because a
 * working unbranded link beats a pretty broken one. See `infra/cloudflare/mitrify-apps-worker.js`.
 *
 * ⚠️ Branded subdomains are NOT isolated from each other for COOKIES until `<domain>` is on the Public
 * Suffix List (a separate, weeks-long registration). localStorage/IndexedDB are already per-origin, so
 * apps are isolated for those from day one; PSL is what closes cookie-tossing between apps. Do not flip
 * this on for apps that set `Domain=.<domain>` cookies before PSL lands.
 */
export function publishedAppUrl(channelUrl: string, site = FIREBASE_PROJECT, brandedDomain = process.env.PUBLISHED_APP_DOMAIN): string {
  const real = String(channelUrl || '').trim();
  const domain = (brandedDomain || '').trim().replace(/^\.+|\.+$/g, '');
  if (!domain) return real;

  // Brand it by RE-LABELLING Firebase's own host, never by rebuilding one. The Worker maps
  // `<sub>.<domain>` → `<site>--<sub>.web.app`, so `<sub>` is exactly what follows `<site>--` in the
  // real host — hash, truncation and all. Anything we could not parse stays on the Firebase URL,
  // because a working unbranded link beats a pretty broken one.
  const host = real.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const prefix = `${site}--`;
  if (!host.endsWith('.web.app') || !host.startsWith(prefix)) return real;
  const sub = host.slice(prefix.length, -'.web.app'.length);
  if (!/^[a-z0-9-]+$/.test(sub)) return real; // the Worker refuses anything else — don't hand it one
  return `https://${sub}.${domain}`;
}

/** The injected deploy function the dispatcher calls: dist files → permanent public URL. */
export type DeployFn = (workspaceId: string, files: Map<string, Buffer>) => Promise<string>;

export class FirebaseHostingDeployer {
  private readonly auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/firebase'] });

  /**
   * @param channelId Which Hosting channel to release onto. Defaults to the workspace's PUBLISH
   *   channel — the one the user's own Publish button uses.
   *
   *   The preview snapshot passes its own instead (previewSnapshot.ts), and that separation is
   *   load-bearing: writing a snapshot to the publish channel would mean an edit that broke the app
   *   silently REPLACED the working version somebody had deliberately shipped. A parameter rather
   *   than a second copy of this method, so the two paths can never drift in how they publish.
   */
  async deployStatic(workspaceId: string, files: Map<string, Buffer>, channelId = makeChannelId(workspaceId)): Promise<string> {
    if (files.size === 0) {
      throw new Error('No files to deploy. Ensure "npm run build" produced a dist/ directory.');
    }
    const { token, headers } = await this.authHeaders();
    const site = FIREBASE_PROJECT;

    // The REAL channel URL, from Firebase — see ensureChannel for why it can never be constructed.
    const channelUrl = await this.ensureChannel(site, channelId, headers);
    const versionName = await this.publishVersion(site, files, token, headers);
    await this.hostingCall('release', () =>
      axios.post(
        `${HOSTING_API}/sites/${site}/channels/${channelId}/releases?versionName=${encodeURIComponent(versionName)}`,
        {},
        { headers },
      ));
    return publishedAppUrl(channelUrl, site);
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

    // ⚠️ THE HASH IS OF THE GZIPPED BYTES, NOT THE FILE (admin 2026-08-20, and Google said it plainly:
    // `Firebase Hosting file upload failed (HTTP 400): "content hash doesn't match content"`).
    //
    // Hosting's upload contract is: gzip the file, and the hash declared in populateFiles is the SHA256
    // of THAT gzipped payload — the same bytes you then PUT. This hashed the RAW buffer and uploaded
    // its gzip, so the two could never agree and every file of every publish was rejected. It is the
    // LAST of the reasons the Hosting console showed every site reading "Waiting for your first
    // release"; the `:populateFiles` colon fix above cleared the 404 that used to mask it.
    //
    // Gzipping ONCE here is also what keeps the hash and the payload provably the same object — a
    // re-gzip at upload time is not guaranteed byte-identical (compression level and OS header can
    // differ), and computing the two apart is the exact shape that made this bug possible.
    const fileHashes: Record<string, string> = {};
    const hashToGzip = new Map<string, Buffer>();
    for (const [relPath, buf] of files) {
      const gz = await gzip(buf);
      const hash = crypto.createHash('sha256').update(gz).digest('hex');
      fileHashes['/' + relPath.replace(/\\/g, '/')] = hash;
      hashToGzip.set(hash, gz);
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
        // The SAME buffer the hash was taken from — never a second gzip. See the note above.
        const gz = hashToGzip.get(hash);
        if (!gz) continue;
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
    return this.deleteChannelById(makeChannelId(workspaceId));
  }

  /**
   * The same takedown, addressed by CHANNEL id rather than workspace id.
   *
   * WHY BOTH EXIST: a channel can outlive every record that points at it. Purges before
   * `markOrphaned` (2026-08-21) deleted the deployment record outright, so those channels are still
   * serving with no workspaceId left anywhere to derive them from — and each one holds a slot in the
   * scarce per-site channel pool (ROADMAP §10). Reclaiming them needs an id-addressed delete; without
   * one they are unreachable forever. `deleteChannel` is now a thin wrapper, so there is ONE delete.
   */
  async deleteChannelById(channelId: string): Promise<boolean> {
    const token = await this.auth.getAccessToken();
    if (!token) {
      throw new Error(
        'Could not obtain a Google auth token for takedown. On Cloud Run this works automatically; ' +
        'locally set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON with the Firebase Hosting Admin role.',
      );
    }
    const site = FIREBASE_PROJECT;
    if (!channelId) throw new Error('A channel id is required to delete a channel.');
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

  /**
   * Every channel that exists on our Hosting site, right now.
   *
   * WHY THIS EXISTS (ROADMAP §10). Each published app holds ONE preview channel, the pool is capped
   * per site, and until now nothing on our side could see how much of it was spent — so the wall
   * ("channel quota reached", publishing stops for EVERYBODY) would have arrived with no warning at
   * all. This turns a guessed limit into a measured number.
   *
   * Paginated deliberately: a partial count would understate usage, and an understated count is worse
   * than none — it is a false all-clear on the one number this is for.
   */
  async listChannels(): Promise<Array<{ channelId: string; url: string; updateTime: string | null }>> {
    return (await this.listChannelsWithCompleteness()).channels;
  }

  /**
   * The same enumeration, plus whether it actually reached the END of the list.
   *
   * The page loop below is bounded at 20 pages so a malformed nextPageToken cannot spin forever —
   * correct, but it means the function can return a PARTIAL list that looks exactly like a whole one.
   * A caller reconciling "which channels exist" against our registry would then treat the channels it
   * never saw as gone. Same class as the registry-side bug this was found with (2026-08-21): a
   * returned list standing in for a complete list.
   */
  async listChannelsWithCompleteness(): Promise<{ channels: Array<{ channelId: string; url: string; updateTime: string | null }>; complete: boolean }> {
    const { headers } = await this.authHeaders();
    const site = FIREBASE_PROJECT;
    const out: Array<{ channelId: string; url: string; updateTime: string | null }> = [];
    let pageToken = '';
    // Bounded so a malformed nextPageToken can never spin forever; 20 × 100 is far past any real cap.
    for (let page = 0; page < 20; page += 1) {
      const resp = await this.hostingCall('channel list', () =>
        axios.get<{ channels?: Array<{ name?: string; url?: string; updateTime?: string }>; nextPageToken?: string }>(
          `${HOSTING_API}/sites/${site}/channels?pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`,
          { headers },
        ));
      for (const c of resp.data?.channels ?? []) {
        const channelId = channelIdFromResourceName(c?.name);
        if (channelId) out.push({ channelId, url: typeof c?.url === 'string' ? c.url : '', updateTime: typeof c?.updateTime === 'string' ? c.updateTime : null });
      }
      pageToken = typeof resp.data?.nextPageToken === 'string' ? resp.data.nextPageToken : '';
      if (!pageToken) break;
    }
    // A token still in hand means the loop stopped on its own bound, not on the end of the list.
    return { channels: out, complete: !pageToken };
  }

  /**
   * Create-or-reuse the channel and return the URL FIREBASE gave it — never one we invented.
   *
   * ROOT CAUSE this closes (admin 2026-08-20, the last publish bug in the chain): a publish finally
   * succeeded end-to-end and the app was still "Site Not Found", because the returned URL was BUILT
   * as `<site>--<channelId>.web.app`. That host does not exist. A preview channel is served at
   *     SITE_ID--CHANNEL_ID-RANDOM_HASH.web.app
   * (firebase.google.com/docs/hosting/test-preview-deploy) — Firebase generates the hash, and it also
   * TRUNCATES the channel id when `SITE--CHANNEL` would pass the 63-character DNS label limit. Neither
   * is reproducible from our side, so any constructed URL is a guess dressed as a fact: the deploy
   * really happened, and we then pointed the user at a host that was never created.
   *
   * The Channel resource carries an output-only `url`. Reading it is the only way this can be right,
   * so it is now the ONLY way the URL is obtained.
   */
  private async ensureChannel(site: string, channelId: string, headers: Record<string, string>): Promise<string> {
    let url = '';
    try {
      // Channel-create payload: ONLY valid `Channel` fields. There is NO `type` field on a Channel —
      // sending `type: 'LIVE'` used to be silently ignored, but Firebase's proto3 JSON parser now
      // REJECTS unknown fields (HTTP 400 "Unknown name \"type\" at 'channel'"), which broke publishing.
      // Omitting `expireTime`/`ttl` is deliberate: per the Hosting API a channel with no expiry "will
      // not be automatically deleted", i.e. the published app URL stays permanent (the whole promise).
      const created = await axios.post<{ url?: string }>(
        `${HOSTING_API}/sites/${site}/channels?channelId=${channelId}`,
        { retainedReleaseCount: 3 },
        { headers },
      );
      url = typeof created.data?.url === 'string' ? created.data.url : '';
    } catch (err) {
      const status = (err as AxiosError)?.response?.status;
      if (status !== 409) {
        const data = (err as AxiosError)?.response?.data;
        const msg = data ? JSON.stringify(data) : String(err);
        // THE CEILING, ARRIVING (ROADMAP §10). Every published app holds one channel and the pool is
        // capped per site; past the cap this is where every user's publish lands. The raw text names
        // the vendor and an IAM role, and it is handed to the agent to paraphrase back to the user —
        // so the one failure that is entirely OUR problem would have reached them as a confusing
        // accusation. Loud in the server log because it is a platform outage, not one user's bad day.
        if (isChannelQuotaError(status, data)) {
          console.error(`[HOSTING] CHANNEL POOL EXHAUSTED — publishing is failing for ALL users. HTTP ${status}: ${msg}`);
          throw new Error(HOSTING_FULL_MESSAGE);
        }
        throw new Error(
          `Firebase Hosting channel creation failed (HTTP ${status}): ${msg}\n` +
          'Ensure the Cloud Run service account has the "Firebase Hosting Admin" IAM role.',
        );
      }
      // 409 = the channel already exists (every redeploy after the first). Its URL — hash and all —
      // is only knowable by asking, which is exactly what the old constructed URL skipped.
    }
    if (!url) {
      const existing = await this.hostingCall('channel lookup', () =>
        axios.get<{ url?: string }>(`${HOSTING_API}/sites/${site}/channels/${channelId}`, { headers }));
      url = typeof existing.data?.url === 'string' ? existing.data.url : '';
    }
    if (!url) {
      // Honest stop rather than a second guessed URL. The files may well be uploaded, but handing back
      // a host we invented is the precise failure being fixed — saying so is the smaller harm.
      throw new Error(
        'Firebase Hosting did not return the channel URL, so NavBharatAI cannot tell you where your app '
        + 'is live. Please publish again in a moment.',
      );
    }
    return url;
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
/**
 * The message a user sees when the channel pool is exhausted (ROADMAP §10).
 *
 * WHY IT IS A CONSTANT AND NOT AN INLINE STRING: this is the ONE moment the ceiling becomes visible
 * to a real person, and two rules meet on it. The white-label law says the user must never learn
 * which vendor hosts their app — the raw failure names Firebase Hosting and an IAM role, and that
 * text was previously handed straight to the agent to paraphrase back to them — and rule 2 says we
 * do not pretend. So it names no vendor, blames no user, states plainly what is NOT lost, and gives
 * a way forward that works this minute.
 */
export const HOSTING_FULL_MESSAGE =
  'NavBharatAI hosting is full right now, so your app could not be published. Nothing was lost — your '
  + 'app and its code are safe, and publishing will work again once space frees up. You can also publish '
  + 'to your own free host (Vercel, Netlify or Cloudflare Pages) from the same Publish screen right now.';

/**
 * Does this Hosting failure mean the channel pool is FULL, rather than something we did wrong?
 *
 * ⚠️ HONESTLY A SUPERSET MATCH. The exact status and wording Firebase returns at the channel cap are
 * not documented and this has never been observed in production, so it matches generously on the
 * words a quota failure uses. A MISS degrades to the generic error — less friendly, still honest. A
 * FALSE POSITIVE is the risk worth guarding, because it would tell a user the platform is full when
 * the real problem was ours; that is why no 4xx status alone qualifies except 429, which means
 * exactly this.
 */
export function isChannelQuotaError(status: number | null | undefined, body: unknown): boolean {
  if (status === 429) return true;
  const text = (typeof body === 'string' ? body : JSON.stringify(body ?? '')).toLowerCase();
  return /resource_exhausted|quota|too many channels|maximum number of channels|channel limit/.test(text);
}

/**
 * `sites/<site>/channels/<id>` → `<id>`. Returns '' for anything that is not a channel resource.
 * The Hosting API only ever gives a channel's id inside its full resource `name`.
 */
export function channelIdFromResourceName(name: string | null | undefined): string {
  const s = String(name ?? '').trim();
  if (!s) return '';
  const parts = s.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

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
