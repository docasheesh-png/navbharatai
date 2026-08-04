// useZipImport — the ZIP-import slice, lifted out of the App.tsx God component (P3.1, behavior-
// preserving). Owns handleZipImport: stream a raw .zip to the server, read the SSE extraction stream,
// load files into Code Studio in real-time, persist + mirror to the v5.0 workspace, classify the app
// (framework / simple-React / static) and post an honest import summary. Code moved BYTE-IDENTICAL —
// pure relocation, zero logic change. Deps are injected; App.tsx destructures the SAME handleZipImport
// identifier back, so every file-drop / conflict-resolve caller is unchanged.

import { saveAllFiles } from '../lib/storage';
import { importDropSummary, type DropCounts } from '../lib/importDropReport';
import { uploadFileChunked } from '../lib/zipProjectUpload';
import { authJsonHeaders } from '../lib/authHeaders';

/**
 * The largest zip a SINGLE request can safely carry: the platform caps any one HTTP request at ~32 MB,
 * so beyond this the file must travel through the chunked uploader instead. This threshold is what
 * killed the old flow's honesty — the UI used to wave through anything under 50 MB and the request then
 * died mid-air between 32 and 50 with no explanation (the dead zone found in the 2026-08-04 audit).
 */
export const SINGLE_REQUEST_ZIP_BYTES = 25 * 1024 * 1024;

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
    // Refusals reported by the server's stream, tallied so the import summary can state them.
    const droppedCounts: DropCounts = {};
    let fileCount = 0;
    let appName = zipFile.name.replace(/\.zip$/i, '');
    const fileList: string[] = [];

    try {
      // TWO TRANSPORTS, one extraction. Small zips go as one raw-binary request (fast, works signed
      // out). Anything bigger rides the chunked uploader first — every request clears the platform's
      // ~32 MB cap, up to 5 GB — and the extract route then claims the assembled file by upload id.
      // The SSE extraction stream that follows is IDENTICAL either way.
      let response: Response;
      if (zipFile.size > SINGLE_REQUEST_ZIP_BYTES) {
        const { uploadId } = await uploadFileChunked(zipFile, (p) => {
          if (p.phase === 'uploading') {
            setProBuildProgress({
              active: true,
              stage: `📦 Uploading ${zipFile.name} — ${Math.round(p.fraction * 100)}%…`,
              steps: [], percent: Math.max(5, Math.round(p.fraction * 60)), generatedFiles: {},
            });
          }
        });
        const auth = await authJsonHeaders();
        response = await fetch('/api/extract-zip', {
          method: 'POST',
          headers: {
            'X-Upload-Id': uploadId,
            'X-File-Name': encodeURIComponent(zipFile.name),
            ...(auth.Authorization ? { Authorization: auth.Authorization } : {}),
          },
        });
      } else {
        response = await fetch('/api/extract-zip', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'X-File-Name': encodeURIComponent(zipFile.name),
          },
          body: zipFile,
        });
      }

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

              // BULK, NOT ONE-BY-ONE (admin 2026-07-31: a 2500-file zip appeared file-by-file over ~23 min).
              // The files ALREADY exist — there is nothing to "rebuild", so they must land in ONE bulk
              // update, not drip in. Root cause of the slow trickle: this used to spread the ENTIRE growing
              // map every 20 files — for N files that is O(N²) full re-renders of the file tree/editor (a
              // 2500-file import ≈ 125 spreads of up-to-2500 keys). We now show ONLY the first few instantly
              // (so a tiny app still feels live) and let the SINGLE bulk `setFiles(loadedFiles)` at the end
              // (below) commit everything at once — O(N), a few seconds instead of tens of minutes. The cheap
              // progress counter (setProBuildProgress, further down) keeps the user informed meanwhile.
              if (fileCount <= 8) {
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
              // NOT "fine, keep going" (admin 2026-08-04). These events were received and discarded, so a
              // media-heavy project reported a clean import while thousands of the user's own files had
              // been dropped. Count them by the server's own reason and state the total below.
              if (evt.reason === 'binary') droppedCounts.binary = (droppedCounts.binary ?? 0) + 1;
              else if (evt.reason === 'too large') droppedCounts.tooLarge = (droppedCounts.tooLarge ?? 0) + 1;
              else if (evt.reason === 'unsafe path') droppedCounts.unsafe = (droppedCounts.unsafe ?? 0) + 1;
              else droppedCounts.overCap = (droppedCounts.overCap ?? 0) + 1;
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
      // source: 'import' marks this a bulk import (not a routine IDE-edit autosave) — required for
      // the large-import GitHub durability backstop in syncFilesToV3/import-files to ever consider it.
      syncFilesToV3(loadedFiles, { source: 'import' }).catch(() => {}); // mirror uploaded files into the v5.0 workspace
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
        importMessage = `📦 **${appName}** imported — ${fileCount} files loaded into Code Studio.\n\n${fileListText}${moreText}\n\n🚀 **Opening the live preview** — installing dependencies & starting the dev server for your EXISTING files (no rebuild). This takes a moment. If it doesn't appear automatically, tap **Diagnose** in the Preview.`;
      } else if (isSimpleReact) {
        importMessage = `📦 **${appName}** imported — ${fileCount} files loaded into Code Studio.\n\n${fileListText}${moreText}\n\n✅ Preview is live in-browser via Babel transpilation. Tell me what you want to change!`;
      } else if (isStaticApp) {
        importMessage = `📦 **${appName}** imported — ${fileCount} files loaded into Code Studio. App is live in Preview.\n\n${fileListText}${moreText}\n\nApp is ready to edit — tell me what you want to change!`;
      } else {
        importMessage = `📦 **${appName}** imported — ${fileCount} files loaded into Code Studio.\n\n${fileListText}${moreText}\n\nOpen Code Studio to view and edit the files. Tell me what you want to change!`;
      }

      // HONEST TAIL (admin 2026-08-04): whatever the classification above says about the app, the
      // message must also say what did NOT come in. '' for a clean import, so a complete project reads
      // exactly as before — this only ever ADDS truth, never noise.
      const dropSummary = importDropSummary({ kept: fileCount, dropped: droppedCounts });
      setProMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        text: dropSummary ? `${importMessage}\n\n⚠️ ${dropSummary}` : importMessage,
        sender: 'ai', timestamp: new Date(),
      }]);
      // Framework apps: open Code Studio so user can see the imported files immediately.
      // Static/simple apps stay in Pro Chat where the inline preview is already showing.
      // Framework app: land on the PREVIEW (admin 2026-07-31 — "preview chal hi chale"). PreviewSurface's
      // existing auto-resume (runDiagnose → /api/agentv3/preview-diagnose) then installs deps + starts the
      // dev server on the EXISTING files — NO LLM, NO regeneration, so the imported app just RUNS. If the
      // auto-boot's sandbox conditions aren't ready on a fresh import, the "Diagnose" button in the Preview
      // does the identical one-tap boot. (Static/simple apps already show their in-browser preview inline.)
      if (isFrameworkApp) {
        setTimeout(() => toggleTab('preview'), 400);
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
