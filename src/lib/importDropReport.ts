// IMPORT HONESTY — say what did NOT come in, in words the user can act on.
//
// ROOT CAUSE (admin, 2026-08-04, discussing a 1 GB / 4000-file project): the import pipeline already
// counts every file it refuses, in eight labelled categories (`ExtractedProject.dropped`) alongside
// `totalEntries`. That information was computed and then THROWN AWAY at every exit:
//   • `/api/zip-upload/commit` returned only `fileCount` / `imported`, never `dropped`;
//   • the client's `uploadZipProject` dropped even the `skipped` count the server did send;
//   • the SSE path's `{type:'skipped'}` events were received by `useZipImport` and explicitly ignored
//     ("a single file was skipped — fine, keep going").
// So a user importing a media-heavy 1 GB project saw a green "✅ Imported 400 files" while 3,600 files
// had been silently discarded. The app looked imported and was not. That is not a limitation — it is
// the product lying about its own result, which the second and third absolute rules forbid outright.
//
// This module is the single place that turns those counts into an honest sentence, so BOTH import
// paths report identically and a future third path cannot quietly regress to silence. Pure + tested.
//
// Tone matters as much as accuracy here. Some drops are GOOD (node_modules and .git are rebuilt by
// `npm install`, so dropping them loses nothing) while others are real losses the user must know about
// (their images, their oversized files). Lumping them into one scary number would be honest but
// useless; hiding the real ones would be useless AND dishonest. So each category is named for what it
// means to the person reading it.

/** The refusal categories the import pipeline already tracks. All optional so partial data is safe. */
export interface DropCounts {
  /** Dependency/build folders: node_modules, .git, dist, build, .next, vendor, … */
  dir?: number;
  /** OS junk: .DS_Store, Thumbs.db, desktop.ini */
  junk?: number;
  /** Credentials deliberately never imported: .env, *.pem, *.key, keystores */
  secret?: number;
  /** Binaries with no text form: images, video, audio, archives, fonts, executables */
  binary?: number;
  /** Text files past the per-file size cap */
  tooLarge?: number;
  /** Unsafe archive paths (zip-slip, absolute paths) */
  unsafe?: number;
  /** Beyond the import's file/byte budget */
  overCap?: number;
  /** Outside the detected app folder in a monorepo */
  outsideAppRoot?: number;
}

/** Total files the import refused, across every category. Pure; tolerates missing/NaN fields. */
export function totalDropped(d: DropCounts | null | undefined): number {
  if (!d) return 0;
  const keys: (keyof DropCounts)[] = ['dir', 'junk', 'secret', 'binary', 'tooLarge', 'unsafe', 'overCap', 'outsideAppRoot'];
  let n = 0;
  for (const k of keys) {
    const v = d[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) n += Math.floor(v);
  }
  return n;
}

/**
 * Drops the user does NOT lose anything from — the import is better for having refused them.
 * Separated so a reassuring 100,000-file node_modules count never drowns out the 12 images that
 * genuinely went missing.
 */
export function harmlessDropped(d: DropCounts | null | undefined): number {
  if (!d) return 0;
  return (d.dir ?? 0) + (d.junk ?? 0);
}

/** Drops that are a REAL loss from the user's point of view — the ones worth leading with. */
export function meaningfulDropped(d: DropCounts | null | undefined): number {
  return Math.max(0, totalDropped(d) - harmlessDropped(d));
}

/** One clause per non-zero category, ordered so real losses are read first. Pure. */
export function dropReasonPhrases(d: DropCounts | null | undefined): string[] {
  if (!d) return [];
  const out: string[] = [];
  const add = (n: number | undefined, one: string, many: string) => {
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) {
      out.push(`${n.toLocaleString()} ${Math.floor(n) === 1 ? one : many}`);
    }
  };
  // Real losses first — these are what the user needs to know.
  add(d.binary, 'image/media file (kept only as small assets)', 'image/media files (kept only as small assets)');
  add(d.tooLarge, 'file too large to import', 'files too large to import');
  add(d.overCap, 'file beyond the import limit', 'files beyond the import limit');
  add(d.outsideAppRoot, 'file outside your app folder', 'files outside your app folder');
  add(d.unsafe, 'file with an unsafe path', 'files with unsafe paths');
  // Then the ones that cost nothing — explained so they do not look like damage.
  add(d.secret, 'credential file (never uploaded, by design)', 'credential files (never uploaded, by design)');
  add(d.dir, 'dependency/build file (rebuilt automatically)', 'dependency/build files (rebuilt automatically)');
  add(d.junk, 'system junk file', 'system junk files');
  return out;
}

/**
 * The honest one-line outcome of an import.
 *
 * `kept` is what actually landed. `totalEntries` is what the archive contained (0 when unknown — the
 * SSE path counts events rather than reading a central directory). Returns '' only when genuinely
 * nothing was refused, so a clean import stays clean and uncluttered.
 */
export function importDropSummary(input: { kept: number; totalEntries?: number; dropped?: DropCounts | null }): string {
  const dropped = totalDropped(input.dropped);
  if (dropped <= 0) return '';
  const phrases = dropReasonPhrases(input.dropped);
  const real = meaningfulDropped(input.dropped);
  const total = typeof input.totalEntries === 'number' && input.totalEntries > 0
    ? input.totalEntries
    : input.kept + dropped;
  const head = `Imported ${input.kept.toLocaleString()} of ${total.toLocaleString()} files — ${dropped.toLocaleString()} were not imported`;
  const body = phrases.length > 0 ? `: ${phrases.join(', ')}.` : '.';
  // Only reassure when there is genuinely nothing to worry about. Saying "nothing important is
  // missing" while a user's images are gone would be exactly the lie this module exists to end.
  const tail = real === 0
    ? ' Nothing you need is missing — these are rebuilt or excluded on purpose.'
    : ' Add anything you still need and I will work with it.';
  return head + body + tail;
}
