// AgentV3 — A FILE THE BUILD REMOVED FROM THE USER'S APP IS NAMED IN THE SUMMARY THEY READ (queue Q-019,
// autopsy 4d538ca3, 2026-10-01).
//
// 🔴 WHY. A build that deleted a file recorded `FILE_DELETED` in the ADMIN report and said nothing to the
// user. #3442 made deleting the user's OWN file (one they added in Code Studio) impossible unless asked; a
// file the build itself wrote on an earlier turn could still disappear with no word on any screen the user
// reads. Their app lost a file and the summary celebrated.
//
// WHICH FILES ARE NAMED, and why only these:
//   - a path that was in the project BEFORE this build began (`before`). A file this build created and
//     then removed never reached the user's app, so naming it would describe nothing they lost.
//   - only when the user already HAD an app (`userAppExists`). On a fresh app the project before the build
//     is our own starter, which the user never saw; "Removed src/App.css" would be noise.
//   - never our own housekeeping files (`.nbai…`).
//   - `before === null` means the project list could not be read. Then every deleted path is named: the
//     class being fixed is silence, so an unknown resolves toward telling.
// The caller then confirms each path is still absent at the END of the build (a later write or a restore
// may have put it back), so the sentence is true of the app the user receives.
//
// PURE — no I/O, never throws.

/** At most this many paths are named; the rest are counted. */
export const MAX_NAMED_DELETIONS = 8;

function norm(p: string): string {
  return String(p ?? '').trim().replace(/^\.?\/+/, '');
}

function isPlatformFile(p: string): boolean {
  return p.split('/').some((seg) => seg.startsWith('.nbai'));
}

/**
 * The deleted paths worth telling the user about, in first-deleted order, de-duplicated.
 */
export function userVisibleDeletions(
  deleted: readonly string[],
  before: readonly string[] | null,
  userAppExists: boolean,
): string[] {
  if (!userAppExists) return [];
  const prior = before == null ? null : new Set(before.map(norm));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(deleted) ? deleted : []) {
    const p = norm(raw);
    if (!p || seen.has(p) || isPlatformFile(p)) continue;
    if (prior && !prior.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  return out;
}

/** The one summary line, or `''` when nothing is worth naming. */
export function deletedFilesNotice(paths: readonly string[]): string {
  const list = (Array.isArray(paths) ? paths : []).map(norm).filter(Boolean);
  if (list.length === 0) return '';
  const named = list.slice(0, MAX_NAMED_DELETIONS).map((p) => `\`${p}\``).join(', ');
  const more = list.length > MAX_NAMED_DELETIONS ? ` and ${list.length - MAX_NAMED_DELETIONS} more` : '';
  const noun = list.length === 1 ? 'this file' : 'these files';
  const it = list.length === 1 ? 'it' : 'them';
  return `\n\n🗑️ This build removed ${noun} from your project: ${named}${more}. An earlier version that still has ${it} is in Files → History.`;
}
