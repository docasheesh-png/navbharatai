// AgentV3 — Dependency-Mutation Guard: never let a build DESTROY its own working dependency tree.
//
// THE REAL INCIDENT (build 5ed0424a, SaaS admin dashboard): the preview was LIVE (Vite v5, dev server
// up, PREVIEW_PUBLISHED). The agent then decided to "fix the vulnerabilities" and ran
// `npm audit fix --force`. That force-upgraded Vite v5 → v8 — a MAJOR breaking version — which crashed
// the running dev server ("conflict with the vite version"), KILLED the live preview, and cost ~7
// minutes of downgrade/--force fighting to recover. i.e. a working preview was destroyed by a
// self-inflicted, destructive dependency mutation mid-build.
//
// ROOT CAUSE (the class, not the instance): a build could run ANY dependency-tree mutation with no
// guard — `npm audit fix --force`, or pinning a core build tool (vite/react/typescript…) to a moving
// `@latest`/`@next` tag — either of which can cross a MAJOR version and break the running app. These
// apps run in an EPHEMERAL PREVIEW sandbox where npm-audit advisories are irrelevant, so the "fix" has
// zero upside and catastrophic downside.
//
// This guard is PURE + deterministic (mirrors ScaffoldGuard): given a shell command it returns a block
// (with an actionable redirect message) or null. The ToolDispatcher `bash` case runs it before the
// command reaches the sandbox, so the destructive command is never executed — the agent gets the
// message and continues building instead.

export interface DependencyMutationBlock {
  reason: string;
  kind: 'audit-fix' | 'core-moving-tag' | 'bulk-upgrade';
}

/** Core toolchain packages whose major version the whole build depends on — a cross-major bump breaks it. */
const CORE_TOOLS = [
  'vite',
  '@vitejs/plugin-react',
  '@vitejs/plugin-react-swc',
  'react',
  'react-dom',
  'typescript',
  'next',
  'vue',
  '@types/react',
  '@types/react-dom',
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// `npm|pnpm|yarn|bun audit fix --force` (or `-f`) ONLY. The `--force` flag is what makes `audit fix`
// DESTRUCTIVE — it applies fixes that require crossing a MAJOR version (this is what bumped Vite v5→v8).
// Plain `npm audit fix` WITHOUT --force stays within the declared semver ranges (safe) and is deliberately
// NOT blocked — only the destructive variant is (admin 2026-07-22: "only destructive command ko rokna chahiye").
const AUDIT_FIX_FORCE_RE = /\b(?:npm|pnpm|yarn|bun)\s+audit\s+fix\b[^\n;&|]*?(?:--force\b|-f\b)/i;

// Installing a CORE tool at a MOVING dist-tag (latest/next/canary/beta/rc) — resolves to an unpredictable,
// possibly-major version that breaks the scaffold's pinned baseline (e.g. `npm i vite@latest` → v8).
const MOVING_TAG = '(?:latest|next|canary|beta|rc|edge|experimental)';
const CORE_MOVING_TAG_RE = new RegExp(
  `\\b(?:npm\\s+(?:install|i|add)|pnpm\\s+(?:install|i|add)|yarn\\s+add|bun\\s+(?:install|add|i))\\b[^\\n;&|]*\\b(?:${CORE_TOOLS.map(escapeRe).join('|')})@${MOVING_TAG}\\b`,
  'i',
);

// BULK cross-major upgrades of the WHOLE tree — the same class as `audit fix --force`, just via a
// different tool. `npm-check-updates -u` / `ncu -u` rewrite package.json to every dep's LATEST major;
// `npm update --latest` (and yarn/pnpm equivalents) bump across majors too. All can silently jump the
// toolchain and break the running build.
const BULK_UPGRADE_RE = /\b(?:npm-check-updates|ncu)\b[^\n;&|]*(?:\s-u\b|--upgrade\b)|\b(?:npm|pnpm|yarn|bun)\s+(?:update|upgrade|up)\b[^\n;&|]*--latest\b/i;

/**
 * Classify a shell command for a destructive dependency mutation that must NOT run during a build.
 * Returns the block (with reason + kind) or null. PURE.
 */
export function dependencyMutationGuard(command: string): DependencyMutationBlock | null {
  const cmd = (command || '').trim();
  if (!cmd) return null;
  if (AUDIT_FIX_FORCE_RE.test(cmd)) {
    return {
      kind: 'audit-fix',
      reason: '`npm audit fix --force` upgrades dependencies ACROSS a MAJOR version (a real incident bumped Vite v5→v8) and crashes the running dev server, killing the live preview — plain `npm audit fix` (no --force) is fine and is allowed',
    };
  }
  if (CORE_MOVING_TAG_RE.test(cmd)) {
    return {
      kind: 'core-moving-tag',
      reason: 'installing a core build tool (vite/react/typescript…) at a moving tag like `@latest`/`@next` resolves to an unpredictable, possibly-major version that breaks the scaffold\'s pinned baseline and the running preview',
    };
  }
  if (BULK_UPGRADE_RE.test(cmd)) {
    return {
      kind: 'bulk-upgrade',
      reason: 'a bulk upgrade (`npm-check-updates -u`, `ncu -u`, `npm update --latest`) rewrites the whole dependency tree to latest majors — the same class of break as `audit fix --force`, and just as likely to jump the toolchain and crash the build',
    };
  }
  return null;
}

/** The actionable message returned to the agent when a dependency mutation is blocked. */
export function dependencyMutationGuardMessage(block: DependencyMutationBlock): string {
  return [
    `BLOCKED (dependency guard): ${block.reason}.`,
    '',
    'This app runs in an EPHEMERAL PREVIEW sandbox — a force/major dependency upgrade only breaks the working preview (zero upside, catastrophic downside). ONLY the destructive variant is blocked.',
    'Avoid: `npm audit fix --force`, `@latest`/`@next` on core tools (vite/react/typescript…), and bulk upgrades (`ncu -u`, `npm update --latest`). All of these can cross a MAJOR version and break the build.',
    'These ARE allowed: plain `npm audit fix` (no --force), installing a specific missing package (e.g. `npm install <pkg>`), and pinned versions (e.g. `vite@5.4.10`). Keep the scaffold\'s pinned versions and continue building.',
  ].join('\n');
}
