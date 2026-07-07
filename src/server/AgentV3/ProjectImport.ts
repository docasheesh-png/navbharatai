// AgentV3 — "Project Landing Pipeline", step 1: turn an uploaded .zip into a clean, safe
// path→content file map ready for the workspace (admin master plan, 2026-07-04).
//
// THE BUG THIS FIXES: a .zip attached in a v3.0 chat message used to flow down the generic
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
const SKIP_DIR_RE = /(^|\/)(node_modules|\.git|dist|build|out|\.next|\.nuxt|\.svelte-kit|coverage|\.cache|\.turbo|\.vercel|\.output|venv|\.venv|__pycache__|\.pytest_cache|\.mypy_cache|target|\.gradle|Pods|DerivedData|\.expo|\.dart_tool|vendor|\.idea)(\/|$)/;
// OS/editor junk files that ride along in almost every user-made zip.
const JUNK_FILE_RE = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i;
// Live secrets are excluded; ".env.example"/".env.sample" templates are safe and useful to keep.
const SECRET_FILE_RE = /(^|\/)\.env(\.local|\.production|\.development|\.staging)?$|\.(pem|key|p12|pfx|keystore|jks)$/i;
const BINARY_EXT_RE = /\.(png|jpe?g|gif|webp|avif|ico|icns|bmp|tiff?|mp3|mp4|mov|avi|mkv|webm|wav|ogg|flac|zip|gz|tgz|bz2|7z|rar|jar|war|exe|dll|so|dylib|bin|wasm|pdf|docx?|xlsx?|pptx?|ttf|otf|woff2?|eot|psd|ai|sketch|db|sqlite3?)$/i;
// Small binary ASSETS worth keeping (an imported app's logo/favicon/icons/fonts) so the preview
// isn't full of broken images. Everything ELSE that matches BINARY_EXT_RE (video/audio/archives/
// binaries) stays dropped — too large and never needed to boot a preview. ext → MIME for a data URI.
const ASSET_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', ico: 'image/x-icon', bmp: 'image/bmp',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', eot: 'application/vnd.ms-fontobject',
};

/** The asset MIME for a path, or null when it is not a keepable small-asset type. Pure. */
export function assetMimeFor(path: string): string | null {
  const m = path.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? (ASSET_MIME[m[1]] ?? null) : null;
}
// Text lockfiles pin the EXACT dependency tree the app was built with — losing them makes
// `npm install` re-resolve versions and can break an imported app in ways the user never had.
// (bun.lockb is binary and stays excluded.)
const LOCKFILE_RE = /^(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/;

// Raised 2000 → 16000 so a large real app (Mitrify-scale and up to ~50×) imports without being
// truncated. The 80 MB total-bytes ceiling below is the real memory guard and usually binds first.
export const IMPORT_MAX_FILES = 16_000;
export const IMPORT_MAX_FILE_BYTES = 900 * 1024; // durable store cap (Firestore 1MB/doc)
export const IMPORT_MAX_TOTAL_BYTES = 80 * 1024 * 1024;
/** A lockfile larger than the durable cap is still written to the SANDBOX (npm install needs it);
 *  only truly enormous ones are dropped. */
export const IMPORT_MAX_LOCKFILE_BYTES = 3 * 1024 * 1024;
/** Per-asset RAW-byte cap — a small logo/favicon/icon/font, not a hero video. */
export const IMPORT_MAX_ASSET_BYTES = 200 * 1024;
/** Bounds on the kept-asset set so a media-heavy zip can't blow the budget. */
export const IMPORT_MAX_ASSETS = 200;
export const IMPORT_MAX_ASSET_TOTAL_BYTES = 20 * 1024 * 1024;

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

/** Normalize a zip entry path; null → unsafe (zip-slip / absolute / empty). Pure. */
export function safeImportPath(raw: string): string | null {
  const p = raw.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!p || p.startsWith('/') || /^[a-zA-Z]:/.test(p)) return null;
  const parts = p.split('/');
  if (parts.some((seg) => seg === '..' || seg === '')) return null;
  return parts.join('/');
}

/**
 * Extract a project file map from a .zip buffer. Skips derived/secret/binary/oversized entries
 * (counted honestly in `dropped`), strips a single shared root folder ("repo-main/…" → "…"),
 * and never lets a traversal path through.
 */
export async function extractZipProject(buf: Buffer, opts?: { maxFiles?: number }): Promise<ExtractedProject> {
  const maxFiles = opts?.maxFiles ?? IMPORT_MAX_FILES;
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buf);
  const dropped = { dir: 0, junk: 0, secret: 0, binary: 0, tooLarge: 0, unsafe: 0, overCap: 0, outsideAppRoot: 0 };

  // Collect candidate entries first so the root-strip decision sees the full listing.
  const entries: Array<{ path: string; entry: import('jszip').JSZipObject }> = [];
  let totalEntries = 0;
  zip.forEach((relPath, entry) => {
    if (entry.dir) return;
    totalEntries++;
    const safe = safeImportPath(relPath);
    if (!safe) { dropped.unsafe++; return; }
    entries.push({ path: safe, entry });
  });

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
  const sandboxOnly: Record<string, string> = {};
  let totalBytes = 0;
  let assetBytes = 0;
  for (const { path, entry } of entries) {
    if (!path) continue; // re-rooted away above (already counted)
    if (SKIP_DIR_RE.test(path)) { dropped.dir++; continue; }
    if (JUNK_FILE_RE.test(path)) { dropped.junk++; continue; }
    if (SECRET_FILE_RE.test(path)) { dropped.secret++; continue; }
    if (BINARY_EXT_RE.test(path)) {
      // A small image/font asset is KEPT (as a data URI); every other binary is dropped.
      const mime = assetMimeFor(path);
      if (mime && Object.keys(assets).length < IMPORT_MAX_ASSETS) {
        const b64 = await entry.async('base64');
        const rawBytes = Math.floor((b64.length * 3) / 4); // base64 → raw byte estimate
        if (rawBytes <= IMPORT_MAX_ASSET_BYTES && assetBytes + rawBytes <= IMPORT_MAX_ASSET_TOTAL_BYTES) {
          assets[path] = `data:${mime};base64,${b64}`;
          assetBytes += rawBytes;
          continue;
        }
      }
      dropped.binary++;
      continue;
    }
    if (Object.keys(files).length >= maxFiles) { dropped.overCap++; continue; }
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
  return { files, assets, sandboxOnly, dropped, totalEntries, strippedRoot, appRoot };
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

/** Map an imported project's package.json to the framework ids v3.0 already understands. Pure. */
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
 * Validate that an extracted project is something v3.0 can actually run — fail FAST and honestly
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
export function findUnresolvedLocalImports(files: Record<string, string>): Array<{ missing: string; importedBy: string }> {
  const paths = new Set(Object.keys(files));
  const hasSrc = [...paths].some((p) => p === 'src' || p.startsWith('src/'));
  const out: Array<{ missing: string; importedBy: string }> = [];
  const seen = new Set<string>();
  const importRe = /(?:import\s[^'"\n]*?from\s*|import\s*|export\s[^'"\n]*?from\s*)['"]([^'"\n]+)['"]/g;
  for (const [path, content] of Object.entries(files)) {
    if (!/\.(?:m?[jt]sx?)$/i.test(path) || typeof content !== 'string') continue;
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
        out.push({ missing: base, importedBy: path });
        if (out.length >= 20) return out; // bounded — 20 named misses is already the full story
      }
    }
  }
  return out;
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
