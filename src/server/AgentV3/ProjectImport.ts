// AgentV3 — "Project Landing Pipeline", step 1: turn an uploaded .zip into a clean, safe
// path→content file map ready for the workspace (admin master plan, 2026-07-04).
//
// THE BUG THIS FIXES: a .zip attached in a v5.0 chat message used to flow down the generic
// attachment path — its text was extracted into the model's CONTEXT and the archive was never
// unpacked into the workspace. Files tab: empty. IDE: empty. Preview: nothing to run. This module
// is the shared extraction/validation half of the pipeline; the chat route (and any future entry
// point — standalone import UI, GitHub import) feeds its output into the SAME dual write
// (E2B sandbox + durable WorkspaceFileStore) that `import-files` uses, so every import lands in
// Files + IDE + Preview together — never in one place but not the others.
//
// Safety rules (non-negotiable):
//  • zip-slip / traversal entries ("../", absolute paths) are REJECTED, never written.
//  • node_modules/.git/build outputs are dropped (they are re-derived by `npm install`/builds).
//  • live secrets (.env and friends) are NEVER imported — the user re-enters their own secrets.
//  • binary and oversized entries are skipped with an honest count, not silently.

// Derived/vendor folders across the stacks users actually migrate from (Node, Python, Rust/Java,
// mobile/Expo, PHP) — all re-created by the stack's own install/build, never worth importing.
// SINGLE SOURCE OF TRUTH (2026-08-04): these rules now live in src/lib/importRules.ts so the BROWSER
// can apply the exact same filter before uploading (the master import handler drops node_modules/media
// client-side instead of shipping a gigabyte for the server to discard). They are re-exported here
// unchanged, so every existing server call site — including the api.github.com repo materializer that
// has relied on them since 2026-07-24 — keeps importing them from this module. Re-export, never a copy:
// a second definition would drift, and the drift would be silent (the browser keeping a file the server
// refuses, or dropping one it would keep).
import {
  SKIP_DIR_RE, JUNK_FILE_RE, SECRET_FILE_RE, BINARY_EXT_RE, assetMimeFor, safeImportPath,
} from '../../lib/importRules';
export {
  SKIP_DIR_RE, JUNK_FILE_RE, SECRET_FILE_RE, BINARY_EXT_RE, assetMimeFor, safeImportPath,
  importDropReason, type ImportDropReason,
} from '../../lib/importRules';

// Text lockfiles pin the EXACT dependency tree the app was built with — losing them makes
// `npm install` re-resolve versions and can break an imported app in ways the user never had.
// (bun.lockb is binary and stays excluded.)
const LOCKFILE_RE = /^(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/;

// Raised 2000 → 16000 so a large real app (Mitrify-scale and up to ~50×) imports without being
// truncated. The 80 MB total-bytes ceiling below is the real memory guard and usually binds first.
export const IMPORT_MAX_FILES = 16_000;
export const IMPORT_MAX_FILE_BYTES = 900 * 1024; // durable store cap (Firestore 1MB/doc)
export const IMPORT_MAX_TOTAL_BYTES = 80 * 1024 * 1024;
/** SECURITY (zip-bomb DoS guard): a hard ceiling on how many ENTRIES a zip may declare, checked
 *  BEFORE anything is decompressed — stops a "millions of tiny entries" archive from OOM-ing the
 *  Node process. Well above any real app (IMPORT_MAX_FILES = 16k), so a legitimate import is never
 *  affected. */
export const IMPORT_MAX_ZIP_ENTRIES = 60_000;
/** SECURITY (zip-bomb DoS guard): the total UNCOMPRESSED bytes we will decompress across the whole
 *  archive. A few-KB "zip bomb" that inflates 1000:1 is refused once its declared uncompressed sizes
 *  cross this ceiling — BEFORE the runaway entry is expanded into memory. Generous headroom over the
 *  80 MB kept-text budget so a real import never trips it. */
export const IMPORT_MAX_DECOMPRESSED_BYTES = 300 * 1024 * 1024;
/** A lockfile larger than the durable cap is still written to the SANDBOX (npm install needs it);
 *  only truly enormous ones are dropped. */
export const IMPORT_MAX_LOCKFILE_BYTES = 3 * 1024 * 1024;
/** Per-asset RAW-byte cap — a small logo/favicon/icon/font, not a hero video. */
export const IMPORT_MAX_ASSET_BYTES = 640 * 1024; // raised 200KB → 640KB (base64 ~853KB < the 900KB Firestore-doc cap)
/** Bounds on the kept-asset set so a media-heavy zip can't blow the budget. */
export const IMPORT_MAX_ASSETS = 200;
export const IMPORT_MAX_ASSET_TOTAL_BYTES = 30 * 1024 * 1024;
/** SANDBOX-ONLY image tier (admin 2026-08-03: "88 large images not imported — will the app break?"):
 *  images too big for the durable store (>640KB) are still materialized in the LIVE sandbox so the
 *  preview isn't full of broken pictures — NOT persisted (a cold restart re-imports, exactly like the
 *  big-lockfile tier). Bounded so a photo/video-heavy repo can't exhaust memory. Non-image binaries
 *  (video/audio/archives — no image MIME) are never kept either way. */
export const IMPORT_MAX_SANDBOX_ASSET_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_SANDBOX_ASSET_TOTAL_BYTES = 50 * 1024 * 1024;

export interface ExtractedProject {
  files: Record<string, string>;
  /**
   * Small binary assets (logo/favicon/icons/fonts, ≤200KB each) kept as `data:<mime>;base64,…`
   * strings. Deliberately SEPARATE from `files`: assets are written to the sandbox as real bytes
   * and persisted in their OWN durable store, so they never pollute the text-file map that the
   * in-browser preview, the deploy collector, and the AI's file reads consume.
   */
  assets: Record<string, string>;
  /**
   * Files that exceed the durable-store cap but are still worth having in the LIVE sandbox
   * (today: big text lockfiles, so `npm install` reproduces the app's exact dependency tree).
   * Written to the sandbox only — the durable store skips them by design (honest, not silent:
   * the summary says so), and a restore simply re-resolves via install.
   */
  /**
   * IMAGES too big for the durable asset store (>640KB) but renderable — materialized in the LIVE
   * sandbox as real bytes so the preview isn't full of broken pictures, NOT persisted durably (a cold
   * restart re-imports, like sandboxOnly lockfiles). `data:` URIs, same shape as `assets`.
   */
  sandboxAssets: Record<string, string>;
  sandboxOnly: Record<string, string>;
  /** Paths intentionally not imported, grouped by the honest reason. */
  dropped: { dir: number; junk: number; secret: number; binary: number; tooLarge: number; unsafe: number; overCap: number; outsideAppRoot: number };
  totalEntries: number;
  /** The single root folder stripped from every path (GitHub-style "repo-main/"), if any. */
  strippedRoot: string | null;
  /** Monorepo landing: the nested app folder the import was re-rooted to (e.g. "apps/web"), if any. */
  appRoot: string | null;
}

/** Is this chat attachment a .zip archive (by extension or MIME)? Pure. */
export function isZipAttachment(att: { name?: unknown; type?: unknown }): boolean {
  const name = typeof att?.name === 'string' ? att.name.toLowerCase() : '';
  const type = typeof att?.type === 'string' ? att.type.toLowerCase() : '';
  return name.endsWith('.zip') || type === 'application/zip' || type === 'application/x-zip-compressed';
}

/**
 * SECURITY (zip-bomb guard) — the DECLARED uncompressed size of a JSZip entry, read defensively from
 * its metadata WITHOUT decompressing it. JSZip does not expose this on the public object, so we read
 * the internal `_data.uncompressedSize` best-effort; when it is unavailable this returns 0 and the
 * caller falls back to the existing post-decompress byte caps (never worse than before). Pure.
 */
export function zipEntryDeclaredBytes(entry: unknown): number {
  const d = (entry as { _data?: { uncompressedSize?: unknown } } | null)?._data;
  const n = d && typeof d.uncompressedSize === 'number' ? d.uncompressedSize : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Extract a project file map from a .zip buffer. Skips derived/secret/binary/oversized entries
 * (counted honestly in `dropped`), strips a single shared root folder ("repo-main/…" → "…"),
 * and never lets a traversal path through. Guarded against decompression-bomb DoS.
 */
export async function extractZipProject(buf: Buffer, opts?: { maxFiles?: number }): Promise<ExtractedProject> {
  const maxFiles = opts?.maxFiles ?? IMPORT_MAX_FILES;
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buf);
  const dropped = { dir: 0, junk: 0, secret: 0, binary: 0, tooLarge: 0, unsafe: 0, overCap: 0, outsideAppRoot: 0 };

  // Collect candidate entries first so the root-strip decision sees the full listing.
  const entries: Array<{ path: string; entry: import('jszip').JSZipObject }> = [];
  let totalEntries = 0;
  // SECURITY (zip-bomb): track the total DECLARED uncompressed size while listing — before any entry
  // is expanded into memory — and refuse the archive the moment it crosses the decompression ceiling
  // or the entry-count cap. Both are checked here, up front, so a malicious archive is rejected
  // instead of OOM-ing the process at the first `entry.async()` below.
  let declaredBytes = 0;
  let bombRejected = false;
  zip.forEach((relPath, entry) => {
    if (entry.dir) return;
    totalEntries++;
    if (bombRejected) return;
    if (totalEntries > IMPORT_MAX_ZIP_ENTRIES) { bombRejected = true; return; }
    declaredBytes += zipEntryDeclaredBytes(entry);
    if (declaredBytes > IMPORT_MAX_DECOMPRESSED_BYTES) { bombRejected = true; return; }
    const safe = safeImportPath(relPath);
    if (!safe) { dropped.unsafe++; return; }
    entries.push({ path: safe, entry });
  });
  if (bombRejected) {
    throw new Error(`Refusing to import this archive: it declares too much content to unpack safely (over ${Math.round(IMPORT_MAX_DECOMPRESSED_BYTES / (1024 * 1024))} MB uncompressed, or over ${IMPORT_MAX_ZIP_ENTRIES.toLocaleString()} entries) — it looks like a decompression bomb. Import a smaller project, or a GitHub URL.`);
  }

  // GitHub "Download ZIP" wraps everything in one "repo-main/" folder — strip it when EVERY
  // entry shares the same first segment (and there is more than the bare folder itself).
  let strippedRoot: string | null = null;
  const firstSegs = new Set(entries.map((e) => e.path.split('/')[0]));
  if (entries.length > 1 && firstSegs.size === 1 && entries.every((e) => e.path.includes('/'))) {
    strippedRoot = [...firstSegs][0];
    for (const e of entries) e.path = e.path.slice(strippedRoot.length + 1);
  }

  // MONOREPO LANDING: no root package.json but nested app(s) → re-root the import to the most
  // app-like nested folder (e.g. "apps/web"), so what lands is a RUNNABLE app instead of a pile
  // of folders no preview can boot. The candidates' package.json contents are read up-front
  // (bounded) so the choice is scored on real evidence, not folder names alone.
  let appRoot: string | null = null;
  if (!entries.some((e) => e.path === 'package.json')) {
    const pkgEntries = entries.filter((e) => /(^|\/)package\.json$/.test(e.path) && !SKIP_DIR_RE.test(e.path)).slice(0, 20);
    const candidates: Array<{ path: string; content: string }> = [];
    for (const e of pkgEntries) {
      try { candidates.push({ path: e.path, content: await e.entry.async('string') }); } catch { /* unreadable candidate — scored out */ }
    }
    appRoot = chooseMonorepoAppRoot(candidates);
    if (appRoot) {
      const prefix = `${appRoot}/`;
      for (const e of entries) {
        if (e.path.startsWith(prefix)) e.path = e.path.slice(prefix.length);
        else { e.path = ''; dropped.outsideAppRoot++; } // outside the chosen app — not imported
      }
    }
  }

  const files: Record<string, string> = {};
  const assets: Record<string, string> = {};
  const sandboxAssets: Record<string, string> = {};
  const sandboxOnly: Record<string, string> = {};
  let totalBytes = 0;
  let assetBytes = 0;
  let sandboxAssetBytes = 0;
  for (const { path, entry } of entries) {
    if (!path) continue; // re-rooted away above (already counted)
    if (SKIP_DIR_RE.test(path)) { dropped.dir++; continue; }
    if (JUNK_FILE_RE.test(path)) { dropped.junk++; continue; }
    if (SECRET_FILE_RE.test(path)) { dropped.secret++; continue; }
    if (BINARY_EXT_RE.test(path)) {
      // IMAGE/FONT assets are KEPT (as data URIs); every other binary (video/audio/archive) is dropped.
      const mime = assetMimeFor(path);
      // MEMORY GUARD: never DECODE a binary we could not keep anyway — an entry that DECLARES more than
      // the sandbox cap is dropped without inflating it into memory (protects against a giant image).
      const declaredBin = zipEntryDeclaredBytes(entry);
      if (mime && !(declaredBin > IMPORT_MAX_SANDBOX_ASSET_BYTES)) {
        const b64 = await entry.async('base64');
        const rawBytes = Math.floor((b64.length * 3) / 4); // base64 → raw byte estimate
        const dataUri = `data:${mime};base64,${b64}`;
        // TIER 1 — DURABLE: fits the Firestore-backed asset store, within its budget + count.
        if (rawBytes <= IMPORT_MAX_ASSET_BYTES && Object.keys(assets).length < IMPORT_MAX_ASSETS
            && assetBytes + rawBytes <= IMPORT_MAX_ASSET_TOTAL_BYTES) {
          assets[path] = dataUri;
          assetBytes += rawBytes;
          continue;
        }
        // TIER 2 — SANDBOX-ONLY: too big to persist but renderable — materialize for the live preview.
        if (rawBytes <= IMPORT_MAX_SANDBOX_ASSET_BYTES
            && sandboxAssetBytes + rawBytes <= IMPORT_MAX_SANDBOX_ASSET_TOTAL_BYTES) {
          sandboxAssets[path] = dataUri;
          sandboxAssetBytes += rawBytes;
          continue;
        }
      }
      dropped.binary++;
      continue;
    }
    if (Object.keys(files).length >= maxFiles) { dropped.overCap++; continue; }
    // SECURITY (zip-bomb): a single entry that DECLARES more than the lockfile ceiling is skipped
    // WITHOUT decompressing it — no text file the app needs is that large, so this only ever drops a
    // hostile inflate-in-one-entry payload (0 when the size is unknowable → falls through to the
    // post-decompress byte cap below).
    const declared = zipEntryDeclaredBytes(entry);
    if (declared > IMPORT_MAX_LOCKFILE_BYTES && !LOCKFILE_RE.test(path)) { dropped.tooLarge++; continue; }
    const content = await entry.async('string');
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > IMPORT_MAX_FILE_BYTES) {
      // A big text lockfile still goes to the live sandbox so `npm install` reproduces the
      // exact dependency tree; anything else oversized is dropped with an honest count.
      if (LOCKFILE_RE.test(path) && bytes <= IMPORT_MAX_LOCKFILE_BYTES) { sandboxOnly[path] = content; continue; }
      dropped.tooLarge++;
      continue;
    }
    if (totalBytes + bytes > IMPORT_MAX_TOTAL_BYTES) { dropped.overCap++; continue; }
    totalBytes += bytes;
    files[path] = content;
  }
  return { files, assets, sandboxAssets, sandboxOnly, dropped, totalEntries, strippedRoot, appRoot };
}

/**
 * Split a `data:<mime>;base64,<payload>` string into its mime + base64 payload, or null when it
 * is not a base64 data URI. Used to materialize a stored asset back into the sandbox as real
 * bytes (via the actuator's writeBinaryFile). Pure + tested.
 */
export function parseDataUri(dataUri: string): { mime: string; base64: string } | null {
  if (typeof dataUri !== 'string') return null;
  const m = dataUri.match(/^data:([^;,]+);base64,(.*)$/s);
  if (!m) return null;
  return { mime: m[1], base64: m[2] };
}

/**
 * Pick the nested folder that is most likely THE runnable app when a zip has no root
 * package.json (monorepo / multi-folder export). Scored on real evidence: a dev/start script,
 * a known framework dependency, a conventional "apps/…" home, and shallowness. Returns the
 * folder (e.g. "apps/web") or null when there is no clear app (no candidates, or nothing
 * scores above zero — a plain file dump should NOT be re-rooted). Pure + tested.
 */
export function chooseMonorepoAppRoot(candidates: Array<{ path: string; content: string }>): string | null {
  let best: { root: string; score: number; depth: number } | null = null;
  for (const c of candidates) {
    if (!/\//.test(c.path)) continue; // a root package.json is handled by the normal path
    const root = c.path.slice(0, -'/package.json'.length);
    const depth = root.split('/').length;
    let pkg: { scripts?: Record<string, unknown>; dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown>; workspaces?: unknown } = {};
    try { pkg = JSON.parse(c.content); } catch { continue; }
    if (pkg.workspaces) continue; // a nested WORKSPACE root is a container, not the app
    let score = 0;
    const scripts = (pkg.scripts && typeof pkg.scripts === 'object') ? pkg.scripts : {};
    if (['dev', 'start', 'serve'].some((s) => typeof (scripts as Record<string, unknown>)[s] === 'string')) score += 3;
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    if (['next', 'react', 'vue', 'svelte', 'astro', '@angular/core', 'vite'].some((d) => Object.prototype.hasOwnProperty.call(deps, d))) score += 2;
    if (/^apps?\//.test(root)) score += 1;
    if (score === 0) continue;
    if (!best || score > best.score || (score === best.score && depth < best.depth)) {
      best = { root, score, depth };
    }
  }
  return best ? best.root : null;
}

/**
 * The honest "set your own secrets" note for an imported app that ships a .env template —
 * surfaces the variable NAMES the app expects (values are the user's own; live .env files are
 * never imported). '' when the project has no template. Pure + tested.
 */
export function envTemplateNote(files: Record<string, string>): string {
  const raw = files['.env.example'] ?? files['.env.sample'] ?? files['.env.template'];
  if (typeof raw !== 'string' || !raw.trim()) return '';
  const names: string[] = [];
  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && !names.includes(m[1])) names.push(m[1]);
  }
  if (names.length === 0) return '';
  const shown = names.slice(0, 12);
  const more = names.length - shown.length;
  return `🔑 This app expects ${names.length} environment variable${names.length === 1 ? '' : 's'} (from its .env template): ${shown.join(', ')}${more > 0 ? ` +${more} more` : ''}. Live secret files are never imported — tell me your values (or add them later) and I will wire them in.`;
}

export interface ImportValidation {
  ok: boolean;
  issues: string[];
  /** FrameworkPicker id the session should adopt ('vite-react' | 'nextjs' | 'vue' | …). */
  framework: string;
  hasPackageJson: boolean;
}

/**
 * Does the `dev` (or start/serve) script LAUNCH A NODE SERVER (tsx/ts-node/node/nodemon on a
 * server entry) rather than a Vite/framework dev server? This is the tell of a Replit/Lovable-style
 * FULL-STACK export where the Express/Fastify server ALSO serves the frontend — so the preview must
 * boot on the server's port (Express default 3000), NOT the Vite 5173 that a pure-frontend guess used
 * (the exact "did not come up on port 5173" Mitrify failure). Pure.
 */
export function devScriptRunsNodeServer(pkgRaw: string | undefined): boolean {
  if (!pkgRaw) return false;
  let scripts: Record<string, unknown> = {};
  try { scripts = (JSON.parse(pkgRaw) as { scripts?: Record<string, unknown> }).scripts ?? {}; } catch { return false; }
  const cmd = ['dev', 'start', 'serve'].map((s) => (typeof scripts[s] === 'string' ? (scripts[s] as string) : '')).join(' ; ').toLowerCase();
  if (!cmd.trim()) return false;
  // A real node-server launcher on a server entry (server.ts, server/index.ts, src/server, app.ts…).
  return /\b(tsx|ts-node|nodemon|node)\b[^;]*\b(server|app|index|main|backend|api)\b/.test(cmd)
    || /\bnodemon\b/.test(cmd);
}

/** Map an imported project's package.json to the framework ids v5.0 already understands. Pure. */
export function detectImportedFramework(files: Record<string, string>): string {
  const pkgRaw = files['package.json'];
  if (!pkgRaw) {
    return Object.keys(files).some((p) => /(^|\/)index\.html$/.test(p)) ? 'vanilla' : 'vite-react';
  }
  let deps: Record<string, unknown> = {};
  try {
    const pkg = JSON.parse(pkgRaw) as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
    deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  } catch {
    return 'vite-react';
  }
  const has = (name: string) => Object.prototype.hasOwnProperty.call(deps, name);
  // Meta-frameworks own their run/port regardless of a server dep, so match them first.
  if (has('next')) return 'nextjs';
  if (has('@remix-run/react') || has('@remix-run/node')) return 'remix';
  if (has('nuxt')) return 'nuxt';
  if (has('@sveltejs/kit')) return 'sveltekit';
  if (has('astro')) return 'astro';
  // FULL-STACK (Replit/Lovable export): a frontend framework + a Node server whose OWN dev script boots
  // it (Express/Fastify serving the client). The Node server is the run target → node-express (port
  // 3000), not the frontend's Vite port. This is what makes a monorepo client/+server/ app's live
  // preview actually come up instead of waiting forever on 5173.
  if ((has('express') || has('fastify') || has('koa')) && devScriptRunsNodeServer(pkgRaw)) return 'node-express';
  if (has('svelte')) return 'svelte';
  if (has('vue')) return 'vue';
  if (has('@angular/core')) return 'angular';
  if (has('react')) return 'vite-react';
  if (has('express') || has('fastify')) return 'node-express';
  return 'vanilla';
}

/**
 * The set of meta-framework ids whose scaffold/toolchain differs FUNDAMENTALLY from vite-react — the
 * class where a wrong `vite-react` label is catastrophic (the builder fights the scaffold, the preview
 * boots on the wrong command/port, the analyzers run against the wrong framework). Detecting one of
 * these from the real files must OVERRIDE a stale `vite-react` label.
 */
const META_FRAMEWORKS = new Set(['nextjs', 'nuxt', 'remix', 'sveltekit', 'astro', 'angular']);

/**
 * Detect the framework of an EXISTING workspace from its real files, for correcting a stale/wrong label
 * on a continue/edit turn (PulseBoard autopsy 2026-07-20: a Next.js app was scaffolded/labelled
 * `vite-react`, so the builder burned ~15 min reconciling package.json vs Next.js code, the preview
 * booted with Vite assumptions, and the report mislabelled the framework). Unlike `detectImportedFramework`
 * (package.json deps only — which LAGS while the builder is still converting the app), this ALSO reads
 * STRUCTURAL signals (a `next.config`/`nuxt.config`/… file, or an app-router layout + route-handler
 * pair under `app/`) so a half-converted app is still recognised. Returns a META-framework id ONLY when
 * a confident signal is present, else null (the caller then keeps the current label — this NEVER downgrades
 * a real framework to vite-react on a weak signal). Pure + unit-testable.
 */
export function detectFrameworkFromWorkspace(files: Record<string, string>): string | null {
  if (!files || typeof files !== 'object') return null;
  const paths = Object.keys(files);
  if (paths.length === 0) return null;
  // 1) DEPENDENCY signal (strongest when present): a real meta-framework dep in package.json.
  const byDeps = detectImportedFramework(files);
  if (META_FRAMEWORKS.has(byDeps)) return byDeps;
  // 2) CONFIG-FILE signal (definitive even when package.json still lags — the exact PulseBoard case):
  //    a framework's own config file is unambiguous. Mirrors isViteReactTarget's "next.config ⇒ Next.js".
  const hasFile = (re: RegExp) => paths.some((p) => re.test(p));
  if (hasFile(/(?:^|\/)next\.config\.[cm]?[jt]s$/i)) return 'nextjs';
  if (hasFile(/(?:^|\/)nuxt\.config\.[cm]?[jt]s$/i)) return 'nuxt';
  if (hasFile(/(?:^|\/)astro\.config\.[cm]?[jt]s$/i)) return 'astro';
  if (hasFile(/(?:^|\/)svelte\.config\.[cm]?[jt]s$/i)) return 'sveltekit';
  if (hasFile(/(?:^|\/)remix\.config\.[cm]?[jt]s$/i)) return 'remix';
  if (hasFile(/(?:^|\/)angular\.json$/i)) return 'angular';
  // 3) STRUCTURE signal for Next.js App Router (a config file can be absent on a fresh app): a file
  //    UNDER an `app/` (or `src/app/`) directory whose basename is `layout.*` PLUS one that is `route.*`
  //    is the unmistakable App-Router shape. Required TOGETHER so a stray `layout.tsx` elsewhere in a
  //    Vite app never false-flips. Uses path segments (not a regex with `/` in a char class).
  const underAppDir = (p: string, base: RegExp): boolean => {
    const segs = p.split('/');
    const i = segs.indexOf('app');
    if (i === -1) return false;            // no `app/` segment
    if (i > 1) return false;               // must be at repo root or directly under one dir
    if (i === 1 && segs[0] !== 'src') return false; // the only allowed parent is `src/`
    if (segs.length - 1 <= i) return false; // must be a file BELOW app/, not `app` itself
    return base.test(segs[segs.length - 1]);
  };
  const hasAppLayout = paths.some((p) => underAppDir(p, /^layout\.[jt]sx?$/i));
  const hasRouteHandler = paths.some((p) => underAppDir(p, /^route\.[jt]s$/i));
  if (hasAppLayout && hasRouteHandler) return 'nextjs';
  return null;
}

export type FrameworkFamily = 'react' | 'vue' | 'svelte' | 'angular' | 'solid' | 'other';

/** Collapse a framework id to its toolchain FAMILY, so nextjs+react source (same family) is NOT a mismatch
 *  but svelte source + react package (different families) IS. Pure. */
export function frameworkFamily(fw: string | null | undefined): FrameworkFamily {
  switch (fw) {
    case 'vite-react':
    case 'nextjs':
    case 'remix':
    case 'gatsby':
      return 'react';
    case 'vue':
    case 'nuxt':
      return 'vue';
    case 'svelte':
    case 'sveltekit':
      return 'svelte';
    case 'angular':
      return 'angular';
    case 'solid':
      return 'solid';
    default:
      return 'other';
  }
}

/**
 * Classify a workspace by its SOURCE FILE signals (extensions + framework-specific markers), independently
 * of package.json. This is the missing counterpart to detectImportedFramework (which reads package.json deps
 * only): nothing else in the engine maps `.svelte`/`.vue`/Angular source to a framework, which is why a
 * Svelte source tree on a React package.json read as `vite-react`. Returns a framework id ONLY on an
 * UNAMBIGUOUS extension signal (`.svelte`, `.vue`, an Angular component + @angular/core), else null — it
 * never tries to claim `react` from a `.tsx` file (too weak; react is already the default). Pure.
 */
export function detectFrameworkFromSourceExtensions(files: Record<string, string>): string | null {
  if (!files || typeof files !== 'object') return null;
  const paths = Object.keys(files);
  if (paths.some((p) => /\.svelte$/i.test(p))) {
    // SvelteKit vs plain Svelte: routing/marker files or SvelteKit-only imports.
    const svelteKit = paths.some((p) => /(?:^|\/)\+(page|layout|server|error)\.(svelte|[jt]sx?)$/i.test(p))
      || Object.values(files).some(
        (c) => typeof c === 'string' && /(from\s+['"]\$(app|lib|env)\/|['"]@sveltejs\/kit['"]|['"]\.\/\$types['"])/.test(c),
      );
    return svelteKit ? 'sveltekit' : 'svelte';
  }
  if (paths.some((p) => /\.vue$/i.test(p))) return 'vue';
  const hasNgComponent = paths.some((p) => /\.component\.ts$/i.test(p));
  const hasNgImport = Object.values(files).some((c) => typeof c === 'string' && /from\s+['"]@angular\/core['"]/.test(c));
  if (hasNgComponent && hasNgImport) return 'angular';
  return null;
}

export interface FrameworkCoherence {
  ok: boolean;
  sourceFramework: string | null;
  packageFramework: string | null;
  evidence: string[];
}

/**
 * Detect a "Frankenstein" workspace whose SOURCE files are one framework but whose package.json/build config
 * genuinely CANNOT build that framework (autopsy buildId a4be5a05: a `.svelte`/`+page.server.ts`/`$lib`
 * source tree on a React package.json with `tsc && vite build` — so `tsc` isn't found, `$types` is never
 * generated, `$lib` is unresolvable, and the builder thrashes for ~18 min then fails). Conservative by
 * construction — flags ONLY when ALL hold: (1) the source framework is unambiguous (.svelte/.vue/Angular),
 * (2) package.json genuinely LACKS that framework's toolchain (a real Svelte app HAS `svelte`/`@sveltejs/kit`
 * deps, so it never fires on a legitimate project), and (3) the package framework is a DIFFERENT family.
 * Pure + unit-testable. Never mutates.
 */
export function checkFrameworkCoherence(files: Record<string, string>): FrameworkCoherence {
  const coherent = (): FrameworkCoherence => ({ ok: true, sourceFramework: null, packageFramework: null, evidence: [] });
  if (!files || typeof files !== 'object' || typeof files['package.json'] !== 'string') return coherent();
  const sourceFramework = detectFrameworkFromSourceExtensions(files);
  if (!sourceFramework) return coherent();
  const packageFramework = detectImportedFramework(files);
  const srcFam = frameworkFamily(sourceFramework);
  if (srcFam === frameworkFamily(packageFramework)) return coherent();
  let deps: Record<string, unknown> = {};
  try {
    const pkg = JSON.parse(files['package.json']) as { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
    deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  } catch {
    return coherent();
  }
  const has = (n: string) => Object.prototype.hasOwnProperty.call(deps, n);
  // Does package.json actually carry the SOURCE framework's toolchain? If so, it's buildable → coherent.
  const buildableForSource =
    srcFam === 'svelte' ? has('svelte') || has('@sveltejs/kit')
    : srcFam === 'vue' ? has('vue') || has('nuxt')
    : srcFam === 'angular' ? has('@angular/core')
    : srcFam === 'solid' ? has('solid-js')
    : true;
  if (buildableForSource) return coherent();
  const evidence: string[] = [];
  if (srcFam === 'svelte') {
    const n = Object.keys(files).filter((p) => /\.svelte$/i.test(p)).length;
    evidence.push(`${n} .svelte file(s)${sourceFramework === 'sveltekit' ? ' + SvelteKit markers ($lib/$app/+page)' : ''}`);
  } else if (srcFam === 'vue') {
    evidence.push(`${Object.keys(files).filter((p) => /\.vue$/i.test(p)).length} .vue file(s)`);
  } else if (srcFam === 'angular') {
    evidence.push('Angular component files + @angular/core imports');
  }
  evidence.push(`package.json declares ${packageFramework} and lacks ${srcFam} tooling`);
  return { ok: false, sourceFramework, packageFramework, evidence };
}

/** Build the agent-facing warning for an incoherent workspace (empty string when coherent). Non-mutating —
 *  it tells the builder to reconcile to ONE framework BEFORE writing features, instead of thrashing. Pure. */
export function frameworkCoherenceGuidance(c: FrameworkCoherence): string {
  if (c.ok || !c.sourceFramework) return '';
  return [
    `[WORKSPACE FRAMEWORK MISMATCH — read before writing any code]`,
    `This project's SOURCE files are ${c.sourceFramework} (${c.evidence.join('; ')}), but its package.json / build config is ${c.packageFramework}. As-is it CANNOT build — the two toolchains conflict.`,
    `Do NOT pile new files of either framework on top, and do NOT mass-rewrite every source file to "reconcile" them (that thrashes and usually fails). FIRST commit to ONE framework:`,
    `• To extend THIS project, keep the framework its source files already use (${c.sourceFramework}) and fix package.json + the dev/build scripts + config to match it (add the right deps, correct the build script), then write features.`,
    `• If the user's request clearly wants a different framework, rebuild BOTH the config and the sources consistently in that one framework — never a mix.`,
    `Make package.json, the build config, and the source files all agree on ONE framework and verify the dev server actually starts BEFORE writing feature code.`,
  ].join('\n');
}

/**
 * Validate that an extracted project is something v5.0 can actually run — fail FAST and honestly
 * (before any sandbox time is spent) instead of producing a mystery dead preview later.
 */
export function validateImportedProject(files: Record<string, string>): ImportValidation {
  const issues: string[] = [];
  const paths = Object.keys(files);
  if (paths.length === 0) {
    return { ok: false, issues: ['The archive contained no importable source files (after skipping node_modules, build outputs, binaries and secrets).'], framework: 'vite-react', hasPackageJson: false };
  }
  const pkgRaw = files['package.json'];
  const hasPackageJson = typeof pkgRaw === 'string';
  const framework = detectImportedFramework(files);
  if (hasPackageJson) {
    try {
      const pkg = JSON.parse(pkgRaw as string) as { scripts?: Record<string, unknown>; workspaces?: unknown };
      const scripts = pkg.scripts ?? {};
      if (pkg.workspaces) {
        // A workspace ROOT landed as the project (the re-root above only fires when there is NO
        // root package.json). Installing may work, but there is no single app to boot — say so.
        issues.push('This project is a monorepo workspace root — tell me which app inside it to run (e.g. "run the app in apps/web") and I will set it up.');
      }
      if (!['dev', 'start', 'serve', 'preview'].some((s) => typeof scripts[s] === 'string')) {
        issues.push('package.json has no dev/start/serve script — the live preview cannot boot it automatically (the in-browser preview and AI editing still work).');
      }
    } catch {
      issues.push('package.json is not valid JSON — fix it (or ask me to) before the live preview can run.');
    }
  } else if (!paths.some((p) => /(^|\/)index\.html$/.test(p))) {
    issues.push('No package.json and no index.html found — this does not look like a runnable web project. I imported the files; tell me what you want to do with them.');
  }
  // Validation "issues" are honest WARNINGS — the import itself still proceeds (files must land
  // in the workspace either way so the user and the AI can fix the project). Only a truly empty
  // archive is a hard failure.
  return { ok: true, issues, framework, hasPackageJson };
}

/** Extensions + index variants a bundler tries when resolving a local import without one. */
const LOCAL_RESOLVE_SUFFIXES = ['', '.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.vue', '.svelte', '.json', '.css',
  '/index.tsx', '/index.ts', '/index.jsx', '/index.js'];

/** Normalize a/b/../c → a/c (no filesystem). */
function normalizeRel(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { out.pop(); continue; }
    out.push(part);
  }
  return out.join('/');
}

/**
 * Find LOCAL imports (./ ../ or the `@/` src alias) that resolve to NO imported file — the honest
 * "this repo snapshot is INCOMPLETE" detector, run at IMPORT time.
 *
 * ROOT CAUSE (admin, 2026-07-07 — "isko rocksolid banao"): a GitHub repo pushed from an interrupted
 * mid-build state imported cleanly (47 files), but its App.tsx referenced five src/pages/* files the
 * repo never contained — the user discovered it only as a stubbed, blank preview. An incomplete
 * import must be named AT IMPORT TIME, with the exact missing list, so the user (and the AI turn)
 * can repair it immediately instead of hitting a silent dead-end. PURE + unit-tested; bare npm
 * packages and builtins are ignored (they are dependency territory, not missing files).
 */
/** The importable forms of a real file path: itself, extension-stripped, and /index-stripped. */
const RESOLVE_EXT_RE = /\.(?:tsx?|jsx?|mjs|cjs|vue|svelte|json|css)$/i;
const RESOLVE_INDEX_RE = /\/index\.(?:tsx?|jsx?|mjs|cjs)$/i;

/**
 * When a local import resolves to NO file, is the SAME module actually present at a DIFFERENT path?
 * (real case, Kanban build 2026-07-13: `src/stores/useBoardStore.ts` WAS written, but Dashboard imported
 * `stores/useBoardStore` — a bare/over-relative path that escaped `src/` — so the gate called it "missing"
 * and told the repair pass to CREATE a duplicate.) Returns the existing file iff EXACTLY ONE file matches
 * the imported tail — never a guess. Lets the repair FIX THE PATH instead of writing a second copy. Pure.
 */
function existingModuleByTail(base: string, paths: Set<string>): string | undefined {
  const found = new Set<string>();
  for (const p of paths) {
    const forms = [p, p.replace(RESOLVE_EXT_RE, ''), p.replace(RESOLVE_INDEX_RE, '')];
    if (forms.some((f) => f === base || f.endsWith(`/${base}`))) found.add(p);
  }
  return found.size === 1 ? [...found][0] : undefined;
}

/**
 * Blank out everything that only LOOKS like code: line/block comments and template literals.
 *
 * ROOT CAUSE (self-import autopsy 2026-08-03): importing NavBharatAI itself reported "This import
 * looks INCOMPLETE — 20 file(s) its code references are missing", naming things like
 * `src/server/AgentV3/Missing`, `src/server/AgentV3/b`, `src/lib/App` and `src/components/ide/component`.
 * NONE of them were real imports:
 *   • `ArchitectureAnalysis.test.ts` holds FIXTURES — `"import { X } from './Missing';"` inside a string,
 *     which is the very input that test feeds the analyzer;
 *   • `AITestingSuite.tsx` holds a TEMPLATE LITERAL of example test code containing `from './component'`;
 *   • `firebase.ts` mentions ``import { auth } from './App'`` inside a // COMMENT.
 * So the scanner cried wolf on a perfectly complete repo — and the offer it makes ("say 'create the
 * missing files' and I'll build them") would have had the AI CREATE `Missing.ts`, `b.ts`, `App.ts`…
 * i.e. actively pollute the user's codebase on the strength of a false alarm. A warning that fires on
 * a healthy import is worse than no warning: it burns the trust the real signal depends on.
 *
 * Length is preserved (replace with spaces/newlines) so any offset stays meaningful. Deliberately does
 * NOT touch ordinary '…'/"…" strings: a real import specifier lives in one, and the `import ⟨spec⟩`
 * grammar the caller matches already requires the import keyword to precede it. Pure.
 */
export function maskNonCodeRegions(src: string): string {
  // ONE left-to-right pass, not a chain of independent regexes. Chained regexes DESYNCHRONISE: a
  // template literal holding generated code (our own Scaffold/Generator files do exactly this) contains
  // `/* … */` and `//` comments, so a comment-regex run first eats across the template's boundaries,
  // its closing backtick disappears, and the template's contents are then scanned AS CODE — which is
  // how "import App from './App';" inside a scaffold string became a phantom missing file. Scanning
  // once, honouring whichever region opens first, is the only way the boundaries stay correct.
  //
  // Ordinary '…' / "…" strings are TOKENISED but their text is PRESERVED: a real import specifier lives
  // in one. Skipping over them still matters — a quote-embedded backtick or `//` must not be mistaken
  // for the start of a template/comment. Length is preserved (newlines kept) so offsets stay meaningful.
  let out = '';
  let i = 0;
  const n = src.length;
  const blankTo = (from: number, to: number) => {
    for (let k = from; k < to; k++) out += src[k] === '\n' ? '\n' : ' ';
  };
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '*') {                      // /* block comment */
      let j = src.indexOf('*/', i + 2);
      j = j < 0 ? n : j + 2;
      blankTo(i, j); i = j; continue;
    }
    if (c === '/' && c2 === '/') {                      // // line comment
      let j = src.indexOf('\n', i);
      j = j < 0 ? n : j;
      blankTo(i, j); i = j; continue;
    }
    if (c === '`') {                                    // `template literal` (escape-aware)
      let j = i + 1;
      while (j < n && src[j] !== '`') j += src[j] === '\\' ? 2 : 1;
      j = Math.min(j + 1, n);
      blankTo(i, j); i = j; continue;
    }
    if (c === '"' || c === "'") {                       // '…' / "…" — skipped over, text KEPT
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      j = Math.min(j + 1, n);
      out += src.slice(i, j); i = j; continue;
    }
    out += c; i++;
  }
  return out;
}

export function findUnresolvedLocalImports(files: Record<string, string>): Array<{ missing: string; importedBy: string; existsAt?: string }> {
  const paths = new Set(Object.keys(files));
  const hasSrc = [...paths].some((p) => p === 'src' || p.startsWith('src/'));
  const out: Array<{ missing: string; importedBy: string; existsAt?: string }> = [];
  const seen = new Set<string>();
  // A REAL import/export is a STATEMENT: it starts its own line. The `^[ \t]*` anchor (with /m) is what
  // separates it from the same text quoted INSIDE a string — which is how every analyzer test fixture in
  // a repo is written (`'src/a.ts': "import { b } from './b';\n…"`). Without the anchor, importing a repo
  // that merely CONTAINS import-parsing tests reported 20 phantom "missing files" (self-import autopsy
  // 2026-08-03). Combined with maskNonCodeRegions (comments + template literals), only real code is read.
  const importRe = /^[ \t]*(?:import\s[^'"\n]*?from\s*|import\s*|export\s[^'"\n]*?from\s*)['"]([^'"\n]+)['"]/gm;
  for (const [path, rawContent] of Object.entries(files)) {
    if (!/\.(?:m?[jt]sx?)$/i.test(path) || typeof rawContent !== 'string') continue;
    // Only scan REAL code — comments and template literals routinely contain example/fixture imports
    // that do not exist and must never be reported as a missing file (see maskNonCodeRegions).
    const content = maskNonCodeRegions(rawContent);
    let m: RegExpExecArray | null;
    importRe.lastIndex = 0;
    while ((m = importRe.exec(content))) {
      const spec = m[1];
      let base: string | null = null;
      if (spec.startsWith('./') || spec.startsWith('../')) {
        base = normalizeRel(`${path.split('/').slice(0, -1).join('/')}/${spec}`);
      } else if (spec.startsWith('@/') && hasSrc) {
        base = normalizeRel(`src/${spec.slice(2)}`);
      }
      if (!base) continue; // bare package / builtin / other alias — dependency territory, not a missing file
      const resolves = LOCAL_RESOLVE_SUFFIXES.some((s) => paths.has(base + s));
      if (!resolves && !seen.has(base)) {
        seen.add(base);
        // If the SAME module exists at another path, this is a MISPATH (fix the import), not a
        // truly-missing file (create it) — surfacing existsAt keeps the repair from writing a duplicate.
        const existsAt = existingModuleByTail(base, paths);
        out.push(existsAt ? { missing: base, importedBy: path, existsAt } : { missing: base, importedBy: path });
        if (out.length >= 20) return out; // bounded — 20 named misses is already the full story
      }
    }
  }
  return out;
}

/** The correct relative import specifier from `fromFile` to a resolved module path (ext + /index stripped). */
function relImportSpecifier(fromFile: string, existsAt: string): string {
  const fromDir = fromFile.split('/').slice(0, -1);
  const target = existsAt.replace(RESOLVE_INDEX_RE, '').replace(RESOLVE_EXT_RE, '').split('/');
  let i = 0;
  while (i < fromDir.length && i < target.length && fromDir[i] === target[i]) i++;
  const ups = fromDir.slice(i).map(() => '..');
  const downs = target.slice(i);
  const rel = [...ups, ...downs].join('/');
  return rel.startsWith('.') ? rel : `./${rel}`;
}

/**
 * DETERMINISTIC MISPATH AUTO-FIX (admin deep-test build #1, 2026-07-17 — the expense-tracker report).
 *
 * ROOT CAUSE: the fast lane's missing-import gate correctly DETECTS a WRONG-PATH local import to a file
 * that already exists (`existsAt`), but it only TELLS the LLM to fix it. On that build the repair call
 * was throttled (GLM 429 storm), so the trivial one-character path error escalated fast-lane → 3 repair
 * attempts → one-shot (150s timeout) → full builder: ~10 wasted minutes for a correct app that needed
 * one import path corrected. A wrong path to a KNOWN existing file is deterministically fixable with zero
 * model calls — so the engine fixes it itself instead of paying a rebuild cascade.
 *
 * For every local import (`./ ../ @/`) that resolves to NO file but whose module EXISTS unambiguously at
 * another path, rewrite the specifier to the correct relative path. Only unambiguous single-target
 * mispaths are touched (existingModuleByTail already guarantees exactly one match); truly-missing imports
 * (no existsAt) are left for the repair pass to CREATE. Pure + unit-tested.
 */
export function fixMispathLocalImports(files: Record<string, string>): {
  files: Record<string, string>;
  fixes: Array<{ importedBy: string; from: string; to: string }>;
} {
  const paths = new Set(Object.keys(files));
  const hasSrc = [...paths].some((p) => p === 'src' || p.startsWith('src/'));
  const fixes: Array<{ importedBy: string; from: string; to: string }> = [];
  const out: Record<string, string> = { ...files };
  // group1 = the import prefix up to and including the opening quote; group2 = specifier; group3 = closing quote.
  const re = /((?:import\s[^'"\n]*?from\s*|import\s*|export\s[^'"\n]*?from\s*)['"])([^'"\n]+)(['"])/g;
  for (const [path, content] of Object.entries(files)) {
    if (!/\.(?:m?[jt]sx?)$/i.test(path) || typeof content !== 'string') continue;
    let changed = false;
    const next = content.replace(re, (full: string, pre: string, spec: string, close: string) => {
      let base: string | null = null;
      if (spec.startsWith('./') || spec.startsWith('../')) base = normalizeRel(`${path.split('/').slice(0, -1).join('/')}/${spec}`);
      else if (spec.startsWith('@/') && hasSrc) base = normalizeRel(`src/${spec.slice(2)}`);
      if (!base) return full; // bare package / builtin / other alias — never our path to touch
      if (LOCAL_RESOLVE_SUFFIXES.some((s) => paths.has(base + s))) return full; // already resolves
      const existsAt = existingModuleByTail(base, paths);
      if (!existsAt) return full; // truly missing — the repair pass CREATEs it, we don't invent a path
      const correct = relImportSpecifier(path, existsAt);
      if (correct === spec) return full;
      changed = true;
      fixes.push({ importedBy: path, from: spec, to: correct });
      return `${pre}${correct}${close}`;
    });
    if (changed) out[path] = next;
  }
  return { files: out, fixes };
}

/**
 * Should a GitHub import RETRY the clone anonymously (without the user's token)? True only when a
 * TOKEN-authenticated clone brought in NOTHING (`!hydrated && addedFileCount === 0`) AND a token was
 * actually used (`hadToken`) AND the anonymous URL differs from the authed one (`urlsDiffer`).
 *
 * ROOT CAUSE (deep-test App #5, 2026-07-13): the structured import injects the user's GitHub token into
 * the clone URL. For a PUBLIC repo the token's scope does NOT cover — a GitHub App installation token, or
 * a token for a different account — the authenticated clone FAILS (403/404), even though an ANONYMOUS
 * clone of that same public repo succeeds. The report proved it: `hydrateFromRepo` said "couldn't clone
 * .../mitrify" while the model's own plain `git clone` of the identical URL exited 0. Retrying without the
 * token recovers exactly that case (a private repo still needs the token, so we try authed FIRST). Pure +
 * unit-tested.
 */
export function shouldRetryImportAnonymously(opts: {
  hydrated: boolean;
  addedFileCount: number;
  hadToken: boolean;
  urlsDiffer: boolean;
}): boolean {
  return !opts.hydrated && opts.addedFileCount === 0 && opts.hadToken && opts.urlsDiffer;
}

/** The honest "— skipped …" tail explaining every entry an extraction dropped, or ''. Pure. */
export function droppedDetailNote(extracted: ExtractedProject): string {
  const d = extracted.dropped;
  if (d.dir + d.junk + d.secret + d.binary + d.tooLarge + d.unsafe + d.overCap + d.outsideAppRoot === 0) return '';
  const why: string[] = [];
  if (d.dir) why.push(`${d.dir} from dependency/build folders (re-created by install)`);
  if (d.junk) why.push(`${d.junk} OS/editor junk file${d.junk === 1 ? '' : 's'}`);
  if (d.secret) why.push(`${d.secret} secret file${d.secret === 1 ? '' : 's'} (.env/keys — re-enter your own secrets)`);
  if (d.binary) why.push(`${d.binary} binary asset${d.binary === 1 ? '' : 's'}`);
  if (d.tooLarge) why.push(`${d.tooLarge} over the 900KB per-file limit`);
  if (d.unsafe) why.push(`${d.unsafe} with unsafe paths`);
  if (d.overCap) why.push(`${d.overCap} over the ${IMPORT_MAX_FILES}-file cap`);
  if (d.outsideAppRoot) why.push(`${d.outsideAppRoot} outside the detected app folder`);
  return `— skipped ${why.join(', ')}`;
}

/** One honest, human-readable import summary line for the chat stream. Pure. */
export function importSummaryLine(extracted: ExtractedProject, framework: string): string {
  const n = Object.keys(extracted.files).length;
  const parts = [`📦 Imported ${n} file${n === 1 ? '' : 's'} from your zip (framework: ${framework})`];
  const assetCount = Object.keys(extracted.assets).length;
  if (assetCount > 0) parts.push(`+ ${assetCount} image/font asset${assetCount === 1 ? '' : 's'}`);
  if (extracted.appRoot) parts.push(`— landed the app from its "${extracted.appRoot}/" folder`);
  const lockfiles = Object.keys(extracted.sandboxOnly);
  if (lockfiles.length > 0) parts.push(`— kept ${lockfiles.join(', ')} for exact dependency versions (sandbox only, too large for durable storage)`);
  const tail = droppedDetailNote(extracted);
  if (tail) parts.push(tail);
  return parts.join(' ');
}

/**
 * The COMPLETE, durable accounting of an import: every archive entry, accounted for.
 *
 * ROOT CAUSE (admin 2026-08-03, mitrify GitHub import): the repo listing said "316 files", the build
 * then said "166 source files", and NOTHING in the build report explained the gap — so the only
 * possible conclusion was "10% bhi import nahi ho paya". The engine already COUNTS every dropped
 * entry by reason (`extracted.dropped`) and then throws those numbers away: the honest note lives
 * only in an ephemeral chat narration, which is not what the admin diagnoses from. Worse, the
 * integrity warnings that DO reach the report hedge with "if part of the repo was too large to
 * import, this may not be accurate" — telling the user something might be missing while withholding
 * the numbers that would settle it.
 *
 * This returns one line where the numbers ADD UP, so "where did my files go?" is always answerable
 * from the report alone. Pure.
 */
export function importAccountingLine(extracted: ExtractedProject): string {
  const d = extracted.dropped;
  const source = Object.keys(extracted.files).length;
  const assets = Object.keys(extracted.assets).length;
  const sandboxAssets = Object.keys(extracted.sandboxAssets ?? {}).length;
  const sandboxOnly = Object.keys(extracted.sandboxOnly).length;
  const droppedTotal = d.dir + d.junk + d.secret + d.binary + d.tooLarge + d.unsafe + d.overCap + d.outsideAppRoot;
  const kept: string[] = [`${source} source file${source === 1 ? '' : 's'}`];
  if (assets) kept.push(`${assets} image/font asset${assets === 1 ? '' : 's'}`);
  if (sandboxAssets) kept.push(`${sandboxAssets} large image${sandboxAssets === 1 ? '' : 's'} (preview only)`);
  if (sandboxOnly) kept.push(`${sandboxOnly} lockfile${sandboxOnly === 1 ? '' : 's'} (sandbox only)`);

  // Every reason, always — a zero bucket is omitted, but nothing that happened is hidden.
  const why: string[] = [];
  if (d.dir) why.push(`${d.dir} dependency/build files (node_modules, dist — re-created by install)`);
  if (d.junk) why.push(`${d.junk} OS/editor junk`);
  if (d.secret) why.push(`${d.secret} secret file${d.secret === 1 ? '' : 's'} (.env/keys — never imported, re-enter your own)`);
  if (d.binary) why.push(`${d.binary} large binaries (images/video over the asset limit)`);
  if (d.tooLarge) why.push(`${d.tooLarge} over the 900KB per-file limit`);
  if (d.unsafe) why.push(`${d.unsafe} with unsafe paths`);
  if (d.overCap) why.push(`${d.overCap} over the import size cap`);
  if (d.outsideAppRoot) why.push(`${d.outsideAppRoot} outside the app folder`);

  const head = `IMPORT ACCOUNTING — ${extracted.totalEntries} archive entr${extracted.totalEntries === 1 ? 'y' : 'ies'} → KEPT ${kept.join(' + ')}`;
  const tail = droppedTotal > 0
    ? `; NOT imported ${droppedTotal} (${why.join(', ')})`
    : '; nothing was dropped';
  const root = extracted.appRoot ? ` [app landed from "${extracted.appRoot}/"]` : '';
  return `${head}${tail}.${root} Source files are what the AI reads and edits; the rest are either re-created by \`npm install\` or not code.`;
}
