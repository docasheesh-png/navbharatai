// AgentV3 — collect a built app's source files from the sandbox into a deploy-ready
// map (§12.2). Reuses the EXISTING deploy + git backend: the returned
// `Record<path, content>` is exactly what `/api/pro/deploy` (Vercel/Netlify/
// Cloudflare/GitHub Pages) and `/api/github/push-enhanced` already accept — so v5.0
// gets durable deploy + git push without rebuilding any deployment code.
//
// PURE over a minimal actuator shape (listFiles + readFile) so it is fully unit-
// testable. Mirrors the security filtering of the ZIP export / GitHub push paths:
// never ships node_modules, build output, .git, or live .env secrets; binary and
// oversized files are skipped (a deploy is source/text).

import { buildTarGz, shouldBulkLand, bulkLandEnabled } from './BulkLanding';

/** The minimal slice of the sandbox actuator this collector needs. */
export interface WorkspaceFileSource {
  listFiles(workspaceId: string): Promise<string[]>;
  readFile(workspaceId: string, filePath: string): Promise<string>;
}

/** The minimal slice of the sandbox actuator the importer needs. */
export interface WorkspaceFileSink {
  writeFile(workspaceId: string, filePath: string, content: string): Promise<void>;
  /**
   * OPTIONAL bulk-landing capability (see BulkLanding.ts). When a sink can take one binary and run one
   * command, a whole project lands in TWO round trips instead of one per file. Optional by design: any
   * sink lacking these (LocalActuator in tests, a stub) transparently keeps the per-file path.
   */
  writeBinaryFile?(workspaceId: string, filePath: string, base64: string): Promise<void>;
  runCommand?(workspaceId: string, command: string): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  readFile?(workspaceId: string, filePath: string): Promise<string>;
}

export interface CollectedFiles {
  files: Record<string, string>;
  /** Paths intentionally skipped (excluded dir, secret, binary, or too large). */
  skipped: string[];
}

export interface ImportedFiles {
  /** Paths successfully written into the sandbox. */
  written: string[];
  /** Paths rejected (unsafe path, excluded, secret, or too large). */
  skipped: string[];
  /**
   * HOW the files got there — recorded so a build report can answer it without guesswork.
   *
   * Shipping the bulk path with NO telemetry was a real mistake: when a data-loss event appeared on a
   * live import (2026-08-03), nothing in the report said which landing path had run or how many files
   * it had verified, so the change could neither be blamed nor cleared from the evidence alone.
   * 'bulk' = one archive, count-verified; 'bulk+per-file' = archive plus the paths tar cannot carry;
   * 'per-file' = the classic path (small import, missing capability, or a fallback after a failed
   * or unproven bulk attempt).
   */
  landedVia?: 'bulk' | 'bulk+per-file' | 'per-file';
  /** Files tar itself reported extracting, when the bulk path ran and was verified. */
  bulkVerifiedCount?: number;
}

// Raised 4000 → 16000 so a Mitrify-scale (and up to ~50×) imported/collected app is not truncated
// (the "handle a huge app" goal). The 120 MB total-bytes ceiling is the real memory guard and
// usually binds first; the file count is the hard backstop.
const MAX_FILES = 16000;
const MAX_TOTAL_BYTES = 120 * 1024 * 1024; // 120 MB — same ceiling as the ZIP export.
const MAX_FILE_BYTES = 5 * 1024 * 1024;     // 5 MB per text file — larger is almost certainly an asset.

// Directories that must never be deployed/pushed (dependencies, build output, VCS).
const EXCLUDED_DIR = /(^|\/)(node_modules|\.git|dist|build|\.next|\.nuxt|\.cache|\.turbo|coverage|\.vercel|\.netlify)(\/|$)/;

// Live secret files — excluded. Templates (.env.example/.sample/.template) are KEPT
// so the deployed/pushed project still documents the variables it needs.
const SECRET_ENV = /(^|\/)\.env(\.[\w-]+)?$/i;
const ENV_TEMPLATE = /(^|\/)\.env\.(example|sample|template)$/i;

// A NUL byte is the standard heuristic for "this is binary, not source text".
const NUL = String.fromCharCode(0);

function isExcludedPath(path: string): boolean {
  if (EXCLUDED_DIR.test(path)) return true;
  if (SECRET_ENV.test(path) && !ENV_TEMPLATE.test(path)) return true;
  return false;
}

function looksBinary(content: string): boolean {
  return content.includes(NUL);
}

/**
 * Read every deploy-eligible source file from the sandbox into a path→content map.
 * Best-effort: a file that fails to read is skipped, never fatal. Bounded by file
 * count and total size so one runaway workspace cannot exhaust memory.
 */
export async function collectWorkspaceFiles(
  source: WorkspaceFileSource,
  workspaceId: string,
): Promise<CollectedFiles> {
  const files: Record<string, string> = {};
  const skipped: string[] = [];
  const all = await source.listFiles(workspaceId);

  // ROOT CAUSE of the 13-minute post-import gap (admin build report 2026-08-03): this used to
  // `await source.readFile(...)` ONE AT A TIME inside a for-loop. Against the E2B sandbox every read
  // is a network round trip, so a 2034-file workspace cost ~2034 × ~390ms ≈ 790 SECONDS — which is
  // exactly the 788s of silence between "import SUCCEEDED" (58s) and the agent starting (868s) in
  // that report. It runs on EVERY turn (the File Guardian calls it before the agent edits anything),
  // so this was a per-turn tax on every large app, not just imports.
  //
  // This is the THIRD instance of one bug class — serial awaits over a network — after the sandbox
  // landing (648s incident) and the Firestore merge. Same fix, same discipline: SELECTION stays
  // sequential and byte-exact (the caps below are applied in the original path order, so the chosen
  // set is identical to before); only the latency-bound READS are parallelised.
  const candidates = all.filter((path) => {
    if (isExcludedPath(path)) { skipped.push(path); return false; }
    return true;
  });

  const contents = new Map<string, string | null>();
  await pool(candidates, READ_CONCURRENCY, async (path) => {
    try {
      contents.set(path, await source.readFile(workspaceId, path));
    } catch {
      contents.set(path, null); // a failed read is a skip, exactly as before
    }
  });

  let totalBytes = 0;
  for (const path of candidates) {
    if (Object.keys(files).length >= MAX_FILES) { skipped.push(path); continue; }
    const content = contents.get(path);
    if (typeof content !== 'string') { skipped.push(path); continue; }
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > MAX_FILE_BYTES || looksBinary(content)) { skipped.push(path); continue; }
    if (totalBytes + bytes > MAX_TOTAL_BYTES) { skipped.push(path); continue; }
    totalBytes += bytes;
    files[path] = content;
  }

  return { files, skipped };
}

/**
 * A path is safe to import only if it stays inside the workspace: no absolute
 * paths, no `..` traversal, no NUL, and not a dependency/build/VCS dir or a live
 * `.env` secret. Templates (`.env.example` etc.) are allowed.
 */
function isSafeImportPath(path: string): boolean {
  if (!path || path.includes(NUL)) return false;
  if (path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path)) return false; // absolute
  const segments = path.split(/[\\/]/);
  if (segments.some((s) => s === '..')) return false;                     // traversal
  if (EXCLUDED_DIR.test(path)) return false;
  if (SECRET_ENV.test(path) && !ENV_TEMPLATE.test(path)) return false;
  return true;
}

/**
 * Write an imported project (e.g. fetched from GitHub via the existing
 * `/api/github/fetch` route) into the v5.0 sandbox so the agent can edit/update and
 * then deploy/push it back. Best-effort + bounded: an unsafe path or a failed write
 * is skipped, never fatal. Reuses the same size/exclusion guards as the collector.
 */
/**
 * Bounded-concurrency runner. Same shape as GithubApiTree's `pool` — kept local so this module has no
 * new dependency, and small enough that duplicating it beats coupling two unrelated files.
 */
async function pool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let idx = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (idx < items.length) await worker(items[idx++]);
  });
  await Promise.all(runners);
}

/**
 * How many sandbox writes may be in flight at once. Each write is a NETWORK round-trip to the E2B
 * cloud VM, so this is latency-bound, not CPU-bound — concurrency is the whole win. Deliberately
 * conservative and env-overridable: the exact optimum depends on E2B's own limits and wants
 * measurement, but 1 (the old behaviour) is provably wrong for a large import.
 */
const WRITE_CONCURRENCY = Math.max(1, Math.min(64, Number(process.env.AGENTV3_IMPORT_WRITE_CONCURRENCY) || 12));

/**
 * How many sandbox READS may be in flight at once (collectWorkspaceFiles). Same latency-bound shape as
 * the writes above: the File Guardian reads the whole workspace on every turn, so this is the knob that
 * turned a 13-minute stall on a 2000-file app into seconds.
 */
const READ_CONCURRENCY = Math.max(1, Math.min(64, Number(process.env.AGENTV3_WORKSPACE_READ_CONCURRENCY) || 16));

/**
 * SELECTION — which files land, and which are skipped. Pure, deterministic, ORDER-DEPENDENT (the
 * byte/count budgets are consumed in iteration order), so it is separated from the writing step:
 * parallelising the writes must not change WHICH files are chosen. Exported for testing.
 */
export function selectImportableFiles(files: Record<string, string>): { accepted: Array<[string, string]>; skipped: string[] } {
  const accepted: Array<[string, string]> = [];
  const skipped: string[] = [];
  let totalBytes = 0;
  for (const [path, content] of Object.entries(files)) {
    if (accepted.length >= MAX_FILES) { skipped.push(path); continue; }
    if (!isSafeImportPath(path) || typeof content !== 'string') { skipped.push(path); continue; }
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > MAX_FILE_BYTES || totalBytes + bytes > MAX_TOTAL_BYTES) { skipped.push(path); continue; }
    accepted.push([path, content]);
    totalBytes += bytes;
  }
  return { accepted, skipped };
}

/**
 * Write an imported project into the workspace.
 *
 * ROOT CAUSE (navbharatai self-import autopsy, buildId d1623410 — 2460 files): this used to `await`
 * ONE `sink.writeFile` at a time inside a for-loop. Against an E2B sandbox every write is a network
 * round-trip, so the landing took ~648 SECONDS — measured between "zipball SUCCEEDED" (526s) and
 * "Editing your existing app" (1174s) in that build. The agent did not start until 21 minutes in and
 * then had 8 minutes before the 29-minute cap killed it. The download was never the main cost; the
 * serial landing was.
 *
 * Selection stays sequential and byte-exact (see selectImportableFiles) so the SAME files are chosen
 * as before; only the latency-bound writes are parallelised. Ordering between independent file writes
 * carries no meaning, so this is safe by construction.
 */
/** The archive we upload, inside the workspace root; removed as soon as it is expanded. */
const LANDING_ARCHIVE = '.nbai-landing.tar.gz';
/** How many landed files are re-read byte-exact to prove the extraction really happened. */
const BULK_VERIFY_SAMPLE = 5;

/**
 * FAST PATH — land every file in TWO round trips (upload one tar.gz, expand it in the sandbox).
 *
 * Returns the paths it verifiably landed, or null to mean "fall back to per-file writes". It NEVER
 * throws and never reports a path it did not prove — three independent checks, because a faster
 * landing must never be a PARTIAL one:
 *   1. `tar` exits non-zero on any extraction error;
 *   2. tar's own verbose listing is COUNTED and must equal the number of entries we archived. This is
 *      the check that matters: a 5-file sample cannot detect a 20%-short extraction (2034 of 2543 —
 *      the real data-loss shape seen on 2026-08-03), and the count costs no extra round trip because
 *      tar prints it during the same command;
 *   3. a spread-out SAMPLE is re-read byte-exact, which catches an extract that "succeeded" against
 *      the wrong directory.
 * Anything unproven ⇒ null ⇒ the slow path runs and the import is still complete.
 */
async function bulkLand(
  sink: WorkspaceFileSink,
  workspaceId: string,
  accepted: Array<[string, string]>,
): Promise<{ written: string[]; leftover: Array<[string, string]>; verifiedCount: number } | null> {
  if (!sink.writeBinaryFile || !sink.runCommand) return null;
  try {
    const map = Object.fromEntries(accepted);
    const { gz, included, excluded } = buildTarGz(map);
    if (included.length === 0) return null;
    await sink.writeBinaryFile(workspaceId, LANDING_ARCHIVE, gz.toString('base64'));
    // `--overwrite` matches the proven checkpoint-restore invocation; runCommand's cwd is the
    // workspace root, so the archive's relative paths land exactly where the per-file writes would.
    // `-v` makes tar list what it ACTUALLY extracted; redirecting that listing to a temp file (GNU
    // tar prints to stdout, BSD to stderr — both covered) lets tar's OWN exit status be captured
    // directly, and `wc -l <file` turns the listing into one number. Pure POSIX sh by construction —
    // the previous `set -o pipefail` was a bashism, and on a plain-sh sandbox the whole command
    // errored, so the fast path silently NEVER engaged (every import quietly took the slow per-file
    // path). `tr -d ' \t'` strips BSD wc's leading padding so the marker regex always matches.
    const listFile = `${LANDING_ARCHIVE}.list`;
    const res = await sink.runCommand(
      workspaceId,
      `tar -xzvf ${LANDING_ARCHIVE} --overwrite >${listFile} 2>&1; RC=$?; N=$(wc -l <${listFile} | tr -d ' \t'); rm -f ${LANDING_ARCHIVE} ${listFile}; echo "NBAI_EXTRACTED:$N"; exit $RC`,
    );
    if (!res || res.exitCode !== 0) {
      try { await sink.runCommand(workspaceId, `rm -f ${LANDING_ARCHIVE} ${listFile}`); } catch { /* cleanup best-effort */ }
      return null; // honest: unproven ⇒ the caller writes every file the slow way
    }
    // COUNT PROOF — the one that catches a silently-short extraction.
    const m = /NBAI_EXTRACTED:(\d+)/.exec(String(res.stdout || ''));
    const extracted = m ? Number(m[1]) : -1;
    if (extracted !== included.length) return null; // short (or unreadable) ⇒ fall back, land everything
    // WRONG-PLACE PROOF — re-read a spread-out sample and compare content byte-exact.
    if (sink.readFile) {
      const step = Math.max(1, Math.floor(included.length / BULK_VERIFY_SAMPLE));
      for (let i = 0; i < included.length && i / step < BULK_VERIFY_SAMPLE; i += step) {
        const path = included[i];
        const got = await sink.readFile(workspaceId, path).catch(() => null);
        if (got !== map[path]) return null; // extraction did not really happen ⇒ fall back
      }
    }
    return { written: included, leftover: excluded.map((p) => [p, map[p]] as [string, string]), verifiedCount: extracted };
  } catch {
    return null; // any failure at all ⇒ the per-file path, which was already working
  }
}

export async function writeWorkspaceFiles(
  sink: WorkspaceFileSink,
  workspaceId: string,
  files: Record<string, string>,
): Promise<ImportedFiles> {
  const { accepted, skipped } = selectImportableFiles(files);
  const written: string[] = [];
  const failed: string[] = [];

  // BULK LANDING (self-import autopsy 2026-08-03): parallelising per-file writes only divided the
  // problem — cost stayed LINEAR in file count (2540 files ÷ 12 ≈ 212 sequential round trips, the
  // dominant cost of a large import). One archive + one extract is O(1) round trips instead. Only for
  // imports big enough to pay back the two extra calls; a failure or an unproven extraction falls
  // through to the loop below, so this can never make an import worse.
  let toWrite = accepted;
  let landedVia: ImportedFiles['landedVia'] = 'per-file';
  let bulkVerifiedCount: number | undefined;
  if (bulkLandEnabled() && shouldBulkLand(accepted.length)) {
    const bulk = await bulkLand(sink, workspaceId, accepted);
    if (bulk) {
      written.push(...bulk.written);
      toWrite = bulk.leftover; // paths the archive format can't carry (non-ASCII / very long)
      landedVia = toWrite.length > 0 ? 'bulk+per-file' : 'bulk';
      bulkVerifiedCount = bulk.verifiedCount;
    }
  }

  await pool(toWrite, WRITE_CONCURRENCY, async ([path, content]) => {
    try {
      await sink.writeFile(workspaceId, path, content);
      written.push(path);
    } catch {
      failed.push(path); // a write failure is a skip, exactly as before
    }
  });

  return { written, skipped: [...skipped, ...failed], landedVia, bulkVerifiedCount };
}
