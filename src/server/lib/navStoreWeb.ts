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
import { gzipSync, gunzipSync } from 'node:zlib';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { getServerDb } from './serverDb';
import { listEqNewestFirst } from './firestoreIndexSafe';
import { proveBrowserRunnable } from '../AgentV3/previewCapability';
import { scanTextForSecrets, type EnvTemplateSecretIssue } from '../AgentV3/EnvSecretValueAnalysis';
import { viteEnvVarsUsed } from '../runtime/previewImportMeta';
import { unshippableAssetImports } from './assetImports';
import { PAID_REMIX_ENABLED } from './navStoreRemixPurchase';
import { previewRuntimeSignature, bakeIsCurrent } from '../runtime/previewRuntimeSignature';

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
  /** How many screenshots the creator uploaded for the listing (0/absent = none). The images themselves
   *  live in a `screenshots` subcollection (one doc each) so they never bloat this doc past Firestore's
   *  1 MiB limit — the same reason files live in their own subcollection. */
  screenshotCount?: number;
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
> & { requiresPassword: boolean; priceInr: number; apiVarsUsed: string[]; screenshotCount: number };

export function toPublicWebApp(a: WebStoreApp): PublicWebStoreApp {
  return {
    id: a.id, name: a.name, description: a.description, iconDataUrl: a.iconDataUrl,
    visibility: a.visibility, fileCount: a.fileCount, runs: a.runs, remixes: a.remixes,
    publishedAt: a.publishedAt, version: a.version,
    // So a browse card can show a "N screenshots" hint without shipping the images until the viewer
    // actually opens the app's detail (where getWebAppScreenshots serves them).
    screenshotCount: Math.max(0, a.screenshotCount ?? 0),
    requiresPassword: a.visibility === 'private',
    // While paid remix is parked, a stored price is not merely hidden — it is not SENT. A price the
    // client never receives cannot be rendered by any screen, present or future, so "free for now"
    // holds even for listings that were priced before the pause.
    priceInr: PAID_REMIX_ENABLED ? (a.priceInr ?? 0) : 0,
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
/**
 * THE CAPS ARE DERIVED FROM THE REAL CEILING, not chosen by feel (reworked 2026-08-16).
 *
 * A live publish was refused at 300 KB for a page component OUR OWN BUILDER generated. The admin
 * asked the right question — "990 KB nahi ho sakta?" — so here is the actual arithmetic, written
 * down once so nobody has to re-derive it or guess again.
 *
 * Every file is stored as its OWN Firestore document (`{ content }`), and a Firestore document may
 * not exceed 1 MiB = 1,048,576 bytes. That is Google's wall, not a setting of ours. The document
 * costs, on top of the content: its path, the field name, and a small per-document overhead — a few
 * hundred bytes in total, not kilobytes.
 *
 * So the honest maximum is "1 MiB minus a margin that cannot plausibly be exceeded". 950 KB leaves
 * ~75 KB of headroom — roughly a hundred times the overhead it needs to cover. Going to 990 KB would
 * also fit; it buys 4% more room in exchange for most of the safety margin, and no real file lives
 * in that 4%. A cap that is provably safe is worth more than a cap that is maximally tight.
 *
 * TOTAL had to rise with it, or the per-file raise would be theatre: at 3 MB, four large files hit
 * the ceiling anyway. 10 MB is our own storage budget (Firestore storage is cheap; the per-open read
 * cost is bounded by the file COUNT, which is capped separately and unchanged).
 *
 * ⚠️ WHAT THIS DOES NOT SOLVE, and must not be mistaken for solving: an app is never 50 MB because of
 * CODE — it is images, audio, video. Those do not belong in source at any cap, and the right home for
 * them is object storage served by URL. That is a real feature with a real cost the store's economics
 * do not currently carry: the whole model is "1 viewer or 10,000 cost us the same" because the app
 * runs on the VIEWER'S machine, and per-viewer bandwidth breaks exactly that property. Build it when
 * an app actually needs it, with a per-app asset quota — never as a quiet cap bump.
 */
const FIRESTORE_DOC_LIMIT_BYTES = 1024 * 1024;
export const MAX_SNAPSHOT_FILE_BYTES = 950 * 1024;
export const MAX_SNAPSHOT_TOTAL_BYTES = 10 * 1024 * 1024;
/** The margin above is only meaningful if it is checked — a future edit cannot quietly erase it. */
if (MAX_SNAPSHOT_FILE_BYTES >= FIRESTORE_DOC_LIMIT_BYTES) {
  throw new Error('MAX_SNAPSHOT_FILE_BYTES must stay under the 1 MiB Firestore document limit');
}

/**
 * WHY is this file too big, and what can the user actually DO about it?
 *
 * The old refusal asserted "large assets don't belong in published source" for every oversized file,
 * which is a guess wearing the clothes of a diagnosis — and the wrong guess for a source file. This
 * measures the file instead: an embedded `data:` URL is a real asset the user CAN move out, and
 * saying so names the fix; otherwise it is genuinely large code, and the honest advice is different.
 * Pure, so both branches are testable.
 */
export function describeOversizeFile(path: string, content: string): string {
  const bytes = Buffer.byteLength(content, 'utf8');
  const kb = (n: number) => `${Math.round(n / 1024)} KB`;
  let embedded = 0;
  for (const m of content.matchAll(/data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi)) {
    embedded += m[0].length;
  }
  if (embedded > bytes / 2) {
    return `"${path}" is ${kb(bytes)}, and about ${kb(embedded)} of that is an image (or other file) pasted directly into the code. `
      + `Save it as a real file in your project — or point at a URL — and publish again; the store limit is ${kb(MAX_SNAPSHOT_FILE_BYTES)} per file.`;
  }
  return `"${path}" is ${kb(bytes)} of code, over the store's ${kb(MAX_SNAPSHOT_FILE_BYTES)} per-file limit. `
    + `Ask NavBharatAI to split this page into smaller components and publish again — every viewer's browser has to compile this file, so a huge one is slow for them too.`;
}

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
      return { ok: false, files: {}, reason: describeOversizeFile(path, content) };
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

  // AN IMAGE THE APP IMPORTS BUT DOES NOT HAVE (2026-08-16, sibling of the mobile-ship asset bug).
  //
  // The snapshot is TEXT ONLY — binary assets live in their own durable store, and this gate already
  // refuses large files with "large assets don't belong in published source". So an app whose code says
  // `import logo from './logo.png'` publishes with no `logo.png` anywhere in it.
  //
  // 🔒 IN A BROWSER THAT IS NOT A BROKEN IMAGE, IT IS A BLANK PAGE. The store compiles and runs the
  // snapshot as ES modules, so an unresolvable module import fails the whole entry — the viewer gets
  // nothing, not a missing picture. That is exactly the outcome this prover already refuses on its own
  // stated principle, three checks above: an app that renders "working-looking and wrong" is worse than
  // an honest refusal. It simply had no check for this case.
  //
  // A REFUSAL here and only a NOTE on the mobile path, deliberately: there the user ships their own app
  // to their own repo and the call is theirs, while this ships to strangers under our name.
  // Conservative by construction — see unshippableAssetImports: only real ES asset imports count, so an
  // `<img src="logo.png">` or a URL-referenced file is never flagged.
  const missingAssets = unshippableAssetImports(files);
  if (missingAssets.length > 0) {
    return {
      ok: false, files: {},
      reason: `This app imports ${missingAssets.length} image/font file(s) it doesn't contain (${missingAssets.slice(0, 3).join(', ')}${missingAssets.length > 3 ? `, +${missingAssets.length - 3} more` : ''}). Store apps run entirely from the files you publish, so a viewer's browser can't load them and the app would open blank. Add those files to your app, then publish again.`,
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
const BAKED_SUB = 'baked';
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


// ── The BAKED page: compile once at publish, serve forever ─────────────────────────────────────────
//
// WHY (admin 2026-08-25: "app mart me app jaldi open ho"). Opening a store app used to do, on every
// Cloud Run instance's first serve of it: one doc read + a subcollection read of EVERY file + a
// 200–500 ms server-side compile (measured) — all between the viewer's tap and their first pixel.
// The in-memory cache hid this only per instance, and instances recycle on every deploy. The page is
// fully determined at publish time, so that is when it is built; open becomes one small doc read.
//
// Stored GZIPPED in a single doc under the app. A typical compiled page is 75–190 KB raw and
// 21–23 KB gzipped, so the 1 MiB doc ceiling holds pages up to several MB of raw HTML. A page whose
// gzip does not fit is simply not baked — the serve-time compile path still exists and still works,
// so "too big to bake" degrades to "as slow as today", never to broken. Same on read: any missing or
// unreadable bake falls through to compile. The bake can only make things faster, by construction.
/** Firestore's 1 MiB doc cap, with headroom for field names + metadata. */
const BAKED_MAX_GZ_BYTES = 950_000;

export async function saveWebAppBakedPage(id: string, version: number, html: string): Promise<boolean> {
  const d = db();
  if (!d) return false;
  const gz = gzipSync(Buffer.from(html, 'utf8'));
  if (gz.length > BAKED_MAX_GZ_BYTES) return false; // honest skip — serve-time compile covers it
  await d.collection(COLLECTION).doc(id).collection(BAKED_SUB).doc('page')
    // `runtime` is what stops a bug in OUR runtime from being permanent for every app baked while it
    // existed — see previewRuntimeSignature.ts. Without it, deploying a preview fix leaves the already
    // published apps serving the broken page forever.
    .set({ version, gz, bakedAt: Date.now(), runtime: previewRuntimeSignature() });
  return true;
}

/**
 * The baked page for EXACTLY this version AND this runtime, or null.
 *
 * Two independent reasons a bake is stale, and both must be checked: the creator re-published (version),
 * or we changed the runtime that produced it (runtime). The second one was missing, which is how a
 * fixed preview kept serving broken pages to every viewer of an already-published app.
 */
export async function getWebAppBakedPage(id: string, version: number): Promise<string | null> {
  const d = db();
  if (!d) return null;
  try {
    const doc = await d.collection(COLLECTION).doc(id).collection(BAKED_SUB).doc('page').get();
    if (!doc.exists) return null;
    const data = doc.data() as { version?: number; gz?: unknown; runtime?: string };
    if (!bakeIsCurrent({ version: data.version, runtime: data.runtime }, version)) return null;
    // The admin SDK hands a bytes field back as a Buffer; anything else (a manually edited doc, an
    // emulator quirk) is treated as no bake rather than parsed hopefully.
    const raw = data.gz;
    const buf = Buffer.isBuffer(raw) ? raw : raw instanceof Uint8Array ? Buffer.from(raw) : null;
    if (!buf || buf.length === 0) return null;
    return gunzipSync(buf).toString('utf8');
  } catch {
    return null; // unreadable bake = no bake; the compile path serves
  }
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

// ── Listing screenshots (admin report 2026-08-19: let a creator upload app screens shown in the store) ──

const SCREENSHOTS_SUB = 'screenshots';
/** At most this many screenshots per listing — enough to tell the story, bounded so a listing stays light. */
export const MAX_SCREENSHOTS = 3;
/** Each screenshot data URL must clear Firestore's 1 MiB per-document ceiling with headroom for the doc. */
export const MAX_SCREENSHOT_LEN = 900_000;

/**
 * Keep only valid, in-limit screenshot data URLs, capped at MAX_SCREENSHOTS. Pure — the boundary of what
 * may be stored, unit-tested without I/O. A non-image, oversize, or malformed entry is DROPPED (not
 * truncated into a broken image); order is preserved so screenshot 1 stays screenshot 1.
 */
export function sanitizeScreenshots(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const s of input) {
    if (out.length >= MAX_SCREENSHOTS) break;
    if (typeof s === 'string' && s.startsWith('data:image/') && s.length <= MAX_SCREENSHOT_LEN) out.push(s);
  }
  return out;
}

/**
 * Replace a listing's screenshots wholesale (same "no v1 haunting v2" discipline as saveWebApp's files).
 * Stored one-per-doc, id = zero-padded index so `.get()` returns them in order. Best-effort caller-side.
 */
export async function saveWebAppScreenshots(id: string, screenshots: string[]): Promise<void> {
  const d = db();
  if (!d) throw new Error('no database');
  const col = d.collection(COLLECTION).doc(id).collection(SCREENSHOTS_SUB);
  const existing = await col.listDocuments();
  const b1 = d.batch();
  for (const doc of existing) b1.delete(doc);
  await b1.commit();
  if (screenshots.length === 0) return;
  const b2 = d.batch();
  screenshots.slice(0, MAX_SCREENSHOTS).forEach((dataUrl, i) => {
    b2.set(col.doc(String(i).padStart(3, '0')), { dataUrl });
  });
  await b2.commit();
}

/** A listing's screenshots, in upload order. Empty when none / unreadable. */
export async function getWebAppScreenshots(id: string): Promise<string[]> {
  const d = db();
  if (!d) return [];
  const snap = await d.collection(COLLECTION).doc(id).collection(SCREENSHOTS_SUB).get();
  return snap.docs
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((doc) => (doc.data() as { dataUrl?: unknown }).dataUrl)
    .filter((u): u is string => typeof u === 'string' && u.startsWith('data:image/'));
}

/**
 * LIST QUERIES ARE EQUALITY-ONLY, BY LAW (root cause of the store's first real publish failure,
 * 2026-08-15): `.where(X).orderBy(Y)` on DIFFERENT fields is a composite-index query — Firestore
 * throws FAILED_PRECONDITION on its first production use until someone creates the index by hand in
 * the console, and no session has console access. A single-field filter is auto-indexed and can
 * never demand an index, so the shape itself is the fix: filter on one field, sort in memory.
 *
 * The mechanics now live in `firestoreIndexSafe.ts` — this file was the first of what became four
 * hand-written copies of the same loop, and four copies of a rule is how a rule drifts. That helper
 * takes no `orderBy` parameter, so a call site written against it cannot express the broken shape.
 * Pinned by a source test — do not reintroduce a where+orderBy chain here or anywhere else.
 */
export async function listListedWebApps(limit = 60): Promise<WebStoreApp[]> {
  const d = db();
  if (!d) return [];
  return listEqNewestFirst<WebStoreApp>(d.collection(COLLECTION), [['status', 'listed']], 'publishedAt', limit);
}

export async function listMyWebApps(uid: string, limit = 50): Promise<WebStoreApp[]> {
  const d = db();
  if (!d) return [];
  return listEqNewestFirst<WebStoreApp>(d.collection(COLLECTION), [['uid', uid]], 'publishedAt', limit);
}

/** Web apps awaiting listing review — the admin queue, same discipline as the APK store. */
export async function listUnlistedWebApps(limit = 50): Promise<WebStoreApp[]> {
  const d = db();
  if (!d) return [];
  return listEqNewestFirst<WebStoreApp>(d.collection(COLLECTION), [['status', 'unlisted']], 'publishedAt', limit);
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

export interface WebAppReport {
  appId: string;
  appName: string;
  /** The app's current status, so a reviewer sees at a glance whether it is still reachable. */
  appStatus: WebStoreApp['status'];
  reporterUid: string;
  reason: string;
  at: number;
}

/**
 * Every report, newest first — the queue a human works through.
 *
 * 🔒 WITHOUT THIS, REPORTING WAS DECORATION. reportWebApp has written to this subcollection since the
 * store shipped and nothing ever read it, so "Report sent — a person will look at it" was a promise
 * the code could not keep (admin 2026-08-27).
 *
 * A collection-group query would be one call instead of N+1, but it needs a composite index created
 * out-of-band, and an admin screen that 500s until someone notices a console link is how this feature
 * would quietly stop working a second time. Reports are rare and the app list is small; correctness
 * without a deployment step wins here. Revisit if the store ever carries thousands.
 */
export async function listWebAppReports(limit = 200): Promise<WebAppReport[]> {
  const d = db();
  if (!d) return [];
  const apps = await d.collection(COLLECTION).get();
  const out: WebAppReport[] = [];
  // Bounded CONCURRENCY, not a serial loop: N apps served one-round-trip-at-a-time is a screen that
  // gets slower every time somebody publishes, and an admin page nobody opens is the state this
  // feature was already in. Batched so a large store cannot open hundreds of connections at once.
  const BATCH = 20;
  for (let i = 0; i < apps.docs.length; i += BATCH) {
    const slice = apps.docs.slice(i, i + BATCH);
    const snaps = await Promise.all(slice.map((appDoc) =>
      // Best-effort per app: one unreadable subcollection must not hide every other app's reports.
      appDoc.ref.collection(REPORTS_SUB).get().catch(() => null)));
    for (let j = 0; j < slice.length; j++) {
      const appDoc = slice[j];
      const snap = snaps[j];
      const app = appDoc.data() as WebStoreApp;
      if (!snap) continue;
      for (const r of snap.docs) {
        const data = r.data() as { reporterUid?: string; reason?: string; at?: number };
        out.push({
          appId: appDoc.id,
          appName: app?.name || '(unnamed)',
          appStatus: app?.status ?? 'unlisted',
          reporterUid: data.reporterUid || 'anon',
          reason: String(data.reason || ''),
          at: typeof data.at === 'number' ? data.at : 0,
        });
      }
    }
  }
  return out.sort((a, b) => b.at - a.at).slice(0, limit);
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
