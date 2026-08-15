/**
 * Phase 3 — Static preview builder (the 'static' runtime target).
 *
 * Builds ONE self-contained HTML document from a project's Virtual File System
 * so a pure HTML/CSS/JS app previews with zero build step. Unlike the old
 * AppEngine `buildPreviewHtml` (which only understood 3 hardcoded files), this
 * works over the real multi-file VFS:
 *   - inlines local <link rel=stylesheet> and <script src> from the VFS,
 *   - rewrites relative <img>/asset references to data-URLs when the file exists,
 *   - synthesizes a minimal index.html if none is present.
 *
 * Pure + dependency-free → unit-testable. External (http/https/CDN) URLs are
 * left untouched.
 */
import { VirtualFileSystem } from '../project/ProjectModel';
import { normalizePath } from '../project/ProjectModel';
import { STORAGE_SHIM_SOURCE, APP_TOUCH_CSS, NAVDATA_RUNTIME_SOURCE } from './previewImportMeta';

const ASSET_MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.avif': 'image/avif',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  // BUG B3 FIX: Add media and data MIME types
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.json': 'application/json',
};

function extOf(p: string): string {
  const i = p.lastIndexOf('.');
  return i >= 0 ? p.slice(i).toLowerCase() : '';
}

function isExternal(url: string): boolean {
  return /^(https?:)?\/\//.test(url) || url.startsWith('data:') || url.startsWith('//');
}

/** Resolve a possibly-relative href against the directory of the referencing file. */
function resolveRef(fromPath: string, ref: string): string {
  if (ref.startsWith('/')) return normalizePath(ref);
  const dir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';
  return normalizePath(dir ? `${dir}/${ref}` : ref);
}

/** A local asset → data-URL (for <img>, fonts, etc.). Returns null if not in VFS. */
function assetDataUrl(vfs: VirtualFileSystem, path: string): string | null {
  const f = vfs.read(path);
  if (!f) return null;
  if (f.content.startsWith('data:')) return f.content;
  const mime = ASSET_MIME[extOf(path)] || 'application/octet-stream';
  const b64 = f.encoding === 'base64' ? f.content : Buffer.from(f.content, 'utf8').toString('base64');
  return `data:${mime};base64,${b64}`;
}

/**
 * Build a single self-contained HTML preview document for a static project.
 * `entry` defaults to index.html (or public/index.html).
 */
export function buildStaticPreview(vfs: VirtualFileSystem, entry?: string): string {
  const entryPath = entry && vfs.has(entry)
    ? normalizePath(entry)
    : (vfs.has('index.html') ? 'index.html' : (vfs.has('public/index.html') ? 'public/index.html' : ''));

  let html = entryPath ? (vfs.readText(entryPath) || '') : '';
  if (!html) {
    // BUG B1 FIX: Synthesize a minimal shell by scanning VFS for any CSS/JS files,
    // not just the hardcoded style.css / script.js names. Also preserve type="module"
    // for ES module JS files.
    const cssFile = vfs.paths().find(p => p.endsWith('.css'));
    const jsFile = vfs.paths().find(p => p.endsWith('.js') || p.endsWith('.mjs'));
    const hasEsModule = jsFile
      ? /^\s*(import\s+[\w{*"'`]|export\s+(default|class|function|const|let|var)\b)/m.test(vfs.readText(jsFile) || '')
      : false;
    html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      (cssFile ? `<link rel="stylesheet" href="${cssFile}">` : '') +
      `</head><body>` +
      (jsFile ? `<script ${hasEsModule ? 'type="module" ' : ''}src="${jsFile}"></script>` : '') +
      `</body></html>`;
  }

  // Inline local <link rel="stylesheet" href="...">
  // BUG B2 FIX: After inlining a CSS file, also resolve its @import url() references.
  html = html.replace(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi, (tag) => {
    const m = tag.match(/href=["']([^"']+)["']/i);
    if (!m || isExternal(m[1])) return tag;
    let css = vfs.readText(resolveRef(entryPath, m[1]));
    if (css == null) return tag;
    // Resolve @import url() or @import "..." inside the inlined CSS
    css = css.replace(/@import\s+(?:url\(["']?([^"')]+)["']?\)|["']([^"']+)["'])/gi, (imp, u1, u2) => {
      const ref = u1 || u2;
      if (!ref || isExternal(ref)) return imp;
      const imported = vfs.readText(resolveRef(entryPath, ref));
      return imported != null ? imported : imp;
    });
    return `<style>\n${css}\n</style>`;
  });

  // Inline local <script src="...">
  html = html.replace(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/gi, (tag, src) => {
    if (isExternal(src)) return tag;
    const js = vfs.readText(resolveRef(entryPath, src));
    if (js == null) return tag;
    const typeAttr = /type=["']module["']/i.test(tag) ? ' type="module"' : '';
    return `<script${typeAttr}>\n${js}\n</script>`;
  });

  // Rewrite local <img src="..."> / src-like asset refs to data-URLs.
  html = html.replace(/\b(src|href)=["']([^"']+)["']/gi, (full, attr, url) => {
    if (isExternal(url) || url.startsWith('#') || url.startsWith('data:')) return full;
    const dataUrl = assetDataUrl(vfs, resolveRef(entryPath, url));
    return dataUrl ? `${attr}="${dataUrl}"` : full;
  });

  // The platform runtime the other two shells already carry, applied to plain-HTML apps too
  // (rule 3 — the static path had NONE of it, found while fixing the store's game-over crash):
  //   • storage shim — an opaque-origin iframe (the store player) throws on localStorage, and a
  //     plain-JS game saving its high score dies at game over without this;
  //   • app-feel CSS — long-press text selection / double-tap zoom off by default (app's own CSS,
  //     loaded later, can opt back in);
  //   • NavData — the builder prompt promises window.NavData on every generated page; static pages
  //     were the one shell where that promise was silently broken.
  // Injected at the TOP of <head> so the shim runs before any app script and the CSS is overridable.
  const platformTag = `<style>${APP_TOUCH_CSS}</style>\n<script>\n${STORAGE_SHIM_SOURCE}\n${NAVDATA_RUNTIME_SOURCE}\n</script>`;
  html = /<head[^>]*>/i.test(html)
    ? html.replace(/<head[^>]*>/i, (m) => `${m}\n${platformTag}`)
    : platformTag + '\n' + html;

  return html;
}
