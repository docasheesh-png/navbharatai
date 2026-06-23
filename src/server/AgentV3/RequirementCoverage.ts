// AgentV3 — Product Understanding: requirement coverage (Phase 10 v1).
//
// The #1 rule is "real features only — nothing half-done". A build can pass every
// technical gate (compiles, no security issues) and STILL have silently skipped a
// feature the user explicitly asked for. This PURE, deterministic analyser compares
// the user's original request against what was actually built (the project graph's
// components, routes and file names — names only, never file bodies) and flags any
// clearly-named feature that was requested but has no matching surface.
//
// Advisory, high-precision and conservative: it only knows a curated set of common,
// high-signal app surfaces (login, dashboard, cart, …), only fires when such a
// surface is named in the request, and is silent before anything is built — so it
// never nags a solid build and never invents requirements.

import type { ProjectGraph } from './WorkspaceMemory';

export interface RequirementFinding {
  level: 'medium';
  feature: string;
  message: string;
}

export interface RequirementCoverageReport {
  /** Feature labels detected in the request. */
  requested: string[];
  /** Requested features with a matching component/route/file. */
  covered: string[];
  /** Requested features with no matching surface. */
  missing: string[];
  findings: RequirementFinding[];
}

interface FeatureSpec {
  label: string;
  /** Fires when the user's request mentions this feature. */
  request: RegExp;
  /** Matches a built component/route/file name that satisfies it. */
  artifact: RegExp;
}

// Curated, high-signal app surfaces only. Each `artifact` is deliberately broad
// (synonyms) so a feature built under a reasonable alternate name still counts.
const FEATURES: FeatureSpec[] = [
  { label: 'login / authentication', request: /\b(login|log ?in|sign ?in|authentication|auth)\b/i, artifact: /(login|signin|sign-in|auth)/i },
  { label: 'sign-up / registration', request: /\b(sign ?up|register|registration|create account)\b/i, artifact: /(signup|sign-up|register)/i },
  { label: 'dashboard', request: /\bdashboard\b/i, artifact: /dashboard/i },
  { label: 'user profile', request: /\bprofile\b/i, artifact: /profile/i },
  { label: 'settings', request: /\bsettings\b/i, artifact: /settings/i },
  { label: 'search', request: /\bsearch\b/i, artifact: /search/i },
  { label: 'shopping cart', request: /\b(cart|basket)\b/i, artifact: /(cart|basket)/i },
  { label: 'checkout', request: /\bcheckout\b/i, artifact: /checkout/i },
  { label: 'payment', request: /\b(payment|payments|billing)\b/i, artifact: /(payment|pay|billing|checkout)/i },
  { label: 'admin panel', request: /\badmin\b/i, artifact: /admin/i },
  { label: 'chat / messaging', request: /\b(chat|messaging|messages)\b/i, artifact: /(chat|message|messaging|conversation)/i },
  { label: 'notifications', request: /\bnotification/i, artifact: /notification/i },
  { label: 'contact page', request: /\bcontact\b/i, artifact: /contact/i },
  { label: 'about page', request: /\babout\b/i, artifact: /about/i },
];

/**
 * Compare the user's request against what was built. PURE & deterministic.
 * Silent (empty report) when there is no request or nothing has been built yet.
 */
export function analyzeRequirementCoverage(
  request: string,
  graph: ProjectGraph,
): RequirementCoverageReport {
  const empty: RequirementCoverageReport = { requested: [], covered: [], missing: [], findings: [] };
  const req = (request || '').toString();
  const files = Array.isArray(graph?.files) ? graph.files : [];
  const components = Array.isArray(graph?.components) ? graph.components : [];
  const routes = Array.isArray(graph?.routes) ? graph.routes : [];

  // Nothing requested, or nothing built yet → nothing to check; stay silent.
  if (!req.trim() || (files.length === 0 && components.length === 0 && routes.length === 0)) {
    return empty;
  }

  // Searchable surface of what was built — names only, never file contents.
  const surface = [...components, ...routes, ...files.map((f) => f.split('/').pop() || f)].join('\n');

  const requested: string[] = [];
  const covered: string[] = [];
  const missing: string[] = [];
  for (const feat of FEATURES) {
    if (!feat.request.test(req)) continue;
    requested.push(feat.label);
    if (feat.artifact.test(surface)) covered.push(feat.label);
    else missing.push(feat.label);
  }

  const findings: RequirementFinding[] = missing.slice(0, 5).map((feature) => ({
    level: 'medium' as const,
    feature,
    message: `Requested "${feature}" but no matching page/component was found — confirm it was actually built (or built under another name).`,
  }));

  return { requested, covered, missing, findings };
}

/** A short, honest requirement-coverage block for the `evaluate` output. */
export function requirementCoverageSummary(report: RequirementCoverageReport): string {
  const { requested, missing, findings } = report;
  if (requested.length === 0) {
    return 'Requirement coverage: — (no specific named features detected in the request).';
  }
  if (findings.length === 0) {
    return `Requirement coverage: ✓ all ${requested.length} detected feature(s) have a matching page/component.`;
  }
  const head = `Requirement coverage — ${missing.length} requested feature(s) not found in the build:`;
  const body = findings.map((f) => `  ⚠ ${f.message}`);
  return [head, ...body].join('\n');
}
