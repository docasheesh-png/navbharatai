// GA-14 (CI/CD engines) — CI-workflow REPAIR: detect + fix a generated GitHub Actions workflow that will
// fail deterministically.
//
// The deploy-artifact generator can WRITE a workflow, but a hand-written / model-written workflow in a user's
// project often ships broken in ways that only surface when CI runs: `npm ci` with no committed lockfile
// (npm ci ERRORS, it does not fall back to install), a setup-node `cache:` keyed to a package manager whose
// lockfile isn't there, or a `npm run <script>` step for a script package.json doesn't define. This detects
// those high-confidence, deterministic breakages and (for the auto-fixable ones) emits a repaired workflow.
//
// PURE + dependency-free (line scan over the workflow text + package.json — no YAML lib needed for these
// patterns). Conservative: only flags breakages that WILL fail, so a fix never changes a working workflow
// (rule 1). Advisory in `evaluate`; the `repair_ci_workflow` tool applies the fixes. Never throws.

export type CiIssueKind = 'npm-ci-no-lockfile' | 'cache-manager-mismatch' | 'missing-script';

export interface CiWorkflowIssue {
  file: string;
  line: number;
  kind: CiIssueKind;
  message: string;
  /** True when repairCiWorkflow can fix this deterministically. */
  autoFixable: boolean;
}

const WORKFLOW_RE = /(^|\/)\.github\/workflows\/[^/]+\.ya?ml$/i;
const GITLAB_RE = /(^|\/)\.gitlab-ci\.ya?ml$/i;
const JENKINS_RE = /(^|\/)Jenkinsfile(\.\w+)?$/;

/** Which CI platform a file belongs to (for cross-platform + platform-specific rules), or null. */
export function ciPlatform(path: string): 'github' | 'gitlab' | 'jenkins' | null {
  if (typeof path !== 'string') return null;
  if (WORKFLOW_RE.test(path)) return 'github';
  if (GITLAB_RE.test(path)) return 'gitlab';
  if (JENKINS_RE.test(path)) return 'jenkins';
  return null;
}
const LOCKFILES: Record<string, string> = {
  npm: 'package-lock.json',
  yarn: 'yarn.lock',
  pnpm: 'pnpm-lock.yaml',
  bun: 'bun.lockb',
};

/** Package managers whose lockfile is present in the project. */
function presentManagers(files: Record<string, string>): Set<string> {
  const out = new Set<string>();
  for (const [mgr, lock] of Object.entries(LOCKFILES)) {
    if (lock in files || (mgr === 'bun' && 'bun.lock' in files) || (mgr === 'npm' && 'npm-shrinkwrap.json' in files)) out.add(mgr);
  }
  return out;
}

/** Script names package.json defines (empty set if absent/unparseable). */
function packageScripts(files: Record<string, string>): Set<string> {
  const raw = files['package.json'];
  if (typeof raw !== 'string') return new Set();
  try {
    const pkg = JSON.parse(raw);
    const scripts = pkg && typeof pkg === 'object' ? pkg.scripts : null;
    return new Set(scripts && typeof scripts === 'object' ? Object.keys(scripts) : []);
  } catch { return new Set(); }
}

/**
 * Detect deterministic CI-workflow breakages across a project's GitHub Actions workflows. Pure; never throws.
 * Sorted by file+line.
 */
export function analyzeCiWorkflow(files: Record<string, string>): CiWorkflowIssue[] {
  if (!files || typeof files !== 'object') return [];
  const managers = presentManagers(files);
  const anyLockfile = managers.size > 0;
  const scripts = packageScripts(files);
  const hasPackageJson = typeof files['package.json'] === 'string';
  const issues: CiWorkflowIssue[] = [];

  for (const [path, content] of Object.entries(files)) {
    const platform = ciPlatform(path);
    if (!platform || typeof content !== 'string') continue;
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // GitHub/GitLab use `#` comments; a Jenkinsfile (Groovy) uses `//`.
      const stripped = line.replace(platform === 'jenkins' ? /\/\/.*$/ : /#.*$/, '');

      // (1) `npm ci` with NO committed lockfile → npm ci fails ("can only install with an existing lockfile").
      //     Cross-platform (any CI running the shell command).
      if (/\bnpm\s+ci\b/.test(stripped) && !anyLockfile) {
        issues.push({ file: path, line: i + 1, kind: 'npm-ci-no-lockfile', autoFixable: true,
          message: `'npm ci' requires a committed package-lock.json, but none is in the project — CI will fail. Use 'npm install' (or commit the lockfile).` });
      }

      // (2) setup-node cache keyed to a manager whose lockfile is absent — GitHub Actions only (setup-node).
      const cacheM = platform === 'github' ? stripped.match(/\bcache:\s*['"]?(npm|yarn|pnpm|bun)['"]?/) : null;
      if (cacheM) {
        const mgr = cacheM[1];
        if (!managers.has(mgr) && anyLockfile) {
          issues.push({ file: path, line: i + 1, kind: 'cache-manager-mismatch', autoFixable: true,
            message: `setup-node cache: '${mgr}' but there is no ${LOCKFILES[mgr]} — the project uses ${[...managers].join('/')}. The cache step fails to resolve.` });
        }
      }

      // (3) `npm run <script>` for a script package.json does not define.
      const runM = stripped.match(/\bnpm\s+run\s+([a-zA-Z0-9:_-]+)/);
      if (runM && hasPackageJson && scripts.size > 0 && !scripts.has(runM[1])) {
        const script = runM[1];
        issues.push({ file: path, line: i + 1, kind: 'missing-script', autoFixable: false,
          message: `Step runs 'npm run ${script}' but package.json has no "${script}" script — this step fails. Add the script or fix the step.` });
      }
    }
  }
  return issues.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** Advisory `evaluate` line, or '' when clean. Pure. */
export function ciWorkflowSummary(issues: CiWorkflowIssue[]): string {
  if (!issues || issues.length === 0) return '';
  const shown = issues.slice(0, 8).map((i) => `  ⚠️ ${i.file}:${i.line} — ${i.message}`);
  return `CI workflow — ${issues.length} likely CI failure(s) (the generated workflow will fail when it runs):\n${shown.join('\n')}${issues.length > 8 ? `\n  …and ${issues.length - 8} more` : ''}`;
}

/**
 * Apply the deterministic fixes to ONE workflow file's content, using the same detection over the whole
 * project. Returns the repaired text + the fixes applied (empty when nothing was auto-fixable). Pure.
 */
export function repairCiWorkflow(path: string, files: Record<string, string>): { content: string; fixes: string[] } {
  const original = files[path];
  if (typeof original !== 'string') return { content: '', fixes: [] };
  const managers = presentManagers(files);
  const preferred = managers.has('pnpm') ? 'pnpm' : managers.has('yarn') ? 'yarn' : managers.has('bun') ? 'bun' : 'npm';
  const fixes: string[] = [];

  const lines = original.split(/\r?\n/).map((line) => {
    const stripped = line.replace(/#.*$/, '');
    // npm ci with no lockfile → npm install.
    if (/\bnpm\s+ci\b/.test(stripped) && managers.size === 0) {
      fixes.push('npm ci → npm install (no committed lockfile)');
      return line.replace(/\bnpm\s+ci\b/, 'npm install');
    }
    // cache manager mismatch → point cache at the manager the project actually uses.
    const cacheM = stripped.match(/\bcache:\s*['"]?(npm|yarn|pnpm|bun)['"]?/);
    if (cacheM && !managers.has(cacheM[1]) && managers.size > 0) {
      fixes.push(`cache: '${cacheM[1]}' → '${preferred}'`);
      return line.replace(/(\bcache:\s*['"]?)(npm|yarn|pnpm|bun)(['"]?)/, `$1${preferred}$3`);
    }
    return line;
  });

  return { content: lines.join('\n'), fixes };
}
