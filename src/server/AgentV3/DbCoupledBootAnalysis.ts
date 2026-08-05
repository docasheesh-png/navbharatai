// AgentV3 — the DB-COUPLED BOOT ("zombie server") class, caught from the code (admin task 3, 2026-08-05).
//
// THE SHAPE, from a real repo (Mitrify, verified end-to-end in a live repro before this was written):
//
//   httpServer.listen(...)                    // the port opens FIRST — "serving on port 5000"
//   (async () => {
//     await ensureSchema();                   // ← database unreachable → this REJECTS
//     await registerRoutes(httpServer, app);  // ← never runs
//     await setupVite(httpServer, app);       // ← never runs — THIS serves the client's pages
//   })();
//   process.on("unhandledRejection", ...)     // keeps the process alive → a ZOMBIE
//
// Result: the port is open, the health check answers, and every page in the app returns
// "Cannot GET /…" — the single most confusing failure a full-stack app can present, because the
// server looks alive by every cheap signal. The repaired shape (proven in the same repro: pages
// served with the database still down) guards the DB call so serving never depends on it.
//
// WHEN THIS FIRES — all three together, in ONE file, or it stays silent:
//   1. the file opens a listener (it is the server entry, not a router module),
//   2. it mounts client serving (setupVite / serveStatic / express.static / a vite middleware),
//   3. an AWAITED db-ish call precedes that mount and is NOT inside a try block.
// A guarded call, an API-only service, serving mounted before the DB, or no DB call at all → null.
// False positives teach people to ignore the check, so the silence cases carry as many tests as the
// firing one (same discipline as SpaFallbackAnalysis, this class's sibling).

export interface DbCoupledBootFinding {
  /** The server entry file with the coupled boot. */
  file: string;
  /** The awaited call that couples serving to the database, e.g. "ensureSchema". */
  dbCall: string;
  /** What mounts the client, e.g. "setupVite" — evidence the file really serves pages. */
  servingCall: string;
  message: string;
}

const CODE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;
const LISTEN_RE = /\.listen\s*\(/;

/**
 * Client serving — the thing whose absence turns every page into "Cannot GET".
 *
 * A CALL, not a mention (fixed 2026-08-05 from the real report). The first version matched the bare
 * name, and the real Mitrify file opens with `import { serveStatic } from "./static";` on line 11 —
 * so the "serving" match landed on the IMPORT, which sits before `await ensureSchema()` on line 83,
 * and the detector concluded "serving mounts first, already decoupled" and stayed silent on the
 * exact repo it was written for. The synthetic fixture used a dynamic `await import(...)` inside the
 * async block and therefore had no top-level import line, which is why the tests passed while
 * reality failed. Import lines are also stripped before scanning (see stripNoise) — either guard
 * alone would fix it; both are cheap and independently correct.
 */
const SERVING_RE = /\b(setupVite|serveStatic|createViteServer)\s*\(|\b(express\.static)\s*\(|\b(vite\.middlewares)\b/;

/**
 * Boot-time database work people actually write. Deliberately NAMED patterns, not "any await":
 * a generic net would flag `await loadConfig()` and drown the real signal in noise.
 */
const DB_CALL_RE = /\bawait\s+(?:[A-Za-z_$][\w$]*\.)?(ensureSchema|runMigrations?|migrate(?:Latest|Up)?|prisma\.\$connect|\$connect|sequelize\.(?:authenticate|sync)|mongoose\.connect|pool\.connect|client\.connect|connectD[bB]|initD[bB]|setupDatabase|initializeDatabase|dbConnect)\s*\(/;

/**
 * Blank out comments, string bodies and IMPORT statements, keeping every index aligned.
 *
 * Imports are blanked for the reason the real report exposed: `import { serveStatic } from "./static"`
 * names the serving function without mounting anything, and treating that mention as the mount made
 * the detector silent on the very file it was written for. What matters is where serving is CALLED.
 * Comments and strings are blanked so a commented-out call or a log line cannot fire the check.
 */
function stripNoise(source: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ');
  return String(source ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length))
    // String literals become blanks of the same length so every index below stays aligned.
    .replace(/(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g, (m) => m[0] + ' '.repeat(Math.max(0, m.length - 2)) + m[0])
    // Static `import … from '…'` / `import '…'` lines — a declaration, never a mount.
    .replace(/^[ \t]*import\b[^\n;]*;?/gm, blank);
}

/**
 * Is `index` inside any `try { … }` block?
 *
 * Real brace matching, not a regex guess: from each `try`, walk the braces to its closing one and
 * test containment. A guarded DB call is the CORRECT pattern — flagging it would tell the user to
 * add a guard they already have.
 */
export function isInsideTry(source: string, index: number): boolean {
  const text = source;
  const tryRe = /\btry\s*\{/g;
  for (let m = tryRe.exec(text); m; m = tryRe.exec(text)) {
    const open = m.index + m[0].length - 1;
    if (open >= index) break; // try starts after the call — cannot contain it
    let depth = 1;
    let i = open + 1;
    while (i < text.length && depth > 0) {
      const ch = text[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      i++;
    }
    if (index > open && index < i) return true;
  }
  return false;
}

/**
 * Find the coupled boot, if it is genuinely present. At most one finding — one server, one story.
 */
export function analyzeDbCoupledBoot(files: Record<string, string>): DbCoupledBootFinding | null {
  const entries = Object.entries(files ?? {}).filter(([p, c]) => CODE_RE.test(p) && typeof c === 'string');
  for (const [file, raw] of entries) {
    const src = stripNoise(raw);
    if (!LISTEN_RE.test(src)) continue;           // not the server entry
    const serving = SERVING_RE.exec(src);
    if (!serving) continue;                        // API-only — nothing here turns pages off
    // The pattern has one alternative per serving form, so the matched name is whichever group hit.
    const servingName = serving[1] ?? serving[2] ?? serving[3] ?? 'the client serving';
    const db = DB_CALL_RE.exec(src);
    if (!db) continue;                             // no boot-time DB work
    if (db.index > serving.index) continue;        // serving mounts first — already decoupled
    if (isInsideTry(src, db.index)) continue;      // already guarded — the correct pattern
    const dbCall = db[1];
    return {
      file,
      dbCall,
      servingCall: servingName,
      message: `${file} makes page serving depend on the database: \`await ${dbCall}(…)\` runs before ${servingName} with no guard, so if the database is down the boot dies half-way and EVERY page answers "Cannot GET /…" while the server looks up. Serving must never depend on the database.`,
    };
  }
  return null;
}

/**
 * The repair instruction — the exact pattern proven in the Mitrify repro (pages served with the
 * database still down, /health telling the truth). Written for the build agent to APPLY, on the
 * user's say-so; the ordering warning travels with it because a catch-all mounted before the API
 * routes would answer the app's own fetch calls with HTML.
 */
export function dbCoupledBootFixInstruction(finding: DbCoupledBootFinding): string {
  return [
    `In ${finding.file}, make page serving independent of the database:`,
    '',
    `1. Wrap \`await ${finding.dbCall}(…)\` in try/catch. On failure: log the error clearly and continue`,
    '   booting — do NOT rethrow, and do NOT stop the startup sequence.',
    `2. If ${finding.dbCall} is safe to re-run (IF NOT EXISTS-style), retry it in the background on an`,
    '   interval and stop retrying once it succeeds, so a late-starting database heals without a restart.',
    '3. Keep route registration and the client serving mount running regardless, IN THEIR CURRENT ORDER',
    `   (API routes before ${finding.servingCall} — the client catch-all must not swallow /api/*).`,
    '4. If there is a /health endpoint, report the database state in its body (keep the 200 status so',
    '   platform health checks still pass) — a health check that says "ok" over a dead database hides',
    '   exactly this failure.',
    '',
    'Result: with the database down, pages still serve and DB-backed requests fail individually with',
    'clear errors — instead of the whole site answering "Cannot GET".',
  ].join('\n');
}

/** The one-line permission ask. The user's reply is the permission — nothing is changed until then. */
export function dbCoupledBootFixOffer(): string {
  return 'I can make this app serve its pages even when the database is down — say "fix the boot guard" and I\'ll apply it.';
}
