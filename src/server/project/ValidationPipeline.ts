/**
 * Validation Pipeline (NavBharatAI autonomous engine — Stages 5/6/7/23/25).
 *
 * Turns "generate → preview" into "generate → validate → preview ONLY if the
 * critical gates pass". Produces a structured ValidationReport + QualityScore so
 * the UI can show a real report card instead of a fake "App is live".
 *
 * Honesty rule (core principle #6): gates that require a real execution
 * environment we don't have yet (npm build, headless runtime, e2e, lighthouse,
 * a11y, security audit) are reported as `pending` — NEVER faked as `pass`.
 * They lower the score and are listed, but only the gates we can truly run
 * (architecture + static analysis) can BLOCK preview today. As the
 * server-container/chromium infra lands, those stages flip from `pending`→real.
 */
import { VirtualFileSystem } from './ProjectModel';
import { verifyProject } from './ProjectVerifier';
import { validateArchitecture } from './ArchitectureValidator';
import { selectArchitecture, type ArchitectureManifest } from './ArchitectureManifest';

export type GateStatus = 'pass' | 'fail' | 'pending';
export type GateSeverity = 'critical' | 'major' | 'minor';

export interface GateResult {
  id: string;
  name: string;
  status: GateStatus;
  severity: GateSeverity;
  /** Why it failed / what is pending — actionable. */
  messages: string[];
}

export interface ValidationReport {
  /** Preview is a privilege: true only when no critical gate FAILED. */
  previewAllowed: boolean;
  /** 0–100. Capped below 100 while infra-gated stages are pending (never faked). */
  qualityScore: number;
  gates: GateResult[];
  blockingReasons: string[];
  /** Human-readable status line. */
  status: 'PASSED' | 'FAILED' | 'PARTIAL';
}

/** Infra-gated stages that need a real Node+browser sandbox (reported, not faked). */
const PENDING_GATES: Array<{ id: string; name: string; severity: GateSeverity }> = [
  { id: 'build', name: 'Build Verification (npm install + build)', severity: 'critical' },
  { id: 'runtime', name: 'Runtime / Smoke Render (headless, console=0)', severity: 'critical' },
  { id: 'tests', name: 'Automated Tests (unit/integration/e2e)', severity: 'major' },
  { id: 'a11y', name: 'Accessibility (axe-core, WCAG AA)', severity: 'minor' },
  { id: 'perf', name: 'Performance (Lighthouse)', severity: 'minor' },
  { id: 'security', name: 'Security (npm audit / XSS / secrets)', severity: 'major' },
];

/**
 * Run the validation gates we can truly execute, plus an honest accounting of
 * the infra-pending ones. Pure (no side effects) → unit-testable.
 */
export function runValidation(vfs: VirtualFileSystem, manifest?: ArchitectureManifest): ValidationReport {
  const m = manifest ?? selectArchitecture('app');
  const gates: GateResult[] = [];

  // ── Gate: Architecture integrity (single framework, DOM mount, no mixing) ──
  const archIssues = validateArchitecture(vfs, m);
  gates.push({
    id: 'architecture',
    name: 'Architecture Integrity (single framework, DOM mount, no mixing)',
    status: archIssues.length === 0 ? 'pass' : 'fail',
    severity: 'critical',
    messages: archIssues.map((i) => `${i.file}: ${i.message}`),
  });

  // ── Gate: Static analysis (JSON, entry, refs, imports, declared deps) ──
  const verify = verifyProject(vfs);
  // Architecture issues are also surfaced by verifyProject; keep only non-arch here.
  const staticErrors = verify.issues.filter((i) => i.severity === 'error' && !/Mixed architecture|mount mismatch|module entry|Duplicate mount|React entry|Entry script/i.test(i.message));
  const staticWarnings = verify.issues.filter((i) => i.severity === 'warning');
  gates.push({
    id: 'static',
    name: 'Static Analysis (imports, dependencies, JSON, references)',
    status: staticErrors.length === 0 ? 'pass' : 'fail',
    severity: 'critical',
    messages: staticErrors.map((i) => `${i.file}: ${i.message}`),
  });
  if (staticWarnings.length) {
    gates.push({
      id: 'static-warnings',
      name: 'Static Warnings',
      status: 'fail',
      severity: 'minor',
      messages: staticWarnings.map((i) => `${i.file}: ${i.message}`),
    });
  }

  // ── Infra-gated stages: honest PENDING (never faked as pass) ──
  for (const g of PENDING_GATES) {
    gates.push({ id: g.id, name: g.name, status: 'pending', severity: g.severity, messages: ['Not run — requires the server-container/browser sandbox (infra pending).'] });
  }

  // ── Decision: preview blocked only by FAILED critical gates we can truly run.
  const criticalFails = gates.filter((g) => g.severity === 'critical' && g.status === 'fail');
  const previewAllowed = criticalFails.length === 0;
  const blockingReasons = criticalFails.flatMap((g) => g.messages.length ? g.messages : [g.name]);

  return {
    previewAllowed,
    qualityScore: scoreFrom(gates),
    gates,
    blockingReasons,
    status: criticalFails.length ? 'FAILED' : gates.some((g) => g.status === 'pending' || g.status === 'fail') ? 'PARTIAL' : 'PASSED',
  };
}

/**
 * Quality score. Per the spec, 100/100 requires build + runtime + tests +
 * lighthouse to PASS — so while those are pending the score is capped (honest),
 * and FAILED critical gates drive it down hard.
 */
function scoreFrom(gates: GateResult[]): number {
  let score = 100;
  for (const g of gates) {
    if (g.status === 'fail') {
      score -= g.severity === 'critical' ? 45 : g.severity === 'major' ? 20 : 6;
    } else if (g.status === 'pending') {
      // Cannot claim full quality without these — modest deduction each.
      score -= g.severity === 'critical' ? 8 : g.severity === 'major' ? 4 : 2;
    }
  }
  return Math.max(0, Math.min(100, score));
}

/** Render a structured, no-fake-success report card (Stage 25). */
export function renderReportCard(report: ValidationReport, manifest?: ArchitectureManifest): string {
  const icon = (s: GateStatus) => (s === 'pass' ? '✓' : s === 'fail' ? '✗' : '…');
  const lines: string[] = [];
  lines.push(`Build Status: ${report.status}`);
  if (manifest) lines.push(`Architecture: ${manifest.framework}${manifest.bundler !== 'none' ? ' + ' + manifest.bundler : ''}`);
  lines.push(`Quality Score: ${report.qualityScore}/100`);
  lines.push('');
  for (const g of report.gates) {
    lines.push(`${icon(g.status)} ${g.name}${g.status === 'pending' ? ' — PENDING (infra)' : ''}`);
    if (g.status === 'fail') for (const msg of g.messages.slice(0, 5)) lines.push(`    - ${msg}`);
  }
  if (!report.previewAllowed) {
    lines.push('');
    lines.push('Preview BLOCKED — fix the critical issues above, then rebuild.');
  }
  return lines.join('\n');
}
