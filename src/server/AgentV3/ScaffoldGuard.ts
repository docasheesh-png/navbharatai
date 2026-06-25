// AgentV3 — deterministic guard against create-* project scaffolders.
//
// The build sandbox runs a FIXED, older Node.js. Modern project generators
// (`npm create vite`, `npx create-react-app`, `npm init <generator>`, etc.)
// require a newer Node and FAIL inside the sandbox. When that happens the build
// agent wastes turns and tends to improvise — e.g. hand-creating a nested
// `todo-app/` subdirectory and re-writing package.json from scratch — instead of
// using the Vite + React + TypeScript project that is ALREADY scaffolded at the
// workspace root.
//
// The system prompt already tells the agent not to run these generators, but a
// prompt is advisory — the model can still ignore it (and has). This module is
// the deterministic backstop: it detects such a command BEFORE it runs so the
// dispatcher can short-circuit it with a clear redirect to the existing scaffold
// instead of executing something we KNOW fails. PURE & deterministic (no I/O),
// so it is fully unit-testable.

export interface ScaffoldGuardResult {
  /** True when the command is a create-* generator that must not run. */
  blocked: boolean;
  /** Honest reason, present only when blocked. */
  reason?: string;
}

// Patterns for project generators that require a newer Node than the sandbox.
// Conservative by design — each targets an unambiguous scaffolder so ordinary
// build/test/install commands (npm install, npm run build, npm init -y) are
// never matched.
const SCAFFOLDER_PATTERNS: RegExp[] = [
  // `npm|pnpm|yarn|bun create <generator>` — e.g. `npm create vite@latest`.
  /\b(npm|pnpm|yarn|bun)\s+create\s+(?!-)\S/i,
  // `npm|pnpm|yarn|bun init <generator>` — a generator, NOT bare `npm init`
  // or `npm init -y` (the negative lookahead drops flag-only inits).
  /\b(npm|pnpm|yarn|bun)\s+init\s+(?!-)[A-Za-z@]/i,
  // `npx create-*` (optionally scoped, optionally with flags before the name),
  // e.g. `npx create-vite`, `npx -y create-next-app`, `npx @scope/create-foo`.
  /\bnpx\s+(?:--?\S+\s+)*(?:@[\w.-]+\/)?create-[\w.-]+/i,
  // Direct generator binary invocation by well-known name.
  /\bcreate-(vite|react-app|next-app|nuxt-app|svelte|remix|astro|expo-app|t3-app|qwik)\b/i,
];

/**
 * Classify whether a shell command is a create-* project generator that will
 * fail on the sandbox's fixed Node version. PURE & deterministic.
 */
export function scaffoldGuard(command: string): ScaffoldGuardResult {
  const cmd = (command || '').trim();
  if (!cmd) return { blocked: false };
  for (const re of SCAFFOLDER_PATTERNS) {
    if (re.test(cmd)) {
      return {
        blocked: true,
        reason:
          'create-* project generators (npm/yarn/pnpm/bun create, npx create-*, ' +
          'npm init <generator>) require a newer Node than this fixed-version ' +
          'sandbox and will FAIL.',
      };
    }
  }
  return { blocked: false };
}

/**
 * The redirect message returned in place of running a blocked generator. Tells
 * the agent the scaffold is already present at the workspace ROOT (never a
 * nested subdirectory) and to edit those files directly. PURE.
 */
export function scaffoldGuardMessage(reason: string, files: string[]): string {
  const scaffolded = files
    .filter((f) => !f.includes('node_modules/'))
    .slice(0, 40);
  const listing = scaffolded.length
    ? scaffolded.map((f) => `  - ${f}`).join('\n')
    : '  (root scaffold prepared: package.json, vite.config.ts, index.html, src/main.tsx, src/App.tsx)';
  return [
    `BLOCKED (scaffold guard): ${reason}`,
    '',
    'A Vite + React + TypeScript project is ALREADY scaffolded at the workspace',
    'ROOT. Do NOT scaffold and do NOT create a nested project subdirectory —',
    'edit/add files at the root with write_file and edit_file. Current files:',
    listing,
    '',
    'Next: open package.json and src/App.tsx, then build the requested app by',
    'editing these existing files. Run `npm install` and `npm run dev` as usual.',
  ].join('\n');
}
