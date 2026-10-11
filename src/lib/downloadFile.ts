// Cross-platform "save this generated file" helper — the ONE place a generated file leaves the app.
//
// The classic `<a download>` + Blob-URL trick DOES NOT WORK on iOS Safari: iOS ignores the `download`
// attribute, so clicking the link saves nothing (or silently navigates) — the "build report save/
// download nahi ho rahi" the admin hit on iPhone (2026-07-06). The reliable mobile path is the Web
// Share API with a real `File`: iOS 15+ opens the native share sheet where the user picks "Save to
// Files" (or sends it anywhere). Desktop browsers keep the classic anchor download.
//
// 🔒 ONE HELPER, EVERY SITE (2026-10-11, Q-790). About twenty buttons still built their own anchor, so on an
// iPhone each of them saved nothing — and many also revoked the URL straight after `click()` (which can cancel
// the download) or never attached the link to the page. The phone apps were worse than Safari: neither
// Capacitor shell handles a download at all (no `DownloadListener` on Android, no `WKDownload` on iOS), and the
// Android WebView has no Web Share API, so in the Android app no generated file had ever saved. Now:
//   web     → share sheet when it can take a file (iPhone Safari), else a real anchor download;
//   native  → share sheet when available (iOS); otherwise the file is WRITTEN to Documents/NavBharatAI with the
//             installed Filesystem plugin (Android) — never the anchor, which a native shell ignores.
// `tests/everyDownloadGoesThroughOneHelper.test.ts` fails on any raw `a.download` outside this file.

import { Capacitor } from '@capacitor/core';

export type FileDeliveryStrategy = 'share' | 'anchor-download' | 'native-save';
/**
 * How a file was delivered. `saved` = written to the device's Documents/NavBharatAI folder (native, no share
 * sheet). `failed` = it could NOT be saved here; the caller must say so rather than claim a download.
 */
export type FileDeliveryResult = 'shared' | 'downloaded' | 'saved' | 'cancelled' | 'failed';

/** Where a native save lands, relative to the device's Documents folder. */
export const NATIVE_SAVE_FOLDER = 'NavBharatAI';

/**
 * Decide how to deliver a generated file, given platform capability. PURE + unit-tested.
 * `canShareFiles` should come from `navigator.canShare?.({ files: [file] })`.
 */
export function pickFileDeliveryStrategy(opts: { canShareFiles: boolean; isNative?: boolean }): FileDeliveryStrategy {
  if (opts.canShareFiles) return 'share';
  // Inside the app the anchor is inert (the shell handles no downloads), so a native build writes the file.
  return opts.isNative ? 'native-save' : 'anchor-download';
}

/** One plain sentence for a delivery outcome, for callers that show a note. PURE. */
export function deliveryMessage(result: FileDeliveryResult, filename: string): string {
  switch (result) {
    case 'shared': return `Opened the share sheet for ${filename}.`;
    case 'downloaded': return `Downloaded ${filename}.`;
    case 'saved': return `Saved ${filename} to Documents/${NATIVE_SAVE_FOLDER} on this device.`;
    case 'cancelled': return 'Not saved — the share sheet was closed.';
    case 'failed': return `Could not save ${filename} on this device.`;
  }
}

type ShareCapableNavigator = Navigator & {
  canShare?: (data?: ShareData) => boolean;
  share?: (data?: ShareData) => Promise<void>;
};

function isNativeShell(): boolean {
  try { return Capacitor.isNativePlatform() === true; } catch { return false; }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** A filename safe to write under Documents/NavBharatAI (no path separators, never empty). PURE. */
export function safeDeviceFilename(name: string): string {
  const cleaned = String(name || '').replace(/[/\\:*?"<>|\u0000-\u001f]+/g, '-').replace(/^\.+/, '').trim();
  return cleaned || 'download';
}

/** The classic anchor download, done right: attached to the page, URL revoked only after the click lands. */
function anchorDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Save/share a generated file (text or binary) so it actually lands on the user's device on desktop, mobile
 * web, and inside the phone apps. Returns how it was delivered; never throws.
 */
export async function deliverFile(
  filename: string,
  data: Blob | string,
  mime = 'application/octet-stream',
): Promise<FileDeliveryResult> {
  const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data;
  const type = blob.type || mime;
  const nav: ShareCapableNavigator | undefined = typeof navigator !== 'undefined' ? navigator : undefined;
  const native = isNativeShell();

  // Build a File for the share sheet (some engines lack the File constructor — guard it).
  let file: File | undefined;
  try { file = new File([blob], filename, { type }); } catch { file = undefined; }

  let canShareFiles = false;
  try { canShareFiles = !!(file && nav?.canShare?.({ files: [file] }) && typeof nav.share === 'function'); } catch { canShareFiles = false; }

  const strategy = pickFileDeliveryStrategy({ canShareFiles, isNative: native });
  if (strategy === 'share' && file && nav) {
    try {
      await nav.share!({ files: [file], title: filename });
      return 'shared';
    } catch (e) {
      // User closed the share sheet → not an error, don't fall through to a second prompt.
      if ((e as { name?: string })?.name === 'AbortError') return 'cancelled';
      // Any other share failure (gesture lost, unsupported) → fall through to the next path.
    }
  }

  if (native) {
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      await Filesystem.writeFile({
        path: `${NATIVE_SAVE_FOLDER}/${safeDeviceFilename(filename)}`,
        data: await blobToBase64(blob),
        directory: Directory.Documents,
        recursive: true,
      });
      return 'saved';
    } catch {
      return 'failed';
    }
  }

  try {
    anchorDownload(blob, filename);
    return 'downloaded';
  } catch {
    return 'failed';
  }
}

/** Text convenience kept for existing callers. */
export async function deliverTextFile(
  filename: string,
  content: string,
  mime = 'application/json',
): Promise<FileDeliveryResult> {
  return deliverFile(filename, content, mime);
}
