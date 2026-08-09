// Copy plain text to the clipboard — one shared implementation.
//
// WHY A HELPER AND NOT `navigator.clipboard.writeText(...)` AT EACH CALL SITE:
//   • `navigator.clipboard` does not exist at all in a non-secure context and in some in-app
//     WebViews, so a bare call throws a TypeError and the button silently does nothing.
//   • `writeText` REJECTS (rather than throwing) when the document is not focused or permission is
//     denied — an un-awaited call swallows that rejection and the UI happily says "Copied".
// Both failures look identical to a user: they paste and get their old clipboard back. So this
// returns an honest boolean and the caller must report the truth (rule 3 — never a fake success).
//
// The `execCommand('copy')` fallback is deliberately kept even though it is deprecated: it is the
// ONLY path that works in the non-secure/WebView cases above, and it is a no-op where the modern
// API already succeeded. Dependency-free and injectable so the logic is unit-testable.

export interface CopyDeps {
  clipboard?: { writeText(text: string): Promise<void> } | null;
  /** Legacy path: builds a selected, off-screen textarea and asks the document to copy it. */
  legacyCopy?: (text: string) => boolean;
}

function defaultLegacyCopy(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
  const ta = document.createElement('textarea');
  ta.value = text;
  // Off-screen but still focusable — `display:none` makes the selection (and so the copy) fail.
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '-1000px';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  try {
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    ta.remove();
  }
}

/**
 * Put `text` on the clipboard. Resolves TRUE only when a copy genuinely happened.
 * Empty text resolves FALSE — "copied nothing" is a failure the caller should surface, not a
 * success that quietly wipes the admin's clipboard.
 */
export async function copyTextToClipboard(text: string, deps: CopyDeps = {}): Promise<boolean> {
  if (!text) return false;
  const clip = deps.clipboard !== undefined
    ? deps.clipboard
    : (typeof navigator !== 'undefined' ? (navigator.clipboard ?? null) : null);
  if (clip && typeof clip.writeText === 'function') {
    try {
      await clip.writeText(text);
      return true;
    } catch {
      // Not focused / permission denied — fall through to the legacy path rather than lie.
    }
  }
  try {
    return (deps.legacyCopy ?? defaultLegacyCopy)(text);
  } catch {
    return false;
  }
}
