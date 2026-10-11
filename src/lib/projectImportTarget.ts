// A PROJECT IMPORT NEVER LANDS ON TOP OF ANOTHER APP (admin 2026-10-11, Q-733 (a): "an import of a complete
// project opens in a NEW chat and the current app is left untouched").
//
// The import merged a zip onto whatever the chat already held, deleting nothing: a 2-file probe landed on a
// 135-file Express + Vite app, its `package.json` replaced the old one, the preview crashed, the connect
// audit described the OLD app's 135 files as the import's, and a Publish would have shipped both apps in
// one archive. THE CLASS: an import whose target is "whatever this chat holds" instead of an empty project.
// Every surface that imports a project asks this one module where it may land.

/** Paths the durable store keeps beside an app that are not the app (`.navbharat/…` and other dotfiles). */
function isAppPath(path: string): boolean {
  return typeof path === 'string' && path !== '' && !path.split('/').some((seg) => seg.startsWith('.'));
}

/** How many of these paths are the app itself. */
export function appFileCount(paths: readonly string[] | null | undefined): number {
  return (paths ?? []).filter(isAppPath).length;
}

/**
 * Does this chat already hold an app, so a project import must open a NEW chat? PURE.
 *
 * `fileCount` is the chat's app file count, or null when it has not been read yet. Unknown with a workspace
 * attached counts as an app: opening an import in a new chat when the old one was in fact empty costs one
 * tap back in History, while landing it on an app nobody looked at is the merge this module exists to stop.
 */
export function chatHoldsAnApp(chat: { workspaceId?: string | null; fileCount: number | null }): boolean {
  if (chat.fileCount === null) return Boolean(chat.workspaceId);
  return chat.fileCount > 0;
}

/** What the user reads when an import opened a new chat instead of merging. */
export function importOpenedNewChatNote(name: string): string {
  return `📂 This chat already holds an app, so “${name}” opens in a new chat. Your other app is untouched — it is in History.`;
}

/** What the user reads when an import was refused rather than merged (a surface that cannot open a chat). */
export const IMPORT_NOT_MERGED_MESSAGE =
  'This chat already holds an app, so the project was not merged into it — nothing was changed. To bring in a whole project, open the builder and use + → Import project: it opens the project in a new chat and leaves this app as it is.';

/** What the user reads when the chat's files could not be read, so the import could not be placed safely. */
export const IMPORT_NOT_CHECKED_MESSAGE =
  'This chat\u2019s files could not be checked just now, so the project was not imported — nothing was changed. Try again in a moment, or use + → Import project in the builder, which opens the project in a new chat.';
