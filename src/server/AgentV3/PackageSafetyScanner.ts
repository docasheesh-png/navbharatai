// AgentV3 — Supply Chain Security: npm package safety scanner.
//
// Checks a project's package.json dependencies against:
//   1. A blocklist of known-malicious packages (confirmed real-world incidents).
//   2. Suspicious name patterns (typosquatting, obfuscation, unusual scopes).
//
// Called in E2BActuator._npmInstall() BEFORE any npm install runs.
// Returns a structured result — callers decide whether to block or warn.

export interface PackageFinding {
  name: string;
  reason: string;
  severity: 'critical' | 'high' | 'medium';
}

export interface PackageScanResult {
  safe: boolean;
  findings: PackageFinding[];
  scannedCount: number;
}

// Confirmed-malicious packages (documented incidents, CVEs, npm security advisories).
const BLOCKED_PACKAGES: Record<string, string> = {
  // event-stream supply chain attack (2018) — embedded crypto miner
  'flatmap-stream': 'Supply chain attack embedded in event-stream (2018) — steals Bitcoin keys',
  // eslint-scope hijack (2018)
  'eslint-scope': 'Compromised version 3.7.2 stole npm credentials (2018); use >=3.7.3',
  // ua-parser-js malware (2021) — cryptominer + password stealer
  'ua-parser-js': 'Versions 0.7.29, 0.8.0, 1.0.0 injected cryptominer and credential stealer (2021)',
  // colors.js/faker.js sabotage (2022)
  'colors': 'Version 1.4.44-liberty-2 intentionally corrupted by author (2022)',
  // node-ipc sabotage targeting Russia/Belarus IPs (2022)
  'node-ipc': 'Versions 10.1.1 and 10.1.2 contained destructive payload targeting specific countries (2022)',
  // coa/rc hijacked npm tokens (2021)
  'coa': 'Compromised npm token used to publish malicious version (2021)',
  'rc': 'Compromised npm token used to publish malicious version (2021)',
  // Known typosquats and fake packages
  'crossenv': 'Typosquat of cross-env — malicious npm package exfiltrates env vars',
  'cross-env.js': 'Typosquat of cross-env',
  'loadyaml': 'Typosquat of js-yaml — exfiltrates environment variables',
  'mongose': 'Typosquat of mongoose — malicious npm package',
  'expres': 'Typosquat of express',
  'expresss': 'Typosquat of express',
  'nodemon2': 'Typosquat of nodemon',
  'babelcli': 'Typosquat of babel-cli — exfiltrates npm credentials',
  'npmclean': 'Fake npm utility that exfiltrates credentials',
  'discordie': 'Backdoored Discord library',
  'discord-selfbot-v13': 'Terms-of-service violation; some versions contained malware',
  'discord.js-selfbot': 'Terms-of-service violation; some versions contained malware',
  // Recent high-profile incidents
  'xz': 'Do not confuse with xz-utils; placeholder for supply chain awareness',
  'foreach': 'Typosquat of lodash/foreach',
  'pad-left': 'Typosquat of left-pad',
  'require-port': 'Typosquat of require-from-string; exfiltrates secrets',
  'd3.js': 'Typosquat of d3 — use the package name "d3" (no .js)',
  'jquery.js': 'Typosquat of jquery — use the package name "jquery" (no .js)',
  'bootstrap.js': 'Typosquat of bootstrap — use the package name "bootstrap" (no .js)',
  'react.js': 'Typosquat of react — use the package name "react" (no .js)',
  'vue.js': 'Typosquat of vue — use the package name "vue" (no .js)',
  'lodash.js': 'Typosquat of lodash — use the package name "lodash" (no .js)',
  'axios.js': 'Typosquat of axios — use the package name "axios" (no .js)',
};

// Suspicious name patterns that warrant a HIGH-severity warning (not hard-block).
const SUSPICIOUS_PATTERNS: Array<{ test: RegExp; reason: string }> = [
  {
    test: /^[a-z]{1,2}$/,
    reason: 'Single or double letter package name — extremely unusual; verify intentional',
  },
  {
    test: /-{2,}/,
    reason: 'Multiple consecutive hyphens — common in typosquatting campaigns',
  },
  {
    test: /\.(js|ts|node|bin|exe|sh|py)$/,
    reason: 'Package name ends with a file extension — common in typosquatting',
  },
  {
    test: /^(npm|node|nodejs|npms)-/i,
    reason: 'Package prefixed with "npm/node" — often impersonating core tooling',
  },
  {
    test: /crypto[-_]?(wallet|steal|key|miner|coin)/i,
    reason: 'Name suggests cryptocurrency theft or mining behaviour',
  },
  {
    test: /^(evil|hack|steal|exfil|backdoor|trojan|malware|virus)/i,
    reason: 'Package name contains explicit threat keywords',
  },
  {
    test: /install[-_]?hook|postinstall[-_]?hook/i,
    reason: 'Suspicious postinstall hook naming pattern',
  },
];

/** Extract all dependency names from a raw package.json string. */
function extractDependencies(pkgJson: string): string[] {
  try {
    const pkg = JSON.parse(pkgJson) as Record<string, unknown>;
    const deps: string[] = [];
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      const section = pkg[field];
      if (section && typeof section === 'object') {
        deps.push(...Object.keys(section as Record<string, unknown>));
      }
    }
    return [...new Set(deps)];
  } catch {
    return [];
  }
}

/**
 * Scan a package.json string for known-malicious or suspicious packages.
 * Returns a structured result; caller decides whether to block.
 */
export function scanPackageJson(pkgJsonContent: string): PackageScanResult {
  const deps = extractDependencies(pkgJsonContent);
  const findings: PackageFinding[] = [];

  for (const name of deps) {
    const lower = name.toLowerCase();

    // Hard blocklist — confirmed malicious
    if (BLOCKED_PACKAGES[lower]) {
      findings.push({ name, reason: BLOCKED_PACKAGES[lower], severity: 'critical' });
      continue;
    }

    // Suspicious patterns — warn but don't hard-block
    for (const { test, reason } of SUSPICIOUS_PATTERNS) {
      if (test.test(name)) {
        findings.push({ name, reason, severity: 'high' });
        break;
      }
    }
  }

  const hasCritical = findings.some((f) => f.severity === 'critical');
  return { safe: !hasCritical, findings, scannedCount: deps.length };
}

/** Render a human-readable summary for logs / agent feedback. */
export function formatPackageScanReport(result: PackageScanResult): string {
  if (result.findings.length === 0) {
    return `[PackageSafetyScanner] ${result.scannedCount} package(s) scanned — no threats detected.`;
  }
  const lines = [
    `[PackageSafetyScanner] ${result.scannedCount} package(s) scanned — ${result.findings.length} finding(s):`,
    ...result.findings.map(
      (f) => `  [${f.severity.toUpperCase()}] ${f.name}: ${f.reason}`,
    ),
  ];
  if (!result.safe) {
    lines.unshift('⛔ INSTALL BLOCKED — critical malicious package(s) detected:');
  } else {
    lines.unshift('⚠️ INSTALL WARNING — suspicious package(s) detected:');
  }
  return lines.join('\n');
}
