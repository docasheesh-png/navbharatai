// WHAT AN ADMIN REPORT LOOKS LIKE WHEN IT LEAVES THE PANEL.
//
// ADMIN 2026-09-21: *"jo jo report … navbharatai ko best aur error free banane ke liye hai, un sab
// reports par direct copy/download option dedo, jisse woh report apko di jaye to aur aap performance
// sudhar sako!"*
//
// The floating `AdminCopyButton` already copies EVERY admin page, and that is right for a page. It is
// wrong for a data card: `pageSnapshot` produces a DOM OUTLINE, so a 30-row table, a per-day series or
// a nested cost breakdown arrives flattened, unlabelled and unparseable — the same defect
// `adminCopyPayload.ts` recorded for the build report, which is why that one was given a JSON path.
// This module is that path generalised: a card hands over the JSON IT ALREADY HOLDS.
//
// 🔒 THE PAYLOAD IS THE CARD'S OWN STATE, NEVER SCRAPED BACK OUT OF THE DOM. Every one of these cards
// fetched its JSON from an `/api/admin/...` endpoint and still has it in React state, so exporting it
// is a re-serialisation of the real response. Reading the rendered markup back would be a
// RECONSTRUCTION that can silently differ from what the server said — a copy that looks like the
// report and is not one is worse than no copy at all.
//
// 🔴 THE ENVELOPE IS NOT DECORATION — IT IS WHAT MAKES A PASTED REPORT USABLE. A bare array of numbers
// does not say which card it came from, when it was taken, or over what window. Every autopsy in
// `PROGRESS.md` starts by establishing exactly those three facts, so they travel WITH the data rather
// than being asked for afterwards.
//
// PURE — no DOM, no clipboard, no clock (the timestamp is passed in). The I/O half lives in
// `ReportExportButtons.tsx`, so the decisions here are unit-testable.

/** The envelope a copied or downloaded report arrives in. */
export interface ReportEnvelope {
  /** What the card is called on screen — the first thing a reader needs. */
  report: string;
  /** ISO time the admin took it, so a stale paste is recognisable as stale. */
  takenAt: string;
  /** Which admin tab it came from, when the card names one. */
  tab?: string;
  /** The window the numbers cover ("last 30 days"), when the card has one. */
  window?: string;
  /** The endpoint that produced it — the fastest way to re-read it later. */
  source?: string;
  /** The card's real, unmodified data. */
  data: unknown;
}

export interface ReportExportInput {
  label: string;
  data: unknown;
  tab?: string;
  window?: string;
  source?: string;
  /** Milliseconds. Passed in so this module stays pure and the test is deterministic. */
  now: number;
}

/**
 * Build the envelope. Undefined optional fields are LEFT OUT rather than written as `undefined`,
 * because `JSON.stringify` drops them anyway and a half-written key reads as missing data.
 */
export function reportEnvelope(input: ReportExportInput): ReportEnvelope {
  const env: ReportEnvelope = {
    report: input.label || 'Admin report',
    takenAt: new Date(input.now).toISOString(),
    data: input.data ?? null,
  };
  if (input.tab) env.tab = input.tab;
  if (input.window) env.window = input.window;
  if (input.source) env.source = input.source;
  return env;
}

/**
 * The exact text that goes on the clipboard or into the file.
 *
 * ⚠️ IT RETURNS `''` WHEN THERE IS NOTHING TO EXPORT, and the caller must treat that as a refusal.
 * `copyTextToClipboard` already refuses empty text, and silently replacing the admin's clipboard with
 * an empty string is the failure that looks exactly like success. A card that has not loaded yet, or
 * whose fetch failed, has no data — saying so beats handing over `{"data":null}` that reads as a
 * measured zero.
 */
export function reportExportText(input: ReportExportInput): string {
  if (input.data === null || input.data === undefined) return '';
  if (Array.isArray(input.data) && input.data.length === 0) return '';
  try {
    return JSON.stringify(reportEnvelope(input), null, 2);
  } catch {
    // A cyclic or otherwise unserialisable payload. Honest empty beats a partial document.
    return '';
  }
}

/** Filename-safe slug: lowercase words joined by '-', nothing else, never empty. */
export function reportSlug(label: string): string {
  const slug = (label || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'report';
}

/** `nbai-build-costs-2026-09-21.json` — sortable, and it names the card without being opened. */
export function reportFilename(label: string, now: number): string {
  const day = new Date(now).toISOString().slice(0, 10);
  return `nbai-${reportSlug(label)}-${day}.json`;
}

/**
 * CAN A FILE DOWNLOAD ACTUALLY HAPPEN HERE?
 *
 * 🔴 IN THE ANDROID APP IT CANNOT, AND THAT IS VERIFIED, NOT ASSUMED. A blob download needs the host
 * WebView to implement the `download` attribute or to carry a `DownloadListener`; Capacitor's
 * Android shell does neither — `MainActivity.java` registers three plugins and installs no download
 * handler. So `a.click()` on a blob URL returns silently and NOTHING reaches the phone's storage.
 *
 * A Download button that does nothing is precisely the "built but not really working" state the
 * second absolute rule forbids, so on a native shell the control is not shown at all and Copy is the
 * single, honest export. On the web both work.
 *
 * ⚠️ Fixing the native side is a real option, not a dead end — it needs a `DownloadListener` in the
 * shell plus a fresh signed bundle, because the app is BUNDLED mode and a frontend change alone never
 * reaches an installed user. Until that ships, this returns false there.
 */
export function downloadWorksHere(isNativeApp: boolean): boolean {
  return !isNativeApp;
}

/** What the confirmation says. It names the report, so the admin can see WHICH copy they took. */
export function exportStatusText(label: string, ok: boolean, action: 'copy' | 'download'): string {
  if (!ok) {
    return action === 'copy'
      ? 'Copy was blocked by the browser — nothing was copied.'
      : 'Download failed — nothing was saved.';
  }
  return action === 'copy'
    ? `${label} copied as JSON — paste it in the chat.`
    : `${label} saved as JSON.`;
}
