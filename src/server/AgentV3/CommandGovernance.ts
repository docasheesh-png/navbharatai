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
  // SECURITY Phase 2.4 — a BARE env dump (`printenv`, `env` as a standalone command, optionally piped/
  // redirected) exposes EVERY server secret (ANTHROPIC_API_KEY, SECRET_ENCRYPTION_KEY, …) into the
  // command output → the build report, transcript and model context. Blocked. Note the negative
  // lookahead: `env FOO=bar cmd` (env used to SET a var for a real command) is NOT a dump and stays
  // allowed — only `env`/`printenv` with no command after it matches.
  { level: 'high', test: /(^|[;&|]\s*)(printenv|env)\s*($|[|;&>])/i, reason: 'dumps all environment variables (exposes every server secret)' },
  // Reading a dotenv file (`.env`, `.env.local`, …) with any text tool leaks its secrets the same way.
  { level: 'high', test: /\b(cat|less|more|head|tail|nl|xxd|od|strings|grep|awk|sed)\b[^\n|]*(^|[\s/'"=])\.env(\.[A-Za-z0-9_.-]+)?\b/i, reason: 'reads a .env secrets file (exposes stored keys)' },
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

// Source directories that hold GENERATED APP CODE. Recursively deleting one during a build destroys
// the app's own work. Real failure (deep-test "PaisaTrack", 2026-07-15): to "fix" two trivial tsc
// errors (an unused import + a type cast), the builder ran `rm -rf src/components src/hooks src/types
// src/utils`, wiping the feature components → the delivered app had orphaned/missing features (Add,
// Delete, Filter, List had no control) yet still shipped as a glowing success. The correct action was
// to fix the two specific errors in-file. This guard makes that class of self-destruction impossible.
const SOURCE_DIR_RE =
  /^(src|app|components|pages|hooks|lib|utils|util|types|type|features|feature|store|stores|context|contexts|services|service|api|routes|styles|assets|models|state|store|containers|views|layouts|widgets)$/i;
// Regenerable / recoverable targets that are ALWAYS safe to delete recursively.
const SAFE_DELETE_RE =
  /^(node_modules|dist|build|out|coverage|\.next|\.nuxt|\.svelte-kit|\.vite|\.cache|\.turbo|\.parcel-cache|tmp|\.tmp|logs|\.expo)$/i;
// Script/component file extensions — deleting MANY of these in one command is the destructive-consolidation
// signature (the builder wiping its own module set to restructure), NOT ordinary boilerplate cleanup (which
// removes .css/.svg/.json assets, never a batch of components). Deliberately excludes .css/.svg/.json/etc.
const SOURCE_CODE_EXT_RE = /\.(tsx?|jsx?|mjs|cjs|vue|svelte|astro)$/i;
// Deleting this many source-code FILES in a single `rm` is treated as a bulk source wipe, not stale-file
// cleanup. One or two genuinely-stale files stay allowed (the message tells the agent to do exactly that).
const BULK_SOURCE_DELETE_THRESHOLD = 3;

/** Does a normalized path live in a source location (a `src/`-rooted path, or a bare source-dir segment)? */
function isUnderSourceLocation(norm: string): boolean {
  const parts = norm.split('/');
  if (parts[0].toLowerCase() === 'src') return true;
  return parts.some((p) => SOURCE_DIR_RE.test(p));
}

/** Strip quotes and a trailing slash from a raw shell arg; return '' for a pure flag/empty. */
function cleanPathArg(rawArg: string): string {
  if (rawArg.startsWith('-')) return '';
  return rawArg.replace(/^['"]|['"]$/g, '').replace(/\/+$/, '');
}

/**
 * Detect a build-agent command that DESTROYS generated app source, and return the first offending
 * target, or null. Pure & deterministic. Covers THREE sibling self-destruction patterns proven in
 * real deep-test failures — each is a different command that produces the same catastrophe (the app's
 * own module tree deleted mid-build → broken imports → build fails / features vanish):
 *
 *   1. `rm -r…` (recursive) of a source DIRECTORY   — "PaisaTrack" (2026-07-15): `rm -rf src/components …`.
 *   2. `rmdir` of a source DIRECTORY                — "StudySync"  (2026-07-16): `rmdir src/components src/hooks src/utils`.
 *   3. bulk `rm` of ≥3 source-code FILES at once    — "StudySync"  (2026-07-16): `rm src/components/CardEditor.tsx CardList.tsx Dashboard.tsx …`.
 *
 * Precise by construction so it never blocks legitimate cleanup: recursive-dir deletion still requires a
 * recursive flag; single/stale-file deletion (1–2 files) stays allowed; regenerable targets
 * (node_modules/dist/.vite/…) are always allowed; boilerplate asset cleanup (.css/.svg/.json) never counts
 * toward the bulk threshold. Handles chained commands (`rm … && rmdir …`) by scanning each shell segment.
 */
export function destructiveSourceDeletionTarget(command: string): string | null {
  const segments = (command || '').split(/[;&|\n]+/);
  for (const seg of segments) {
    const s = seg.trim();

    // Pattern 2 — `rmdir <source dir> …`. rmdir ONLY removes directories, so any source-dir arg is a
    // deliberate module-tree teardown; no recursive flag to check. Regenerable dirs stay allowed.
    const rmdirMatch = /^rmdir\s+(.+)$/i.exec(s);
    if (rmdirMatch) {
      for (const rawArg of rmdirMatch[1].trim().split(/\s+/)) {
        const path = cleanPathArg(rawArg);
        if (!path) continue;
        const norm = path.replace(/^\.\//, '');
        const parts = norm.split('/');
        if (parts.some((p) => SAFE_DELETE_RE.test(p))) continue;
        if (SOURCE_DIR_RE.test(norm) || (parts.length === 2 && parts[0].toLowerCase() === 'src')) {
          return path;
        }
      }
      continue;
    }

    const m = /^rm\s+(.+)$/i.exec(s);
    if (!m) continue;
    const args = m[1].trim().split(/\s+/);
    const hasRecursive = args.some((a) => /^-[a-z]*[rR]/.test(a));

    // Pattern 1 — recursive delete of a source DIRECTORY.
    if (hasRecursive) {
      for (const rawArg of args) {
        const path = cleanPathArg(rawArg);
        if (!path) continue;
        // A bare `.` or `*` at the workspace root wipes the whole project — always block.
        if (path === '.' || path === './' || path === '*' || path === './*') return path;
        const norm = path.replace(/^\.\//, '');
        const parts = norm.split('/');
        const last = parts[parts.length - 1];
        if (/\.[a-z0-9]+$/i.test(last)) continue; // looks like a single file (has an extension) — allowed
        if (parts.some((p) => SAFE_DELETE_RE.test(p))) continue; // node_modules/dist/… — allowed
        // A source dir at the root (`src`, `components`) OR nested directly under src (`src/components`).
        if (SOURCE_DIR_RE.test(norm) || (parts.length === 2 && parts[0].toLowerCase() === 'src')) {
          return path;
        }
      }
    }

    // Pattern 3 — bulk delete of many source-code FILES in a single rm (recursive flag or not). Deleting
    // 3+ .ts/.tsx/.js/… files under a source location in one shot is the "wipe my own module set" signature,
    // not stale-file cleanup. Assets (.css/.svg/.json) and non-source paths don't count toward the threshold.
    const sourceFileArgs: string[] = [];
    for (const rawArg of args) {
      const path = cleanPathArg(rawArg);
      if (!path) continue;
      const norm = path.replace(/^\.\//, '');
      if (SOURCE_CODE_EXT_RE.test(norm) && isUnderSourceLocation(norm)) sourceFileArgs.push(path);
    }
    if (sourceFileArgs.length >= BULK_SOURCE_DELETE_THRESHOLD) return sourceFileArgs[0];
  }
  return null;
}

/** The honest, actionable refusal shown to the build agent when it tries to destroy generated app source. */
export function destructiveSourceDeletionMessage(target: string): string {
  return (
    `[GOVERNANCE BLOCKED] Refused to bulk-delete generated app source ("${target}") — deleting a source ` +
    `directory (via \`rm -r\` or \`rmdir\`) or a batch of source files almost always destroys working ` +
    `features and leaves broken imports (a known build-killing failure mode). Do NOT delete or restructure ` +
    `source to fix a compile/import error. Instead, FIX the specific error in the file it reports — e.g. add ` +
    `the missing export, correct the import path, remove the unused import — and re-run the check. If ONE ` +
    `file is genuinely stale, delete just that single file by name.`
  );
}

/** A short, honest governance advisory appended to a risky command's result. */
export function governanceNote(risk: CommandRisk): string {
  if (risk.level === 'none') return '';
  const label = risk.level === 'high' ? 'HIGH-risk' : 'medium-risk';
  return `⚠️ Governance: this command is ${label} — ${risk.reasons.join('; ')}. Recorded to the decision-audit trail.`;
}
