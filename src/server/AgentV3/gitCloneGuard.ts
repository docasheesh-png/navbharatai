// AgentV3 — deterministic guard against cloning a repository INSIDE the workspace.
//
// 🔴 ROOT CAUSE (autopsy `c5fd6ad1` + `bff0bf23`, 2026-09-21). The prompt was *"Import this app from
// my GitHub repository and give me a short survey … **Do not change any files yet.**"* The platform
// imported it correctly — 175 source files, `IMPORT_LANDING` count-verified, `IMPORT_DIAGNOSTIC`
// "SUCCEEDED". The architect then delegated the survey to the fullstack sub-agent, which ran:
//
//     git clone https://github.com/<owner>/mitrify workspace/mitrify
//
// Every shell command runs with `cwd: WORKSPACE_ROOT`, so that relative target landed at
// `/home/user/workspace/workspace/mitrify` — **a second, complete copy of the user's own project,
// inside their project.** The report proves each consequence:
//
//   • 175 → 352 "source files", persisted durably and bound for the user's GitHub repo.
//   • `INTEGRITY_DUPLICATE_ENTRY` — two files mounting a React root, one of them ours.
//   • `INTEGRITY_DUPLICATE_STYLESHEET` and `INTEGRITY_FOCUS_CONFLICT` — same cause.
//   • The next turn's integrity heal then spent ~3.5 minutes and 10 model calls EDITING the copy
//     the engine had itself created, on a turn where the user had only said "preview nahi chala".
//   • A `TOOL_ERROR` on `/home/user/workspace/workspace/mitrify/README.md` — the doubled path.
//
// 🔑 WHY A PROMPT COULD NOT HAVE STOPPED IT, AND WHY THIS MODULE EXISTS. The architect's context
// already carries, in as many words, `[APP IMPORT — already completed] … Work WITH these existing
// files … and NEVER scaffold a new app over them`. **The sub-agent that ran the clone never
// receives that block** — `makeSubAgentSpawn` passes `projectMap()` and `verificationStatus()` and
// nothing else. So the actor doing the work was told the project had 175 files and was never told
// those files were already on its own disk. That half is fixed in `SubAgent.ts`; this module is the
// deterministic backstop, exactly as `ScaffoldGuard` is for `create-*` generators — and that guard's
// own docblock states the principle this one inherits: *"the system prompt already tells the agent
// not to run these … but a prompt is advisory — the model can still ignore it (and has)."*
//
// ⚠️ PREVENTION, NOT CLEANUP — and the reason is a fact about the sandbox, not a preference.
// Excluding a nested repository from the collected project would be the tidier-sounding fix and it
// is NOT AVAILABLE: `IGNORED_LIST_DIRS` in `E2BActuator` prunes `.git` **inside the sandbox**, so
// `listFiles` never returns a single `.git` path and `collectWorkspaceFiles` therefore cannot tell a
// nested repository from an ordinary subdirectory. The one signal that would identify it is destroyed
// before the collector runs. The alternatives are worse: a nested `package.json` is how every
// monorepo is laid out, and "a subtree that duplicates the root" is a heuristic that would DELETE a
// user's real files from their durable copy. So the wrong branch is made impossible at the door
// instead — after which there is no nested copy to detect. Recorded in `PROGRESS.md` as the reason.
//
// PURE & deterministic (no I/O), so it is fully unit-testable. The caller supplies the one workspace
// fact it needs.

/** Where a `git clone` in this command would put the repository. */
export type CloneDestination =
  | { kind: 'inside'; target: string }   // lands in the workspace — a second copy of the project
  | { kind: 'outside'; target: string }  // an absolute path elsewhere (e.g. /tmp) — fine
  | { kind: 'none' };                    // not a clone at all

/** The sandbox root every shell command runs in (`cwd: WORKSPACE_ROOT` in `E2BActuator`). */
const WORKSPACE_ROOT = '/home/user/workspace';

/**
 * `git clone` flags that take a SEPARATE value, so the token after them is that value and must never
 * be mistaken for the URL or the destination. Long `--flag=value` forms carry their own value and are
 * skipped by the generic `-`-prefix test.
 */
const VALUE_FLAGS = new Set([
  '-b', '--branch', '-o', '--origin', '-u', '--upload-pack', '-c', '--config',
  '--depth', '--reference', '--separate-git-dir', '--template', '-j', '--jobs',
  '--shallow-since', '--shallow-exclude', '--filter', '--server-option', '--bundle-uri',
]);

/** Split a command line on the shell separators that start a NEW command. */
function segments(command: string): string[] {
  return command.split(/(?:&&|\|\||;|\||\n)/g);
}

/**
 * Tokenise one command segment, honouring single and double quotes so a quoted path with a space
 * stays one token. Deliberately simple: this decides a guard, and anything it cannot parse falls
 * through to `{ kind: 'none' }` — i.e. today's behaviour.
 */
function tokenize(segment: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(segment)) !== null) out.push(m[1] ?? m[2] ?? m[3] ?? '');
  return out;
}

/** The directory `git clone <url>` creates when no destination is given: the repo's own name. */
export function defaultCloneDirName(url: string): string {
  const noQuery = url.split(/[?#]/)[0] ?? url;
  const trimmed = noQuery.replace(/\/+$/, '').replace(/\.git$/i, '');
  const last = trimmed.split(/[/:]/).filter(Boolean).pop() ?? '';
  return last;
}

/** Does this token look like a repository URL / SCP-style remote rather than a local path? */
function looksLikeRemote(token: string): boolean {
  return /^(https?|git|ssh|file):\/\//i.test(token) || /^[\w.-]+@[\w.-]+:/.test(token);
}

/**
 * Where would a `git clone` in this command land? PURE.
 *
 * A RELATIVE destination is `inside` because every shell command runs with `cwd: WORKSPACE_ROOT`.
 * An ABSOLUTE destination is `inside` only when it is under that root — which is what keeps the
 * platform's own import path (`git clone … /tmp/nbhydrate`, `GitRepoSync.ts`) allowed by
 * construction rather than by an exception list.
 */
export function cloneDestination(command: string): CloneDestination {
  for (const segment of segments(command || '')) {
    const tokens = tokenize(segment);
    const gitAt = tokens.findIndex((t) => t === 'git');
    if (gitAt === -1) continue;
    if (tokens[gitAt + 1] !== 'clone') continue;

    // Walk the arguments after `clone`, skipping flags and the values they consume.
    const positional: string[] = [];
    for (let i = gitAt + 2; i < tokens.length; i += 1) {
      const token = tokens[i] ?? '';
      if (VALUE_FLAGS.has(token)) { i += 1; continue; }   // flag + its separate value
      if (token.startsWith('-')) continue;                 // --depth=1, --recursive, -q …
      positional.push(token);
    }
    if (positional.length === 0) continue;                  // `git clone` with nothing to clone

    const url = positional[0] ?? '';
    const explicitTarget = positional[1];
    // A second positional that is itself a URL is not a destination (nothing sane produces this,
    // but reading it as a path would classify the clone on the wrong side of the guard).
    const target = explicitTarget && !looksLikeRemote(explicitTarget)
      ? explicitTarget
      : defaultCloneDirName(url);
    if (!target) continue;

    if (target.startsWith('/')) {
      const normalised = target.replace(/\/+$/, '');
      const inside = normalised === WORKSPACE_ROOT || normalised.startsWith(`${WORKSPACE_ROOT}/`);
      return { kind: inside ? 'inside' : 'outside', target };
    }
    return { kind: 'inside', target };                      // relative — cwd IS the workspace root
  }
  return { kind: 'none' };
}

/**
 * Should this clone be refused? True only when it would land INSIDE the workspace AND the workspace
 * already holds the project.
 *
 * ⚠️ THE SECOND CONDITION IS WHAT KEEPS A REAL RESCUE PATH OPEN, and it is not a guess:
 * `shouldRetryImportAnonymously` (`ProjectImport.ts`) records a real July incident in which the
 * platform's own authenticated clone of THIS SAME repository brought in nothing while *"the model's
 * own plain `git clone` of the identical URL exited 0"*. An import that lands nothing leaves the
 * workspace with no project, so `projectFileCount` is 0 and that clone still runs. The asymmetry is
 * deliberate: refusing wrongly on an empty workspace costs the user their whole import, while
 * allowing wrongly on a populated one costs a duplicate copy — and the duplicate is the case the
 * evidence actually names.
 */
export function shouldRefuseClone(opts: {
  destination: CloneDestination;
  projectFileCount: number;
}): boolean {
  return opts.destination.kind === 'inside' && opts.projectFileCount > 0;
}

/**
 * The redirect handed back instead of running the clone. It names the destination, says what the
 * copy would have done, and points at the tools that read the files that are already there — a stop
 * that only forbids leaves a model nowhere to go, which is the lesson `READ_LOOP_LIMIT` encodes.
 */
export function cloneGuardMessage(target: string, projectFileCount: number): string {
  return [
    `[CLONE REFUSED] \`git clone\` into \`${target}\` was not run.`,
    '',
    `This project is ALREADY in your workspace — ${projectFileCount} source file(s), at the workspace`,
    'root. Cloning it again would create a second copy of the same app inside the app: two files',
    'mounting a React root, two copies of every stylesheet, and a duplicate the user would find in',
    'their own repository.',
    '',
    'Read what is already here instead:',
    '  • `glob` with a pattern (e.g. `**/package.json`, `src/**/*.tsx`) to see the layout',
    '  • `read_file` on any path, relative to the workspace root (e.g. `package.json`, `src/App.tsx`)',
    '  • `grep` to find a symbol across the project',
    '',
    'If you genuinely need a DIFFERENT repository for reference, clone it outside the workspace',
    '(an absolute path under `/tmp`), so it never becomes part of the user\'s project.',
  ].join('\n');
}
