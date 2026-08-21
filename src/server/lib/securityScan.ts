// The Security Scan, made of work that actually happens.
//
// ADMIN 2026-08-21: "SecurityScan ka progress bar abhi bhi nakli hai — isko asli bana do."
//
// WHAT WAS THERE. The screen walked five canned strings on a 1.5-second timer —
//   "Phase 3: Static Analysis (SAST) Patterns…"
// — and pushed the bar to 95%, while the server did ONE thing: a single AI call. There was no static
// analysis, no configuration review, no phases at all. The bar was not a slow or approximate reading
// of real work; it was a clock with security words written on it, and the words named checks the
// product did not perform. That is worse than an unlabelled spinner, because a user watching
// "Static Analysis" scroll past reasonably believes their code was statically analysed.
//
// THE FIX IS NOT A HONEST-ER BAR. It is to do the work the bar was claiming.
//
// Two of the three stages below are REAL, DETERMINISTIC and FREE, and one of them we already owned:
// `appStaticScan.ts` was built for the App Debugger as a "precise, zero-hallucination" scanner with
// exact file:line findings. A security screen was inventing a static-analysis phase while a genuine
// static analyser sat one import away.
//
// Every function here is pure — no I/O, no LLM, no provider names — so the findings a user is shown
// are testable, and the progress reported to them corresponds to a stage that genuinely finished.

import { scanFilesStatic, type StaticFinding } from './appStaticScan';

export interface ScanFinding {
  severity: 'critical' | 'high' | 'medium' | 'low';
  file: string;
  line: number;
  problem: string;
  suggestion: string;
}

/** The stages, in order. The client's progress is (stages finished / this length) — nothing else. */
export const SCAN_STAGES = [
  { id: 'secrets', label: 'Looking for exposed keys and unsafe code' },
  { id: 'config', label: 'Checking project configuration' },
  { id: 'review', label: 'Security review of your code' },
] as const;

export type ScanStageId = (typeof SCAN_STAGES)[number]['id'];

/**
 * STAGE 1 — the deterministic pass, filtered to what is genuinely a SECURITY finding.
 *
 * `appStaticScan` also reports cleanup, maintainability and type-safety smells. Those are real, but
 * they are not security, and padding a security report with "you left a console.log" is how a report
 * stops being read. Only the security category, plus swallowed errors — a silently ignored failure is
 * how a failed auth check passes for a successful one.
 */
export function secretFindings(files: Record<string, string>): ScanFinding[] {
  return toFindings(
    scanFilesStatic(files).filter((f) => f.category === 'security' || f.category === 'error-handling'),
  );
}

function toFindings(rows: StaticFinding[]): ScanFinding[] {
  return rows.map((f) => ({
    severity: f.severity,
    file: f.file,
    line: f.line,
    problem: f.problem,
    suggestion: f.suggestion,
  }));
}

/**
 * STAGE 2 — configuration checks.
 *
 * Deliberately a SHORT list of things that are provably true from the files themselves. Each one is a
 * real, well-known risk with a specific fix — nothing here is a guess about what the code "might" do,
 * because a security report that cries wolf is one nobody acts on.
 */
export function configFindings(files: Record<string, string>): ScanFinding[] {
  const out: ScanFinding[] = [];

  for (const [path, content] of Object.entries(files)) {
    const name = path.split('/').pop() || path;

    // A .env among the app's own files means real credentials are one careless publish from being
    // public. (Our own publish gate drops these, which is exactly why the risk is easy to forget.)
    if (/^\.env(\.|$)/i.test(name) && content.trim()) {
      out.push({
        severity: 'critical', file: path, line: 1,
        problem: 'This project carries a .env file with real values in it.',
        suggestion: 'Keep .env out of the project and add it to .gitignore. Set the values as environment variables where the app runs.',
      });
    }

    if (name === 'package.json') {
      out.push(...packageJsonFindings(path, content));
    }
  }

  // A lockfile is what makes an install reproducible; without one, a dependency can change under you
  // between two installs of the "same" version.
  const hasManifest = Object.keys(files).some((p) => (p.split('/').pop() || '') === 'package.json');
  const hasLock = Object.keys(files).some((p) => /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/i.test(p));
  if (hasManifest && !hasLock) {
    out.push({
      severity: 'medium', file: 'package.json', line: 1,
      problem: 'There is no lockfile, so two installs of this project can end up with different code.',
      suggestion: 'Commit the lockfile your package manager generates (package-lock.json / yarn.lock / pnpm-lock.yaml).',
    });
  }

  return out;
}

function packageJsonFindings(path: string, content: string): ScanFinding[] {
  const out: ScanFinding[] = [];
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(content) as Record<string, unknown>;
  } catch {
    // An unreadable manifest is a real problem, and saying "no issues" about a file we could not read
    // would be the same class of lie this file exists to remove.
    return [{
      severity: 'medium', file: path, line: 1,
      problem: 'package.json could not be read as JSON, so its dependencies could not be checked.',
      suggestion: 'Fix the JSON syntax so tools (and this scan) can read it.',
    }];
  }

  const scripts = (pkg.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {}) as Record<string, string>;
  for (const hook of ['preinstall', 'postinstall', 'prepare']) {
    if (typeof scripts[hook] === 'string' && scripts[hook].trim()) {
      out.push({
        severity: 'medium', file: path, line: lineOf(content, `"${hook}"`),
        problem: `The "${hook}" script runs automatically whenever anyone installs this project.`,
        suggestion: 'Make sure you know exactly what it does — install hooks are a common way for malicious code to run on a developer machine.',
      });
    }
  }

  for (const field of ['dependencies', 'devDependencies']) {
    const deps = (pkg[field] && typeof pkg[field] === 'object' ? pkg[field] : {}) as Record<string, string>;
    for (const [name, range] of Object.entries(deps)) {
      if (typeof range !== 'string') continue;
      const r = range.trim();
      // `*` and `latest` accept ANY future version, including one published after a package is taken
      // over. This is the shape of most real supply-chain incidents.
      if (r === '*' || r.toLowerCase() === 'latest' || r === '') {
        out.push({
          severity: 'high', file: path, line: lineOf(content, `"${name}"`),
          problem: `"${name}" accepts any version (${r || 'empty'}), so an install can silently pull brand-new code.`,
          suggestion: `Pin it to a version range you have actually tested, e.g. "^1.2.3".`,
        });
      } else if (/^(git\+|https?:)/i.test(r)) {
        out.push({
          severity: 'medium', file: path, line: lineOf(content, `"${name}"`),
          problem: `"${name}" is installed straight from a URL rather than the package registry.`,
          suggestion: 'Prefer a published, versioned package — a URL dependency can change contents without changing its version.',
        });
      }
    }
  }

  return out;
}

/** 1-based line of the first occurrence, or 1. Only used to point a human at the right place. */
function lineOf(content: string, needle: string): number {
  const idx = content.indexOf(needle);
  if (idx < 0) return 1;
  return content.slice(0, idx).split('\n').length;
}

export interface ScanCounts {
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
}

/** Count by severity, for the one-line verdict. */
export function countFindings(findings: ScanFinding[]): ScanCounts {
  const c: ScanCounts = { critical: 0, high: 0, medium: 0, low: 0, total: findings.length };
  for (const f of findings) c[f.severity]++;
  return c;
}

/**
 * The headline. Says what was CHECKED as well as what was found, because "no issues" from a scan that
 * silently skipped a stage is the failure mode this whole change is about.
 */
export function scanVerdict(counts: ScanCounts, stagesRun: number, stagesTotal: number): string {
  const checked = stagesRun < stagesTotal
    ? ` (${stagesRun} of ${stagesTotal} checks completed)`
    : '';
  if (counts.critical > 0) return `${counts.critical} critical issue${counts.critical === 1 ? '' : 's'} found${checked}`;
  if (counts.high > 0) return `${counts.high} serious issue${counts.high === 1 ? '' : 's'} found${checked}`;
  if (counts.total > 0) return `${counts.total} issue${counts.total === 1 ? '' : 's'} worth a look${checked}`;
  return `No issues found in the automatic checks${checked}`;
}
