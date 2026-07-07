// Files-map hygiene (crash report 2026-07-07: "undefined is not an object (evaluating 'ce.split')").
//
// The app-wide `files` state is a `Record<path, sourceText>` rendered by FilesPanel, Code Studio and
// the preview. ONE non-string value (undefined from a stale merge, an object from a malformed server
// payload) crashed the ENTIRE app at the error boundary when a row computed `content.split('\n')`.
// This is the single write-boundary sanitizer: every merge of externally-sourced file data goes
// through it, so the "only strings live in the files map" invariant is enforced where the data
// ENTERS — not patched at one render site. Pure.

/** Drop every entry whose value is not a real string (and every empty/invalid path key). */
export function sanitizeFileMap(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== 'object') return out;
  for (const [path, content] of Object.entries(input as Record<string, unknown>)) {
    if (typeof path === 'string' && path.trim() !== '' && typeof content === 'string') {
      out[path] = content;
    }
  }
  return out;
}
