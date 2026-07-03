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

const SKIP_DIR_RE = /(^|\/)(node_modules|\.git|dist|build|out|\.next|\.nuxt|\.svelte-kit|coverage|\.cache|\.turbo|\.vercel|\.output)(\/|$)/;
// Live secrets are excluded; ".env.example"/".env.sample" templates are safe and useful to keep.
const SECRET_FILE_RE = /(^|\/)\.env(\.local|\.production|\.development|\.staging)?$|\.(pem|key|p12|pfx|keystore|jks)$/i;
const BINARY_EXT_RE = /\.(png|jpe?g|gif|webp|avif|ico|icns|bmp|tiff?|mp3|mp4|mov|avi|mkv|webm|wav|ogg|flac|zip|gz|tgz|bz2|7z|rar|jar|war|exe|dll|so|dylib|bin|wasm|pdf|docx?|xlsx?|pptx?|ttf|otf|woff2?|eot|psd|ai|sketch|db|sqlite3?)$/i;

export const IMPORT_MAX_FILES = 2_000;
export const IMPORT_MAX_FILE_BYTES = 900 * 1024; // durable store cap (Firestore 1MB/doc)
export const IMPORT_MAX_TOTAL_BYTES = 80 * 1024 * 1024;

export interface ExtractedProject {
  files: Record<string, string>;
  /** Paths intentionally not imported, grouped by the honest reason. */
  dropped: { dir: number; secret: number; binary: number; tooLarge: number; unsafe: number; overCap: number };
  totalEntries: number;
  /** The single root folder stripped from every path (GitHub-style "repo-main/"), if any. */
  strippedRoot: string | null;
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
export async function extractZipProject(buf: Buffer): Promise<ExtractedProject> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buf);
  const dropped = { dir: 0, secret: 0, binary: 0, tooLarge: 0, unsafe: 0, overCap: 0 };

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

  const files: Record<string, string> = {};
  let totalBytes = 0;
  for (const { path, entry } of entries) {
    if (SKIP_DIR_RE.test(path)) { dropped.dir++; continue; }
    if (SECRET_FILE_RE.test(path)) { dropped.secret++; continue; }
    if (BINARY_EXT_RE.test(path)) { dropped.binary++; continue; }
    if (Object.keys(files).length >= IMPORT_MAX_FILES) { dropped.overCap++; continue; }
    const content = await entry.async('string');
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > IMPORT_MAX_FILE_BYTES) { dropped.tooLarge++; continue; }
    if (totalBytes + bytes > IMPORT_MAX_TOTAL_BYTES) { dropped.overCap++; continue; }
    totalBytes += bytes;
    files[path] = content;
  }
  return { files, dropped, totalEntries, strippedRoot };
}

export interface ImportValidation {
  ok: boolean;
  issues: string[];
  /** FrameworkPicker id the session should adopt ('vite-react' | 'nextjs' | 'vue' | …). */
  framework: string;
  hasPackageJson: boolean;
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
  if (has('next')) return 'nextjs';
  if (has('@remix-run/react') || has('@remix-run/node')) return 'remix';
  if (has('nuxt')) return 'nuxt';
  if (has('@sveltejs/kit')) return 'sveltekit';
  if (has('svelte')) return 'svelte';
  if (has('vue')) return 'vue';
  if (has('@angular/core')) return 'angular';
  if (has('astro')) return 'astro';
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
      const pkg = JSON.parse(pkgRaw as string) as { scripts?: Record<string, unknown> };
      const scripts = pkg.scripts ?? {};
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

/** One honest, human-readable import summary line for the chat stream. Pure. */
export function importSummaryLine(extracted: ExtractedProject, framework: string): string {
  const n = Object.keys(extracted.files).length;
  const d = extracted.dropped;
  const droppedTotal = d.dir + d.secret + d.binary + d.tooLarge + d.unsafe + d.overCap;
  const parts = [`📦 Imported ${n} file${n === 1 ? '' : 's'} from your zip (framework: ${framework})`];
  if (droppedTotal > 0) {
    const why: string[] = [];
    if (d.dir) why.push(`${d.dir} from node_modules/build folders (re-created by npm install)`);
    if (d.secret) why.push(`${d.secret} secret file${d.secret === 1 ? '' : 's'} (.env/keys — re-enter your own secrets)`);
    if (d.binary) why.push(`${d.binary} binary asset${d.binary === 1 ? '' : 's'}`);
    if (d.tooLarge) why.push(`${d.tooLarge} over the 900KB per-file limit`);
    if (d.unsafe) why.push(`${d.unsafe} with unsafe paths`);
    if (d.overCap) why.push(`${d.overCap} over the ${IMPORT_MAX_FILES}-file cap`);
    parts.push(`— skipped ${why.join(', ')}`);
  }
  return parts.join(' ');
}
