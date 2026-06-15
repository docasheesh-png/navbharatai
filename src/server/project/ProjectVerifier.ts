/**
 * Phase 4 — Real project verifier.
 *
 * Replaces the old "heuristic score out of 100" that let known-broken apps ship.
 * Performs concrete, false-positive-averse checks over the VFS and reports real
 * issues a repair step can act on:
 *   - invalid JSON (package.json / *.json)
 *   - missing entry (no index.html for a static project)
 *   - broken LOCAL references in HTML (<link>/<script>/<img> src/href → missing file)
 *
 * Pure + dependency-free → fully unit-testable. External (http/CDN/data:) refs are
 * never flagged.
 */
import { VirtualFileSystem, normalizePath } from './ProjectModel';

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

  // 3. Broken LOCAL references in HTML files
  const refRe = /\b(?:src|href)=["']([^"']+)["']/gi;
  for (const f of vfs.list()) {
    if (!f.path.endsWith('.html') && !f.path.endsWith('.htm')) continue;
    const html = vfs.readText(f.path) || '';
    let m: RegExpExecArray | null;
    while ((m = refRe.exec(html))) {
      const ref = m[1];
      if (isExternal(ref) || ref.trim() === '') continue;
      const target = resolveRef(f.path, ref.split(/[?#]/)[0]);
      if (target && !vfs.has(target)) {
        issues.push({ severity: 'warning', file: f.path, message: `Broken local reference: "${ref}" → ${target} (not found)` });
      }
    }
  }

  const errors = issues.filter(i => i.severity === 'error').length;
  const warnings = issues.length - errors;
  return { ok: errors === 0, errors, warnings, issues };
}
