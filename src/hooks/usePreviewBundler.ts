// usePreviewBundler — the preview-build / client-side bundling slice of the app, lifted out of the
// App.tsx God component (P3.1 slice 2, behavior-preserving). It owns the preview build-state + the
// Problems panel data + the preview history, and the four functions that turn the virtual file set into
// a rendered preview document: handleTriggerPreviewBuild (the "Build preview" action), updatePreview
// (the core bundler: server-side esbuild for React/Vue with a client-side fallback, CSS/JS inlining for
// vanilla web, universal viewer otherwise), handleFileChange (debounced edit→rebuild bridge) and runCode.
//
// Everything the bundler needs from the rest of the app (the file set, the undo/redo-backed preview
// doc setter, nav, the active agent for telemetry, the free-tier build counter, log/toast sinks) is
// injected as deps, so the code moved BYTE-IDENTICAL — pure relocation, zero logic change. App.tsx
// destructures the SAME identifiers this hook returns, so the render tree is unchanged.

import { useState, useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { FileSystem, ViewType } from '../types';
import type { PreviewProblem } from '../lib/previewProblems';
import { detectFrameworkFromFiles, detectAppType, isClassicVanillaWeb } from '../lib/appUtils';
import { stripFences, buildSourceAppPreview, buildUniversalPreview, injectHarness } from '../lib/previewUtils';
import { trackEvent } from '../lib/analytics';

export interface UsePreviewBundlerDeps {
  /** The virtual file set to bundle (read by handleTriggerPreviewBuild). */
  files: FileSystem;
  /** File-set setter — handleFileChange writes a single file then debounces a rebuild. */
  setFiles: Dispatch<SetStateAction<FileSystem>>;
  /** Undo/redo-backed setter for the rendered preview document. */
  setGeneratedCode: (code: string) => void;
  /** The file currently open in the editor (runCode decides how to run by its extension). */
  activeFile: string;
  /** Active AI agent id — attached to the app_generated telemetry event. */
  activeAgent: string;
  /** Nav — switch the surface tab to 'preview' once a build is ready. */
  toggleTab: (view: ViewType, pushToHistory?: boolean) => void;
  /** Free-tier build counter (payment engine). */
  incrementDailyUsage: (type: 'message' | 'build') => void;
  addLog: (message: string, level?: string) => void;
  addToast: (message: string, type?: string) => void;
}

/**
 * Owns preview build-state + the bundler functions. Returns the exact identifiers App.tsx already
 * referenced, so the extraction is a pure relocation (no behavior change).
 */
export function usePreviewBundler({
  files, setFiles, setGeneratedCode, activeFile, activeAgent, toggleTab, incrementDailyUsage, addLog, addToast,
}: UsePreviewBundlerDeps) {
  const [isPreviewBuilding, setIsPreviewBuilding] = useState(false);
  const [previewBuildError, setPreviewBuildError] = useState<string | null>(null);
  const [previewBuildStage, setPreviewBuildStage] = useState<'preparing' | 'installing' | 'building' | 'starting' | 'ready'>('preparing');
  const [detectedFramework, setDetectedFramework] = useState<string>('Static HTML Site');
  const [problems, setProblems] = useState<PreviewProblem[]>([]);
  const [previewHistory, setPreviewHistory] = useState<{ id: string; label: string; ts: Date; html: string }[]>([]);

  const handleTriggerPreviewBuild = async () => {
    incrementDailyUsage('build');
    setIsPreviewBuilding(true);
    setPreviewBuildError(null);
    setPreviewBuildStage('preparing');

    const framework = detectFrameworkFromFiles(files);
    setDetectedFramework(framework);

    addLog(`Building preview for [${framework}]...`, 'info');

    try {
      // STAGE 1: Validate workspace (real, instant)
      const fileCount = Object.keys(files).length;
      if (fileCount === 0) {
        throw new Error('No source files found. Ask NavBharat AI to build something first.');
      }

      const hasHtml = !!files['index.html'];
      const hasPkg = !!files['package.json'];

      if (!hasHtml && !hasPkg) {
        throw new Error('No index.html or package.json found. Cannot build preview.');
      }

      addLog(`Found ${fileCount} source file(s): ${Object.keys(files).slice(0, 5).join(', ')}${fileCount > 5 ? '...' : ''}`, 'info');

      // STAGE 2: Validate files (real, instant)
      setPreviewBuildStage('installing');
      if (hasPkg) {
        try {
          JSON.parse(files['package.json']);
          addLog('package.json: valid JSON ✓', 'info');
        } catch {
          throw new Error('package.json has invalid JSON syntax. Fix it and try again.');
        }
      }

      // For React/Vite: show honest note (WebContainers not yet available)
      const isReactApp = hasPkg && (
        files['package.json'].includes('"react"') ||
        files['package.json'].includes('"vite"')
      );
      if (isReactApp && !hasHtml) {
        addLog('React/Vite app detected — showing static HTML preview (full runtime coming in Phase 5.1)', 'info');
      }

      // STAGE 3: Bundle files (real work — CSS + JS injection)
      setPreviewBuildStage('building');
      updatePreview(files);
      const bundledFiles = Object.keys(files).filter(f =>
        f.endsWith('.css') || f.endsWith('.js') || f.endsWith('.html')
      );
      addLog(`Bundled ${bundledFiles.length} asset(s) into preview ✓`, 'info');

      // STAGE 4: Ready
      setPreviewBuildStage('starting');
      setPreviewBuildStage('ready');
      addLog('Preview ready!', 'success');
      addToast('Preview ready! ⚡', 'success');

      // Short visual pause so user sees "ready" state
      await new Promise((resolve) => setTimeout(resolve, 500));
      toggleTab('preview');

    } catch (err: any) {
      setPreviewBuildError(err.message || 'Build failed.');
      addLog(`Preview build failed: ${err.message}`, 'error');
    } finally {
      setIsPreviewBuilding(false);
    }
  };

  const updatePreview = (currentFiles: FileSystem) => {
    // BUG A4 FIX: Wrap entire function in try-catch so any exception doesn't crash silently.
    try {
    // stripFences → imported from src/lib/previewUtils.ts
    // Strip markdown code fences the AI accidentally wraps file content in (```lang\n...\n```)
    currentFiles = Object.fromEntries(
      Object.entries(currentFiles).map(([k, v]) => [k, typeof v === 'string' ? stripFences(v) : v])
    ) as FileSystem;

    let finalHtml: string;

    // Source/framework apps: try server-side esbuild bundle first (eliminates Babel CDN).
    // Falls back to client-side PREVIEW_BOOTSTRAP if the server endpoint fails or is slow.
    if (detectAppType(currentFiles) === 'react') {
      const clientFallback = buildSourceAppPreview(currentFiles);
      // Kick off server-side bundle (async, replaces preview when ready)
      const ctl = new AbortController();
      const timeout = setTimeout(() => ctl.abort(), 20_000);
      fetch('/api/preview-bundle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: currentFiles }),
        signal: ctl.signal,
      })
        .then(async (r) => {
          const data = await r.json().catch(() => ({} as { html?: string; problems?: PreviewProblem[] }));
          if (r.ok && data.html) {
            setGeneratedCode(data.html);
            setProblems([]); // a clean bundle clears the Problems panel
          } else if (Array.isArray(data.problems)) {
            // Real esbuild compile errors — surface them in the Problems panel (client fallback still renders).
            setProblems(data.problems);
          }
        })
        .catch(() => { /* network/abort — leave the client-side fallback + last problems as-is */ })
        .finally(() => clearTimeout(timeout));
      // Show client-side fallback immediately so the user isn't stuck on a blank/old preview.
      finalHtml = clientFallback;
    } else if (detectAppType(currentFiles) === 'vue') {
      // Vue SFC apps compile in-browser via the server-built vue3-sfc-loader doc.
      const ctl = new AbortController();
      const timeout = setTimeout(() => ctl.abort(), 20_000);
      fetch('/api/preview-vue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: currentFiles }),
        signal: ctl.signal,
      })
        .then(r => r.ok ? r.json() : Promise.reject(new Error(`Vue preview failed: ${r.status}`)))
        .then(({ html }: { html: string }) => { if (html) setGeneratedCode(html); })
        .catch(() => setGeneratedCode('<!doctype html><html><body style="font-family:system-ui;padding:24px;color:#b00">Could not build the Vue preview (network blocked?).</body></html>'))
        .finally(() => clearTimeout(timeout));
      // Honest interim state (never a blank/old preview) until the compiled doc arrives.
      finalHtml = '<!doctype html><html><body style="font-family:system-ui;padding:24px;color:#666">Compiling Vue preview…</body></html>';
    } else if (!currentFiles['index.html'] && !isClassicVanillaWeb(currentFiles)) {
      // No index.html and not a runnable vanilla web app → universal multi-format viewer
      // (markdown, code, JSON, CSV, images, SVG, PDF, audio, video, HTML, text).
      finalHtml = buildUniversalPreview(currentFiles);
    } else {
      let html = currentFiles['index.html'] || '';

      if (!html) {
        html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="root"></div></body></html>';
      } else if (!html.toLowerCase().includes('viewport')) {
        if (html.includes('</head>')) {
          html = html.replace('</head>', '<meta name="viewport" content="width=device-width, initial-scale=1.0"></head>');
        } else if (html.includes('<head>')) {
          html = html.replace('<head>', '<head><meta name="viewport" content="width=device-width, initial-scale=1.0">');
        } else if (html.includes('<html>')) {
          html = html.replace('<html>', '<html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>');
        }
      }

      // Collect all CSS files (style.css, styles.css, main.css, app.css, index.css, etc.)
      const CSS_NAMES = ['style.css', 'styles.css', 'main.css', 'app.css', 'index.css'];
      const allCss = [
        ...CSS_NAMES.map(n => currentFiles[n] || ''),
        ...Object.entries(currentFiles)
          .filter(([k]) => k.endsWith('.css') && !CSS_NAMES.includes(k))
          .map(([, v]) => v as string),
      ].filter(Boolean).join('\n');

      // Collect all JS files (script.js, app.js, main.js, index.js, etc.)
      // BUG A3 FIX: Skip ES module files (files with import/export) from allJs injection.
      // Those files use import/export which breaks when concatenated into a non-module <script>.
      const JS_NAMES = ['script.js', 'app.js', 'main.js', 'index.js'];
      const isEsModule = (src: string) => /^\s*(import\s+[\w{*"'`]|export\s+(default|class|function|const|let|var)\b)/m.test(src);
      const allJsEntries = [
        ...JS_NAMES.map(n => currentFiles[n] ? [n, currentFiles[n]] as [string, string] : null),
        ...Object.entries(currentFiles).filter(([k]) => k.endsWith('.js') && !JS_NAMES.includes(k) && !k.includes('node_modules') && !k.includes('.min.js')),
      ].filter(Boolean) as [string, string][];
      const allJs = allJsEntries.filter(([, v]) => !isEsModule(v)).map(([, v]) => v).filter(Boolean).join('\n');

      finalHtml = html;

      // Inline external CSS links that reference local files
      finalHtml = finalHtml.replace(/<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["'][^>]*\/?>/gi, (match, href) => {
        const filename = href.replace(/^\.\//, '').replace(/^\//, '');
        const content = currentFiles[filename];
        return content ? `<style data-src="${filename}">${content}</style>` : match;
      });

      // Inline external script src — preserve type attribute (e.g. type="text/babel" for React/JSX)
      // Handles: single-quoted src, unquoted src, self-closing, missing </script>
      finalHtml = finalHtml.replace(/<script([^>]*?)\bsrc\s*=\s*["']?([^"'>\s]+)["']?([^>]*)>\s*<\/script>/gi, (match, pre, src, post) => {
        const filename = src.replace(/^\.\//, '').replace(/^\//, '');
        const content = currentFiles[filename];
        if (!content) return match;
        const allAttrs = pre + post;
        const typeMatch = allAttrs.match(/type=["']([^"']+)["']/);
        const typeAttr = typeMatch ? ` type="${typeMatch[1]}"` : '';
        return `<script${typeAttr} data-src="${filename}">${content.replace(/<\//g, '<\\/')}<\/script>`;
      });

      // BUG D1 FIX: Resolve @import url() in collected CSS before injecting
      const resolveImports = (css: string): string => css.replace(
        /@import\s+(?:url\(["']?([^"')]+)["']?\)|["']([^"']+)["'])/gi,
        (_imp, u1, u2) => { const ref = (u1 || u2 || '').replace(/^\.\//, ''); const c = currentFiles[ref]; return c ? c : _imp; }
      );
      const resolvedCss = resolveImports(allCss);

      // Inject any remaining CSS not already inlined
      if (resolvedCss) {
        const styleTag = `<style id="nb-injected-css">${resolvedCss.replace(/<\/style>/gi, '<\\/style>')}</style>`;
        if (finalHtml.includes('</head>')) {
          finalHtml = finalHtml.replace('</head>', `${styleTag}</head>`);
        } else if (finalHtml.includes('<body>')) {
          finalHtml = finalHtml.replace('<body>', `<head>${styleTag}</head><body>`);
        } else {
          finalHtml = `<head>${styleTag}</head>${finalHtml}`;
        }
      }

      // Inject any remaining JS not already inlined
      if (allJs) {
        const scriptTag = `<script id="nb-injected-js">${allJs.replace(/<\//g, '<\\/')}<\/script>`;
        if (finalHtml.includes('</body>')) {
          finalHtml = finalHtml.replace('</body>', `${scriptTag}</body>`);
        } else {
          finalHtml = `${finalHtml}${scriptTag}`;
        }
      }

      finalHtml = injectHarness(finalHtml);
    }

    setGeneratedCode(finalHtml);
    trackEvent('app_generated', { agent: activeAgent, htmlBytes: finalHtml.length });

    // Save to preview history (max 5). Skip very large docs (e.g. imports with many
    // inlined base64 images) — keeping 5 multi-MB copies would balloon memory.
    if (finalHtml.length < 2_000_000) {
      setPreviewHistory(prev => {
        const title = (finalHtml.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || 'App Preview').trim();
        // BUG J1 FIX: Skip duplicate entries (same HTML as last entry)
        if (prev.length > 0 && prev[prev.length - 1].html === finalHtml) return prev;
        const entry = { id: Date.now().toString(), label: title, ts: new Date(), html: finalHtml };
        return [entry, ...prev.filter(h => h.id !== entry.id)].slice(0, 5);
      });
    }
    } catch (err: any) {
      // BUG A4 FIX: Catch any exception and show an error preview instead of crashing silently
      console.error('[preview] updatePreview failed:', err?.message || err);
      setGeneratedCode(`<!DOCTYPE html><html><body style="font-family:system-ui;padding:24px;color:#b00"><h3>Preview Error</h3><pre>${String(err?.message || err).replace(/</g, '&lt;')}</pre></body></html>`);
    }
  };

  // K4: debounce preview rebuild so rapid edits don't trigger a rebuild on every keystroke
  const previewDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleFileChange = (path: string, content: string) => {
    setFiles(prev => {
      const next = { ...prev, [path]: content };
      if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);
      previewDebounceRef.current = setTimeout(() => { updatePreview(next); }, 400);
      return next;
    });
  };

  const runCode = (currentFiles: FileSystem) => {
    const ext = activeFile.split('.').pop();
    addLog(`Preparing to run ${activeFile}...`, 'info');

    if (['html', 'js', 'css'].includes(ext || '')) {
        updatePreview(currentFiles);
        toggleTab('preview');
        addLog(`Application launched in Sandbox mode.`, 'success');
    } else {
        addLog(`Runtime for .${ext} is currently in limited availability. Executing in dry-run mode...`, 'warn');
        setTimeout(() => {
            addLog(`[STDOUT] Execution of ${activeFile} completed.`, 'info');
            addLog(`[PROCESS] Exited with code 0.`, 'success');
        }, 1500);
    }
  };

  return {
    isPreviewBuilding, setIsPreviewBuilding,
    previewBuildError, setPreviewBuildError,
    previewBuildStage, setPreviewBuildStage,
    detectedFramework, setDetectedFramework,
    problems, setProblems,
    previewHistory, setPreviewHistory,
    handleTriggerPreviewBuild,
    updatePreview,
    handleFileChange,
    runCode,
  };
}
