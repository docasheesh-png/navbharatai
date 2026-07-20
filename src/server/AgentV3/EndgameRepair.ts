// AgentV3 — ENDGAME REPAIR (QuizArena autopsy 2026-07-17, admin-mandated Slice 1).
//
// THE FAILURE THIS KILLS: the agentic builder ground the last ~10 TypeScript errors ONE per
// round-trip (read → edit → tsc ≈ 4-5 steps each) until "Step limit reached (80)" — and a
// 13-minute build shipped NOT-ready over errors that were almost all MECHANICAL (an unused
// import, a missing `FormEvent` import, an export-name mismatch). The admin's mandate: stop
// paying an LLM to do grep's job.
//
// TWO LAYERS, cheapest first:
//   1. DETERMINISTIC — parse `tsc --noEmit` output and fix the mechanical classes in pure code:
//      • TS6133/TS6192 unused IMPORT → remove exactly that specifier (only import lines; deleting
//        other "unused" code deterministically is unsafe, so it is left to layer 2).
//      • import/export drift → the SAME proven reconcilers the fast lane uses
//        (reconcileImportExports / addMissingProjectImports / fixWrongSourceImports), run over the
//        FULL workspace map. Zero LLM calls, zero steps, milliseconds.
//   2. ONE BATCH LLM CALL — every REMAINING error in a single repair prompt over only the offending
//      files (the fast lane's repair shape) instead of one error per agent round-trip.
//
// PURE core (parse + unused-import removal + orchestration over injected I/O) so every piece is
// unit-testable with the real QuizArena error text. The dispatcher/runner supply sandbox I/O and
// the single LLM call. Kill switch: AGENTV3_ENDGAME_REPAIR=off.

import { reconcileImportExports, addMissingProjectImports, fixWrongSourceImports } from './ImportExportReconcile';

export interface TscError {
  file: string;
  line: number;
  col: number;
  code: string;
  message: string;
}

/** Parse `tsc --noEmit` output lines like `src/x.ts(12,5): error TS6133: 'y' is declared …`. Pure. */
export function parseTscErrors(output: string): TscError[] {
  const out: TscError[] = [];
  const re = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.*)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(output || '')) !== null) {
    out.push({ file: m[1].trim(), line: Number(m[2]), col: Number(m[3]), code: m[4], message: m[5].trim() });
  }
  return out;
}

/** The error codes the deterministic layer addresses (everything else goes to the batch LLM call). */
const UNUSED_CODES = new Set(['TS6133', 'TS6192', 'TS6196']);

/**
 * Remove UNUSED IMPORT bindings named by TS6133/TS6192/TS6196 errors. Only import lines are touched:
 * the named specifier is removed from its list; a list/line left empty is dropped entirely (side-effect
 * imports like `import './index.css'` are never targeted by these codes, so they survive). Pure.
 */
export function removeUnusedImports(
  files: Record<string, string>,
  errors: TscError[],
): { files: Record<string, string>; removed: string[] } {
  const removed: string[] = [];
  const out = { ...files };
  for (const err of errors) {
    if (!UNUSED_CODES.has(err.code)) continue;
    const src = out[err.file];
    if (typeof src !== 'string') continue;
    const name = /'([^']+)'/.exec(err.message)?.[1];
    if (!name) continue;
    const lines = src.split('\n');
    const idx = err.line - 1;
    const line = lines[idx];
    if (typeof line !== 'string' || !/^\s*import\b/.test(line)) continue; // ONLY import lines
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let next = line
      // named specifier with optional alias, and a neighbouring comma on either side
      .replace(new RegExp(`\\{([^}]*)\\}`), (_all, inner: string) => {
        const kept = inner
          .split(',')
          .map((s: string) => s.trim())
          .filter((s: string) => s && s !== name && !new RegExp(`^${esc}\\s+as\\s+`).test(s) && !new RegExp(`\\s+as\\s+${esc}$`).test(s));
        return `{ ${kept.join(', ')} }`;
      })
      // default import (`import Name from` / `import Name, {…} from`)
      .replace(new RegExp(`^(\\s*import\\s+(?:type\\s+)?)${esc}\\s*,\\s*`), '$1')
      .replace(new RegExp(`^(\\s*import\\s+(?:type\\s+)?)${esc}\\s+from`), '$1{ } from');
    if (next === line) continue; // nothing matched — leave for the LLM layer
    // A now-empty binding (`import { } from 'x'` / `import type { } from 'x'`) → drop the whole line.
    if (/^\s*import\s+(type\s+)?\{\s*\}\s+from/.test(next)) {
      lines.splice(idx, 1);
    } else {
      lines[idx] = next;
    }
    out[err.file] = lines.join('\n');
    removed.push(`${err.file}: removed unused import '${name}'`);
  }
  return { files: out, removed };
}

export interface EndgameDeterministicResult {
  files: Record<string, string>;
  /** Human-readable fix descriptions, in application order. */
  fixes: string[];
  /** Paths whose content changed. */
  changedPaths: string[];
}

/**
 * The full deterministic layer: unused-import removal (guided by the tsc errors) followed by the three
 * proven import/export reconcilers over the WHOLE map. Best-effort — a reconciler throw skips only
 * that reconciler. Returns the updated map + honest fix list.
 */
export async function endgameDeterministicPass(
  files: Record<string, string>,
  errors: TscError[],
): Promise<EndgameDeterministicResult> {
  const fixes: string[] = [];
  let cur = files;
  const unused = removeUnusedImports(cur, errors);
  cur = unused.files;
  fixes.push(...unused.removed);
  try {
    const r = await reconcileImportExports(cur);
    cur = r.files;
    fixes.push(...r.fixes.map((f) => `${f.file}: ${f.kind} '${f.name}' from '${f.from}'`));
  } catch { /* best-effort */ }
  try {
    const a = await addMissingProjectImports(cur);
    cur = a.files;
    fixes.push(...a.added.map((f) => `${f.file}: added missing import '${f.name}' from '${f.from}'`));
  } catch { /* best-effort */ }
  try {
    const w = await fixWrongSourceImports(cur);
    cur = w.files;
    fixes.push(...w.fixes.map((f) => `${f.file}: re-pointed '${f.name}' to '${f.from}'`));
  } catch { /* best-effort */ }
  const changedPaths = Object.keys(cur).filter((p) => cur[p] !== files[p]);
  return { files: cur, fixes, changedPaths };
}

/** Default ON — the endgame only ever runs on a build that is ALREADY failing, so it can only help. */
export function endgameRepairEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.AGENTV3_ENDGAME_REPAIR ?? '').trim().toLowerCase() !== 'off';
}

/** The offending-file subset for the batch LLM call (bounded so the prompt stays sane). */
export function offendingFileSubset(
  files: Record<string, string>,
  errors: TscError[],
  maxFiles = 12,
): Array<{ path: string; content: string }> {
  const paths: string[] = [];
  for (const e of errors) if (files[e.file] !== undefined && !paths.includes(e.file)) paths.push(e.file);
  return paths.slice(0, maxFiles).map((path) => ({ path, content: files[path] }));
}

export interface EndgameIo {
  /** Run `tsc --noEmit` in the sandbox and return its combined output ('' = clean). */
  runTsc(): Promise<string>;
  /** Full project text-file map (durable/collected — the app the user actually runs). */
  readFiles(): Promise<Record<string, string>>;
  /** Persist one repaired file (sandbox + any mirrors the caller maintains). */
  writeFile(path: string, content: string): Promise<void>;
  /**
   * ONE bounded batch repair call: all remaining error text + the offending files, returns corrected
   * files (fast-lane repair shape). Absent → deterministic-only endgame.
   */
  llmRepair?(errorText: string, files: Array<{ path: string; content: string }>): Promise<Array<{ path: string; content: string }>>;
  log?(msg: string): void;
}

export interface EndgameVerdict {
  attempted: boolean;
  /** tsc error count when the endgame started / after the deterministic layer / at the end. */
  errorsBefore: number;
  errorsAfterDeterministic: number;
  errorsAfter: number;
  deterministicFixes: string[];
  llmFilesWritten: number;
  clean: boolean;
  /** True when the batch LLM repair INCREASED the error count and was rolled back (CrewHub 59→67). */
  llmReverted?: boolean;
}

const NO_ATTEMPT: EndgameVerdict = {
  attempted: false, errorsBefore: 0, errorsAfterDeterministic: 0, errorsAfter: 0,
  deterministicFixes: [], llmFilesWritten: 0, clean: true,
};

/**
 * Run the two-layer endgame over injected I/O. Never throws — any I/O failure returns the honest
 * partial verdict (the caller's NOT-ready outcome then stands unchanged).
 */
export async function runEndgameRepair(io: EndgameIo): Promise<EndgameVerdict> {
  try {
    const out1 = await io.runTsc();
    const errors1 = parseTscErrors(out1);
    if (errors1.length === 0) return { ...NO_ATTEMPT, attempted: true }; // already clean — nothing to do
    io.log?.(`🔧 Endgame repair: ${errors1.length} compile error(s) left — fixing mechanically first…`);
    let files = await io.readFiles();
    const det = await endgameDeterministicPass(files, errors1);
    for (const p of det.changedPaths) await io.writeFile(p, det.files[p]).catch(() => {});
    files = det.files;
    const out2 = det.changedPaths.length > 0 ? await io.runTsc() : out1;
    const errors2 = parseTscErrors(out2);
    let llmFilesWritten = 0;
    let llmReverted = false;
    let finalErrors = errors2;
    if (errors2.length > 0 && io.llmRepair) {
      io.log?.(`🔧 ${errors2.length} error(s) need real fixes — one batch repair pass…`);
      const subset = offendingFileSubset(files, errors2);
      const fixed = (await io.llmRepair(out2, subset).catch(() => [])) || [];
      // CONVERGENCE GUARD (CrewHub autopsy 2026-07-20: repair went 59 → 67 and the WORSE files stayed):
      // snapshot every file BEFORE the repair overwrites it, so a repair that increases the error count
      // can be rolled back. The pass is then monotone by construction — it helps or does nothing, never harms.
      const preRepair = new Map<string, string | undefined>();
      for (const f of fixed) {
        if (!f?.path || typeof f.content !== 'string') continue;
        // Blank-overwrite guard: a repair that returns an empty/husk file must not destroy real work.
        const existing = files[f.path];
        if (typeof existing === 'string' && existing.trim().length > 80 && f.content.trim().length < 10) continue;
        if (!preRepair.has(f.path)) preRepair.set(f.path, existing);
        await io.writeFile(f.path, f.content).catch(() => {});
        files[f.path] = f.content;
        llmFilesWritten++;
      }
      if (llmFilesWritten > 0) {
        finalErrors = parseTscErrors(await io.runTsc());
        if (finalErrors.length > errors2.length) {
          // The repair made it WORSE — restore every touched file to its pre-repair content and keep the
          // better (pre-repair) state as the honest outcome.
          for (const [p, prev] of preRepair) {
            if (typeof prev !== 'string') continue;
            await io.writeFile(p, prev).catch(() => {});
            files[p] = prev;
          }
          io.log?.(`↩️ The batch repair increased the error count (${errors2.length} → ${finalErrors.length}) — reverted those files and kept the better state.`);
          finalErrors = errors2;
          llmFilesWritten = 0; // honest: the repair delivered net-zero files
          llmReverted = true;
        }
      }
    }
    return {
      attempted: true,
      errorsBefore: errors1.length,
      errorsAfterDeterministic: errors2.length,
      errorsAfter: finalErrors.length,
      deterministicFixes: det.fixes,
      llmFilesWritten,
      clean: finalErrors.length === 0,
      ...(llmReverted ? { llmReverted } : {}),
    };
  } catch {
    return NO_ATTEMPT; // endgame is best-effort — it must never worsen or hang a build
  }
}

// === SLICE 2 — MID-BUILD ERROR-TREND CHECKPOINT (admin-mandated 2026-07-17) =======================
// The admin's alternative to "raise the cap to 800": every ~25 steps peek at the tsc error count.
// Two consecutive peeks with errors NOT decreasing = the builder is grinding, not converging — fire
// the SAME two-layer endgame repair immediately (once per run) instead of waiting for the step cap.

export interface ErrorTrendConfig {
  enabled: boolean;
  /** Steps between peeks (default 25; floor 5 so a misconfig can't hammer tsc every step). */
  interval: number;
}

export function errorTrendConfig(env: NodeJS.ProcessEnv = process.env): ErrorTrendConfig {
  const enabled = (env.AGENTV3_ERRTREND_CHECKPOINT ?? '').trim().toLowerCase() !== 'off';
  const n = Number(env.AGENTV3_ERRTREND_INTERVAL);
  return { enabled, interval: Number.isFinite(n) && n >= 5 ? Math.floor(n) : 25 };
}

/**
 * TRUE when the last two checkpoint counts show NO convergence (both > 0, not decreasing).
 * A single bad peek never fires (files are legitimately half-written mid-build); two flat/rising
 * peeks = ~2×interval steps with zero progress on compile errors. Pure.
 */
export function shouldTriggerMidBuildRepair(counts: number[]): boolean {
  if (counts.length < 2) return false;
  const prev = counts[counts.length - 2];
  const last = counts[counts.length - 1];
  return prev > 0 && last > 0 && last >= prev;
}

// === SLICE 3 — STEP-LIMIT AUTO-RESUME (admin-mandated 2026-07-17: "pause, not death") ==============
// When the cap hits and the build is STILL not ready (even after the endgame repair), the run gets a
// bounded extension instead of dying: budget = how many times a single build may extend (default 1;
// each extension adds half the base cap). 0/off disables. A runaway can never loop: the budget is
// consumed per run and the wall-clock watchdog still rules over everything.
export function stepResumeBudget(env: NodeJS.ProcessEnv = process.env): number {
  const raw = (env.AGENTV3_STEP_RESUME ?? '').trim().toLowerCase();
  if (raw === '') return 1; // unset → the default ONE extension
  if (raw === 'off') return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.min(Math.floor(n), 3) : 1;
}
