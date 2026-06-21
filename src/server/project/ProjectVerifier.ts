/**
 * Phase 4 — Real project verifier.
 *
 * Replaces the old "heuristic score out of 100" that let known-broken apps ship.
 * Performs concrete, false-positive-averse checks over the VFS and reports real
 * issues a repair step can act on:
 *   - invalid JSON (package.json / *.json)
 *   - missing entry (no index.html for a static project)
 *   - broken LOCAL refs in HTML: a missing classic <script src> or stylesheet
 *     <link href> is an ERROR (hard break); other missing local refs are warnings
 *
 * Pure + dependency-free → fully unit-testable. External (http/CDN/data:) refs are
 * never flagged.
 */
import { VirtualFileSystem, normalizePath } from './ProjectModel';
import { validateArchitecture } from './ArchitectureValidator';

export type IssueSeverity = 'error' | 'warning';

export interface ProjectIssue {
  severity: IssueSeverity;
  file: string;
  message: string;
}

export interface VerifyResult {
  ok: boolean;            // true when there are no 'error'-severity issues
  errors: number;
  warnings: number;
  issues: ProjectIssue[];
}

function isExternal(url: string): boolean {
  return /^(https?:)?\/\//.test(url) || url.startsWith('data:') || url.startsWith('//')
    || url.startsWith('#') || url.startsWith('mailto:') || url.startsWith('tel:');
}

function resolveRef(fromPath: string, ref: string): string {
  if (ref.startsWith('/')) return normalizePath(ref);
  const dir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';
  return normalizePath(dir ? `${dir}/${ref}` : ref);
}

export function verifyProject(vfs: VirtualFileSystem): VerifyResult {
  const issues: ProjectIssue[] = [];
  const hasPackageJson = vfs.has('package.json');

  // 1. JSON validity
  for (const f of vfs.list()) {
    if (f.path.endsWith('.json') && f.encoding === 'utf8') {
      try { JSON.parse(f.content); }
      catch (e: any) { issues.push({ severity: 'error', file: f.path, message: `Invalid JSON: ${e.message}` }); }
    }
  }

  // 2. Entry presence (only meaningful for static / no-build projects)
  if (!hasPackageJson && !vfs.has('index.html') && !vfs.has('public/index.html')) {
    issues.push({ severity: 'error', file: '(project)', message: 'No entry point: missing index.html for a static project.' });
  }

  // 3. Broken LOCAL references in HTML files. A missing classic <script src>
  //    (non-module) or stylesheet <link href> HARD-BREAKS a static app, so those
  //    are ERRORS (block preview + drive repair); other missing local refs
  //    (images, anchors, and type="module" scripts the bundler resolves itself)
  //    stay WARNINGS to avoid false positives on React/bundled apps.
  const tagRe = /<(script|link|img|a|source|iframe)\b([^>]*?)\/?>/gi;
  const attrRe = /\b(?:src|href)=["']([^"']+)["']/i;
  for (const f of vfs.list()) {
    if (!f.path.endsWith('.html') && !f.path.endsWith('.htm')) continue;
    const html = vfs.readText(f.path) || '';
    let m: RegExpExecArray | null;
    tagRe.lastIndex = 0;
    while ((m = tagRe.exec(html))) {
      const tag = m[1].toLowerCase();
      const attrs = m[2] || '';
      const a = attrRe.exec(attrs);
      if (!a) continue;
      const ref = a[1];
      if (isExternal(ref) || ref.trim() === '') continue;
      const target = resolveRef(f.path, ref.split(/[?#]/)[0]);
      if (!target || vfs.has(target)) continue;
      const isModule = /\btype\s*=\s*["']module["']/i.test(attrs);
      const isStylesheet = tag === 'link' && /\brel\s*=\s*["'][^"']*stylesheet/i.test(attrs);
      const hardBreak = (tag === 'script' && !isModule) || isStylesheet;
      issues.push({
        severity: hardBreak ? 'error' : 'warning',
        file: f.path,
        message: `Broken local reference: "${ref}" → ${target} (not found)`,
      });
    }
  }

  // 4. Module-level checks for JS/TS source apps: dangling relative imports
  //    (real build breakers) and bare deps not declared in package.json.
  const sourceFiles = vfs.list().filter(f => f.encoding === 'utf8' && SRC_RE.test(f.path));
  if (sourceFiles.length) {
    const declaredDeps = collectDeclaredDeps(vfs);
    for (const f of sourceFiles) {
      const src = vfs.readText(f.path) || '';
      let m: RegExpExecArray | null;
      IMPORT_RE.lastIndex = 0;
      const seenBare = new Set<string>();
      while ((m = IMPORT_RE.exec(src))) {
        const spec = m[1];
        if (!spec) continue;
        if (spec.startsWith('.') || spec.startsWith('/')) {
          // relative/absolute local import → must resolve to a real file
          if (!resolveModuleRef(vfs, f.path, spec)) {
            issues.push({ severity: 'error', file: f.path, message: `Broken import: "${spec}" does not resolve to a project file.` });
          }
        } else {
          // bare specifier → should be declared (skip node builtins & already-flagged)
          const pkgName = bareRoot(spec);
          if (declaredDeps && !declaredDeps.has(pkgName) && !isNodeBuiltin(pkgName) && !seenBare.has(pkgName)) {
            seenBare.add(pkgName);
            issues.push({ severity: 'warning', file: f.path, message: `Dependency "${pkgName}" is imported but not in package.json.` });
          }
        }
      }
    }
  }

  // 5. Architecture integrity (blocks the React #299 / mixed-architecture class):
  //    single architecture, DOM mount match, single module entry, no legacy layers.
  for (const issue of validateArchitecture(vfs)) issues.push(issue);

  const errors = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.length - errors;
  return { ok: errors === 0, errors, warnings, issues };
}

const MODULE_EXTS = ['', '.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.vue', '.json', '.css',
  '/index.tsx', '/index.ts', '/index.jsx', '/index.js', '/index.vue'];

const SRC_RE = /\.(jsx?|tsx?|mjs|cjs)$/i;

/** Shared import regex — used by both verifyProject and extractBareImports to avoid drift. */
const IMPORT_RE = /(?:import\s[^'"]*?from\s*|import\s*|export\s[^'"]*?from\s*|require\(\s*|import\(\s*)["']([^"']+)["']/g;

/** Resolve a relative/absolute local import to a real VFS path, trying extensions. */
function resolveModuleRef(vfs: VirtualFileSystem, fromPath: string, spec: string): string | null {
  const base = resolveRef(fromPath, spec.split(/[?#]/)[0]);
  for (const ext of MODULE_EXTS) {
    if (vfs.has(base + ext)) return base + ext;
  }
  return null;
}

/** The package name from a bare specifier ("@scope/pkg/sub" → "@scope/pkg", "lodash/x" → "lodash"). */
function bareRoot(spec: string): string {
  return spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
}

/** Declared deps from package.json (deps+devDeps+peerDeps), or null if no/invalid package.json. */
export function collectDeclaredDeps(vfs: VirtualFileSystem): Set<string> | null {
  const text = vfs.readText('package.json');
  if (!text) return null;
  try {
    const pkg = JSON.parse(text);
    return new Set([
      ...Object.keys(pkg.dependencies || {}),
      ...Object.keys(pkg.devDependencies || {}),
      ...Object.keys(pkg.peerDependencies || {}),
    ]);
  } catch { return null; }
}

/**
 * Scan every JS/TS source file in the VFS and return the de-duped list of bare
 * package roots imported (relative imports and Node.js builtins excluded).
 * Used by DependencySync to auto-declare missing packages in package.json.
 */
export function extractBareImports(vfs: VirtualFileSystem): string[] {
  const seen = new Set<string>();
  for (const f of vfs.list()) {
    if (!f.encoding || f.encoding !== 'utf8' || !SRC_RE.test(f.path)) continue;
    const src = vfs.readText(f.path) || '';
    let m: RegExpExecArray | null;
    IMPORT_RE.lastIndex = 0;
    while ((m = IMPORT_RE.exec(src))) {
      const spec = m[1];
      if (!spec || spec.startsWith('.') || spec.startsWith('/')) continue;
      const pkg = bareRoot(spec);
      if (!isNodeBuiltin(pkg)) seen.add(pkg);
    }
  }
  return Array.from(seen);
}

const NODE_BUILTINS = new Set([
  'fs', 'path', 'http', 'https', 'crypto', 'os', 'util', 'events', 'stream',
  'url', 'querystring', 'child_process', 'zlib', 'buffer', 'assert', 'net',
  'tls', 'dns', 'process', 'module', 'timers', 'string_decoder',
]);
function isNodeBuiltin(name: string): boolean {
  return NODE_BUILTINS.has(name) || name.startsWith('node:');
}
