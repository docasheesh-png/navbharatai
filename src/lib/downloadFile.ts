// Cross-platform "save this generated file" helper.
//
// The classic `<a download>` + Blob-URL trick DOES NOT WORK on iOS Safari: iOS ignores the `download`
// attribute, so clicking the link saves nothing (or silently navigates) — the "build report save/
// download nahi ho rahi" the admin hit on iPhone (2026-07-06). The reliable mobile path is the Web
// Share API with a real `File`: iOS 15+ opens the native share sheet where the user picks "Save to
// Files" (or sends it anywhere). Desktop browsers keep the classic anchor download.

export type FileDeliveryStrategy = 'share' | 'anchor-download';
export type FileDeliveryResult = 'shared' | 'downloaded' | 'cancelled';

/**
 * Decide how to deliver a generated file, given platform capability. PURE + unit-tested.
 * `canShareFiles` should come from `navigator.canShare?.({ files: [file] })`.
 */
export function pickFileDeliveryStrategy(opts: { canShareFiles: boolean }): FileDeliveryStrategy {
  return opts.canShareFiles ? 'share' : 'anchor-download';
}

type ShareCapableNavigator = Navigator & {
  canShare?: (data?: ShareData) => boolean;
  share?: (data?: ShareData) => Promise<void>;
};

/**
 * Save/share a text file so it actually lands on the user's device on BOTH desktop and mobile.
 * Prefers the Web Share API with a real File (the iOS-Safari-safe path → "Save to Files"); falls back
 * to the classic `<a download>` on desktop. Returns how it was delivered, or 'cancelled' if the user
 * dismissed the share sheet. Never throws for a delivery failure the caller can't act on.
 */
export async function deliverTextFile(
  filename: string,
  content: string,
  mime = 'application/json',
): Promise<FileDeliveryResult> {
  const blob = new Blob([content], { type: mime });
  const nav: ShareCapableNavigator | undefined = typeof navigator !== 'undefined' ? navigator : undefined;

  // Build a File for the share sheet (some engines lack the File constructor — guard it).
  let file: File | undefined;
  try { file = new File([blob], filename, { type: mime }); } catch { file = undefined; }

  const canShareFiles = !!(file && nav?.canShare?.({ files: [file] }) && typeof nav.share === 'function');
  if (pickFileDeliveryStrategy({ canShareFiles }) === 'share' && file && nav) {
    try {
      await nav.share!({ files: [file], title: filename });
      return 'shared';
    } catch (e) {
      // User closed the share sheet → not an error, don't fall through to a second prompt.
      if ((e as { name?: string })?.name === 'AbortError') return 'cancelled';
      // Any other share failure (gesture lost, unsupported) → fall through to the anchor download.
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return 'downloaded';
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
}
