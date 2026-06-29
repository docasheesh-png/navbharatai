/**
 * P-PME.7 — Changelog Manager.
 *
 * Turns a build's file-level diff (previous vs current workspace) into a Keep-a-Changelog entry
 * (Added / Changed / Removed, plus an optional explicit Fixed list) and prepends it to the
 * project's `CHANGELOG.md`. Pure + dependency-free + unit-tested; a route feeds it the two file
 * sets (the caller already has them), so it needs no build-pipeline plumbing to be usable.
 */

export interface FileDiff { added: string[]; changed: string[]; removed: string[] }

/** Diff two workspace file maps by path + content. Pure. Results are sorted for stable output. */
export function diffFiles(previous: Record<string, string>, current: Record<string, string>): FileDiff {
  const prev = previous || {};
  const curr = current || {};
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  for (const path of Object.keys(curr)) {
    if (!(path in prev)) added.push(path);
    else if (prev[path] !== curr[path]) changed.push(path);
  }
  for (const path of Object.keys(prev)) {
    if (!(path in curr)) removed.push(path);
  }
  return { added: added.sort(), changed: changed.sort(), removed: removed.sort() };
}

export interface ChangelogSections extends FileDiff { fixed?: string[] }

/** True when a diff has no entries in any section. */
export function isEmptyDiff(s: ChangelogSections): boolean {
  return !s.added.length && !s.changed.length && !s.removed.length && !(s.fixed && s.fixed.length);
}

/**
 * Render a single Keep-a-Changelog entry. Empty sections are omitted. `version` defaults to
 * "Unreleased"; `date` should be an ISO date (YYYY-MM-DD).
 */
export function renderChangelogEntry(version: string, date: string, sections: ChangelogSections): string {
  const lines: string[] = [`## [${version || 'Unreleased'}] - ${date}`];
  const section = (title: string, items?: string[]) => {
    if (!items || !items.length) return;
    lines.push('', `### ${title}`);
    for (const it of items) lines.push(`- ${it}`);
  };
  section('Added', sections.added);
  section('Changed', sections.changed);
  section('Fixed', sections.fixed);
  section('Removed', sections.removed);
  return lines.join('\n');
}

const HEADER = '# Changelog\n\nAll notable changes to this project are documented here (Keep a Changelog format).';

/**
 * Prepend a new entry to an existing CHANGELOG.md (or create one). The entry is inserted directly
 * after the `# Changelog` header/preamble and before the most recent prior entry.
 */
export function prependChangelogEntry(existing: string | undefined, entry: string): string {
  const trimmedEntry = entry.trim();
  if (!existing || !existing.trim()) {
    return `${HEADER}\n\n${trimmedEntry}\n`;
  }
  const content = existing;
  const firstEntryIdx = content.indexOf('\n## ');
  if (firstEntryIdx === -1) {
    // Header/preamble only, no prior entries.
    return `${content.replace(/\s+$/, '')}\n\n${trimmedEntry}\n`;
  }
  const head = content.slice(0, firstEntryIdx).replace(/\s+$/, '');
  const rest = content.slice(firstEntryIdx + 1); // drop the leading newline; rest starts at "## "
  return `${head}\n\n${trimmedEntry}\n\n${rest.replace(/\s+$/, '')}\n`;
}

export interface ChangelogResult {
  entry: string;
  changelog: string;
  diff: FileDiff;
  empty: boolean;
}

/**
 * One-shot: diff prev→curr, render an entry, and produce the updated CHANGELOG.md. When there are
 * no changes, returns the existing changelog unchanged with `empty: true`.
 */
export function generateChangelog(
  previousFiles: Record<string, string>,
  currentFiles: Record<string, string>,
  opts: { version?: string; date?: string; fixed?: string[]; existingChangelog?: string } = {},
): ChangelogResult {
  const diff = diffFiles(previousFiles, currentFiles);
  const sections: ChangelogSections = { ...diff, fixed: opts.fixed };
  const empty = isEmptyDiff(sections);
  const entry = renderChangelogEntry(opts.version || 'Unreleased', opts.date || '1970-01-01', sections);
  const changelog = empty
    ? (opts.existingChangelog || '')
    : prependChangelogEntry(opts.existingChangelog, entry);
  return { entry, changelog, diff, empty };
}
