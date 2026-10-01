// EARLY PREVIEW CUE — tell the user their app is on screen while it is still being built.
//
// Admin 2026-10-01: "preview jitna jaldi ayega, user utna rukega". The builder now writes the app's
// entry early (server: earlyPreview.ts) and the preview shows each unwritten screen as a "being built"
// card. But on a phone the user is in the chat while a build runs, and the preview only opened by
// itself on a desktop, and only once a dev server published a URL — late on exactly the builds that
// take longest. So the moment this build writes the entry, the live strip offers "Watch it live".
//
// The signal is a WRITE of the entry in THIS build, never "the entry exists": a workspace always holds
// one (the starter page), and offering to watch a starter page is the wait this removes, relabelled.
// PURE.

/** The files whose rendering IS the app: a React root component or a Next.js App Router page. */
const APP_ENTRY_RE = /^(src\/)?(App\.[jt]sx?|app\/page\.[jt]sx?)$/;

export function isAppEntryPath(path: string | null | undefined): boolean {
  if (typeof path !== 'string') return false;
  return APP_ENTRY_RE.test(path.replace(/\\/g, '/').replace(/^\.?\/+/, ''));
}

/** Should the live strip offer "Watch it live" right now? */
export function offerWatchLive(input: { running: boolean; entryWrittenAt?: number; previewOpen: boolean }): boolean {
  return input.running && typeof input.entryWrittenAt === 'number' && !input.previewOpen;
}
