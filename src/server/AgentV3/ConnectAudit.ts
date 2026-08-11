// MASTER IMPORT, part 4 — the first thirty seconds after a project connects.
//
// THE IDEA (admin, 2026-08-04, "koi out of box sujhao jo hamko next level par le jaye"). Parts 1-3 made
// getting a project IN fast. That is plumbing, and plumbing is not a reason to choose us: every builder
// can list files after an import. What none of them do is tell you something about your own app that
// you did not already know, for free, before you have spent anything.
//
// So connecting is not the product — the moment RIGHT AFTER connecting is. A user who imports 2,460
// files and immediately reads "3 imports point at files that do not exist, 14 components are never
// rendered, and 2 front-end files import server-only modules" has a reason to have brought their app
// here rather than anywhere else. And the next thing they say is "fix it" — which is the first build.
//
// EVERYTHING HERE IS DETERMINISTIC AND FREE. Not one model call: the findings come from the analyzers
// this repo already has (`analyzeArchitecture`, `findUnwiredFiles`), which are conservative by design —
// they exclude entries, tests, configs, type declarations, stories and file-based routes precisely so a
// reported item is very likely real. That conservatism is the whole reason this can be shown
// unprompted: an audit that cries wolf on a freshly imported project would destroy trust in one screen,
// which is far worse than saying nothing.
//
// THE HONESTY LINE. This reports what the analysis FOUND, never a grade. There is no score, no "your
// app is 40% slower", no claim about anything not measured here — those would be invented authority.
// A clean project gets a short, honest "nothing to flag", not manufactured concern to look useful.

import { analyzeArchitecture, type ArchitectureReport } from './ArchitectureAnalysis';
import { findUnwiredFiles } from './deadCode';
import type { ProjectGraph } from './WorkspaceMemory';

export interface ConnectAuditFinding {
  /** Stable id so the UI (or a later fix pass) can address one finding. */
  kind: 'brokenImport' | 'orphanComponent' | 'unwiredFile' | 'serverInFrontend' | 'importCycle';
  /** How many instances were found. */
  count: number;
  /** One line in the user's terms — what it means, not what the analyzer calls it. */
  headline: string;
  /** Up to a few concrete examples, so the finding is checkable rather than a claim. */
  examples: string[];
  /** TRUE when this is something the engine can genuinely repair on request. */
  fixable: boolean;
}

export interface ConnectAudit {
  fileCount: number;
  findings: ConnectAuditFinding[];
  /** The message shown to the user. '' when there is genuinely nothing worth saying. */
  message: string;
}

/** At most this many examples per finding — enough to verify, not enough to become a wall of text. */
const MAX_EXAMPLES = 3;

function take(list: readonly string[], n = MAX_EXAMPLES): string[] {
  return list.slice(0, n);
}

/**
 * Turn the existing analyzers' output into findings a non-technical owner can act on. PURE.
 *
 * Ordered by how much the user is likely to care: things that are actually BROKEN first, then things
 * that are merely unused. A cycle is last because it is real but rarely urgent.
 */
export function buildConnectAudit(report: ArchitectureReport, unwired: readonly string[]): ConnectAudit {
  const findings: ConnectAuditFinding[] = [];

  if (report.unresolvedImports.length > 0) {
    findings.push({
      kind: 'brokenImport',
      count: report.unresolvedImports.length,
      headline: `${report.unresolvedImports.length} import(s) point at a file that does not exist — these break the app at build or run time.`,
      examples: take(report.unresolvedImports),
      fixable: true,
    });
  }

  if (report.nodeBuiltinsInFrontend.length > 0) {
    findings.push({
      kind: 'serverInFrontend',
      count: report.nodeBuiltinsInFrontend.length,
      headline: `${report.nodeBuiltinsInFrontend.length} front-end file(s) import something that only works on a server — this crashes in the browser.`,
      examples: take(report.nodeBuiltinsInFrontend),
      fixable: true,
    });
  }

  if (report.orphanComponents.length > 0) {
    findings.push({
      kind: 'orphanComponent',
      count: report.orphanComponents.length,
      headline: `${report.orphanComponents.length} screen(s)/component(s) exist but nothing ever shows them — built, but unreachable in the app.`,
      examples: take(report.orphanComponents),
      fixable: true,
    });
  }

  if (unwired.length > 0) {
    findings.push({
      kind: 'unwiredFile',
      count: unwired.length,
      headline: `${unwired.length} file(s) are never imported by anything — likely leftovers you can delete.`,
      examples: take(unwired),
      fixable: false, // deleting someone's files unasked is not ours to decide
    });
  }

  if (report.cycles.length > 0) {
    findings.push({
      kind: 'importCycle',
      count: report.cycles.length,
      headline: `${report.cycles.length} circular import chain(s) — these make the app fragile to change and can break the build order.`,
      examples: take(report.cycles.map((c) => c.join(' → '))),
      fixable: true,
    });
  }

  return { fileCount: report.fileCount, findings, message: auditMessage(report.fileCount, findings) };
}

/**
 * The message the user actually reads.
 *
 * A clean project gets a SHORT honest line, never manufactured concern — an audit that invents problems
 * to look useful is worse than one that stays quiet, because the next real finding will not be believed.
 */
export function auditMessage(fileCount: number, findings: readonly ConnectAuditFinding[]): string {
  if (fileCount <= 0) return '';
  if (findings.length === 0) {
    return `🔍 I read all ${fileCount.toLocaleString()} files — nothing broken to flag. Tell me what you want to change.`;
  }
  const lines: string[] = [`🔍 I read all ${fileCount.toLocaleString()} files of your app. Here is what I found:`, ''];
  for (const f of findings) {
    lines.push(`• ${f.headline}`);
    if (f.examples.length > 0) lines.push(`   e.g. ${f.examples.join(' · ')}`);
  }
  const fixable = findings.filter((f) => f.fixable);
  lines.push('');
  lines.push(fixable.length > 0
    // Only offer what we can genuinely do. Offering to "fix" the unused-file finding would mean deleting
    // someone's files on a guess — so that one is reported and deliberately not offered.
    ? 'Say “fix these” and I will repair the ones I can.'
    : 'Nothing here is broken — these are cleanup notes, not errors.');
  return lines.join('\n');
}

/**
 * Run the audit over an indexed project. Thin by design: the analysis is the existing analyzers', and
 * this only decides what is worth saying.
 */
export function auditConnectedProject(graph: ProjectGraph): ConnectAudit {
  return buildConnectAudit(analyzeArchitecture(graph), findUnwiredFiles(graph));
}
