// Nav App Store — a place where a NavBharatAI user can publish their Android app, and anyone can
// install it.
//
// THE SAFETY MODEL, stated once because every route below depends on it (admin 2026-07-27):
//
//   1. Every upload is INSPECTED (is this really a signed Android package? what does it ask for?).
//   2. Every upload is SCANNED against ~70 malware engines. No scan, no publication — ever.
//   3. Every upload lands as 'pending'. NOTHING in this file can make an app public. Only an admin,
//      explicitly, can approve one — because malware built for a specific campaign is routinely
//      unknown to every engine on the day it ships, so a clean scan informs the reviewer rather than
//      replacing them.
//   4. Every app's exact bytes are hashed and its uploader recorded, so a takedown is possible and
//      provable. Removing an app deletes the file, not just a flag.
//
// The admin asked for free uploads (₹0) now, rising later. Free is fine — but the fee was the only
// thing standing between this store and anyone with a banking trojan, so the human review step is
// what replaces it, and that is not a setting.

import type { Express, Request, Response } from 'express';
import { verifyFirebaseIdentity } from '../lib/authMiddleware';
import { inspectApk, MAX_APK_BYTES, publishableApkLimitBytes } from '../lib/apkInspect';
import axios from 'axios';
import { fetchBuildArtifact, type ArtifactFetcher } from '../lib/buildArtifact';

/** Real HTTP at the edge, so the artifact logic itself stays testable without a network. */
const githubZipFetcher: ArtifactFetcher = async (url, token) => {
  const r = await axios.get(url, {
    headers: { Authorization: `token ${token}` }, responseType: 'arraybuffer', maxRedirects: 5,
  });
  return { status: r.status, data: r.data as ArrayBuffer };
};

/** JSZip lazily — only the publish-from-build path needs it. */
const jsZipLoader = async (buf: Buffer) => {
  const JSZip = (await import('jszip')).default;
  return await JSZip.loadAsync(buf) as unknown as { files: Record<string, { async: (t: 'nodebuffer') => Promise<Buffer> }> };
};
import { scanFile, isScanningConfigured, MAX_SCANNABLE_BYTES} from '../lib/malwareScan';
import { githubTokenFromRequest } from '../lib/mobileShipAuth';
import {
  isStorageConfigured, putApk, getApk, getApkStream, deleteApk, saveApp, getApp, updateApp,
  listApps, listAppsByUid, toPublic,
  type StoreApp, type SubmissionStatus,
} from '../lib/navStoreStore';
import {
  evaluateWebPublish, hashAppPassword, verifyAppPassword, toPublicWebApp, newWebAppId,
  saveWebApp, getWebApp, getWebAppFiles, listListedWebApps, listMyWebApps, listUnlistedWebApps,
  saveWebAppBakedPage, getWebAppBakedPage,
  updateWebApp, makeWebAppPublic, bumpWebAppCounter, removeWebApp, reportWebApp,
  recordRemixOrigin, getRemixOrigin, keyShapedEnvVars,
  sanitizeScreenshots, saveWebAppScreenshots, getWebAppScreenshots,
  type WebStoreApp,
} from '../lib/navStoreWeb';
import { generateEnvExample } from '../AgentV3/EnvExampleGenerator';
import { loadWorkspaceFiles, saveWorkspaceFiles } from '../AgentV3/WorkspaceFileStore';
import { validateRemixPrice, hasPurchased, canAffordRemix, settleRemixPurchase, resalePriceCheck, resalePriceFloor, MAX_REMIX_PRICE_INR, PAID_REMIX_ENABLED, listPurchases } from '../lib/navStoreRemixPurchase';
import { addDataRow, listDataRows, isValidDataCollection } from '../lib/navStoreWebData';
import { rateLimiter } from '../lib/authMiddleware';
import { verifiedWorkspaceReadOk } from '../lib/workspaceIdentity';
import { verifyFirebaseToken } from '../lib/authMiddleware';
import { renderPreview } from '../runtime/renderPreview';
import { VirtualFileSystem } from '../project/ProjectModel';
import { escapeHtml } from '../../lib/escapeHtml';

/** What an upload costs today. One value, so raising it later is a one-line change. */
export const UPLOAD_FEE_INR = 0;

/**
 * The largest listing icon a store record may carry, as data-URL characters.
 *
 * A Firestore document is capped at 1 MiB and the icon rides inside the record, so this is a real
 * limit rather than a preference. The CLIENT fits every icon well under it before sending
 * (`STORE_ICON_MAX_CHARS` in `src/lib/appIcon.ts`, deliberately lower so the two can never meet at the
 * boundary) — this is the server's own guarantee, not a duplicate of that one.
 */
export const STORE_ICON_MAX_CHARS = 200_000;

export const STORE_CATEGORIES = [
  'Business', 'Education', 'Entertainment', 'Finance', 'Food & Drink', 'Games',
  'Health & Fitness', 'Lifestyle', 'News', 'Productivity', 'Shopping', 'Social', 'Tools', 'Travel',
] as const;

/** Who may review. Read from the same admin list the rest of the platform uses. */
export function isStoreAdmin(email: string | null): boolean {
  if (!email) return false;
  const list = (process.env.NAV_STORE_ADMINS || process.env.AGENTV3_FREE_LIST || '')
    .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return list.includes(email.toLowerCase());
}

export interface SubmissionForm {
  developerName: string;
  developerEmail: string;
  developerPhone?: string;
  developerWebsite?: string;
  appName: string;
  versionName: string;
  shortDescription: string;
  description: string;
  category: string;
  iconDataUrl?: string;
  /** The developer must state they have the right to publish this. Recorded, not decorative. */
  acceptedTerms: boolean;
}

/**
 * Check the submission form.
 *
 * Pure, so every rule is visible and tested. These are not bureaucracy: a real contact for the
 * developer is what makes a takedown or an abuse report actionable, and an unattributable app is
 * exactly what a malware uploader wants.
 */
export function validateSubmission(form: Partial<SubmissionForm>): { ok: true; value: SubmissionForm } | { ok: false; error: string } {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const developerName = str(form.developerName);
  const developerEmail = str(form.developerEmail);
  const appName = str(form.appName);
  const versionName = str(form.versionName);
  const shortDescription = str(form.shortDescription);
  const description = str(form.description);
  const category = str(form.category);

  if (developerName.length < 2) return { ok: false, error: 'Please enter the developer or company name.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(developerEmail)) return { ok: false, error: 'Please enter a valid contact email — it is how anyone reports a problem with your app.' };
  if (appName.length < 2) return { ok: false, error: 'Please enter the app name.' };
  if (appName.length > 60) return { ok: false, error: 'The app name is too long (60 characters maximum).' };
  if (!versionName) return { ok: false, error: 'Please enter the version, for example 1.0.0.' };
  if (shortDescription.length < 10) return { ok: false, error: 'Please write a one-line description (at least 10 characters).' };
  if (shortDescription.length > 120) return { ok: false, error: 'The one-line description must be 120 characters or fewer.' };
  if (description.length < 30) return { ok: false, error: 'Please describe what your app does, in at least 30 characters.' };
  if (!(STORE_CATEGORIES as readonly string[]).includes(category)) return { ok: false, error: 'Please choose a category.' };
  if (form.acceptedTerms !== true) return { ok: false, error: 'Please confirm you have the right to publish this app.' };

  const developerWebsite = str(form.developerWebsite);
  if (developerWebsite && !/^https?:\/\/[^\s"'<>]+$/i.test(developerWebsite)) {
    return { ok: false, error: 'The website must start with http:// or https://.' };
  }

  return {
    ok: true,
    value: {
      developerName, developerEmail,
      developerPhone: str(form.developerPhone) || undefined,
      developerWebsite: developerWebsite || undefined,
      appName, versionName, shortDescription, description, category,
      iconDataUrl: typeof form.iconDataUrl === 'string' && form.iconDataUrl.startsWith('data:image/') ? form.iconDataUrl : undefined,
      acceptedTerms: true,
    },
  };
}

/** Base64 payload → bytes, refusing anything that is not plausibly a file. */
/**
 * The ONE path from "we have APK bytes" to "a pending store record exists".
 *
 * Extracted when a second caller appeared (publish-from-build). Every guarantee the store rests on
 * lives HERE, so neither entry point can accidentally skip one:
 *   • the app MUST be one NavBharatAI built — `provenance` is REQUIRED, so there is no code path that
 *     can ingest an arbitrary file a user uploaded from their device (admin 2026-08-16: the store
 *     carries only NavBharatAI-built apps — "kisi aur ka banaya virus nahi"). A NavBharatAI build that
 *     lives in the user's own GitHub is still a NavBharatAI build and reaches here through
 *     publish-from-build; a random `.apk`/`.zip` from a device has no way in at all;
 *   • the file must genuinely be an installable, signed Android package;
 *   • it must be scanned — no verdict means NO publication, ever;
 *   • malware is recorded but never stored (we keep no copy of it);
 *   • the record lands as `pending`; nothing in this file can make an app public.
 * Returns an HTTP status + body rather than writing to the response, so it stays testable and both
 * routes report identically.
 */
async function ingestApkSubmission(
  bytes: Buffer,
  form: SubmissionForm,
  uid: string,
  provenance: { source: 'navbharatai-build'; repo: string; artifactId: string },
): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
    // 1) Is this genuinely an installable Android app?
    const facts = await inspectApk(bytes);
    if (!facts.ok) return { httpStatus: 422, body: { error: facts.error } };

    // 2) Malware scan. No verdict means no publication — this is the rule the store rests on.
    const scan = await scanFile(bytes, facts.sha256);
    if (scan.verdict === 'malicious') {
      // Recorded but never stored: we keep no copy of something the engines call malware.
      return { httpStatus: 422, body: {
        error: `This app was flagged as malicious by ${scan.malicious} security engines, so it cannot be published.`,
        flaggedBy: scan.flaggedBy.slice(0, 5),
        reportUrl: scan.reportUrl,
      } };
    }
    if (scan.verdict === 'unavailable') {
      return { httpStatus: 503, body: { error: `Your app could not be scanned, so it was not uploaded. ${scan.reason || ''}`.trim() } };
    }

    // 3) Store the bytes and the record. PENDING — an admin decides from here.
    const id = `${facts.sha256.slice(0, 16)}_${Date.now().toString(36)}`;
    try {
      const storagePath = await putApk(facts.sha256, bytes);
      const record: StoreApp = {
        id,
        status: 'pending',
        uid,
        developer: {
          name: form.developerName,
          email: form.developerEmail,
          phone: form.developerPhone,
          website: form.developerWebsite,
        },
        appName: form.appName,
        packageName: '',
        versionName: form.versionName,
        shortDescription: form.shortDescription,
        description: form.description,
        category: form.category,
        iconDataUrl: form.iconDataUrl,
        sha256: facts.sha256,
        sizeBytes: facts.sizeBytes,
        permissions: facts.permissions,
        highRisk: facts.highRisk,
        inspectionWarnings: facts.warnings,
        scanVerdict: scan.verdict,
        scanMalicious: scan.malicious,
        scanEnginesTotal: scan.enginesTotal,
        scanFlaggedBy: scan.flaggedBy,
        scanReportUrl: scan.reportUrl,
        scanReason: scan.reason,
        storagePath,
        downloads: 0,
        submittedAt: Date.now(),
        ...(provenance ? { provenance } : {}),
      };
      await saveApp(record);
      return { httpStatus: 200, body: {
        ok: true,
        id,
        status: 'pending',
        scanVerdict: scan.verdict,
        enginesChecked: scan.enginesTotal,
        highRisk: facts.highRisk,
        message: scan.verdict === 'suspicious'
          ? 'Your app was uploaded, but one security engine flagged it — a reviewer will look closely before it goes live.'
          : 'Your app was uploaded and passed the malware scan. A reviewer will check it before it appears in the store.',
      } };
    } catch {
      return { httpStatus: 502, body: { error: 'Your app could not be saved. Nothing was published — please try again.' } };
    }
}

export function registerNavStoreRoutes(app: Express): void {
  /**
   * Is the store open for submissions at all?
   *
   * Answered honestly and up front, so the upload screen can say "not accepting apps yet" instead of
   * taking someone's file and failing halfway.
   */
  app.get('/api/nav-store/status', async (req: Request, res: Response) => {
    const me = await verifyFirebaseIdentity(req);
    const storage = isStorageConfigured();
    const scanning = isScanningConfigured();
    res.json({
      acceptingUploads: storage && scanning,
      uploadFeeInr: UPLOAD_FEE_INR,
      categories: STORE_CATEGORIES,
      // The number users see must be the one that can actually publish (see publishableApkLimitBytes).
      maxSizeMb: publishableApkLimitBytes(MAX_APK_BYTES, MAX_SCANNABLE_BYTES) / 1024 / 1024,
      isAdmin: isStoreAdmin(me?.email ?? null),
      // Named plainly so the admin knows exactly what to switch on, rather than seeing a dead button.
      missing: [
        ...(storage ? [] : ['app storage (NAV_STORE_BUCKET)']),
        ...(scanning ? [] : ['malware scanning (VIRUSTOTAL_API_KEY)']),
      ],
    });
  });

  // NO DEVICE-UPLOAD ROUTE — the store carries ONLY apps NavBharatAI built (admin 2026-08-16).
  //
  // There used to be a `POST /api/nav-store/submit` that ingested a raw `.apk` the user picked from
  // their device (chunked upload / base64). That was the one hole through which "kisi aur ka banaya
  // virus" could enter the store — the malware scan + admin review sat downstream of an untrusted
  // SOURCE. It also contradicted the store's own stated rule (see publish-from-build below). It has
  // been removed entirely: the ONLY way bytes reach `ingestApkSubmission` is publish-from-build, which
  // pulls a NavBharatAI build artifact from the user's own GitHub Actions server-side. A NavBharatAI
  // build stored in the user's GitHub is still allowed (that IS publish-from-build); a device file, a
  // hand-uploaded `.zip`, or anyone else's `.apk` has no route in at all. `ingestApkSubmission` now
  // REQUIRES provenance, so even a future caller cannot re-open this hole by accident.

  /**
   * PUBLISH FROM THE BUILD — the button that sits next to "Download APK" (admin 2026-08-04).
   *
   * The Nav App Store carries only apps NavBharatAI built, and the user should never have to handle
   * the file: `/api/mobile-ship/download` already pulls the finished artifact from GitHub Actions
   * SERVER-SIDE, so the same bytes can go straight into the store. No upload, no "choose file".
   *
   * It reuses `fetchBuildArtifact` (shared with the download route) and `ingestApkSubmission` (shared
   * with the manual upload), so scanning, the pending-only rule and the honest failures cannot be
   * skipped on this path — they are the same code.
   *
   * HONEST LIMIT, recorded rather than implied: this is PROVENANCE, not proof. The build runs in the
   * USER's own GitHub Actions with the USER's signing key, so a determined user could push arbitrary
   * code into their own repo before building. That is exactly why the scan and admin approval stay
   * mandatory here — publishing from a build earns no shortcut past either.
   */
  app.post('/api/nav-store/publish-from-build', async (req: Request, res: Response) => {
    const me = await verifyFirebaseIdentity(req);
    if (!me?.uid) return res.status(401).json({ error: 'Please sign in to publish an app.' });

    if (!isStorageConfigured() || !isScanningConfigured()) {
      return res.status(503).json({
        error: 'The Nav App Store is not accepting apps yet — malware scanning and app storage must be switched on first. Nothing was uploaded.',
      });
    }

    const body = (req.body || {}) as Record<string, unknown>;
    const parsed = validateSubmission(body as Partial<SubmissionForm>);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });

    // The GitHub token is the USER's — we read their artifact on their behalf, exactly as the
    // download button already does, and from the SAME place it does.
    //
    // ROOT CAUSE (admin 2026-08-19: "github connected hai fir bhi yeh error"). This line used to read
    // `body.githubToken`, while the client — `PublishToNavStore.tsx`, sharing the download button's
    // own `ghHeaders()` — sends it as the `X-GitHub-Token` HEADER. The token was therefore ALWAYS
    // empty here, so "Send for review" failed 100% of the time with "Connect GitHub first", sending
    // the user to reconnect an account that was already connected perfectly.
    //
    // This is the THIRD copy of "where does the GitHub token live", and `mobileShipAuth.ts` exists
    // precisely because the first two disagreed — its header documents that exact outage. The lesson
    // was written down and then missed anyway, because its test asserted only the two route files
    // that existed at the time, and this route was written later. A rule that guards a fixed list of
    // files does not guard the rule; the test now covers EVERY route that takes a GitHub token.
    const token = githubTokenFromRequest(req) ?? '';
    const owner = String(body.owner ?? '');
    const repo = String(body.repo ?? '');
    const artifactId = String(body.artifactId ?? '');

    const got = await fetchBuildArtifact({ owner, repo, artifactId, token }, githubZipFetcher, jsZipLoader);
    if (!got.ok) {
      const status = got.failure === 'expired' ? 404 : got.failure === 'not-app' ? 422 : got.failure === 'bad-request' ? 400 : 502;
      return res.status(status).json({ error: got.message, failure: got.failure });
    }

    const publishCap = publishableApkLimitBytes(MAX_APK_BYTES, MAX_SCANNABLE_BYTES);
    if (got.bytes.length > publishCap) {
      return res.status(413).json({ error: `That file is over the ${publishCap / 1024 / 1024} MB limit.` });
    }

    const out = await ingestApkSubmission(got.bytes, parsed.value, me.uid, {
      source: 'navbharatai-build', repo: `${owner}/${repo}`, artifactId,
    });
    return res.status(out.httpStatus).json(out.body);
  });

  /** A developer's own submissions, with the real status of each. */
  app.get('/api/nav-store/mine', async (req: Request, res: Response) => {
    const me = await verifyFirebaseIdentity(req);
    if (!me?.uid) return res.status(401).json({ error: 'Please sign in.' });
    try {
      const apps = await listAppsByUid(me.uid);
      res.json({
        apps: apps.map((a) => ({
          id: a.id, appName: a.appName, versionName: a.versionName, status: a.status,
          submittedAt: a.submittedAt, reviewedAt: a.reviewedAt, reviewNote: a.reviewNote,
          scanVerdict: a.scanVerdict, downloads: a.downloads, sizeBytes: a.sizeBytes,
        })),
      });
    } catch {
      res.status(502).json({ error: 'Could not load your apps.' });
    }
  });

  /** The public store. Approved apps only — there is no parameter that can widen this. */
  app.get('/api/nav-store/apps', async (req: Request, res: Response) => {
    try {
      const category = String(req.query.category || '');
      const apps = await listApps('approved', 100);
      const filtered = category ? apps.filter((a) => a.category === category) : apps;
      res.json({ apps: filtered.map(toPublic) });
    } catch {
      res.status(502).json({ error: 'Could not load the store.' });
    }
  });

  /** One approved app's full detail. */
  app.get('/api/nav-store/app/:id', async (req: Request, res: Response) => {
    try {
      const found = await getApp(String(req.params.id || ''));
      if (!found || found.status !== 'approved') return res.status(404).json({ error: 'That app is not available.' });
      res.json({ app: toPublic(found) });
    } catch {
      res.status(502).json({ error: 'Could not load that app.' });
    }
  });

  /**
   * Download an approved app.
   *
   * Served through here rather than from a public bucket URL, so removing an app genuinely stops the
   * download instead of leaving a link alive somewhere.
   */
  app.get('/api/nav-store/download/:id', async (req: Request, res: Response) => {
    // A DOWNLOAD IS A NAVIGATION, SO A FAILURE MUST READ LIKE A PAGE (admin report 2026-08-19:
    // "app mart se apk download hi nahi hoti"). This route is opened by the browser itself, not by
    // fetch — so answering a failure with a JSON body showed the user a line of raw code, or nothing
    // at all, and the button simply looked dead. Say what happened, in words.
    const fail = (code: number, message: string) => {
      if (String(req.headers.accept || '').includes('application/json')) {
        return res.status(code).json({ error: message });
      }
      res.status(code).type('html').send(
        `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;` +
        `background:#0d1117;color:#e6edf3;font:16px/1.6 system-ui,sans-serif;padding:24px;text-align:center">` +
        `<div><p style="font-weight:700;margin:0 0 8px">${escapeHtml(message)}</p>` +
        `<p style="color:#8b949e;margin:0;font-size:14px">Go back to App Mart and try again.</p></div>`,
      );
    };

    let found: Awaited<ReturnType<typeof getApp>> = null;
    try {
      found = await getApp(String(req.params.id || ''));
    } catch {
      return fail(502, 'Could not reach the store just now.');
    }
    if (!found || found.status !== 'approved') return fail(404, 'That app is not available.');

    const safeName = found.appName.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 40) || 'app';
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}-${found.versionName}.apk"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Known from the record, so the phone can show a real progress bar instead of an unknown size.
    if (typeof found.sizeBytes === 'number' && found.sizeBytes > 0) {
      res.setHeader('Content-Length', String(found.sizeBytes));
    }

    // STREAMED, not buffered: an app is 5–50 MB, and holding all of it in the server's memory before
    // sending a byte is both slow to start and a real memory risk under two concurrent downloads.
    let stream: NodeJS.ReadableStream;
    try {
      stream = getApkStream(found.storagePath);
    } catch {
      return fail(502, 'This app’s file could not be opened.');
    }
    stream.on('error', () => {
      // Once bytes are on the wire the status is already sent, so the only honest signal left is to
      // break the connection — a truncated file the user believes is complete would be worse.
      if (res.headersSent) res.destroy();
      else fail(502, 'This app’s file could not be read.');
    });
    stream.pipe(res);
    // The count is updated once the file is genuinely on its way, and never allowed to fail it.
    await updateApp(found.id, { downloads: (found.downloads || 0) + 1 }).catch(() => { /* a count is never worth failing a download */ });
  });

  // ── Admin review ───────────────────────────────────────────────────────────

  /** The review queue, with everything a reviewer needs to decide. */
  app.get('/api/nav-store/admin/queue', async (req: Request, res: Response) => {
    const me = await verifyFirebaseIdentity(req);
    if (!isStoreAdmin(me?.email ?? null)) return res.status(403).json({ error: 'Not allowed.' });
    try {
      const status = String(req.query.status || 'pending') as SubmissionStatus;
      const valid: SubmissionStatus[] = ['pending', 'approved', 'rejected', 'removed'];
      res.json({ apps: await listApps(valid.includes(status) ? status : 'pending', 100) });
    } catch {
      res.status(502).json({ error: 'Could not load the queue.' });
    }
  });

  /**
   * Approve, reject or remove an app.
   *
   * This is the only door to 'approved' in the entire system, and it requires a real admin. Removing
   * an app deletes its bytes, so a takedown is genuine rather than a hidden flag.
   */
  app.post('/api/nav-store/admin/review', async (req: Request, res: Response) => {
    const me = await verifyFirebaseIdentity(req);
    if (!isStoreAdmin(me?.email ?? null)) return res.status(403).json({ error: 'Not allowed.' });

    const { id, decision, note } = (req.body || {}) as Record<string, unknown>;
    const appId = String(id || '');
    const allowed = ['approved', 'rejected', 'removed'];
    if (!appId || !allowed.includes(String(decision))) {
      return res.status(400).json({ error: 'An app id and a decision (approved, rejected or removed) are required.' });
    }

    try {
      const found = await getApp(appId);
      if (!found) return res.status(404).json({ error: 'No such app.' });

      const status = String(decision) as SubmissionStatus;
      await updateApp(appId, {
        status,
        reviewedAt: Date.now(),
        reviewedBy: me?.email || 'admin',
        reviewNote: typeof note === 'string' ? note.slice(0, 500) : undefined,
      });
      // A removed app must actually stop existing, not merely stop being listed.
      if (status === 'removed' || status === 'rejected') await deleteApk(found.storagePath);

      res.json({ ok: true, id: appId, status });
    } catch {
      res.status(502).json({ error: 'Could not save that decision.' });
    }
  });

  // ═══ WEB APPS — the browser-run store (Kadam 0/1 of the ecosystem plan, admin 2026-08-15) ═══
  //
  // See src/server/lib/navStoreWeb.ts for the full safety model. Shape of the lifecycle:
  // publish (gated) → live via direct link (`unlisted`) → admin lists it (`listed`) → takedown
  // (`removed`, snapshot deleted). Private apps demand their password SERVER-side on every open.

  /**
   * Compiled-player cache. A snapshot is immutable (re-publish bumps `version`), so a compiled page
   * can be reused for every viewer of that version — the compile cost is paid once per version per
   * instance, and 10,000 viewers of one app cost the same CPU as one. Keyed by id+version; bounded.
   */
  /**
   * Bake the store app id in, which flips window.NavData from its per-device preview backend to the
   * REAL shared rows — the difference between "a chat app that talks to yourself" and one that talks
   * to everyone. Injected at SERVE time in both branches (baked page and live compile), never stored
   * in the bake, so the bake stays a pure function of the published files.
   */
  const withStoreAppId = (html: string, id: string): string => {
    const idTag = `<script>window.__NBAI_STORE_APP_ID=${JSON.stringify(id)};</script>`;
    return html.includes('<body>') ? html.replace('<body>', `<body>${idTag}`) : idTag + html;
  };
  const webPlayerCache = new Map<string, { html: string; kind: string }>();
  const WEB_PLAYER_CACHE_MAX = 40;

  /** One-click publish: snapshot the workspace, gate it, and hand back the share link. */
  /**
   * Server-side forensics for every web-store catch. The USER-facing reply stays generic (the
   * white-label law — no provider or infra detail ever reaches a user), but the REAL error must
   * land in the Cloud Run logs: the store's first live publish failed and this catch swallowed the
   * cause without a trace, turning a one-grep diagnosis into an autopsy. Logging is the fix's other
   * half — the query-shape fix kills this instance; the log line kills the silence for the class.
   */
  const logStoreError = (where: string, e: unknown) =>
    console.error(`[nav-store] ${where} failed:`, e instanceof Error ? e.stack || e.message : e);

  app.post('/api/nav-store/web/publish', async (req: Request, res: Response) => {
    const me = await verifyFirebaseIdentity(req);
    if (!me?.uid) return res.status(401).json({ error: 'Sign in to publish to the store.' });

    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required.' });
    // Publishing DISTRIBUTES code — strict gate: the verified account must own the workspace.
    if (!verifiedWorkspaceReadOk(await verifyFirebaseToken(req), workspaceId)) {
      return res.status(403).json({ error: 'This workspace does not belong to you.' });
    }

    const name = (typeof req.body?.name === 'string' ? req.body.name : '').trim().slice(0, 60);
    const description = (typeof req.body?.description === 'string' ? req.body.description : '').trim().slice(0, 600);
    // AN ICON IS EITHER USED OR REFUSED OUT LOUD — never silently dropped (rule 5, honesty).
    // This used to fall back to `undefined` for anything oversized, so a creator who added an icon
    // published successfully and then found a listing with no icon and no explanation. The client now
    // fits every icon under the cap before sending (src/lib/appIcon.ts), so reaching this refusal means
    // something genuinely unusable arrived — and saying so beats a blank card.
    const rawIcon = typeof req.body?.iconDataUrl === 'string' ? req.body.iconDataUrl : '';
    if (rawIcon && !rawIcon.startsWith('data:image/')) {
      return res.status(400).json({ error: 'That app icon could not be read as an image. Pick a PNG or JPG.' });
    }
    if (rawIcon.length >= STORE_ICON_MAX_CHARS) {
      return res.status(400).json({ error: 'That app icon is too large. Use a smaller square picture — or press "Make icon" and let NavBharatAI create one.' });
    }
    const iconDataUrl = rawIcon || undefined;
    // Listing screenshots (admin report 2026-08-19). The sanitizer is the boundary of what may be stored
    // — anything non-image / oversize / over the count is dropped, never truncated into a broken image.
    const screenshots = sanitizeScreenshots(req.body?.screenshots);
    const visibility = req.body?.visibility === 'private' ? 'private' as const : 'public' as const;
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!name) return res.status(400).json({ error: 'Give your app a name.' });
    if (visibility === 'private' && password.length < 4) {
      return res.status(400).json({ error: 'A private app needs a password of at least 4 characters.' });
    }

    try {
      // THE UNDERCUT RULE (admin 2026-08-15, superseding the flat re-list ban of the same day): a
      // paid remix MAY be re-listed — but never at or below the original creator's price, and never
      // free, however much it was edited ("chahe woh kitna bhi edit kar le"). Lineage makes editing
      // irrelevant: the parent travels with the workspace from the moment of remix.
      //
      // Publish carries no price field, so a paid remix LISTS AT THE FLOOR (one rupee above the
      // original) and the owner may raise it later — settings enforce the same floor. Refusing
      // publish until a price was typed would be a dead end; auto-pricing AT the floor is the only
      // number that is simultaneously lawful, minimal, and not our invention (the rule fixes it).
      const remixParent = await getRemixOrigin(workspaceId);
      let resaleFloorPrice: number | undefined;
      // PAID REMIX PARKED — with every remix free, there is no original price to undercut, so
      // auto-pricing a resale would invent a charge nobody asked for. The rule itself is untouched
      // and returns with the money.
      if (PAID_REMIX_ENABLED && remixParent) {
        const parentApp = await getWebApp(remixParent);
        if (parentApp && parentApp.status !== 'removed' && (parentApp.priceInr ?? 0) > 0) {
          const floor = resalePriceFloor(parentApp.priceInr ?? 0);
          if (floor > MAX_REMIX_PRICE_INR) {
            return res.status(403).json({ error: 'The original app is at the store\'s maximum price, so a resale above it isn\'t possible. The app is fully yours to build on — publish it with hosting or as an Android app instead.' });
          }
          resaleFloorPrice = floor;
        }
      }
      const workspaceFiles = await loadWorkspaceFiles(workspaceId);
      const gate = evaluateWebPublish(workspaceFiles);
      if (!gate.ok) return res.status(422).json({ error: gate.reason });

      // RE-PUBLISH = same listing, new version — one app id per (owner, workspace), so updating
      // never spawns a duplicate listing and the share link the creator already sent keeps working.
      const mine = await listMyWebApps(me.uid);
      const existing = mine.find((a) => a.workspaceId === workspaceId && a.status !== 'removed');
      const id = existing?.id ?? newWebAppId();
      const pw = visibility === 'private' ? hashAppPassword(password) : undefined;
      const record: WebStoreApp = {
        id,
        // A re-publish keeps its earned place: a listed app stays listed (same owner, same listing —
        // the admin reviewed the LISTING; content updates are the point of re-publishing).
        status: existing?.status === 'listed' ? 'listed' : 'unlisted',
        uid: me.uid,
        name, description, iconDataUrl,
        visibility,
        ...(pw ? { passwordHash: pw.hash, passwordSalt: pw.salt } : {}),
        workspaceId,
        // LINEAGE: a workspace born as a remix carries its parent onto everything it publishes. The
        // fact was recorded at remix time — the only moment it is knowable — and survives here.
        ...((existing?.parentAppId || await getRemixOrigin(workspaceId)) ? { parentAppId: existing?.parentAppId || (await getRemixOrigin(workspaceId))! } : {}),
        fileCount: Object.keys(gate.files).length,
        sizeBytes: Object.values(gate.files).reduce((n, c) => n + Buffer.byteLength(c, 'utf8'), 0),
        // "api sell nahi hogi" — the vars a remixer will have to bring, known at publish and shown
        // BEFORE anyone pays. The creator's own keys are already physically absent (scan + .env drop).
        apiVarsUsed: keyShapedEnvVars(gate.files),
        runs: existing?.runs ?? 0,
        remixes: existing?.remixes ?? 0,
        // RE-PUBLISH MUST NOT WIPE MONEY OR QUOTA STATE (found while adding the undercut rule): the
        // record replaces the doc wholesale, so any field not carried here is silently reset. The
        // price resetting to free on every update would undercut the CREATOR THEMSELVES; the data-row
        // counter resetting would let an app evade its storage quota by republishing.
        ...((): Record<string, number> => {
          const carried: Record<string, number> = {};
          const keptPrice = existing?.priceInr ?? 0;
          const price = resaleFloorPrice !== undefined ? Math.max(keptPrice, resaleFloorPrice) : keptPrice;
          if (price > 0) carried.priceInr = price;
          const rows = (existing as unknown as { dataRows?: number } | undefined)?.dataRows;
          if (typeof rows === 'number' && rows > 0) carried.dataRows = rows;
          return carried;
        })(),
        screenshotCount: screenshots.length,
        publishedAt: Date.now(),
        version: (existing?.version ?? 0) + 1,
      };
      await saveWebApp(record, gate.files);
      // BAKE THE PAGE NOW, while we already hold the files (admin 2026-08-25, "app mart me app
      // jaldi open ho"): the page a viewer gets is fully determined at publish time, so compiling it
      // per-instance on first open was pure repeated latency — one doc read now replaces a
      // subcollection read + a 200–500 ms compile on every cold serve. Best-effort by design: the
      // publish already saved app + files above, and a failed or skipped bake (page too big for a
      // doc) only means opens fall back to today's serve-time compile — slower, never broken.
      try {
        const hdrHost = req.get('host');
        const bakeOrigin = hdrHost ? `${(req.headers['x-forwarded-proto'] as string) || req.protocol || 'https'}://${hdrHost}` : undefined;
        await saveWebAppBakedPage(id, record.version, renderPreview(VirtualFileSystem.fromRecord(gate.files), bakeOrigin, `store-${id}`));
      } catch (e) { logStoreError('web/publish bake', e); }
      // Screenshots replace wholesale, in their own subcollection — best-effort so a screenshot write
      // failure never fails a publish whose app + files already saved. screenshotCount above stays
      // honest to what was ACCEPTED; getWebAppScreenshots is what the detail view actually serves.
      try { await saveWebAppScreenshots(id, screenshots); } catch (e) { logStoreError('web/publish screenshots', e); }
      webPlayerCache.delete(id); // the old version's compiled page must not survive the update
      res.json({
        ok: true, id, status: record.status, version: record.version, shareUrl: `/store/app/${id}`,
        ...(resaleFloorPrice !== undefined && record.priceInr ? {
          priceInr: record.priceInr,
          priceNote: `This is a paid remix, so it lists at ₹${record.priceInr} — the rule is that a remix always costs more than the original. You can raise the price (never lower it below the original) under Nav App Store → My apps.`,
        } : {}),
      });
    } catch (e) {
      logStoreError('web/publish', e);
      res.status(502).json({ error: 'Publishing failed — nothing was published. Try again.' });
    }
  });

  /** Public listing metadata. A removed app is gone for viewers, honestly 404. */
  app.get('/api/nav-store/web/app/:id', async (req: Request, res: Response) => {
    try {
      const found = await getWebApp(String(req.params.id || ''));
      if (!found || found.status === 'removed') return res.status(404).json({ error: 'This app is not on the store.' });
      // The detail view is the ONE place the screenshot bytes ship — never on the browse list, so a
      // gallery of listings stays light. Best-effort: a screenshot read failure still returns the app.
      const screenshots = (found.screenshotCount ?? 0) > 0 ? await getWebAppScreenshots(found.id).catch(() => []) : [];
      res.json({ app: toPublicWebApp(found), screenshots });
    } catch (e) {
      logStoreError('web/app meta', e);
      res.status(502).json({ error: 'Could not load that app.' });
    }
  });

  /**
   * OPEN = serve the compiled player page. The one place a private password is checked — and it is
   * checked HERE, before any file leaves the server, which is what makes "private" true rather than
   * decorative. POST so the password travels in a body, never in a URL that lands in logs/history.
   */
  app.post('/api/nav-store/web/app/:id/open', async (req: Request, res: Response) => {
    try {
      const found = await getWebApp(String(req.params.id || ''));
      if (!found || found.status === 'removed') return res.status(404).json({ error: 'This app is not on the store.' });
      if (found.visibility === 'private') {
        const pw = typeof req.body?.password === 'string' ? req.body.password : '';
        if (!verifyAppPassword(pw, found.passwordHash, found.passwordSalt)) {
          return res.status(401).json({ error: 'This app is private — the password is wrong or missing.', requiresPassword: true });
        }
      }
      const cacheKey = `${found.id}@${found.version}`;
      let compiled = webPlayerCache.get(cacheKey);
      if (!compiled) {
        // FAST PATH — the page baked at publish time: one small doc read instead of every file +
        // a compile. Version-checked inside, so a re-publish can never serve its predecessor.
        const baked = await getWebAppBakedPage(found.id, found.version);
        if (baked) compiled = { html: withStoreAppId(baked, found.id), kind: 'web' };
      }
      if (!compiled) {
        const files = await getWebAppFiles(found.id);
        if (Object.keys(files).length === 0) return res.status(404).json({ error: 'This app has no published files.' });
        const hdrHost = req.get('host');
        const origin = hdrHost ? `${(req.headers['x-forwarded-proto'] as string) || req.protocol || 'https'}://${hdrHost}` : undefined;
        const vfs = VirtualFileSystem.fromRecord(files);
        // The SAME compiler the in-browser preview uses — one engine, one set of guarantees. The
        // client renders this html in a sandboxed iframe WITHOUT allow-same-origin (opaque origin),
        // so a store app can never read the platform's storage or tokens.
        const html = renderPreview(vfs, origin, `store-${found.id}`);
        compiled = { html: withStoreAppId(html, found.id), kind: 'web' };
      }
      // One L1 write for BOTH sources (baked doc or live compile), so a hot app costs zero reads.
      if (!webPlayerCache.has(cacheKey)) {
        webPlayerCache.set(cacheKey, compiled);
        if (webPlayerCache.size > WEB_PLAYER_CACHE_MAX) {
          const oldest = webPlayerCache.keys().next().value;
          if (oldest !== undefined) webPlayerCache.delete(oldest);
        }
      }
      bumpWebAppCounter(found.id, 'runs');
      res.json({ html: compiled.html, name: found.name });
    } catch (e) {
      logStoreError('web/open', e);
      res.status(502).json({ error: 'Could not open that app.' });
    }
  });

  /** The browsable store — LISTED apps only (admin-curated discovery; links work from `unlisted`). */
  app.get('/api/nav-store/web/apps', async (_req: Request, res: Response) => {
    try {
      res.json({ apps: (await listListedWebApps()).map(toPublicWebApp) });
    } catch (e) {
      logStoreError('web/apps list', e);
      res.status(502).json({ error: 'Could not load the store.' });
    }
  });

  /** The creator's own web apps — includes unlisted/removed, because they are the owner. */
  app.get('/api/nav-store/web/mine', async (req: Request, res: Response) => {
    const me = await verifyFirebaseIdentity(req);
    if (!me?.uid) return res.status(401).json({ error: 'Sign in first.' });
    try {
      const mine = await listMyWebApps(me.uid);
      res.json({ apps: mine.map((a) => ({ ...toPublicWebApp(a), status: a.status, workspaceId: a.workspaceId })) });
    } catch (e) {
      logStoreError('web/mine', e);
      res.status(502).json({ error: 'Could not load your apps.' });
    }
  });

  /** Owner controls: visibility/password, or unpublish (a real removal — snapshot deleted). */
  app.post('/api/nav-store/web/app/:id/settings', async (req: Request, res: Response) => {
    const me = await verifyFirebaseIdentity(req);
    if (!me?.uid) return res.status(401).json({ error: 'Sign in first.' });
    try {
      const found = await getWebApp(String(req.params.id || ''));
      if (!found || found.uid !== me.uid) return res.status(404).json({ error: 'No such app of yours.' });
      if (req.body?.action === 'unpublish') {
        await removeWebApp(found.id, 'unpublished by the owner', me.email || me.uid);
        return res.json({ ok: true, status: 'removed' });
      }
      if (req.body?.priceInr !== undefined) {
        // Refused HERE, not just hidden in the UI: a price that cannot be stored cannot later be
        // charged by any path. Honest about what it is — parked, not broken.
        if (!PAID_REMIX_ENABLED) {
          return res.status(503).json({ error: 'Selling apps is coming soon — every app on the store is free to remix right now. Publish and share it; you will be able to set a price when it opens.' });
        }
        const price = validateRemixPrice(req.body.priceInr);
        if (!price.ok) return res.status(400).json({ error: price.reason });
        // The undercut rule, at the second place a price is ever set. The floor is the parent's
        // price AT THIS MOMENT — the original creator's current ask is what must not be undercut.
        if (found.parentAppId) {
          const parent = await getWebApp(found.parentAppId);
          if (parent && parent.status !== 'removed') {
            const check = resalePriceCheck(price.priceInr, parent.priceInr ?? 0);
            if (!check.ok) return res.status(403).json({ error: check.reason });
          }
        }
        await updateWebApp(found.id, { priceInr: price.priceInr });
        return res.json({ ok: true, priceInr: price.priceInr });
      }
      const visibility = req.body?.visibility === 'private' ? 'private' as const : req.body?.visibility === 'public' ? 'public' as const : null;
      if (!visibility) return res.status(400).json({ error: 'Nothing to change.' });
      if (visibility === 'private') {
        const password = typeof req.body?.password === 'string' ? req.body.password : '';
        if (password.length < 4) return res.status(400).json({ error: 'A private app needs a password of at least 4 characters.' });
        const pw = hashAppPassword(password);
        await updateWebApp(found.id, { visibility, passwordHash: pw.hash, passwordSalt: pw.salt });
      } else {
        await makeWebAppPublic(found.id);
      }
      res.json({ ok: true, visibility });
    } catch (e) {
      logStoreError('web/settings', e);
      res.status(502).json({ error: 'Could not save that change.' });
    }
  });

  /**
   * REMIX — "make it yours" (Kadam 2). Copies the published snapshot into the CALLER'S OWN fresh
   * workspace, so the store's viewer becomes a creator in one tap.
   *
   * The trust rules, in order:
   *   • A PRIVATE app demands its password here exactly as /open does — remix is a stronger read
   *     than viewing (it hands over the code), so it can never require less.
   *   • The TARGET workspace must belong to the caller (verified owner, or an anon workspace by its
   *     unguessable sid — the same capability model v5 itself uses, so signed-out remix works).
   *   • The target must be EMPTY. Remixing into a workspace that has files would silently bury
   *     someone's real work under a stranger's app — refused, never merged.
   *   • What is copied is the published SNAPSHOT — never the creator's live workspace.
   */
  app.post('/api/nav-store/web/app/:id/remix', async (req: Request, res: Response) => {
    try {
      const found = await getWebApp(String(req.params.id || ''));
      if (!found || found.status === 'removed') return res.status(404).json({ error: 'This app is not on the store.' });
      if (found.visibility === 'private') {
        const pw = typeof req.body?.password === 'string' ? req.body.password : '';
        if (!verifyAppPassword(pw, found.passwordHash, found.passwordSalt)) {
          return res.status(401).json({ error: 'This app is private — the password is wrong or missing.', requiresPassword: true });
        }
      }
      const target = typeof req.body?.targetWorkspaceId === 'string' ? req.body.targetWorkspaceId : '';
      if (!target) return res.status(400).json({ error: 'targetWorkspaceId is required.' });
      if (!verifiedWorkspaceReadOk(await verifyFirebaseToken(req), target)) {
        return res.status(403).json({ error: 'That workspace does not belong to you.' });
      }
      const already = await loadWorkspaceFiles(target);
      if (Object.keys(already).length > 0) {
        return res.status(409).json({ error: 'That workspace already has files — remix into a fresh app instead.' });
      }
      // ── PAID REMIX (Kadam 3) ──────────────────────────────────────────────────────────────────
      // Non-refundable by decision, fair by construction (the app is free to RUN before buying).
      // Owners and past buyers pay nothing; an anonymous viewer has no wallet, so a paid remix
      // needs sign-in — said plainly, never a dead button.
      // The single place a remix's price is READ. Parked ⇒ 0, so every branch below (sign-in demand,
      // wallet check, debit, creator credit) is skipped by the same condition that already handled a
      // free app — no separate "disabled" code path to keep in sync, and no way for a stored price
      // on an old listing to charge anyone.
      const price = PAID_REMIX_ENABLED ? (found.priceInr ?? 0) : 0;
      const buyerUid = await verifyFirebaseToken(req);
      let settlementNote: string | undefined;
      // "Buy once, take the code whenever you like" (admin 2026-08-16) — reported back so v5 can say
      // "copied again" rather than "yours now". Only read when there IS a price: while paid remix is
      // parked this stays false and costs no lookup.
      let alreadyOwned = false;
      if (price > 0 && buyerUid !== found.uid) {
        if (!buyerUid) return res.status(401).json({ error: `This remix costs ₹${price} — sign in to buy it (it's non-refundable; you can use the app free first).` });
        const owned = await hasPurchased(found.id, buyerUid);
        alreadyOwned = owned;
        if (!owned) {
          const afford = await canAffordRemix(buyerUid, price);
          if (!afford.ok) return res.status(402).json({ error: afford.reason });
        }
      }
      const files = await getWebAppFiles(found.id);
      if (Object.keys(files).length === 0) return res.status(404).json({ error: 'This app has no published files.' });
      // DELIVER FIRST, CHARGE AFTER — the platform's "working result or free" order. A debit failure
      // after delivery means the buyer got it free; the reverse order could take money for nothing.
      // THE ADMIN'S KEY RULE ("api user B ko deni hogi"): the creator's keys were never in the
      // snapshot — but B's copy must SAY what it needs, or B's first build fails mysteriously. An
      // .env.example listing the key-shaped vars is the platform's own convention: v5's existing
      // secret-preflight reads it and asks B for THEIR OWN keys at the right moment. Merged over the
      // snapshot's own example if one shipped, so nothing the creator wrote is lost.
      const neededVars = keyShapedEnvVars(files);
      const delivered: Record<string, string> = { ...files };
      if (neededVars.length > 0) {
        delivered['.env.example'] = generateEnvExample(neededVars, files['.env.example'] ?? null);
      }
      await saveWorkspaceFiles(target, delivered);
      await recordRemixOrigin(target, found.id);
      if (price > 0 && buyerUid && buyerUid !== found.uid) {
        const settled = await settleRemixPurchase({ appId: found.id, appName: found.name, buyerUid, creatorUid: found.uid, priceInr: price });
        settlementNote = settled.note;
      }
      bumpWebAppCounter(found.id, 'remixes');
      res.json({ ok: true, fileCount: Object.keys(files).length, name: found.name, apiKeysNeeded: neededVars, alreadyOwned, ...(settlementNote ? { settlementNote } : {}) });
    } catch (e) {
      logStoreError('web/remix', e);
      res.status(502).json({ error: 'The remix failed — nothing was copied.' });
    }
  });

  /**
   * WHAT THIS BUYER OWNS (admin 2026-08-16: "purchase ho jaye to us par kharidne wale ka naam likh
   * jaye, fir jitni baar chahe code copy kare — par bas wahi ek app").
   *
   * A purchase is a permanent entitlement, not a one-shot download. The record and the free
   * re-remix already existed; this is the missing half — being able to SEE what you own, so the
   * guarantee is usable instead of theoretical. Nothing here grants anything: the remix route
   * re-checks `hasPurchased` for the ONE app being copied, so this list can never widen access.
   */
  app.get('/api/nav-store/web/purchases', async (req: Request, res: Response) => {
    const me = await verifyFirebaseIdentity(req);
    if (!me?.uid) return res.status(401).json({ error: 'Sign in to see the apps you own.' });
    try {
      const owned = await listPurchases(me.uid);
      // The listing may have been removed or renamed since the purchase; the ENTITLEMENT survives
      // either way, so a missing listing is reported honestly rather than dropped from the list.
      const apps = await Promise.all(owned.map(async (p) => {
        const found = await getWebApp(p.appId);
        return {
          appId: p.appId,
          priceInr: p.priceInr,
          at: p.at,
          name: found && found.status !== 'removed' ? found.name : null,
          available: !!found && found.status !== 'removed',
        };
      }));
      res.json({ apps });
    } catch (e) {
      logStoreError('web/purchases', e);
      res.status(502).json({ error: 'Could not load the apps you own.' });
    }
  });

  /** Viewer report — the store's immune system. Requires sign-in so reports carry accountability. */
  app.post('/api/nav-store/web/app/:id/report', async (req: Request, res: Response) => {
    const me = await verifyFirebaseIdentity(req);
    if (!me?.uid) return res.status(401).json({ error: 'Sign in to report an app.' });
    const reason = (typeof req.body?.reason === 'string' ? req.body.reason : '').trim();
    if (reason.length < 5) return res.status(400).json({ error: 'Say briefly what is wrong with this app.' });
    try {
      const found = await getWebApp(String(req.params.id || ''));
      if (!found || found.status === 'removed') return res.status(404).json({ error: 'This app is not on the store.' });
      await reportWebApp(found.id, me.uid, reason);
      res.json({ ok: true });
    } catch (e) {
      logStoreError('web/report', e);
      res.status(502).json({ error: 'Could not send the report.' });
    }
  });

  // ═══ SHARED DATA (Kadam 4) — append + list, hard-quota'd; see navStoreWebData.ts ═══
  //
  // CORS IS THE POINT, not an oversight: the caller is the app itself, running in the player's
  // OPAQUE-ORIGIN iframe, so every one of its fetches is cross-origin. Anonymous by design (viewers
  // have no session inside the sandbox); protection is quotas + the platform's rate limiter — the
  // same trade /api/esm/* already makes for the same iframe.
  const dataCors = (res: Response) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  };
  app.options('/api/nav-store/web/app/:id/data/:collection', (_req: Request, res: Response) => {
    dataCors(res);
    res.status(204).end();
  });

  const dataWriteLimiter = rateLimiter({ name: 'store-data-write', authed: 600, anon: 300, noun: 'writes', durable: false, anonGlobalPerHour: 20_000 });
  const dataReadLimiter = rateLimiter({ name: 'store-data-read', authed: 2_000, anon: 1_000, noun: 'reads', durable: false });

  app.post('/api/nav-store/web/app/:id/data/:collection', dataWriteLimiter, async (req: Request, res: Response) => {
    dataCors(res);
    const collection = String(req.params.collection || '');
    if (!isValidDataCollection(collection)) return res.status(400).json({ error: 'Collection names are short lowercase words (letters, digits, - or _).' });
    try {
      const found = await getWebApp(String(req.params.id || ''));
      if (!found || found.status === 'removed') return res.status(404).json({ error: 'This app is not on the store.' });
      const result = await addDataRow(found.id, collection, req.body?.data);
      if (!result.ok) return res.status(result.status).json({ error: result.reason });
      res.json({ ok: true, row: result.row });
    } catch (e) {
      logStoreError('web/data write', e);
      res.status(502).json({ error: 'The row could not be saved — nothing was stored.' });
    }
  });

  app.get('/api/nav-store/web/app/:id/data/:collection', dataReadLimiter, async (req: Request, res: Response) => {
    dataCors(res);
    const collection = String(req.params.collection || '');
    if (!isValidDataCollection(collection)) return res.status(400).json({ error: 'Collection names are short lowercase words (letters, digits, - or _).' });
    try {
      const found = await getWebApp(String(req.params.id || ''));
      if (!found || found.status === 'removed') return res.status(404).json({ error: 'This app is not on the store.' });
      res.json({ rows: await listDataRows(found.id, collection, Number(req.query.limit) || 50) });
    } catch (e) {
      logStoreError('web/data read', e);
      res.status(502).json({ error: 'Could not load the rows.' });
    }
  });

  /** Admin: the listing queue + decisions. Same review discipline as the APK store. */
  app.get('/api/nav-store/web/admin/queue', async (req: Request, res: Response) => {
    const me = await verifyFirebaseIdentity(req);
    if (!isStoreAdmin(me?.email ?? null)) return res.status(403).json({ error: 'Not allowed.' });
    try {
      res.json({ apps: await listUnlistedWebApps() });
    } catch (e) {
      logStoreError('web/admin queue', e);
      res.status(502).json({ error: 'Could not load the queue.' });
    }
  });

  app.post('/api/nav-store/web/admin/review', async (req: Request, res: Response) => {
    const me = await verifyFirebaseIdentity(req);
    if (!isStoreAdmin(me?.email ?? null)) return res.status(403).json({ error: 'Not allowed.' });
    const id = String(req.body?.id || '');
    const decision = String(req.body?.decision || '');
    if (!id || !['listed', 'removed'].includes(decision)) {
      return res.status(400).json({ error: 'An app id and a decision (listed or removed) are required.' });
    }
    try {
      const found = await getWebApp(id);
      if (!found) return res.status(404).json({ error: 'No such app.' });
      if (decision === 'removed') {
        await removeWebApp(id, typeof req.body?.note === 'string' ? req.body.note : 'removed by admin', me?.email || 'admin');
      } else {
        await updateWebApp(id, { status: 'listed', reviewedAt: Date.now(), reviewedBy: me?.email || 'admin' });
      }
      res.json({ ok: true, id, status: decision });
    } catch (e) {
      logStoreError('web/admin review', e);
      res.status(502).json({ error: 'Could not save that decision.' });
    }
  });
}
