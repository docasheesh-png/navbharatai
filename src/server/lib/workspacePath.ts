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
