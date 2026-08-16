// Shared, pure workspace-path normalizer for the AgentV3 / Engineer AI sandbox actuators.
//
// ROOT CAUSE this fixes (build-diagnostics 2026-07-03): every actuator's `safeRelPath` only dropped
// "."/".."/empty segments, then the file op string-concatenated the workspace root in front again
// (`${WORKSPACE_ROOT}/${safeRelPath(p)}`). So when a (sub-)agent supplied an ABSOLUTE in-workspace
// path — e.g. `/home/user/workspace/src/App.tsx`, easily produced by copying a `pwd`/`find` result —
// the leading root survived as literal segments (`home/user/workspace/src/App.tsx`) and the join
// doubled it: `/home/user/workspace/home/user/workspace/src/App.tsx` → "path does not exist". A single
// wrong absolute path from one sub-agent then failed every read/write/edit for that file.
//
// The fix: strip a leading workspace-root prefix BEFORE normalizing, so an absolute in-workspace path
// resolves to the correct relative path. A relative path is unchanged. Traversal ("..") can still never
// escape the root. Pure + unit-tested; shared so the four actuator copies can't drift.

/**
 * Normalize an agent-supplied file path to a workspace-RELATIVE path (no leading slash), safe to join
 * under `workspaceRoot`. Accepts BOTH a relative path ("src/App.tsx") and an absolute path that points
 * inside the workspace ("/home/user/workspace/src/App.tsx" → "src/App.tsx"). Drops ""/"."/".." segments
 * so the result can never escape the root. Throws when nothing usable remains.
 */
/**
 * The E2B sandbox's project root. Declared here — beside the normalizer that knows what to do with
 * it — so a caller that has no actuator (the DURABLE STORE, which is off the sandbox entirely) can
 * still recognise an absolute in-workspace path. Three actuator-local copies of this literal already
 * exist; this is the one a non-actuator may import.
 */
export const SANDBOX_WORKSPACE_ROOT = '/home/user/workspace';

/**
 * The DURABLE-STORE half of the same fix — normalize a file-map key, or reject it. Returns null when
 * nothing usable remains (instead of throwing, because the store's contract is best-effort).
 *
 * ROOT CAUSE (admin report 2026-08-16, build 5b4f9b63). `toWorkspaceRelPath` was applied to the four
 * ACTUATORS and stopped there, but the durable `WorkspaceFileStore` is the OTHER door into a project's
 * file map — and it stored whatever key it was handed, with no normalization at all. One absolute path
 * written once (`/home/user/workspace/src/main.tsx`, exactly the shape this module's header warns is
 * "easily produced by copying a pwd/find result") became a PHANTOM FILE that lives forever:
 *
 *   • every whole-project analyzer saw it, because it reads the durable map;
 *   • the sandbox never had it, because every actuator write/read runs through toWorkspaceRelPath;
 *   • so the integrity pass reported "2 files each mount a React root" and «"./index.css" imported by
 *     3 modules» on a project that had exactly ONE of each. The build then spent ~8 minutes of its
 *     30-minute budget hunting a file `find` could not see, and finished by telling the user it had
 *     fixed a duplicate entry point that never existed.
 *
 * A phantom is worse than a missing file: a missing file is noticed, a phantom is BELIEVED.
 */
export function toDurableFileKey(filePath: string): string | null {
  try {
    return toWorkspaceRelPath(filePath, SANDBOX_WORKSPACE_ROOT);
  } catch {
    return null;
  }
}

/**
 * Normalize every key of a durable file map, collapsing the duplicates that normalization reveals.
 *
 * `collapsed` counts the keys that turned out to name a file already in the map — i.e. the phantoms.
 * It is returned rather than logged so the caller can record it honestly instead of healing in
 * silence; a duplicate that disappears without a word is indistinguishable from data loss. PURE.
 */
export function normalizeFileMapKeys(
  files: Record<string, string>,
): { files: Record<string, string>; collapsed: number; dropped: number } {
  const out: Record<string, string> = {};
  let collapsed = 0;
  let dropped = 0;
  for (const [rawPath, content] of Object.entries(files ?? {})) {
    const key = toDurableFileKey(rawPath);
    if (key === null) { dropped++; continue; }
    // A later entry wins, matching the `{...store, ...written}` merge every caller already performs —
    // so normalizing here can never change WHICH content a path resolves to, only how many paths there
    // are. An object cannot hold one key twice, so ANY collision here is a normalization collapse —
    // counted whichever side happened to arrive first.
    if (Object.prototype.hasOwnProperty.call(out, key)) collapsed++;
    out[key] = content;
  }
  return { files: out, collapsed, dropped };
}

export function toWorkspaceRelPath(filePath: string, workspaceRoot: string): string {
  let p = String(filePath ?? '').replace(/\\/g, '/').trim();
  const root = String(workspaceRoot ?? '').replace(/\\/g, '/').replace(/\/+$/, '');

  // Strip a leading workspace-root prefix when the caller passed an absolute in-workspace path.
  // Guard the boundary with '/' (or exact match) so "/home/user/workspace-other" is NOT mis-stripped.
  if (root && (p === root || p.startsWith(root + '/'))) {
    p = p.slice(root.length);
  }

  const cleaned = p
    .split('/')
    .filter((s) => s && s !== '.' && s !== '..')
    .join('/');
  if (!cleaned) throw new Error(`Unsafe workspace path: ${JSON.stringify(filePath)}`);
  return cleaned;
}
