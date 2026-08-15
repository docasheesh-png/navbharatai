// Nav App Store — WEB APPS (the browser-run ecosystem, admin-approved plan 2026-08-15).
//
// THE IDEA, in one line: a user builds an app in NavBharatAI Pro v5, presses one button, and another
// user runs it from the store — in their own browser, on our in-browser preview engine. No APK, no
// deploy, no per-viewer VM: the viewer brings their own CPU, so 1 viewer or 10,000 cost us the same.
//
// This module is KADAM 0 of the plan — the security foundation the rest stands on:
//
//   • PUBLISH = SNAPSHOT. The store serves an immutable copy taken at publish time, never the live
//     workspace — otherwise every half-finished edit the creator makes would break the app for every
//     viewer mid-use. Updating = publishing again (a new version of the same listing).
//   • THE KEY-SCAN GATE. Published code ships to every viewer's browser. A hardcoded API key in it
//     hands the creator's paid credential to every person who opens the app — so a snapshot carrying
//     a real-format secret is REFUSED with the exact file:line, never published "with a warning".
//     Real `.env` files never enter the snapshot at all.
//   • THE PROVER decides publishability, not the user. `proveBrowserRunnable`'s default answer is
//     "no" — an app it cannot vouch for is refused honestly with the reason, because a store where
//     half the apps are broken loses its trust in the first week.
//   • PRIVATE = SERVER-SIDE. A private app's password is checked here, and the files simply do not
//     leave the server without it. A client-side check would be theatre — the code would carry its
//     own lock and any viewer could delete it.
//
// SAFETY MODEL vs THE APK STORE (deliberate difference, same spirit): an APK is an installable binary
// — it stays PENDING until an admin approves, because malware is invisible. A web app runs inside a
// sandboxed iframe with an opaque origin and can touch nothing of the platform's. So a fresh publish
// is immediately LIVE VIA ITS DIRECT LINK (`unlisted` — the creator sharing their own work, the same
// exposure our hosting paths already allow), but appearing in the browsable STORE requires the same
// admin review the APK store uses. Discovery is curated; self-sharing is instant. Takedown
// (`removed`) kills both, link included.

import * as admin from 'firebase-admin';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { getServerDb } from './serverDb';
import { proveBrowserRunnable } from '../AgentV3/previewCapability';
import { scanTextForSecrets, type EnvTemplateSecretIssue } from '../AgentV3/EnvSecretValueAnalysis';
import { viteEnvVarsUsed } from '../runtime/previewImportMeta';

/** Lifecycle: live-via-link → admin lists it → or an admin/owner takes it down. */
export type WebAppStatus = 'unlisted' | 'listed' | 'removed';

export interface WebStoreApp {
  id: string;
  status: WebAppStatus;
  /** The publishing account. Never taken from the request body. */
  uid: string;
  /** Creator-facing name shown on the listing and the player. */
  name: string;
  description: string;
  iconDataUrl?: string;
  /** 'public' = anyone with the link; 'private' = password required before files are served. */
  visibility: 'public' | 'private';
  /** scrypt(salt, password) — present only for private apps. NEVER in any public view. */
  passwordHash?: string;
  passwordSalt?: string;
  /** Which workspace this snapshot came from — provenance + the remix lineage anchor. */
  workspaceId: string;
  /** Remix lineage: the store app this one was remixed from, when it was. */
  parentAppId?: string;
  /** Remix price in whole rupees. 0/absent = free (the default and the growth engine). */
  priceInr?: number;
  /**
   * Key-shaped env vars the app's own code reads (VITE_/REACT_APP_/NEXT_PUBLIC_ names containing
   * KEY/TOKEN/SECRET/API/AUTH). THE ADMIN'S RULE (2026-08-15): "api sell nahi hogi — api user B ko
   * deni hogi." The original creator's keys never ship (the scan gate + .env exclusion make that
   * physically true); this field is the OTHER half — telling a buyer BEFORE money moves that the
   * app's API features will need THEIR OWN key, and telling a viewer why an AI button may not work.
   */
  apiVarsUsed?: string[];
  fileCount: number;
  sizeBytes: number;
  /** Honest usage counters. `runs` increments on a served open, never on a page view of the listing. */
  runs: number;
  remixes: number;
  publishedAt: number;
  /** Bumped on every re-publish of the same listing; the snapshot subcollection is replaced. */
  version: number;
  reviewedAt?: number;
  reviewedBy?: string;
  removedReason?: string;
}

/** What a viewer may see. No uid, no password material, no internals. */
export type PublicWebStoreApp = Pick<WebStoreApp,
  'id' | 'name' | 'description' | 'iconDataUrl' | 'visibility' | 'fileCount' | 'runs' | 'remixes' | 'publishedAt' | 'version'
> & { requiresPassword: boolean; priceInr: number; apiVarsUsed: string[] };

export function toPublicWebApp(a: WebStoreApp): PublicWebStoreApp {
  return {
    id: a.id, name: a.name, description: a.description, iconDataUrl: a.iconDataUrl,
    visibility: a.visibility, fileCount: a.fileCount, runs: a.runs, remixes: a.remixes,
    publishedAt: a.publishedAt, version: a.version,
    requiresPassword: a.visibility === 'private',
    priceInr: a.priceInr ?? 0,
    apiVarsUsed: Array.isArray(a.apiVarsUsed) ? a.apiVarsUsed : [],
  };
}

// ─── Publish gate (pure — the part that decides, fully unit-tested) ───────────────────────────────

/** Files that must never enter a published snapshot, whatever the workspace holds. */
const NEVER_PUBLISH = /(^|\/)(\.env(\.[^/]*)?|\.git\/|node_modules\/|dist\/|build\/|coverage\/|\.next\/)/;
/** …except shareable env TEMPLATES, which are placeholders by definition. */
const ENV_TEMPLATE = /\.env\.(example|sample|template|dist|defaults?)$/i;

/** Caps — quotas exist from day 1, because one runaway app must never become our bill. */
export const MAX_SNAPSHOT_FILES = 400;
export const MAX_SNAPSHOT_FILE_BYTES = 300 * 1024;
export const MAX_SNAPSHOT_TOTAL_BYTES = 3 * 1024 * 1024;

export interface PublishGateResult {
  ok: boolean;
  /** The sanitized snapshot to store when ok. */
  files: Record<string, string>;
  /** Honest, user-facing refusal when not ok. */
  reason?: string;
  /** Secret findings, so the route can name the exact lines. */
  secrets?: EnvTemplateSecretIssue[];
}

/**
 * Decide whether this workspace may be published, and produce the exact snapshot if so.
 *
 * ORDER MATTERS and is the safety model: sanitize (drop what must never ship) → prove the browser
 * can run it → scan what WILL ship for secrets → enforce quotas. A failure at any step publishes
 * nothing. The scan runs on the SANITIZED set on purpose — scanning files we already dropped would
 * refuse apps over content that was never going to ship (e.g. the user's own `.env`, which the
 * sanitizer removes precisely because it holds their real keys).
 */
export function evaluateWebPublish(input: Record<string, string> | null | undefined): PublishGateResult {
  const files: Record<string, string> = {};
  let total = 0;
  for (const [path, content] of Object.entries(input || {})) {
    if (typeof path !== 'string' || typeof content !== 'string') continue;
    if (NEVER_PUBLISH.test(path) && !ENV_TEMPLATE.test(path)) continue;
    files[path] = content;
    total += Buffer.byteLength(content, 'utf8');
  }

  const count = Object.keys(files).length;
  if (count === 0) return { ok: false, files: {}, reason: 'There is nothing to publish yet — build your app first.' };
  if (count > MAX_SNAPSHOT_FILES) {
    return { ok: false, files: {}, reason: `This app has ${count} files — the store limit is ${MAX_SNAPSHOT_FILES}. Remove generated or unused files and publish again.` };
  }
  for (const [path, content] of Object.entries(files)) {
    if (Buffer.byteLength(content, 'utf8') > MAX_SNAPSHOT_FILE_BYTES) {
      return { ok: false, files: {}, reason: `"${path}" is larger than ${Math.round(MAX_SNAPSHOT_FILE_BYTES / 1024)} KB. Large assets don't belong in published source — move it out and publish again.` };
    }
  }
  if (total > MAX_SNAPSHOT_TOTAL_BYTES) {
    return { ok: false, files: {}, reason: `This app totals ${(total / 1024 / 1024).toFixed(1)} MB of source — the store limit is ${MAX_SNAPSHOT_TOTAL_BYTES / 1024 / 1024} MB.` };
  }

  // Can the viewer's browser actually run it? The prover's default is "no" — it vouches, it never
  // guesses. An app it cannot vouch for gets the real reason, not a broken listing.
  const capability = proveBrowserRunnable(files);
  if (!capability.browserRunnable) {
    return {
      ok: false, files: {},
      reason: `This app can't run in a viewer's browser yet: ${capability.reason || 'it needs a live server.'} Apps on the store run entirely in the browser — no server. You can still share it with hosting (Publish → Host on NavBharatAI).`,
    };
  }

  // The key-scan gate. Everything below this line WILL ship to strangers' browsers.
  const secrets: EnvTemplateSecretIssue[] = [];
  for (const [path, content] of Object.entries(files)) {
    secrets.push(...scanTextForSecrets(path, content));
  }
  if (secrets.length > 0) {
    const first = secrets[0];
    return {
      ok: false, files: {}, secrets,
      reason: `This app contains what looks like a real API key (${first.kind} in ${first.file}:${first.line}${secrets.length > 1 ? `, +${secrets.length - 1} more` : ''}). Published code is visible to every viewer — anyone could use that key and the bill would land on you. Move it out of the code, then publish again.`,
    };
  }

  return { ok: true, files };
}

/** The env vars in this snapshot whose NAME says "credential" — the ones a remixer must bring. */
export function keyShapedEnvVars(files: Record<string, string>): string[] {
  return viteEnvVarsUsed(files).filter((v) => /KEY|TOKEN|SECRET|API|AUTH/i.test(v));
}

// ─── Private-app password (server-side by construction) ───────────────────────────────────────────

export function hashAppPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return { hash, salt };
}

export function verifyAppPassword(password: string, hash: string | undefined, salt: string | undefined): boolean {
  if (!hash || !salt || !password) return false;
  try {
    const candidate = scryptSync(password, salt, 32);
    const stored = Buffer.from(hash, 'hex');
    return candidate.length === stored.length && timingSafeEqual(candidate, stored);
  } catch {
    return false;
  }
}

// ─── Firestore ────────────────────────────────────────────────────────────────────────────────────

const COLLECTION = 'nav_store_web_apps';
const FILES_SUB = 'files';
const REPORTS_SUB = 'reports';
const BATCH = 400;

function db(): admin.firestore.Firestore | null {
  if (process.env.VITEST || process.env.NODE_ENV === 'test') return null;
  try {
    if (!admin.apps || admin.apps.length === 0) admin.initializeApp({});
    return getServerDb();
  } catch {
    return null;
  }
}

/** Firestore doc ids cannot contain '/'; keep a reversible encoding for file paths. */
const encPath = (p: string): string => encodeURIComponent(p);
const decPath = (p: string): string => decodeURIComponent(p);

export async function saveWebApp(app: WebStoreApp, files: Record<string, string>): Promise<void> {
  const d = db();
  if (!d) throw new Error('no database');
  const root = d.collection(COLLECTION).doc(app.id);
  await root.set(app);
  // Replace the snapshot wholesale: on a re-publish, stale files from the previous version must not
  // survive into the new one (a deleted page that kept being served would be v1 haunting v2).
  const filesCol = root.collection(FILES_SUB);
  const existing = await filesCol.listDocuments();
  const writes: Array<Promise<unknown>> = [];
  for (let i = 0; i < existing.length; i += BATCH) {
    const b = d.batch();
    for (const doc of existing.slice(i, i + BATCH)) b.delete(doc);
    writes.push(b.commit());
  }
  await Promise.all(writes);
  const entries = Object.entries(files);
  const commits: Array<Promise<unknown>> = [];
  for (let i = 0; i < entries.length; i += BATCH) {
    const b = d.batch();
    for (const [path, content] of entries.slice(i, i + BATCH)) {
      b.set(filesCol.doc(encPath(path)), { content });
    }
    commits.push(b.commit());
  }
  await Promise.all(commits);
}

export async function getWebApp(id: string): Promise<WebStoreApp | null> {
  const d = db();
  if (!d) return null;
  const doc = await d.collection(COLLECTION).doc(id).get();
  return doc.exists ? (doc.data() as WebStoreApp) : null;
}

export async function getWebAppFiles(id: string): Promise<Record<string, string>> {
  const d = db();
  if (!d) return {};
  const snap = await d.collection(COLLECTION).doc(id).collection(FILES_SUB).get();
  const out: Record<string, string> = {};
  for (const doc of snap.docs) {
    const c = (doc.data() as { content?: unknown }).content;
    if (typeof c === 'string') out[decPath(doc.id)] = c;
  }
  return out;
}

/**
 * LIST QUERIES ARE EQUALITY-ONLY, BY LAW (root cause of the store's first real publish failure,
 * 2026-08-15): `.where(X).orderBy(Y)` on DIFFERENT fields is a composite-index query — Firestore
 * throws FAILED_PRECONDITION on its first production use until someone creates the index by hand in
 * the console, and no session has console access. A single-field filter is auto-indexed and can
 * never demand an index, so the shape itself is the fix: filter on one field, sort in memory.
 * The in-memory sort is bounded by FETCH_CAP; these collections are small by construction (one doc
 * per listing, not per row). Pinned by a source test — do not reintroduce a where+orderBy chain.
 */
const FETCH_CAP = 500;

function newestFirst(docs: admin.firestore.QueryDocumentSnapshot[], limit: number): WebStoreApp[] {
  return docs.map((x) => x.data() as WebStoreApp)
    .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
    .slice(0, limit);
}

export async function listListedWebApps(limit = 60): Promise<WebStoreApp[]> {
  const d = db();
  if (!d) return [];
  const snap = await d.collection(COLLECTION).where('status', '==', 'listed').limit(FETCH_CAP).get();
  return newestFirst(snap.docs, limit);
}

export async function listMyWebApps(uid: string, limit = 50): Promise<WebStoreApp[]> {
  const d = db();
  if (!d) return [];
  const snap = await d.collection(COLLECTION).where('uid', '==', uid).limit(FETCH_CAP).get();
  return newestFirst(snap.docs, limit);
}

/** Web apps awaiting listing review — the admin queue, same discipline as the APK store. */
export async function listUnlistedWebApps(limit = 50): Promise<WebStoreApp[]> {
  const d = db();
  if (!d) return [];
  const snap = await d.collection(COLLECTION).where('status', '==', 'unlisted').limit(FETCH_CAP).get();
  return newestFirst(snap.docs, limit);
}

export async function updateWebApp(id: string, patch: Partial<WebStoreApp>): Promise<void> {
  const d = db();
  if (!d) throw new Error('no database');
  await d.collection(COLLECTION).doc(id).update(patch);
}

/** Fire-and-forget usage counter. A metrics failure must never fail a run. */
export function bumpWebAppCounter(id: string, field: 'runs' | 'remixes'): void {
  const d = db();
  if (!d) return;
  void d.collection(COLLECTION).doc(id)
    .update({ [field]: admin.firestore.FieldValue.increment(1) })
    .catch(() => { /* counter only */ });
}

/**
 * A takedown is REAL: the snapshot's bytes are deleted, so a removed app genuinely stops being
 * servable — same principle as the APK store deleting the binary.
 */
export async function removeWebApp(id: string, reason: string, by: string): Promise<void> {
  const d = db();
  if (!d) throw new Error('no database');
  const root = d.collection(COLLECTION).doc(id);
  await root.update({ status: 'removed', removedReason: reason.slice(0, 300), reviewedBy: by, reviewedAt: Date.now() });
  const files = await root.collection(FILES_SUB).listDocuments();
  for (let i = 0; i < files.length; i += BATCH) {
    const b = d.batch();
    for (const doc of files.slice(i, i + BATCH)) b.delete(doc);
    await b.commit();
  }
}

/** A viewer report — lands in the admin queue; reports are the store's immune system, not refunds. */
export async function reportWebApp(id: string, reporterUid: string, reason: string): Promise<void> {
  const d = db();
  if (!d) throw new Error('no database');
  await d.collection(COLLECTION).doc(id).collection(REPORTS_SUB).add({
    reporterUid, reason: reason.slice(0, 500), at: Date.now(),
  });
}

export function newWebAppId(): string {
  return `web_${randomBytes(9).toString('hex')}`;
}

/**
 * Flip a private app public — and DELETE its password material, not merely stop checking it.
 *
 * Leaving a stale hash behind would make a later flip back to private silently reuse a password the
 * owner set months ago and may not remember — "private" guarding with a forgotten key. Public means
 * no password exists; going private again requires setting a fresh one.
 */
export async function makeWebAppPublic(id: string): Promise<void> {
  const d = db();
  if (!d) throw new Error('no database');
  await d.collection(COLLECTION).doc(id).update({
    visibility: 'public',
    passwordHash: admin.firestore.FieldValue.delete(),
    passwordSalt: admin.firestore.FieldValue.delete(),
  });
}

// ─── Remix (Kadam 2) — "make it yours" ────────────────────────────────────────────────────────────

const REMIX_ORIGINS = 'nav_store_remix_origins';

/**
 * Remember that a WORKSPACE was born as a remix of a store app.
 *
 * This is the lineage anchor. It is recorded at remix time (not publish time) because that is the
 * only moment the fact is knowable — by the time the user publishes the workspace, nothing else in
 * the system remembers where its files came from. The publish route reads this and stamps
 * `parentAppId`, which is what later makes rules like "a paid remix cannot be re-listed" (Kadam 3)
 * enforceable rather than aspirational.
 */
export async function recordRemixOrigin(workspaceId: string, parentAppId: string): Promise<void> {
  const d = db();
  if (!d) return;
  try {
    await d.collection(REMIX_ORIGINS).doc(workspaceId).set({ parentAppId, at: Date.now() });
  } catch { /* lineage is metadata — losing it must never fail the remix itself */ }
}

export async function getRemixOrigin(workspaceId: string): Promise<string | null> {
  const d = db();
  if (!d) return null;
  try {
    const doc = await d.collection(REMIX_ORIGINS).doc(workspaceId).get();
    const parent = doc.exists ? (doc.data() as { parentAppId?: unknown }).parentAppId : null;
    return typeof parent === 'string' ? parent : null;
  } catch {
    return null;
  }
}
