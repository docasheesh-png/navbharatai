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
import * as fs from 'node:fs';
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
import { claimUpload } from './zipUpload';
import { scanFile, isScanningConfigured, MAX_SCANNABLE_BYTES} from '../lib/malwareScan';
import {
  isStorageConfigured, putApk, getApk, deleteApk, saveApp, getApp, updateApp,
  listApps, listAppsByUid, toPublic,
  type StoreApp, type SubmissionStatus,
} from '../lib/navStoreStore';

/** What an upload costs today. One value, so raising it later is a one-line change. */
export const UPLOAD_FEE_INR = 0;

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
function decodeUpload(base64: unknown): Buffer | null {
  if (typeof base64 !== 'string' || !base64) return null;
  const raw = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(raw)) return null;
  try {
    const buf = Buffer.from(raw, 'base64');
    return buf.length > 0 ? buf : null;
  } catch {
    return null;
  }
}

/**
 * The ONE path from "we have APK bytes" to "a pending store record exists".
 *
 * Extracted when a second caller appeared (publish-from-build). Every guarantee the store rests on
 * lives HERE, so neither entry point can accidentally skip one:
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
  provenance?: { source: 'navbharatai-build'; repo: string; artifactId: string },
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

  /**
   * Submit an app.
   *
   * The order is the safety model: validate → inspect → scan → store as PENDING. A failure at any
   * step means nothing is stored and nothing is publishable.
   */
  app.post('/api/nav-store/submit', async (req: Request, res: Response) => {
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

    // APK BYTES — chunked upload first, legacy base64 as a fallback (2026-07-28).
    //
    // The store advertises a 150 MB limit but `apkBase64` rides inside a JSON body, and the platform
    // caps a single request at ~32 MB — so ~24 MB was the REAL ceiling and anything larger died before
    // this route's own honest 413 could ever run. The advertised number was fiction. A real APK is
    // 5-50 MB, so most genuine submissions were unpublishable. The client now transfers the file in
    // chunks and passes `uploadId`; `claimUpload` hands over the assembled bytes. The base64 path is
    // kept for small files so nothing that worked before breaks.
    let bytes: Buffer | null = null;
    let claimedPath: string | null = null;
    if (typeof body.uploadId === 'string' && body.uploadId) {
      const claimed = claimUpload(body.uploadId, me?.uid ?? null);
      if (!claimed) return res.status(403).json({ error: 'That upload has expired — please choose the file again.' });
      claimedPath = claimed.filePath;
      try { bytes = fs.readFileSync(claimed.filePath); } catch { bytes = null; }
    } else {
      bytes = decodeUpload(body.apkBase64);
    }
    const cleanupUpload = () => { if (claimedPath) { try { fs.unlinkSync(claimedPath); } catch { /* already gone */ } claimedPath = null; } };
    if (!bytes) { cleanupUpload(); return res.status(400).json({ error: 'Please choose your .apk file.' }); }
    const publishCap = publishableApkLimitBytes(MAX_APK_BYTES, MAX_SCANNABLE_BYTES);
    if (bytes.length > publishCap) {
      cleanupUpload();
      // Same derived number the Publish form advertises — the refusal can never contradict the promise.
      return res.status(413).json({ error: `That file is over the ${publishCap / 1024 / 1024} MB limit.` });
    }
    // The assembled temp file is never needed past this point — the bytes are in memory now.
    cleanupUpload();

    const out = await ingestApkSubmission(bytes, parsed.value, me.uid);
    return res.status(out.httpStatus).json(out.body);
  });

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
    // download button already does.
    const token = typeof body.githubToken === 'string' ? body.githubToken : '';
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
    try {
      const found = await getApp(String(req.params.id || ''));
      if (!found || found.status !== 'approved') return res.status(404).json({ error: 'That app is not available.' });
      const bytes = await getApk(found.storagePath);
      await updateApp(found.id, { downloads: (found.downloads || 0) + 1 }).catch(() => { /* a count is never worth failing a download */ });
      const safeName = found.appName.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 40) || 'app';
      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}-${found.versionName}.apk"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(bytes);
    } catch {
      res.status(502).json({ error: 'Could not download that app.' });
    }
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
}
