// Provider-neutral Android build API (2026-11-25) — the Native Cloud Build's routes, and the one place
// the screen asks "which providers can run right now?".
//
// The GitHub provider keeps its own long-hardened routes (`/api/mobile-ship/*`): its flow is driven step
// by step from the panel (prepare → dispatch → poll → repair → retry), and re-implementing it behind a
// second API would be a second copy of working code — the exact drift this repo forbids. Both providers
// share the preparation (prepareMobileProject.ts) and the charge (mobileBuildCharge.ts); this file adds
// only what the native provider genuinely needs.
//
// 🔒 Every route verifies the Firebase identity first and reads ownership from the STORED row. Nothing
// the browser sends is trusted as an owner, a path, a sandbox id, a workflow or a bucket.

import type { Express, Request, Response, RequestHandler } from 'express';
import { verifyFirebaseIdentity } from '../lib/authMiddleware';
import { sessionWorkspaceId } from '../lib/workspaceEdit';
import { routeParam } from '../lib/expressCompat';
import { generateShipKit } from '../lib/mobileShipKit';
import { generateUploadKeystore } from '../lib/androidKeystore';
import { apkChargeInr } from '../lib/apkCharge';
import { CHARGE_PRICE_HEADER, CHARGE_APPLIED_HEADER } from '../../lib/apkChargeNotice';
import { providerCapabilities, nativeMissing } from '../lib/mobileBuild/providerRegistry';
import { isArtifactKind, toView, type NativeBuildJob } from '../lib/mobileBuild/types';
import {
  deleteKey, exportKey, getKeyRecord, getOwnedJob, isIdempotencyKey, isNativeBuildId, keyMeta, listJobsForUser, listKeysForUser, requestCancel, saveKey,
} from '../lib/mobileBuild/nativeBuildStore';
import {
  advanceNativeBuild, decodeKeystore, defaultRunnerDeps, expireIfDue, startNativeBuild, startNativeBuildSweeper, verifyKeystoreInSandbox,
} from '../lib/mobileBuild/nativeBuildRunner';
import { isSafeAlias } from '../lib/mobileBuild/nativeSigning';
import { CONTENT_TYPE } from '../lib/mobileBuild/nativeArtifactStore';

/** An Android application id Play accepts: two or more dot-separated segments, each starting with a letter. */
export function isValidAppId(v: unknown): v is string {
  return typeof v === 'string' && v.length <= 100 && /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(v);
}

function appNameFrom(v: unknown): string {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 60) : 'My App';
}

/** The application id this build will use: the user's own when valid, else the ship kit's default for the name. */
export function resolveAppId(appId: unknown, appName: string): string | null {
  if (appId === undefined || appId === null || appId === '') return generateShipKit({ appName, ios: false }).appId;
  return isValidAppId(appId) ? appId : null;
}

async function identity(req: Request, res: Response): Promise<{ uid: string; email: string | null; emailVerified: boolean } | null> {
  const id = await verifyFirebaseIdentity(req);
  if (!id?.uid) { res.status(401).json({ error: 'Please sign in first.' }); return null; }
  return id;
}

export function registerMobileBuildRoutes(app: Express, limiter?: RequestHandler): void {
  const limited: RequestHandler[] = limiter ? [limiter] : [];
  startNativeBuildSweeper();

  /** The two providers, each with whether it can run now and the honest reason when it cannot. */
  app.get('/api/mobile-builds/capabilities', async (req: Request, res: Response) => {
    if (!(await identity(req, res))) return;
    // `missing` names configuration keys — admin information, never sent to the browser.
    res.json({ providers: providerCapabilities().map(({ missing: _missing, ...p }) => p), priceInr: apkChargeInr() });
  });

  /** Start a Native Cloud Build. Idempotent on `idempotencyKey`: a replay returns the same build. */
  app.post('/api/mobile-builds', ...limited, async (req: Request, res: Response) => {
    const id = await identity(req, res);
    if (!id) return;
    const body = (req.body || {}) as Record<string, unknown>;
    if (body.provider === 'github_actions') {
      return res.status(400).json({ error: 'GitHub builds start from the GitHub option in the build screen.', code: 'use-github-flow' });
    }
    if (body.provider !== 'native_cloud') return res.status(400).json({ error: 'Unknown build provider.', code: 'bad-provider' });
    if (!isArtifactKind(body.kind)) return res.status(400).json({ error: 'Choose an .apk or an .aab.', code: 'bad-kind' });
    if (!isIdempotencyKey(body.idempotencyKey)) return res.status(400).json({ error: 'A valid request id is required.', code: 'bad-request-id' });
    const workspaceId = sessionWorkspaceId(id.uid, String(body.sessionId || ''));
    if (!workspaceId) return res.status(400).json({ error: 'Which app should be built?', code: 'bad-app' });
    const appName = appNameFrom(body.appName);
    const appId = resolveAppId(body.appId, appName);
    if (!appId) return res.status(400).json({ error: 'That application id is not valid. Use a form like com.yourname.yourapp.', code: 'bad-app-id' });

    const r = await startNativeBuild({
      identity: id,
      sessionId: String(body.sessionId),
      workspaceId,
      kind: body.kind,
      appName,
      appId,
      iconDataUrl: typeof body.iconDataUrl === 'string' && body.iconDataUrl.length < 3_000_000 ? body.iconDataUrl : undefined,
      backgroundColor: typeof body.backgroundColor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(body.backgroundColor) ? body.backgroundColor : undefined,
      powerLevel: typeof body.powerLevel === 'string' ? body.powerLevel : undefined,
      idempotencyKey: body.idempotencyKey,
    });
    if (!r.ok) return res.status(r.status).json({ ...r.body, build: r.job ? toView(r.job) : null });
    res.status(r.created ? 201 : 200).json({ build: toView(r.job) });
  });

  /** This user's native builds, newest first. Survives reloads, devices and sessions (it is Firestore). */
  app.get('/api/mobile-builds/history', async (req: Request, res: Response) => {
    const id = await identity(req, res);
    if (!id) return;
    try {
      const jobs = await listJobsForUser(id.uid);
      const fresh: NativeBuildJob[] = [];
      for (const j of jobs) fresh.push(await expireIfDue(j, defaultRunnerDeps));
      res.json({ builds: fresh.map(toView) });
    } catch {
      res.status(502).json({ error: 'Could not read your builds right now.' });
    }
  });

  // ── Upload keys (registered before `/:buildId`) ──────────────────────────────────────────────────

  app.get('/api/mobile-builds/signing-key', async (req: Request, res: Response) => {
    const id = await identity(req, res);
    if (!id) return;
    const appId = String(req.query.appId ?? '');
    if (!isValidAppId(appId)) return res.status(400).json({ error: 'A valid application id is required.' });
    const k = await getKeyRecord(id.uid, appId).catch(() => null);
    res.json({ key: k ? keyMeta(k) : null });
  });

  /**
   * Every upload key this user has saved (metadata only — never a key, never a password). The Danger zone reads
   * this so its "deleting your account deletes your Play signing key" warning appears exactly when it is true
   * (Q-3703). An unreadable store answers 502, never an empty list: "no keys" would hide the warning.
   */
  app.get('/api/mobile-builds/signing-keys', async (req: Request, res: Response) => {
    const id = await identity(req, res);
    if (!id) return;
    try {
      const keys = await listKeysForUser(id.uid);
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ keys: keys.map(keyMeta) });
    } catch {
      res.status(502).json({ error: 'Your saved signing keys could not be checked right now.' });
    }
  });

  /**
   * Download the user's OWN upload key — the keystore file and its passwords — so they keep a copy before deleting
   * the key or their account (Q-3703). POST, not GET, so no prefetch, link preview or cache ever fetches a secret.
   * Works even while the native provider is switched off: a user must always be able to take their key with them.
   */
  app.post('/api/mobile-builds/signing-key/export', ...limited, async (req: Request, res: Response) => {
    const id = await identity(req, res);
    if (!id) return;
    const b = (req.body || {}) as Record<string, unknown>;
    const appId = b.appId;
    if (!isValidAppId(appId)) return res.status(400).json({ error: 'A valid application id is required.' });
    let out: Awaited<ReturnType<typeof exportKey>>;
    try {
      out = await exportKey(id.uid, appId);
    } catch {
      return res.status(502).json({ error: 'Your signing key could not be opened right now. It is still saved — please try again.', code: 'export-unavailable' });
    }
    if (!out) return res.status(404).json({ error: 'No saved key for that app.' });
    res.setHeader('Cache-Control', 'private, no-store');
    res.json({
      key: out.meta,
      keystore: {
        base64: out.plain.keystore.toString('base64'),
        storePassword: out.plain.storePassword,
        keyPassword: out.plain.keyPassword,
        keyAlias: out.plain.alias,
        sha256Fingerprint: out.plain.certSha256,
      },
    });
  });

  /**
   * Bring the user's EXISTING upload key — the one an app already on Play is bound to (for an app built
   * with the GitHub option, the `<repo>-upload.keystore` file NavBharatAI handed them). Opened with a real
   * keytool in a network-less machine before anything is saved; saved sealed, with explicit consent.
   */
  app.post('/api/mobile-builds/signing-key/import', ...limited, async (req: Request, res: Response) => {
    const id = await identity(req, res);
    if (!id) return;
    if (nativeMissing('aab').length > 0) return res.status(503).json({ error: 'Native Cloud Build is not available right now.', code: 'provider-unavailable' });
    const b = (req.body || {}) as Record<string, unknown>;
    if (b.consent !== true) return res.status(400).json({ error: 'Please confirm that NavBharatAI may keep this key encrypted for your builds.', code: 'consent-required' });
    if (!isValidAppId(b.appId)) return res.status(400).json({ error: 'A valid application id is required.' });
    const ks = decodeKeystore(b.keystoreBase64);
    if (!ks) return res.status(400).json({ error: 'That keystore file could not be read (it must be under 64 KB).', code: 'bad-keystore' });
    const alias = typeof b.alias === 'string' ? b.alias.trim() : '';
    if (!isSafeAlias(alias)) return res.status(400).json({ error: 'The key alias may only contain letters, numbers, dots, dashes and underscores.', code: 'bad-alias' });
    const storePassword = typeof b.storePassword === 'string' ? b.storePassword : '';
    const keyPassword = typeof b.keyPassword === 'string' && b.keyPassword ? b.keyPassword : storePassword;
    if (!storePassword || storePassword.length > 200 || keyPassword.length > 200) return res.status(400).json({ error: 'Enter the keystore password.', code: 'bad-password' });

    const existing = await getKeyRecord(id.uid, b.appId).catch(() => null);
    if (existing && b.replace !== true) {
      return res.status(409).json({ error: 'This app already has a saved upload key. Replacing it changes which key your Play uploads must use.', code: 'key-exists', key: keyMeta(existing) });
    }
    let verified: Awaited<ReturnType<typeof verifyKeystoreInSandbox>>;
    try {
      verified = await verifyKeystoreInSandbox(ks, storePassword, keyPassword, alias, defaultRunnerDeps);
    } catch {
      return res.status(502).json({ error: 'The key could not be checked right now. Nothing was saved — please try again.', code: 'verify-unavailable' });
    }
    if (!verified.ok) return res.status(422).json({ error: `${verified.detail}. Nothing was saved.`, code: verified.code.toLowerCase() });
    const saved = await saveKey(id.uid, b.appId, { keystore: ks, storePassword, keyPassword, alias, certSha256: verified.certSha256, source: 'imported' }, { replace: b.replace === true });
    if (!saved.ok) return res.status(409).json({ error: 'This app already has a saved upload key.', code: 'key-exists' });
    res.json({ key: saved.meta });
  });

  /**
   * Create a NEW upload key — only for an app that has never been uploaded to Google Play (a published
   * app is bound to its existing key; a new one would make its next update fail). The key is returned
   * ONCE so the user keeps their own backup, and kept sealed for future builds.
   */
  app.post('/api/mobile-builds/signing-key/generate', ...limited, async (req: Request, res: Response) => {
    const id = await identity(req, res);
    if (!id) return;
    if (nativeMissing('aab').length > 0) return res.status(503).json({ error: 'Native Cloud Build is not available right now.', code: 'provider-unavailable' });
    const b = (req.body || {}) as Record<string, unknown>;
    if (b.consent !== true) return res.status(400).json({ error: 'Please confirm that NavBharatAI may keep this key encrypted for your builds.', code: 'consent-required' });
    if (b.confirmNeverPublished !== true) {
      return res.status(400).json({ error: 'Only create a new key for an app that has never been uploaded to Google Play. For a published app, add its existing key instead.', code: 'confirm-never-published' });
    }
    if (!isValidAppId(b.appId)) return res.status(400).json({ error: 'A valid application id is required.' });
    const existing = await getKeyRecord(id.uid, b.appId).catch(() => null);
    if (existing) return res.status(409).json({ error: 'This app already has a saved upload key.', code: 'key-exists', key: keyMeta(existing) });
    const k = generateUploadKeystore(appNameFrom(b.appName));
    const saved = await saveKey(id.uid, b.appId, {
      keystore: Buffer.from(k.base64, 'base64'), storePassword: k.storePassword, keyPassword: k.storePassword,
      alias: k.keyAlias, certSha256: k.sha256Fingerprint, source: 'generated',
    }, { replace: false });
    if (!saved.ok) return res.status(409).json({ error: 'This app already has a saved upload key.', code: 'key-exists' });
    res.json({
      key: saved.meta,
      // ⚠️ Shown once, for the user's own backup — the same hand-off the GitHub option makes.
      backup: { base64: k.base64, storePassword: k.storePassword, keyAlias: k.keyAlias, sha256Fingerprint: k.sha256Fingerprint, validUntil: k.validUntil },
    });
  });

  app.delete('/api/mobile-builds/signing-key', async (req: Request, res: Response) => {
    const id = await identity(req, res);
    if (!id) return;
    const appId = String(req.query.appId ?? '');
    if (!isValidAppId(appId)) return res.status(400).json({ error: 'A valid application id is required.' });
    const removed = await deleteKey(id.uid, appId).catch(() => false);
    if (!removed) return res.status(404).json({ error: 'No saved key for that app.' });
    res.json({ ok: true });
  });

  // ── One build ────────────────────────────────────────────────────────────────────────────────────

  async function ownedOr404(req: Request, res: Response): Promise<{ uid: string; job: NativeBuildJob } | null> {
    const id = await identity(req, res);
    if (!id) return null;
    const buildId = routeParam(req.params.buildId);
    if (!isNativeBuildId(buildId)) { res.status(404).json({ error: 'Build not found.' }); return null; }
    const job = await getOwnedJob(buildId, id.uid).catch(() => null);
    // Another user's build is answered exactly like a missing one — its existence is not disclosed.
    if (!job) { res.status(404).json({ error: 'Build not found.' }); return null; }
    return { uid: id.uid, job };
  }

  /** Real status. Each call also moves the build forward one step (stateless driver — see the runner). */
  app.get('/api/mobile-builds/:buildId', async (req: Request, res: Response) => {
    const owned = await ownedOr404(req, res);
    if (!owned) return;
    const advanced = (await advanceNativeBuild(owned.job.id, defaultRunnerDeps).catch(() => null)) ?? owned.job;
    res.json({ build: toView(await expireIfDue(advanced, defaultRunnerDeps)) });
  });

  app.get('/api/mobile-builds/:buildId/logs', async (req: Request, res: Response) => {
    const owned = await ownedOr404(req, res);
    if (!owned) return;
    res.json({ lines: owned.job.logTail ?? [], failedStep: owned.job.failedStep, state: owned.job.state });
  });

  app.post('/api/mobile-builds/:buildId/cancel', async (req: Request, res: Response) => {
    const owned = await ownedOr404(req, res);
    if (!owned) return;
    const asked = await requestCancel(owned.job.id, owned.uid);
    const now = (asked && asked.state === 'cancelling') ? ((await advanceNativeBuild(owned.job.id, defaultRunnerDeps).catch(() => null)) ?? asked) : asked;
    res.json({ build: toView(now ?? owned.job) });
  });

  /** The file itself, streamed from private storage after the ownership check. Never a public URL. */
  app.get('/api/mobile-builds/:buildId/download', async (req: Request, res: Response) => {
    const owned = await ownedOr404(req, res);
    if (!owned) return;
    const job = await expireIfDue(owned.job, defaultRunnerDeps);
    if (job.state === 'expired') return res.status(410).json({ error: 'This build has expired. Build the app again to get a fresh file.' });
    if (job.state !== 'completed' || !job.artifact) return res.status(409).json({ error: 'This build has no file yet.' });
    const a = job.artifact;
    res.setHeader('Content-Type', CONTENT_TYPE[job.kind]);
    res.setHeader('Content-Disposition', `attachment; filename="${a.fileName}"`);
    res.setHeader('Content-Length', String(a.sizeBytes));
    res.setHeader('X-Checksum-SHA256', a.sha256);
    res.setHeader('Cache-Control', 'private, no-store');
    // Same receipt headers as the GitHub download: the price is shown, and the download itself charges nothing
    // (the build was charged once, when it completed).
    res.setHeader(CHARGE_PRICE_HEADER, String(apkChargeInr()));
    res.setHeader(CHARGE_APPLIED_HEADER, 'false');
    res.setHeader('Access-Control-Expose-Headers', `Content-Disposition, X-Checksum-SHA256, ${CHARGE_PRICE_HEADER}, ${CHARGE_APPLIED_HEADER}`);
    try {
      const stream = defaultRunnerDeps.artifacts.stream(a.objectPath);
      stream.on('error', () => {
        if (!res.headersSent) res.status(502).json({ error: 'The file could not be read from storage.' });
        else res.destroy();
      });
      stream.pipe(res);
    } catch {
      res.status(502).json({ error: 'The file could not be read from storage.' });
    }
  });
}
