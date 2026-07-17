// useZipImport — the ZIP-import slice, lifted out of the App.tsx God component (P3.1, behavior-
// preserving). Owns handleZipImport: stream a raw .zip to the server, read the SSE extraction stream,
// load files into Code Studio in real-time, persist + mirror to the v5.0 workspace, classify the app
// (framework / simple-React / static) and post an honest import summary. Code moved BYTE-IDENTICAL —
// pure relocation, zero logic change. Deps are injected; App.tsx destructures the SAME handleZipImport
// identifier back, so every file-drop / conflict-resolve caller is unchanged.

import { saveAllFiles } from '../lib/storage';

export interface ZipImportDeps {
  setFiles: (v: any) => void;
  setHasGeneratedCode: (v: any) => void;
  setIsAppBuilt: (v: any) => void;
  setIsProLoading: (v: any) => void;
  setProBuildProgress: (v: any) => void;
  setProInput: (v: any) => void;
  setProMessages: (v: any) => void;
  syncFilesToV3: (files: Record<string, string>, opts?: any) => Promise<void>;
  updatePreview: (files: any) => void;
  toggleTab: (view: any, pushToHistory?: boolean) => void;
  addToast: (message: string, type?: any) => void;
}

export function useZipImport(deps: ZipImportDeps) {
  const {
    setFiles, setHasGeneratedCode, setIsAppBuilt, setIsProLoading, setProBuildProgress, setProInput,
    setProMessages, syncFilesToV3, updatePreview, toggleTab, addToast,
  } = deps;

  const handleZipImport = async (zipFile: File, extraMessage?: string) => {
    setIsProLoading(true);
    setProInput('');
    setProMessages(prev => [...prev, {
      id: Date.now().toString(),
      text: `📦 Uploading ${zipFile.name} (${(zipFile.size / 1024 / 1024).toFixed(1)} MB)...`,
      sender: 'user', timestamp: new Date(),
    }]);
    setProBuildProgress({ active: true, stage: `📦 Streaming ${zipFile.name}...`, steps: [], percent: 5, generatedFiles: {} });

    const loadedFiles: Record<string, string> = {};
    let fileCount = 0;
    let appName = zipFile.name.replace(/\.zip$/i, '');
    const fileList: string[] = [];

    try {
      // Send raw binary — no base64 encoding, browser streams directly to server
      const response = await fetch('/api/extract-zip', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-File-Name': encodeURIComponent(zipFile.name),
        },
        body: zipFile,
      });

      if (!response.ok || !response.body) {
        const errText = await response.text().catch(() => `HTTP ${response.status}`);
        throw new Error(errText || `Upload failed: ${response.status}`);
      }

      // Read SSE stream and load files into Code Studio in real-time
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      let didIncrementalPreview = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let evt: any;
          try { evt = JSON.parse(line.slice(6)); } catch { continue; }

          // Per-event crash isolation: one bad event must never abort the whole import
          try {
            if (evt.type === 'file') {
              if (typeof evt.path !== 'string' || typeof evt.content !== 'string') continue;
              loadedFiles[evt.path] = evt.content;
              fileList.push(evt.path);
              fileCount++;

              // Throttle React state updates — flushing per-file would mean thousands of
              // re-renders for a big app (jank/crash). Show first few instantly, then batch.
              if (fileCount <= 8 || fileCount % 20 === 0) {
                setFiles({ ...loadedFiles } as any);
              }

              // Live preview on key files — only for static apps, and only once (source/React
              // apps rebuild the Babel runtime, so we preview them once at the very end).
              const isKey = evt.path === 'index.html' || evt.path.endsWith('.css') || evt.path.endsWith('.js');
              const looksSource = !!loadedFiles['package.json'] || Object.keys(loadedFiles).some(k => /\.(tsx|jsx)$/i.test(k));
              if (isKey && !looksSource && !didIncrementalPreview && evt.path === 'index.html') {
                didIncrementalPreview = true;
                const snapshot = { ...loadedFiles };
                setTimeout(() => { try { updatePreview(snapshot as any); } catch { /* harness covers it */ } }, 50);
              }

              if (fileCount % 8 === 0) {
                setProBuildProgress(prev => ({ ...prev, stage: `📂 Loading ${fileCount} files...`, percent: Math.min(90, 5 + fileCount) }));
              }
            } else if (evt.type === 'progress') {
              setProBuildProgress(prev => ({ ...prev, stage: evt.stage || evt.message || prev.stage }));
            } else if (evt.type === 'skipped') {
              // a single file was skipped (binary/too large) — fine, keep going
            } else if (evt.type === 'complete') {
              appName = evt.appName || appName;
            } else if (evt.type === 'error') {
              // Only fatal if NOTHING loaded; otherwise import the partial app
              if (fileCount === 0) throw new Error(evt.message || 'ZIP extraction error');
              console.warn('[ZIP] partial error (continuing):', evt.message);
            }
          } catch (evtErr) {
            if (fileCount === 0) throw evtErr;
            console.warn('[ZIP] event error (continuing):', evtErr);
          }
        }
      }

      if (fileCount === 0) throw new Error('No files extracted from ZIP — it may be empty or contain only binaries.');

      // Final state — ensure everything is synced.
      setFiles(loadedFiles as any);
      saveAllFiles(loadedFiles).catch(() => {}); // persist to IndexedDB/Cache API
      syncFilesToV3(loadedFiles).catch(() => {}); // mirror uploaded files into the v5.0 workspace
      setHasGeneratedCode(true);  // ← marks workspace as occupied so next prompt = edit, not rebuild
      setIsAppBuilt(true);

      // Classify the imported app to give an honest status message.
      const pkg = loadedFiles['package.json'] || '';
      const hasBuildTool = /["'](vite|webpack|rollup|parcel|next|nuxt|gatsby|create-react-app|@vitejs)\s*["']/.test(pkg);
      const hasJsxEntry = Object.keys(loadedFiles).some(k => /\.(tsx|jsx)$/i.test(k));
      const hasPackageJson = !!pkg;
      // Framework app = needs a real build step (npm install + npm run dev) — in-browser Babel
      // cannot resolve npm packages, so the preview would silently fail.
      const isFrameworkApp = hasBuildTool && hasPackageJson;
      // Simple React = JSX/TSX without a bundler config — Babel can transpile these in-browser.
      const isSimpleReact = hasJsxEntry && !hasBuildTool;
      // Static app = plain HTML/CSS/JS — preview works immediately.
      const isStaticApp = !hasPackageJson && Object.keys(loadedFiles).some(k => k === 'index.html' || k.endsWith('.html'));

      // Only attempt live preview for static and simple-React apps; framework apps need a
      // real dev server (npm install + npm run dev) which only E2B/Engineer AI can provide.
      if (!isFrameworkApp) {
        setTimeout(() => updatePreview(loadedFiles as any), 100);
      }

      const generatedFilesObj = Object.fromEntries(
        Object.entries(loadedFiles).map(([k, v]) => [k, { content: v, expanded: false }])
      );
      setProBuildProgress({ active: false, stage: '', steps: [], percent: 100, generatedFiles: generatedFilesObj });

      const fileListText = fileList.slice(0, 10).map(f => `• \`${f}\``).join('\n');
      const moreText = fileList.length > 10 ? `\n• ... and ${fileList.length - 10} more` : '';

      let importMessage: string;
      if (isFrameworkApp) {
        // Honest: framework apps need npm install + dev server — tell user exactly what to do.
        importMessage = `📦 **${appName}** imported — ${fileCount} files loaded into Code Studio.\n\n${fileListText}${moreText}\n\n⚠️ **This app needs a build step** (it uses ${hasBuildTool ? 'Vite/webpack/etc.' : 'npm'}).\nIn-browser preview won't work for it — you need a real dev server.\n\n👉 Type **"run this app"** and I will install dependencies and launch a live preview for you.`;
      } else if (isSimpleReact) {
        importMessage = `📦 **${appName}** imported — ${fileCount} files loaded into Code Studio.\n\n${fileListText}${moreText}\n\n✅ Preview is live in-browser via Babel transpilation. Tell me what you want to change!`;
      } else if (isStaticApp) {
        importMessage = `📦 **${appName}** imported — ${fileCount} files loaded into Code Studio. App is live in Preview.\n\n${fileListText}${moreText}\n\nApp is ready to edit — tell me what you want to change!`;
      } else {
        importMessage = `📦 **${appName}** imported — ${fileCount} files loaded into Code Studio.\n\n${fileListText}${moreText}\n\nOpen Code Studio to view and edit the files. Tell me what you want to change!`;
      }

      setProMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        text: importMessage,
        sender: 'ai', timestamp: new Date(),
      }]);
      // Framework apps: open Code Studio so user can see the imported files immediately.
      // Static/simple apps stay in Pro Chat where the inline preview is already showing.
      if (isFrameworkApp) {
        setTimeout(() => toggleTab('studio'), 400);
      }
    } catch (err: any) {
      setProBuildProgress({ active: false, stage: '', steps: [], percent: 0, generatedFiles: {} });
      setProMessages(prev => [...prev, {
        id: (Date.now() + 2).toString(),
        text: `❌ ZIP import failed: ${err.message}`,
        sender: 'ai', timestamp: new Date(),
      }]);
    } finally {
      setIsProLoading(false);
      setProInput('');
    }
  };
  return { handleZipImport };
}
