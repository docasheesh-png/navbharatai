// AgentV3 — A PROBE THE BUILDER WROTE TO MEASURE SOMETHING IS NOT THE USER'S APP (build report #2566, 2026-11-27).
//
// 🔴 WHAT HAPPENED. A preview-render repair could not see screenshots, so it measured the map generator directly: it
// wrote `probe.test.ts` in the project ROOT, ran `vitest run probe.test.ts`, and rewrote it six times while it looked
// for why "riverside-town" found no dry ground. The build was stopped by the time cap mid-investigation and the probe
// shipped: it was in the delivered manifest, saved with the project, and — being a root `*.test.ts` — part of the
// user's own `npm test` from then on.
//
// 🧬 THE CLASS: a file written only to investigate (a probe, a scratch script, a debug run, a repro) that survives the
// turn. `scratchCapture.ts` closed it for a tool's output redirected into a file, `scratchCopies.ts` for a copy of a
// project file; this closes it for a throwaway investigation file. Two layers (the 50/50 law): the builder is told
// to delete its probes (`SCRATCH_PROBE_RULE`), and this end-of-turn net removes the ones it left anyway — run at the
// very END of the turn, after every repair pass, because the sibling net used to run before the preview repair that
// wrote this file (a net that runs before the writer cannot catch it).
//
// 🔒 PRECISION FIRST — a user's own `debug.ts` or `check.mjs` is their project. A file is removed only when ALL hold:
//   1. it sits at the project ROOT (no folder) — an app's own code lives in folders; the root holds config, and a
//      probe is dropped there because that is where the test runner and `node` run from;
//   2. its name is a scratch name: `probe`, `scratch`, `debug`, `tmp`, `temp`, `repro` or `check`, optionally numbered
//      and with suffixes (`probe2.ts`, `probe.test.ts`, `debug-world.mjs`, `tmp_check.js`), with a script extension;
//   3. THIS build wrote it, and it was not in the saved project when the turn began;
//   4. nothing else in the project names it (not imported, not in a `package.json` script — checked in the sandbox;
//      an unanswerable check keeps the file);
//   5. the user's request does not name it.
// Everything else is kept. Kill switch: AGENTV3_SCRATCH_PROBE_REMOVE=off. PURE, except `applyScratchProbeNet`.
import { parseMentionGrep } from './scratchCopies';

export function scratchProbeRemovalEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_SCRATCH_PROBE_REMOVE ?? '').trim().toLowerCase() !== 'off';
}

/** The builder rule line (layer one). */
export const SCRATCH_PROBE_RULE = 'A throwaway file you write only to investigate (a probe test, a debug or scratch script, a repro) '
  + 'is yours to delete: `rm` it in the same turn once you have the answer. Never leave `probe.test.ts`, `debug.mjs`, '
  + '`scratch.ts` or similar in the project — it ships with the app, and a root `*.test.ts` runs in the user\'s own test suite.';

/** Root-level scratch names with a script extension. `.test`/`.spec` are just more suffixes. */
const PROBE_NAME = /^(?:probe|scratch|debug|tmp|temp|repro|check)\d*(?:[-_.][A-Za-z0-9]+)*\.(?:[cm]?[jt]sx?|py|sh)$/i;

/** Is this path, by name and place alone, a builder's investigation file? PURE. */
export function isProbeName(path: string): boolean {
  const p = String(path ?? '').replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
  if (!p || p.includes('/') || !/^[A-Za-z0-9._-]+$/.test(p)) return false;
  return PROBE_NAME.test(p);
}

export interface ScratchProbeDecision {
  candidates: string[];
  /** Probe-shaped files the user's request names — kept, and said so. */
  askedFor: string[];
}

/** Which files are probes this build made. The mention check is the caller's (it reads the sandbox). PURE. */
export function scratchProbeCandidates(input: {
  listing: readonly string[];
  writtenThisBuild: Iterable<string>;
  existedAtStart: readonly string[];
  request: string;
  env?: NodeJS.ProcessEnv;
}): ScratchProbeDecision {
  if (!scratchProbeRemovalEnabled(input.env)) return { candidates: [], askedFor: [] };
  const norm = (s: string) => String(s ?? '').replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
  const present = new Set(input.listing.map(norm));
  const before = new Set(input.existedAtStart.map(norm));
  const request = String(input.request ?? '').toLowerCase();
  const candidates: string[] = [];
  const askedFor: string[] = [];
  for (const raw of new Set([...input.writtenThisBuild].map(norm))) {
    if (!present.has(raw) || before.has(raw) || !isProbeName(raw)) continue;
    if (request.includes(raw.toLowerCase())) { askedFor.push(raw); continue; }
    candidates.push(raw);
  }
  return { candidates: candidates.sort(), askedFor: askedFor.sort() };
}

/**
 * The sandbox command that asks whether any other project file names `path`: by file name (`node check.mjs`, a
 * `.ts` import) or as an import without its extension (`'../probe'`, `"./debug.js"`). Fixed strings only; NULL for
 * anything that is not a plain root file name. PURE.
 */
export function probeMentionCommand(path: string): string | null {
  if (!isProbeName(path)) return null;
  const stem = path.replace(/\.[A-Za-z0-9]+$/, '');
  const ex = '--exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build --exclude-dir=.next';
  return `grep -rlF ${ex} -e '${path}' -e "/${stem}'" -e '/${stem}"' -e '/${stem}.js' . 2>/dev/null; echo "NBAI_GREP_EXIT:$?"`;
}

/** The report line. '' when there is nothing to say. PURE. */
export function scratchProbeNote(removed: readonly string[], keptMentioned: readonly string[], askedFor: readonly string[]): string {
  const parts: string[] = [];
  if (removed.length) {
    parts.push(`Removed ${removed.length} throwaway investigation file${removed.length === 1 ? '' : 's'} the builder wrote and left in the project root: `
      + `${removed.join(', ')} — nothing in the app referenced ${removed.length === 1 ? 'it' : 'them'}, so nothing on screen changes, and `
      + `${removed.length === 1 ? 'it no longer ships' : 'they no longer ship'} with the project or run${removed.length === 1 ? 's' : ''} in its tests.`);
  }
  if (keptMentioned.length) parts.push(`Kept ${keptMentioned.join(', ')}: named like a scratch file, but something in the project refers to it.`);
  if (askedFor.length) parts.push(`Kept ${askedFor.join(', ')}: named like a scratch file, but the request names it.`);
  return parts.join(' ');
}

export interface ScratchProbeNetDeps {
  listProjectFiles(): Promise<string[]>;
  writtenThisBuild(): string[];
  runCommand(command: string): Promise<{ stdout?: string } | null>;
  removeLeftoverFiles(paths: readonly string[]): Promise<string[]>;
}
export interface ScratchProbeNetReport {
  record(issue: { phase: 'build'; severity: 'info'; code: string; message: string; autoResolved: boolean }): void;
}

/** The end-of-turn net (layer two). Best-effort: any failure removes nothing. Never throws. Returns the removed paths. */
export async function applyScratchProbeNet(
  deps: ScratchProbeNetDeps, report: ScratchProbeNetReport, input: { request: string; existedAtStart: readonly string[] },
  env: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  try {
    if (!scratchProbeRemovalEnabled(env)) return [];
    const written = deps.writtenThisBuild();
    if (!written.some(isProbeName)) return [];
    const listing = await deps.listProjectFiles();
    const decision = scratchProbeCandidates({ listing, writtenThisBuild: written, existedAtStart: input.existedAtStart, request: input.request, env });
    const remove: string[] = [];
    const keptMentioned: string[] = [];
    for (const path of decision.candidates) {
      const command = probeMentionCommand(path);
      const out = command ? await deps.runCommand(command).catch(() => null) : null;
      const mentioned = out ? parseMentionGrep(out.stdout, path) : null;
      if (mentioned === false) remove.push(path);
      else if (mentioned === true) keptMentioned.push(path);
      // null: could not check — kept silently.
    }
    const gone = remove.length ? new Set(await deps.removeLeftoverFiles(remove)) : new Set<string>();
    const removed = remove.filter((p) => gone.has(p));
    const line = scratchProbeNote(removed, keptMentioned, decision.askedFor);
    if (line) report.record({ phase: 'build', severity: 'info', code: 'SCRATCH_PROBES', message: line, autoResolved: true });
    return removed;
  } catch {
    return [];
  }
}
