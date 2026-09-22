/**
 * 🔴 A SECOND REPOSITORY INSIDE THE USER'S PROJECT LOOKS EXACTLY LIKE AN ORDINARY FOLDER.
 *
 * The open root cause `gitCloneGuard.ts` recorded and could not close (autopsy `c5fd6ad1`), in its
 * own words: *"`IGNORED_LIST_DIRS` prunes `.git` inside the sandbox, so `listFiles` never returns a
 * single `.git` path and `collectWorkspaceFiles` therefore cannot tell a nested repository from an
 * ordinary subdirectory. The one signal that would identify it is destroyed before the collector
 * runs. … Whoever re-opens this needs a dedicated nested-repo probe (`find . -name .git -not -path
 * ./.git`), not a change to the collector's skip list."*
 *
 * What it cost: a sub-agent's `git clone` put a complete second copy of the user's 175-file app
 * inside their app, every integrity check then paired files across the two repositories, and the
 * heal spent **~3.5 minutes and 10 model calls editing the copy the engine had itself created** — on
 * a turn where the user had said only *"preview nahi chala"*.
 *
 * ## What this suite locks
 *
 * 1. The probe finds a nested repository and **ignores the workspace's own** `.git`.
 * 2. The skip list is NOT the fix — `.git` is still pruned from the file listing, and the probe's own
 *    prune list is the actuator's minus that one entry. Asserted against the exported
 *    `isIgnoredListPath`, so the two cannot drift.
 * 3. Each project is judged on its own, and `ok` is ANDed per project rather than recomputed over
 *    the merged arrays — the mistake that would re-create the exact false finding.
 * 4. **Nothing is deleted or dropped.** Every file is still analysed. `PROGRESS.md` rejects the
 *    deleting alternatives by name, and a nested repository can be perfectly legitimate.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  buildNestedRepoCommand, parseNestedRepoRoots, isInsideNestedRepo, projectOf, splitByProject,
  nestedRepoNote, NESTED_REPO_PRUNE_DIRS,
} from '../src/server/AgentV3/nestedRepoProbe';
import { analyzeProjectIntegrity } from '../src/server/AgentV3/ProjectIntegrityChecks';
import { isIgnoredListPath, buildListFilesCommand } from '../src/server/AgentV3/sandbox/EngineerAI/actuators/E2BActuator';

const ROOT = '/home/user/workspace';
const ROUTE = readFileSync('src/server/routes/agentv3.ts', 'utf8');

function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('the probe — one find, and the skip list is untouched', () => {
  it('🔴 does NOT prune .git — that is the entire point', () => {
    expect(NESTED_REPO_PRUNE_DIRS).not.toContain('.git');
    expect(buildNestedRepoCommand(ROOT)).not.toContain("-name '.git' -o");
    expect(buildNestedRepoCommand(ROOT)).toContain("-type d -name '.git' -prune -print");
  });

  it('🔒 the FILE LISTING still prunes .git — widening that list was the rejected fix', () => {
    // Undoing this would put every .git blob back on the wire and reverse the 226-second fix
    // buildListFilesCommand exists for (report a876b7bb).
    expect(buildListFilesCommand(ROOT)).toContain("-name '.git'");
    expect(isIgnoredListPath('.git/HEAD')).toBe(true);
    expect(isIgnoredListPath('a/b/.git/config')).toBe(true);
  });

  it('🔒 the probe’s prune list is the actuator’s, minus .git — asserted, not assumed', () => {
    for (const d of NESTED_REPO_PRUNE_DIRS) {
      expect(isIgnoredListPath(`${d}/anything`)).toBe(true);
    }
  });

  it('prunes the dependency tree — a vendored .git is the package manager’s business', () => {
    expect(buildNestedRepoCommand(ROOT)).toContain("-name 'node_modules'");
  });

  it('stops descending into a repository it has found', () => {
    expect(buildNestedRepoCommand(ROOT)).toMatch(/-name '\.git' -prune -print/);
  });

  it('quotes the root and swallows stderr, like its sibling', () => {
    expect(buildNestedRepoCommand("/home/user/workspace")).toContain("find '/home/user/workspace'");
    expect(buildNestedRepoCommand(ROOT)).toContain('2>/dev/null');
  });
});

describe('parseNestedRepoRoots — the workspace is not nested inside itself', () => {
  it('🔴 finds the nested repository and IGNORES the workspace’s own .git', () => {
    const out = [
      `${ROOT}/.git`,
      `${ROOT}/workspace/mitrify/.git`,
    ].join('\n');
    expect(parseNestedRepoRoots(out, ROOT)).toEqual(['workspace/mitrify']);
  });

  it('a workspace with only its own repository yields nothing', () => {
    expect(parseNestedRepoRoots(`${ROOT}/.git\n`, ROOT)).toEqual([]);
  });

  it('several nested repositories come back sorted and unique', () => {
    const out = `${ROOT}/vendor/b/.git\n${ROOT}/examples/a/.git\n${ROOT}/vendor/b/.git\n`;
    expect(parseNestedRepoRoots(out, ROOT)).toEqual(['examples/a', 'vendor/b']);
  });

  it('a trailing slash on the root describes the same root', () => {
    expect(parseNestedRepoRoots(`${ROOT}/pkg/.git`, `${ROOT}/`)).toEqual(['pkg']);
  });

  it('tolerates blank lines, CRLF and a path from some other root', () => {
    const out = `\r\n\n${ROOT}/pkg/.git\r\n/somewhere/else/.git\n   \n`;
    expect(parseNestedRepoRoots(out, ROOT)).toEqual(['pkg']);
  });

  it('never throws, and an empty answer is an empty list — not a guess', () => {
    expect(parseNestedRepoRoots('', ROOT)).toEqual([]);
    expect(parseNestedRepoRoots(undefined as never, ROOT)).toEqual([]);
    expect(() => parseNestedRepoRoots('garbage', '')).not.toThrow();
  });
});

describe('ownership — segment-exact, deepest wins', () => {
  it('🔒 a repo at `app` does not swallow `application/`', () => {
    expect(isInsideNestedRepo('application/src/x.tsx', ['app'])).toBe(false);
    expect(isInsideNestedRepo('app/src/x.tsx', ['app'])).toBe(true);
  });

  it('the root itself is not "inside" anything', () => {
    expect(isInsideNestedRepo('app', ['app'])).toBe(false);
  });

  it('a repository inside a repository is filed under the DEEPER one', () => {
    expect(projectOf('a/b/src/x.tsx', ['a', 'a/b'])).toBe('a/b');
    expect(projectOf('a/src/x.tsx', ['a', 'a/b'])).toBe('a');
    expect(projectOf('src/x.tsx', ['a', 'a/b'])).toBe('');
  });

  it('splitByProject always puts the user’s own project first, even when empty', () => {
    const groups = splitByProject({ 'pkg/a.tsx': 'x' }, ['pkg']);
    expect(groups[0].root).toBe('');
    expect(groups[0].files).toEqual({});
    expect(groups[1]).toEqual({ root: 'pkg', files: { 'pkg/a.tsx': 'x' } });
  });

  it('no roots ⇒ one group holding everything, unchanged', () => {
    const files = { 'src/a.tsx': 'x' };
    expect(splitByProject(files, [])).toEqual([{ root: '', files }]);
  });
});

describe('🔴 THE FALSE FINDING — two projects, each with its own root mount', () => {
  const mount = (id: string) => `import { createRoot } from 'react-dom/client';\ncreateRoot(document.getElementById('${id}')!).render(<App />);\n`;
  const files = {
    'src/main.tsx': mount('root'),
    'workspace/mitrify/client/src/main.tsx': mount('root'),
  };

  it('without the probe they are reported as duplicates — the behaviour that cost 10 model calls', () => {
    const before = analyzeProjectIntegrity(files);
    expect(before.duplicateEntryPoints.length).toBeGreaterThan(0);
    expect(before.ok).toBe(false);
  });

  it('✅ with the probe each project is judged on its own and nothing is reported', () => {
    const after = analyzeProjectIntegrity(files, ['workspace/mitrify']);
    expect(after.duplicateEntryPoints).toEqual([]);
    expect(after.ok).toBe(true);
  });

  it('🔒 a REAL duplicate INSIDE one project is still reported — nothing is dropped', () => {
    const real = {
      'src/main.tsx': mount('root'),
      'src/index.tsx': mount('root'),
      'workspace/mitrify/client/src/main.tsx': mount('root'),
    };
    const after = analyzeProjectIntegrity(real, ['workspace/mitrify']);
    expect(after.duplicateEntryPoints.length).toBe(1);
    expect(after.duplicateEntryPoints[0].entries.sort()).toEqual(['src/index.tsx', 'src/main.tsx']);
    expect(after.ok).toBe(false);
  });

  it('🔴 `ok` is ANDed per project, never recomputed over the merged arrays', () => {
    // Two projects with ONE focus owner each would fail a `focusOwners.length <= 1` test over the
    // union — the exact false finding the split exists to remove.
    const focus = (n: string) => `export function ${n}() { return <input autoFocus />; }\n`;
    const two = { 'src/A.tsx': focus('A'), 'pkg/src/B.tsx': focus('B') };
    expect(analyzeProjectIntegrity(two).ok).toBe(false);            // one project: a real conflict
    expect(analyzeProjectIntegrity(two, ['pkg']).ok).toBe(true);    // two projects: one owner each
  });

  it('omitting the argument is today’s behaviour exactly', () => {
    expect(analyzeProjectIntegrity(files, [])).toEqual(analyzeProjectIntegrity(files));
    expect(analyzeProjectIntegrity(files, undefined)).toEqual(analyzeProjectIntegrity(files));
  });
});

describe('the note, and the wiring', () => {
  it('names the repository, its size, and says plainly that nothing was removed', () => {
    const note = nestedRepoNote(['workspace/mitrify'], { 'workspace/mitrify': 175 });
    expect(note).toContain('workspace/mitrify (175 file(s))');
    expect(note).toContain('Nothing was removed');
  });

  it('🔒 the route runs the probe and feeds it to the analysis', () => {
    const src = code(ROUTE);
    expect(src).toContain('buildNestedRepoCommand(SANDBOX_WORKSPACE_ROOT)');
    expect(src).toContain('analyzeProjectIntegrity(integrityFiles, nestedRepoRoots)');
  });

  it('🔒 the probe uses the SHARED workspace root, not a sixth private copy of the string', () => {
    // Five files already carry `const WORKSPACE_ROOT = '/home/user/workspace'`. A probe searching a
    // root the actuator is not using would return nothing, for ever, with nothing failing.
    expect(code(ROUTE)).toContain("import { SANDBOX_WORKSPACE_ROOT } from '../lib/workspacePath'");
    expect(code(ROUTE)).not.toMatch(/buildNestedRepoCommand\('\/home/);
  });

  it('🔒 the probe never deletes, excludes or edits — it only regroups', () => {
    const probe = readFileSync('src/server/AgentV3/nestedRepoProbe.ts', 'utf8');
    expect(code(probe)).not.toMatch(/delete |unlink|rm -rf|writeFile/);
  });
});
