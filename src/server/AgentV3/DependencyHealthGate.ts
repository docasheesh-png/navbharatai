// AgentV3 — Build-end dependency-health gate (P-PIPE).
//
// The on-demand `scan_vulnerabilities` (OSV/CVE) and `check_licenses` (strong-copyleft) tools already exist;
// this is the deterministic composition that runs BOTH at build-end and produces one honest advisory block
// for the build summary. It is ADVISORY-ONLY: it never blocks or fails a build (a transitive CVE or a GPL
// dependency in a generated app must not break an otherwise-working app — the one absolute rule). It only
// surfaces what was found so the agent/admin can act.
//
// This pure verdict function is the unit-tested core (parity with `lintGateVerdict`). The network/file glue
// that actually reads the workspace and calls OSV lives in ToolDispatcher.assessDependencyHealthGate and is
// best-effort + timeout-bounded, so a slow/unreachable scan degrades to an empty (clean) advisory rather
// than ever failing a real build.

export interface DependencyHealthInputs {
  /** Number of vulnerable dependencies found by the CVE scan (0 when clean, unavailable, or not scanned). */
  vulnFindings: number;
  /** Human summary from `vulnScanSummary(result)` — only surfaced when `vulnFindings > 0`. */
  vulnSummary: string;
  /** Number of strong-copyleft (GPL/AGPL) dependencies found by the license check. */
  copyleftStrong: number;
  /** Human summary from `licenseAdvisorySummary(analysis)` — only surfaced when `copyleftStrong > 0`. */
  licenseSummary: string;
}

export interface DependencyHealthVerdict {
  /** True when there is at least one CVE finding or strong-copyleft dependency to report. */
  hasFindings: boolean;
  /** The advisory block for the build summary — '' when clean (nothing is appended). */
  summary: string;
}

/**
 * Compose the two dependency-health signals into a single advisory block. Deterministic and pure — no I/O.
 * Returns an empty summary (and hasFindings=false) when both signals are clean, so the caller appends
 * nothing to a healthy build's summary.
 */
export function dependencyHealthVerdict(inputs: DependencyHealthInputs): DependencyHealthVerdict {
  const parts: string[] = [];

  if (inputs.vulnFindings > 0 && inputs.vulnSummary.trim()) {
    parts.push(inputs.vulnSummary.trim());
  }
  if (inputs.copyleftStrong > 0 && inputs.licenseSummary.trim()) {
    parts.push(inputs.licenseSummary.trim());
  }

  if (parts.length === 0) {
    return { hasFindings: false, summary: '' };
  }

  const header =
    `🔎 Dependency-health check (advisory — does not block): ` +
    [
      inputs.vulnFindings > 0 ? `${inputs.vulnFindings} vulnerable dep(s)` : null,
      inputs.copyleftStrong > 0 ? `${inputs.copyleftStrong} strong-copyleft dep(s)` : null,
    ]
      .filter(Boolean)
      .join(', ') +
    '.';

  return { hasFindings: true, summary: [header, ...parts].join('\n\n') };
}
