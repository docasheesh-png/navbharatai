// P-PME.2 — Release Notes Generator.
//
// A pure, dependency-free engine that turns the difference between two app "blueprints"
// (the previous deployed version and the current one) into a structured, shareable release
// note: version, date, features added/removed/kept, tech stack, and a formatted Markdown body.
//
// HONESTY: every line of the note is derived from the supplied blueprints. Nothing is
// invented — if a section has no entries it is omitted, and an empty diff produces an honest
// "no user-visible changes" note rather than fabricated highlights.
//
// Decoupled by design: it operates on a minimal `BlueprintLike` shape (name/features/techStack),
// so any caller (the build flow, an API request, the IDE) can map its own blueprint to it
// without this engine depending on the build pipeline.

export interface BlueprintLike {
  name?: string;
  /** User-visible features/capabilities of the app at this version. */
  features?: string[];
  /** Tech stack entries (frameworks, providers, services). */
  techStack?: string[];
}

export interface BlueprintDiff {
  added: string[];
  removed: string[];
  kept: string[];
}

export interface ReleaseNote {
  appName: string;
  version: string;
  date: string;
  /** One-line human summary of the change shape. */
  summary: string;
  added: string[];
  removed: string[];
  keptCount: number;
  techStack: string[];
  /** True when there is no user-visible feature change between the two blueprints. */
  noChanges: boolean;
  markdown: string;
}

const norm = (s: string): string => s.trim();
const uniqNonEmpty = (xs: string[] | undefined): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs || []) {
    const v = norm(String(x));
    if (v && !seen.has(v.toLowerCase())) { seen.add(v.toLowerCase()); out.push(v); }
  }
  return out;
};

/** Diff two blueprints' feature lists into added / removed / kept (case-insensitive, deduped). */
export function diffBlueprints(current: BlueprintLike, previous: BlueprintLike | null | undefined): BlueprintDiff {
  const cur = uniqNonEmpty(current.features);
  const prev = uniqNonEmpty(previous?.features);
  const prevLower = new Set(prev.map((f) => f.toLowerCase()));
  const curLower = new Set(cur.map((f) => f.toLowerCase()));
  return {
    added: cur.filter((f) => !prevLower.has(f.toLowerCase())),
    removed: prev.filter((f) => !curLower.has(f.toLowerCase())),
    kept: cur.filter((f) => prevLower.has(f.toLowerCase())),
  };
}

function summarise(diff: BlueprintDiff, firstRelease: boolean): string {
  if (firstRelease) return `Initial release — ${diff.added.length} feature${diff.added.length === 1 ? '' : 's'}.`;
  const parts: string[] = [];
  if (diff.added.length) parts.push(`${diff.added.length} added`);
  if (diff.removed.length) parts.push(`${diff.removed.length} removed`);
  if (!parts.length) return 'No user-visible feature changes in this release.';
  return `${parts.join(', ')}.`;
}

function buildMarkdown(note: Omit<ReleaseNote, 'markdown'>): string {
  const lines: string[] = [];
  lines.push(`# ${note.appName} — ${note.version}`);
  lines.push('');
  lines.push(`_Released ${note.date}_`);
  lines.push('');
  lines.push(note.summary);
  if (note.added.length) {
    lines.push('');
    lines.push('## ✨ New');
    for (const f of note.added) lines.push(`- ${f}`);
  }
  if (note.removed.length) {
    lines.push('');
    lines.push('## 🗑️ Removed');
    for (const f of note.removed) lines.push(`- ${f}`);
  }
  if (note.techStack.length) {
    lines.push('');
    lines.push('## 🧱 Tech stack');
    lines.push(note.techStack.join(' · '));
  }
  return lines.join('\n');
}

export interface ReleaseNoteOptions {
  version?: string;
  /** ISO date string for the release — passed in (the engine never reads the clock). */
  date?: string;
}

/** Generate a structured release note from the current + previous blueprint. Pure. */
export function generateReleaseNote(
  current: BlueprintLike,
  previous: BlueprintLike | null | undefined,
  opts: ReleaseNoteOptions = {},
): ReleaseNote {
  const firstRelease = !previous || uniqNonEmpty(previous.features).length === 0;
  const diff = diffBlueprints(current, previous);
  const base: Omit<ReleaseNote, 'markdown'> = {
    appName: norm(current.name || 'App'),
    version: norm(opts.version || (firstRelease ? 'v1.0.0' : 'v1.0.1')),
    date: opts.date || 'unreleased',
    summary: summarise(diff, firstRelease),
    added: diff.added,
    removed: diff.removed,
    keptCount: diff.kept.length,
    techStack: uniqNonEmpty(current.techStack),
    noChanges: !firstRelease && diff.added.length === 0 && diff.removed.length === 0,
  };
  return { ...base, markdown: buildMarkdown(base) };
}
