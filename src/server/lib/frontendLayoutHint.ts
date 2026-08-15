// FRONTEND LAYOUT HINT — tell the builder up front WHERE a project's frontend source actually lives, so it
// stops guessing a top-level `src/` on a fullstack app whose frontend is under `client/src/` (admin
// 2026-08-15, real report: the agent tried to read/write `src/App.tsx` and `src/index.css` when they were
// at `client/src/…`, burning steps on TOOL_ERRORs before the "did you mean client/src/…?" hint corrected it).
//
// Deterministic + pure. Returns a short instruction to prepend to the build prompt, or null for an ordinary
// top-level-`src` app (where there is nothing to clarify). Never throws.

const IGNORE = /^(node_modules|\.git|dist|build|out|coverage|\.next|\.turbo|\.vercel)\//;
const CODE = /\.(tsx?|jsx?)$/;

/**
 * Inspect the workspace's file paths and, IF the frontend source is under a NESTED root (client/src,
 * frontend/src, apps/web/src, …) rather than a bare top-level `src/`, return a one-paragraph layout hint
 * naming that root (and the backend dir, when present). Returns null when the app is a plain top-level-`src`
 * project (no ambiguity) or has no detectable frontend source.
 */
export function frontendLayoutHint(files: readonly string[]): string | null {
  if (!Array.isArray(files) || files.length === 0) return null;

  const srcRoots = new Map<string, number>(); // '.../src' -> count of code files under it
  let serverDir: string | null = null;

  for (const raw of files) {
    if (typeof raw !== 'string' || IGNORE.test(raw)) continue;
    // Backend dir (a real fullstack signal): a server/ folder holding code.
    if (!serverDir) {
      const sm = /(?:^|\/)(server|backend|api)\/[^/]+/.exec(raw);
      if (sm && CODE.test(raw)) serverDir = sm[1];
    }
    // The frontend source root = everything up to and including the FIRST `src` segment, for a code file.
    const m = /^(.*?(?:^|\/)src)\/.+/.exec(raw);
    if (m && CODE.test(raw)) srcRoots.set(m[1], (srcRoots.get(m[1]) ?? 0) + 1);
  }

  if (srcRoots.size === 0) return null;
  // Nested roots are the only confusing case; a bare top-level `src` needs no hint.
  const nested = [...srcRoots.entries()].filter(([r]) => r !== 'src');
  if (nested.length === 0) return null;

  // Pick the nested root with the most frontend files (ties → the shortest path).
  nested.sort((a, b) => b[1] - a[1] || a[0].length - b[0].length);
  const root = nested[0][0];

  const serverNote = serverDir
    ? ` This is a full-stack app with a separate backend under \`${serverDir}/\`.`
    : '';
  return `PROJECT LAYOUT: this app's frontend source lives under \`${root}/\` — NOT a top-level \`src/\`.${serverNote} ` +
    `When you read or write frontend files, use the \`${root}/…\` path (e.g. \`${root}/App.tsx\`, \`${root}/components/…\`, \`${root}/index.css\`); ` +
    `a bare \`src/…\` path does not exist in this project.`;
}
