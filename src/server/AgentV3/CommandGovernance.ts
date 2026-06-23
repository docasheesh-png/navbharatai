// AgentV3 — Autonomous Governance: command-risk classification (Layer 58 v1).
//
// Before the build agent runs a shell command, this PURE, deterministic classifier
// flags operations that are irreversible, destructive, or dangerous (remote code
// execution, credential exfiltration). The dispatcher uses it to (a) annotate the
// command's result with an honest governance warning so the agent knows what it
// just did, and (b) write a decision-audit episode to project memory — an
// accountable trail of every risky action taken. It does NOT block execution on its
// own (hard gating stays with the existing human-approval system); it makes risky
// behaviour visible and auditable, which is the foundation governance must provide
// before any higher autonomy is enabled.
//
// Conservative by design: patterns target unambiguously risky commands so benign
// build/test/git commands are never flagged.

export type RiskLevel = 'high' | 'medium' | 'none';

export interface CommandRisk {
  level: RiskLevel;
  reasons: string[];
}

interface Rule {
  level: 'high' | 'medium';
  test: RegExp;
  reason: string;
}

// HIGH — irreversible damage, remote code execution, or secret exfiltration.
const HIGH_RULES: Rule[] = [
  { level: 'high', test: /\brm\s+(-[a-z]*\s+)*-[a-z]*[rf][a-z]*\b[^|&;]*\s(\/|~|\$HOME|\/\*|\.\s*$|\*\s*$)/i, reason: 'recursive delete of a root/home/wildcard path (irreversible)' },
  { level: 'high', test: /--no-preserve-root/i, reason: 'rm --no-preserve-root (removes the entire filesystem)' },
  { level: 'high', test: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, reason: 'fork bomb' },
  { level: 'high', test: /\b(mkfs|fdisk|dd)\b[^\n]*\b(of=)?\/dev\//i, reason: 'writes directly to a disk device (data loss)' },
  { level: 'high', test: />\s*\/dev\/sd[a-z]/i, reason: 'redirect to a raw disk device' },
  { level: 'high', test: /\b(curl|wget|fetch)\b[^\n|]*\|[^\n]*\b(sh|bash|zsh|python[0-9.]*|node)\b/i, reason: 'pipes downloaded content straight into a shell/interpreter (remote code execution)' },
  { level: 'high', test: /\b(printenv|env|cat)\b[^\n]*\|[^\n]*\b(curl|wget|nc|netcat)\b/i, reason: 'pipes environment/secrets to the network (exfiltration)' },
  { level: 'high', test: /\b(cat|cp|scp)\b[^\n]*(\.ssh\/|id_rsa|id_ed25519|\.aws\/credentials|\.netrc)/i, reason: 'reads/copies private keys or credentials' },
  { level: 'high', test: /\bchmod\s+(-[a-z]*\s+)*777\s+(\/|~|\$HOME)\b/i, reason: 'chmod 777 on a root/home path (insecure + dangerous)' },
  { level: 'high', test: /\bsudo\b/i, reason: 'runs with elevated privileges (sudo)' },
  { level: 'high', test: /\bgit\s+push\b[^\n]*(--force\b|\s-f\b)/i, reason: 'force-push rewrites remote history (can destroy others\' commits)' },
];

// MEDIUM — destructive or impactful but local/recoverable, or unexpected network use.
const MEDIUM_RULES: Rule[] = [
  { level: 'medium', test: /\brm\s+(-[a-z]*\s+)*-[a-z]*[rf][a-z]*\b/i, reason: 'recursive/forced delete (verify the path)' },
  { level: 'medium', test: /\bgit\s+reset\s+--hard\b/i, reason: 'git reset --hard discards uncommitted work' },
  { level: 'medium', test: /\bgit\s+clean\s+-[a-z]*f/i, reason: 'git clean -f deletes untracked files' },
  { level: 'medium', test: /\bnpm\s+(install|i)\b[^\n]*\s(-g|--global)\b/i, reason: 'global npm install (affects the whole environment)' },
  { level: 'medium', test: /\b(kill|pkill|killall)\b[^\n]*-9\b/i, reason: 'force-kills processes (-9)' },
  { level: 'medium', test: /\b(curl|wget)\b[^\n]*\bhttps?:\/\//i, reason: 'outbound network fetch to an external host' },
  { level: 'medium', test: /\btee\b[^\n]*\s\/(etc|usr|bin|boot|lib)\b|>\s*\/(etc|usr|bin|boot|lib)\//i, reason: 'writes into a system directory' },
];

/**
 * Classify a shell command's risk. Returns the highest level matched and the
 * concrete reasons. PURE & deterministic.
 */
export function classifyCommandRisk(command: string): CommandRisk {
  const cmd = (command || '').trim();
  if (!cmd) return { level: 'none', reasons: [] };

  const highReasons = HIGH_RULES.filter((r) => r.test.test(cmd)).map((r) => r.reason);
  if (highReasons.length) return { level: 'high', reasons: highReasons };

  const medReasons = MEDIUM_RULES.filter((r) => r.test.test(cmd)).map((r) => r.reason);
  if (medReasons.length) return { level: 'medium', reasons: medReasons };

  return { level: 'none', reasons: [] };
}

/** A short, honest governance advisory appended to a risky command's result. */
export function governanceNote(risk: CommandRisk): string {
  if (risk.level === 'none') return '';
  const label = risk.level === 'high' ? 'HIGH-risk' : 'medium-risk';
  return `⚠️ Governance: this command is ${label} — ${risk.reasons.join('; ')}. Recorded to the decision-audit trail.`;
}
