// AgentV3 — Code Safety Scanner: scan AI-generated JS/TS for malicious patterns.
//
// Called inside the onFileWrite callback for every .js/.ts/.jsx/.tsx file the
// agent writes to disk. Detects common malware/exfiltration patterns that a
// compromised AI model (or injected prompt) might try to embed in user code.
//
// Philosophy: flag suspicious code constructs BEFORE they are executed.
// False positives are acceptable (warn and let the user decide); false negatives
// in a CRITICAL category are not (block the write).
//
// Categories:
//   CRITICAL  — nearly no legitimate use; always block (eval injection, remote-exec pipe)
//   HIGH      — suspicious; surface as security warning but allow
//   MEDIUM    — unusual; note in log, don't surface to user UI

export type CodeFindingSeverity = 'critical' | 'high' | 'medium';

export interface CodeScanFinding {
  severity: CodeFindingSeverity;
  rule: string;
  description: string;
  matchSnippet: string;
  line: number;
}

export interface CodeScanResult {
  safe: boolean;     // false when ANY critical finding exists
  findings: CodeScanFinding[];
  filePath: string;
}

interface CodeRule {
  severity: CodeFindingSeverity;
  id: string;
  description: string;
  test: RegExp;
}

const CODE_RULES: CodeRule[] = [
  // ── CRITICAL: remote code execution ──────────────────────────────────────
  {
    severity: 'critical',
    id: 'EVAL_CALL',
    description: 'Direct eval() call — executes arbitrary code at runtime',
    test: /\beval\s*\(/,
  },
  {
    severity: 'critical',
    id: 'NEW_FUNCTION',
    description: 'new Function() constructor — executes arbitrary code string',
    test: /\bnew\s+Function\s*\(/,
  },
  {
    severity: 'critical',
    id: 'BASE64_EVAL',
    description: 'Base64 decode then eval — classic obfuscation for hidden payloads',
    test: /atob\s*\([^)]+\)\s*[,;]?\s*(eval|new\s+Function)\b|\bBuffer\.from\([^)]+,\s*['"]base64['"]\)[^;]*eval/,
  },
  {
    severity: 'critical',
    id: 'CURL_PIPE_SHELL',
    description: 'curl/wget piped to shell inside exec/execSync — remote code execution',
    test: /exec(?:Sync)?\s*\(\s*['"`][^'"`]*(curl|wget)[^'"`]*\|\s*(sh|bash|node|python)/i,
  },
  {
    severity: 'critical',
    id: 'DYNAMIC_REQUIRE_HTTP',
    description: 'require() with an HTTP URL — fetches and executes remote code',
    test: /require\s*\(\s*['"`]https?:\/\//i,
  },
  {
    severity: 'critical',
    id: 'SCRIPT_SRC_EXTERNAL',
    description: 'Dynamically injected <script> tag pointing to an external non-CDN domain',
    test: /document\.createElement\s*\(\s*['"`]script['"`]\s*\)[^;]*\.src\s*=\s*['"`]https?:\/\/(?!cdn\.|unpkg\.com|jsdelivr\.net|cdnjs\.cloudflare\.com)/i,
  },

  // ── HIGH: credential/secret exfiltration ─────────────────────────────────
  {
    severity: 'high',
    id: 'PROCESS_ENV_FETCH',
    description: 'process.env values sent via fetch/axios to an external URL (possible exfiltration)',
    test: /fetch\s*\([^)]*process\.env|axios\.[a-z]+\([^)]*process\.env/i,
  },
  {
    severity: 'high',
    id: 'ENV_CHILD_PROCESS',
    description: 'Environment variables passed through exec/spawn with network tool (curl/wget)',
    test: /exec(?:Sync|File)?\s*\([^)]*process\.env[^)]*\b(curl|wget|nc|ncat)\b/i,
  },
  {
    severity: 'high',
    id: 'FETCH_RAW_IP',
    description: 'fetch() call to a raw IP address (instead of hostname) — unusual for legitimate code',
    test: /fetch\s*\(\s*['"`]https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/i,
  },
  {
    severity: 'high',
    id: 'HIDDEN_CRYPTO_WALLET',
    description: 'Cryptocurrency wallet address or seed phrase patterns in code',
    test: /(['"`])(0x[a-fA-F0-9]{40}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-z0-9]{39,59})\1/,
  },
  {
    severity: 'high',
    id: 'SSH_KEY_WRITE',
    description: 'Writing content to .ssh/authorized_keys or private key files',
    test: /writeFile(?:Sync)?\s*\([^)]*\.(ssh\/authorized_keys|ssh\/id_rsa|pem|key)\b/i,
  },
  {
    severity: 'high',
    id: 'EXECSYNC_NETWORK',
    description: 'execSync with network exfiltration commands (curl/wget/nc/ncat)',
    test: /exec(?:Sync)?\s*\(\s*['"`][^'"`]*(curl|wget|nc\s|ncat\s|netcat)\b/i,
  },
  {
    severity: 'high',
    id: 'PROTOTYPE_POLLUTION',
    description: 'Direct __proto__ or prototype assignment — potential prototype pollution',
    test: /(\.__proto__\s*=|\['__proto__'\]\s*=|Object\.prototype\.[a-z_$][\w$]*\s*=)/i,
  },

  // ── MEDIUM: unusual patterns worth noting ─────────────────────────────────
  {
    severity: 'medium',
    id: 'PROCESS_EXIT_UNCAUGHT',
    description: 'process.exit() called outside of CLI/test context — can crash a server unexpectedly',
    test: /\bprocess\.exit\s*\(/,
  },
  {
    severity: 'medium',
    id: 'OBFUSCATED_HEX_STRING',
    description: 'Long hex-encoded string — may indicate obfuscated payload',
    test: /['"`]([0-9a-fA-F]{80,})['"`]/,
  },
  {
    severity: 'medium',
    id: 'GLOBAL_FETCH_ALL_COOKIES',
    description: 'document.cookie sent via network call — may leak session cookies',
    test: /fetch\s*\([^)]*document\.cookie|axios\.[a-z]+\([^)]*document\.cookie/i,
  },
];

// Only scan these file extensions (not markdown, config, images, etc.)
const SCANNABLE_EXTENSIONS = new Set(['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs']);

function extOf(filePath: string): string {
  const dot = filePath.lastIndexOf('.');
  return dot >= 0 ? filePath.slice(dot).toLowerCase() : '';
}

/**
 * Scan a single AI-generated file for malicious code patterns.
 * Returns a structured result; caller decides whether to block the write.
 */
export function scanGeneratedCode(filePath: string, content: string): CodeScanResult {
  if (!SCANNABLE_EXTENSIONS.has(extOf(filePath))) {
    return { safe: true, findings: [], filePath };
  }

  const lines = content.split('\n');
  const findings: CodeScanFinding[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comment-only lines (single-line comments) to reduce false positives in
    // documentation that mentions dangerous APIs without calling them.
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

    for (const rule of CODE_RULES) {
      if (rule.test.test(line)) {
        findings.push({
          severity: rule.severity,
          rule: rule.id,
          description: rule.description,
          matchSnippet: line.trim().slice(0, 120),
          line: i + 1,
        });
      }
    }
  }

  // Deduplicate same rule triggered multiple times (keep first occurrence only)
  const seen = new Set<string>();
  const deduped = findings.filter((f) => {
    const key = f.rule;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const hasCritical = deduped.some((f) => f.severity === 'critical');
  return { safe: !hasCritical, findings: deduped, filePath };
}

/** Render a human-readable summary for logs / agent feedback. */
export function formatCodeScanReport(result: CodeScanResult): string {
  if (result.findings.length === 0) return '';
  const header = result.safe
    ? `⚠️ [CodeSafetyScanner] ${result.filePath} — ${result.findings.length} warning(s):`
    : `⛔ [CodeSafetyScanner] ${result.filePath} — BLOCKED (critical pattern detected):`;
  const lines = [
    header,
    ...result.findings.map(
      (f) => `  [${f.severity.toUpperCase()}] Line ${f.line} — ${f.rule}: ${f.description}\n    → ${f.matchSnippet}`,
    ),
  ];
  return lines.join('\n');
}
