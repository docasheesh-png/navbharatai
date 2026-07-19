import type { Express, Request, Response, RequestHandler } from 'express';

/** No-op middleware used when no rate limiter is injected (e.g. unit tests). */
const previewPassthrough: RequestHandler = (_req, _res, next) => next();
import { build as esbuild } from 'esbuild';
import { esbuildMessagesToProblems } from '../../lib/previewProblems';
import path from 'path';
import os from 'os';
import { promises as fsp } from 'fs';
import { VirtualFileSystem } from '../project/ProjectModel';
import { getPreviewService } from '../runtime/PreviewService';
import { buildProxyUrl } from '../runtime/proxyUrl';
import { buildVuePreview } from '../runtime/VuePreview';
import { sendSafeError } from '../lib/httpError';

// ── Server-side esbuild bundler for React/TS preview ────────────────────────
// Eliminates the browser-side Babel CDN + complex require() runtime entirely.
// Result: one pre-bundled ESM script + importmap for npm packages (esm.sh).
//
// POST /api/preview-bundle { files } → { html: string }
// ─────────────────────────────────────────────────────────────────────────────

const ESM = 'https://esm.sh/';

const MINI_HARNESS = `<script>(function(){
  function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');}
  window.__nbShowError=function(m){
    if(document.getElementById('__nb_err'))return;
    var o=document.createElement('div');o.id='__nb_err';
    o.style.cssText='position:fixed;inset:0;background:#0d1117;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;z-index:2147483647;padding:24px;box-sizing:border-box';
    o.innerHTML='<div style="max-width:500px;width:100%;background:#161b22;border:1px solid rgba(245,158,11,.3);border-radius:14px;padding:24px;color:#c9d1d9"><div style="font-weight:800;color:#f59e0b;font-size:12px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Preview Error</div><pre style="background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:10px;font-size:11px;color:#ff7b72;overflow:auto;max-height:200px;white-space:pre-wrap;word-break:break-all;margin:0">'+esc(m)+'</pre><div style="margin-top:12px;font-size:11px;color:#8b949e">Ask AI to fix or check the code in Code Studio.</div></div>';
    (document.body||document.documentElement).appendChild(o);
  };
  window.onerror=function(m,s,l,c,e){window.__nbShowError((e&&e.message)||m||'Script error');};
  window.addEventListener('unhandledrejection',function(e){window.__nbShowError((e&&e.reason&&e.reason.message)||(e&&e.reason)||'Promise rejected');});
  setTimeout(function(){
    if(document.getElementById('__nb_err'))return;
    var t=(document.body&&document.body.innerText||'').trim();
    var v=document.querySelector('#root *,#app *,[data-reactroot] *,canvas,svg,img,button,input');
    if(!t&&!v)window.__nbShowError('Preview is empty — the app rendered nothing visible.');
  },5000);
})();</script>`;

function safePath(p: string): string {
  // Segment-wise filtering: a single-pass /\.\./g strip is bypassable ("....//" → "../").
  // Splitting and dropping traversal/empty segments guarantees nothing escapes the temp dir.
  return p
    .replace(/\\/g, '/')
    .split('/')
    .filter(seg => seg && seg !== '.' && seg !== '..')
    .join('/');
}

function detectBundleEntry(files: Record<string, string>): string {
  const rawHtml = files['index.html'] || '';
  const m = rawHtml.match(/<script[^>]+type=["']module["'][^>]+src=["']([^"']+)["']/i);
  if (m) {
    const e = m[1].replace(/^\//, '').replace(/^\.\//, '');
    if (files[e]) return e;
  }
  const cands = ['src/main.tsx','src/main.jsx','src/main.ts','src/index.tsx','src/index.jsx','main.tsx','main.jsx'];
  return cands.find(c => files[c]) || '';
}

function collectBarePackages(files: Record<string, string>): Set<string> {
  const found = new Set<string>();
  const re = /(?:from|import)\s+['"]([^'"]+)['"]/g;
  for (const content of Object.values(files)) {
    if (typeof content !== 'string') continue;
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content))) {
      const s = m[1];
      if (s && s[0] !== '.' && s[0] !== '/' && !(s[0] === '@' && s[1] === '/')) {
        const root = s[0] === '@' ? s.split('/').slice(0, 2).join('/') : s.split('/')[0];
        found.add(root);
      }
    }
  }
  return found;
}

export async function bundleForPreview(files: Record<string, string>): Promise<string> {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nb-preview-'));
  try {
    // Write source files to temp dir (with BrowserRouter→HashRouter rewrite)
    for (const [rawPath, content] of Object.entries(files)) {
      if (typeof content !== 'string') continue;
      const safe = safePath(rawPath);
      if (!safe) continue;
      const full = path.join(tmpDir, safe);
      await fsp.mkdir(path.dirname(full), { recursive: true });
      let src = content;
      if (/\.(jsx|tsx|js|ts|mjs)$/i.test(safe) && src.includes('BrowserRouter')) {
        src = src.replace(/createBrowserRouter/g, 'createHashRouter').replace(/\bBrowserRouter\b/g, 'HashRouter');
      }
      await fsp.writeFile(full, src, 'utf8');
    }

    const entry = detectBundleEntry(files);
    if (!entry) throw new Error('No runnable entry point found');

    // Package versions from package.json
    let pkgDeps: Record<string, string> = {};
    try {
      const pkg = JSON.parse(files['package.json'] || '{}');
      Object.assign(pkgDeps, pkg.dependencies || {}, pkg.devDependencies || {});
    } catch {}
    const ver = (name: string) => {
      const v = pkgDeps[name];
      return v ? '@' + v.replace(/^[\^~>=<\s]*/,'').split(/\s/)[0] : '';
    };

    // All bare imports → external (importmap resolves them via esm.sh). Include the
    // `pkg/*` wildcard so subpath imports (firebase/app, firebase/auth) are externalized
    // too, not bundled — across all esbuild versions.
    const barePackages = [...collectBarePackages(files)];
    const external = barePackages.flatMap(p => [p, `${p}/*`]);

    let result;
    try {
      result = await esbuild({
      entryPoints: [path.join(tmpDir, entry)],
      bundle: true,
      write: false,
      outfile: 'bundle.js',
      format: 'esm',
      jsx: 'automatic',
      jsxImportSource: 'react',
      external,
      loader: {
        '.tsx': 'tsx', '.ts': 'ts', '.jsx': 'jsx', '.js': 'js',
        '.css': 'css', '.svg': 'dataurl',
        '.png': 'dataurl', '.jpg': 'dataurl', '.jpeg': 'dataurl',
        '.gif': 'dataurl', '.webp': 'dataurl',
      },
      nodePaths: [path.join(process.cwd(), 'node_modules')],
      plugins: [{
        name: 'at-alias',
        setup(b) {
          b.onResolve({ filter: /^@\// }, async (args) => {
            const base = path.join(tmpDir, 'src', args.path.slice(2));
            // Try with and without common extensions so `@/components/Foo` resolves to Foo.tsx
            const exts = ['', '.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.jsx', '/index.js'];
            for (const ext of exts) {
              try {
                await fsp.access(base + ext);
                return { path: base + ext };
              } catch {}
            }
            return { path: base }; // let esbuild report "not found" with the real path
          });
        },
      }],
      logLevel: 'silent',
      define: { 'import.meta.env': '{"MODE":"production","DEV":false,"PROD":true}' },
      });
    } catch (buildErr: any) {
      // esbuild throws a BuildFailure with a structured `errors` array (text + file/line/column).
      // Surface those as REAL "Problems" so the IDE can list them — attached to the thrown error and
      // mapped to workspace-relative paths. Never fabricated.
      const problems = esbuildMessagesToProblems(buildErr?.errors, tmpDir);
      const msg = problems.length > 0 ? problems[0].message : (buildErr?.message || 'Bundle failed');
      throw Object.assign(new Error(msg), { problems });
    }

    const js = result.outputFiles?.find(f => f.path.endsWith('.js'))?.text || '';
    const css = result.outputFiles?.find(f => f.path.endsWith('.css'))?.text || '';
    if (!js) throw new Error('esbuild produced no JS output');

    // Importmap for npm packages → esm.sh.
    // CRITICAL: each package needs BOTH an exact entry (bare import `firebase`) AND a
    // trailing-slash entry (subpath imports `firebase/app`, `firebase/auth`). Native
    // importmaps do NOT auto-resolve subpaths from the bare entry — without the
    // `"firebase/"` mapping the browser throws "Failed to resolve module specifier
    // firebase/app". This is the #1 cause of preview failures for Firebase/MUI/etc.
    const reactVer = ver('react') || '@18.3.1';
    const rdVer = ver('react-dom') || '@18.3.1';
    const imapEntries: Record<string, string> = {
      react: ESM + 'react' + reactVer,
      'react/': ESM + 'react' + reactVer + '/',
      'react-dom': ESM + 'react-dom' + rdVer,
      'react-dom/': ESM + 'react-dom' + rdVer + '/',
      'react-dom/client': ESM + 'react-dom' + rdVer + '/client',
      'react/jsx-runtime': ESM + 'react' + reactVer + '/jsx-runtime',
      'react/jsx-dev-runtime': ESM + 'react' + reactVer + '/jsx-dev-runtime',
    };
    for (const pkg of barePackages) {
      if (!imapEntries[pkg]) {
        imapEntries[pkg] = ESM + pkg + ver(pkg) + '?external=react,react-dom';
      }
      // Trailing-slash mapping so subpath imports (pkg/sub) resolve via esm.sh.
      const prefix = pkg + '/';
      if (!imapEntries[prefix]) {
        imapEntries[prefix] = ESM + pkg + ver(pkg) + '/';
      }
    }

    // Extract body markup from index.html
    const rawHtml = files['index.html'] || '';
    let bodyInner = '<div id="root"></div>';
    const bm = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body\s*>/i);
    if (bm) {
      bodyInner = bm[1]
        .replace(/<script[^>]*type=["']module["'][^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<script[^>]+src=["'][^"']+["'][^>]*>\s*<\/script>/gi, '');
      if (!/id=["'](root|app)["']/.test(bodyInner)) bodyInner += '<div id="root"></div>';
    }

    const sj = (v: unknown) => JSON.stringify(v).replace(/<\//g, '<\\/');

    return [
      '<!DOCTYPE html><html><head>',
      '<meta charset="UTF-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      `<script type="importmap">${sj({ imports: imapEntries })}<\/script>`,
      css ? `<style>${css.replace(/<\/style>/gi, '<\\/style>')}<\/style>` : '',
      MINI_HARNESS,
      `</head><body>${bodyInner}`,
      `<script type="module">\n${js.replace(/<\//g, '<\\/')}\n<\/script>`,
      '</body></html>',
    ].filter(Boolean).join('\n');

  } finally {
    try { await fsp.rm(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

/**
 * Preview routes (Phase 3). Starts a live preview for a project's files via the
 * hybrid PreviewService (RuntimeRouter picks static/webcontainer/server-container)
 * and serves built static previews.
 *
 * - POST /api/preview        — body { projectId?, files: {path: content} } → start preview
 * - GET  /preview/:sessionId — serve the built static HTML (static target)
 */
const previewService = getPreviewService();

export function registerPreviewRoutes(app: Express, limiter: RequestHandler = previewPassthrough): void {
  // Server-side esbuild bundle → self-contained HTML (eliminates browser Babel CDN).
  app.post('/api/preview-bundle', limiter, async (req: Request, res: Response) => {
    try {
      const { files } = req.body || {};
      if (!files || typeof files !== 'object') return res.status(400).json({ error: 'files required' });
      const html = await bundleForPreview(files as Record<string, string>);
      return res.json({ html });
    } catch (err: any) {
      console.error('[preview-bundle] error:', err?.message || err);
      // Include the real esbuild problems (file/line/message) so the IDE's Problems panel can list them.
      const problems = Array.isArray(err?.problems) ? err.problems : [];
      return res.status(500).json({ error: err?.message || 'Bundle failed', problems });
    }
  });

  // Vue preview → self-contained HTML compiled in-browser (vue3-sfc-loader). The
  // .vue SFCs can't go through the React/esbuild path, so Vue apps use this.
  app.post('/api/preview-vue', limiter, (req: Request, res: Response) => {
    try {
      const { files } = req.body || {};
      if (!files || typeof files !== 'object') return res.status(400).json({ error: 'files required' });
      const html = buildVuePreview(VirtualFileSystem.fromRecord(files as Record<string, string>));
      return res.json({ html });
    } catch (err: any) {
      console.error('[preview-vue] error:', err?.message || err);
      return res.status(500).json({ error: err?.message || 'Vue preview failed' });
    }
  });

  app.post('/api/preview', limiter, async (req: Request, res: Response) => {
    try {
      const { projectId, files } = req.body || {};
      if (!files || typeof files !== 'object') {
        return res.status(400).json({ error: 'files (object of path->content) required' });
      }
      const vfs = VirtualFileSystem.fromRecord(files);
      if (vfs.count === 0) return res.status(400).json({ error: 'No files provided' });
      const result = await previewService.startPreview(String(projectId || 'project'), vfs);
      return res.status(result.ok ? 200 : 202).json(result);
    } catch (err: any) {
      console.error('[PREVIEW] start error:', err?.message || err);
      return res.status(500).json({ error: err?.message || 'Preview failed' });
    }
  });

  // Reverse proxy: server-container previews are reachable via the main server
  // (no raw internal port exposed). Forwards /preview-app/:sessionId/<rest> to the
  // session's dev server. (HTTP only for now; WS/HMR upgrade handled separately.)
  app.all('/preview-app/:sessionId/*', async (req: Request, res: Response) => {
    const target = previewService.serverTarget(req.params.sessionId);
    if (!target) return res.status(404).json({ error: 'Preview session not found or not running' });
    try {
      const rest = (req.params as any)[0] || '';
      const url = buildProxyUrl(target.origin, rest, req.originalUrl);
      const headers: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string' && k.toLowerCase() !== 'host') headers[k] = v;
      }
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
      // Forward the request body. Prefer the captured raw bytes (set by the
      // express.json `verify` hook in server.ts); fall back to re-serialising the
      // already-parsed JSON body so POSTs from the previewed app aren't dropped.
      let body: any = undefined;
      if (hasBody) {
        const raw = (req as any).rawBody;
        if (raw && raw.length) body = raw;
        else if (req.body && Object.keys(req.body).length) body = JSON.stringify(req.body);
      }
      const upstream = await fetch(url, {
        method: req.method,
        headers,
        body,
        redirect: 'manual',
      });
      res.status(upstream.status);
      upstream.headers.forEach((value, key) => {
        if (key.toLowerCase() !== 'content-encoding' && key.toLowerCase() !== 'transfer-encoding') res.setHeader(key, value);
      });
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.send(buf);
    } catch (err: any) {
      // Do NOT leak the raw upstream/network error (host, IP, infra) to the client.
      sendSafeError(res, 502, 'Preview upstream unreachable', err, 'preview proxy');
    }
  });

  app.get('/preview/:sessionId', (req: Request, res: Response) => {
    const html = previewService.static.getHtml(req.params.sessionId);
    if (!html) {
      return res.status(404).send('<!DOCTYPE html><meta charset="utf-8"><body style="font-family:system-ui;background:#0d1117;color:#c9d1d9;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><p>Preview expired or not found.</p></body>');
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  });
}
