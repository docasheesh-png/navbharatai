// UT-3 (browser extensions) — Manifest V3 browser-extension export for a USER's generated web app.
//
// Turns a generated web app (it builds to a static `webDir`) into a Chrome/Edge/Firefox MV3 extension by
// emitting a `manifest.json` (Manifest V3) that serves the built app as the extension's popup, plus an
// `EXTENSION_EXPORT.md` runbook. Mirrors the UT-1/UT-2 export pattern.
//
// HONESTY (rule 6 — what this does NOT do): it generates the manifest + packaging instructions, not a
// published extension. Loading it unpacked is instant; publishing needs a Chrome Web Store / AMO developer
// account (a one-time fee + review) — a store step, not something an in-process generator can do. The runbook
// states this and the `base: './'` relative-path requirement (an extension loads assets over chrome-extension://,
// so absolute /assets/ paths 404 — the same gotcha as the desktop export).
//
// PURE + deterministic; unit-tested.

export interface ExtensionExportOptions {
  /** Extension name shown in the browser (e.g. "My Shop"). */
  appName?: string;
  /** Short description for the store listing / manifest. */
  description?: string;
  /** The build output directory whose index.html becomes the popup (Vite → 'dist'). */
  webDir?: string;
}

export interface ExtensionExportResult {
  files: Record<string, string>;
  instructions: string;
}

const clean = (s: unknown): string => (typeof s === 'string' ? s.trim() : '');

const MANIFEST = (name: string, description: string): string => JSON.stringify({
  manifest_version: 3,
  name,
  version: '1.0.0',
  description,
  action: { default_popup: 'index.html', default_title: name },
  // Minimal permissions by design — add only what the app actually needs (a broad manifest is rejected/risky).
  permissions: [],
}, null, 2) + '\n';

const README = (name: string, webDir: string): string => `# Browser extension export (Manifest V3)

This project can ship as a Chrome/Edge/Firefox extension. NavBharatAI generated a \`manifest.json\` (Manifest
V3) that serves your built app (\`${webDir}/index.html\`) as the extension's popup, for "${name}".

## Build + load (instant, no account needed)
1. **Set a RELATIVE base path** so assets load over chrome-extension:// — Vite: \`base: './'\` in vite.config;
   CRA: \`"homepage": "."\`. Without this the popup opens blank (absolute \`/assets/...\` paths 404).
2. \`npm run build\`  — produces \`${webDir}/\`.
3. Copy \`manifest.json\` into \`${webDir}/\` (or build with it alongside).
4. Chrome/Edge: \`chrome://extensions\` → enable Developer mode → **Load unpacked** → pick \`${webDir}/\`.
   Firefox: \`about:debugging\` → This Firefox → **Load Temporary Add-on** → pick the manifest.

## Notes
- The app runs as a POPUP (a small window). For a full-screen app, change the manifest to open a tab instead
  (an \`action\` with a background service worker that calls \`chrome.tabs.create\`), or use \`chrome_url_overrides\`.
- Add an \`icons\` entry (16/48/128 px PNGs) before publishing — stores require them.

## Publishing (needs a developer account — NOT done here)
Zip the \`${webDir}/\` folder and upload it to the **Chrome Web Store** (one-time \$5 dev fee + review) or
**Firefox AMO**. NavBharatAI generates the manifest, not the published listing — the account, signing, and
review are the store's, not something a generator can do.
`;

/**
 * Generate a Manifest V3 browser-extension wrapper for a generated web app. Deterministic; pure.
 * `webDir` defaults to 'dist' (Vite).
 */
export function generateExtensionExport(opts: ExtensionExportOptions = {}): ExtensionExportResult {
  const name = clean(opts.appName) || 'My App';
  const description = clean(opts.description) || `${name} — a browser extension.`;
  const webDir = clean(opts.webDir) || 'dist';
  return {
    files: {
      'manifest.json': MANIFEST(name, description),
      'EXTENSION_EXPORT.md': README(name, webDir),
    },
    instructions: `Wrapped this app as a Manifest V3 browser extension ("${name}"). Set a RELATIVE base path (Vite base: './'), then: npm run build → copy manifest.json into ${webDir}/ → Chrome chrome://extensions → Load unpacked → ${webDir}/. Publishing to the Chrome Web Store / Firefox AMO needs a developer account + review (see EXTENSION_EXPORT.md) — NOT done here.`,
  };
}
