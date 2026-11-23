// AgentV3 — A BUILDER'S SCRATCH COPY OF A PROJECT FILE IS NOT THE USER'S APP (failedbr #2494, 2026-11-22).
//
// 🔴 WHAT HAPPENED. Fixing errors in a game, the builder ran `cp src/game/world.ts src/game/world.ts.backup`, then wrote
// `src/game/worldCorrected.ts` and `src/game/worldFixed.ts` as alternative versions, `mv`'d one over the original and
// `rm`'d the other. `world.ts.backup` was never removed: the shell-write ledger read it back (correctly — a missed write
// loses work) and it shipped in the saved project. While `worldCorrected.ts` existed it was compiled as part of the app
// and added five TS2322 errors to the typecheck the builder was trying to clear.
//
// 🧬 THE CLASS: a duplicate of an existing project file, made by the builder as a safety copy or a trial version, that
// survives the turn. `scratchCapture.ts` (Q-2713) closed the sibling for a tool's OUTPUT redirected into a file; this
// closes it for a COPY of a project file. Two layers (the 50/50 law): the builder is told not to make them
// (`SCRATCH_COPY_RULE`), and this end-of-turn net removes the ones it made anyway.
//
// 🔒 PRECISION FIRST — a user's own `worldOld.ts` is their project. A file is removed only when ALL hold:
//   1. its name is an exact scratch-copy pattern of a SIBLING that exists: `<file>.backup|.bak|.orig|.old`,
//      `<stem>.backup|.bak|.orig|.old.<ext>`, or `<stem>Fixed|Corrected|Copy|Old|Backup<.ext>` (also `-fixed`, `_copy`, …);
//   2. THIS build wrote it, and it was not in the saved project when the turn began;
//   3. nothing else in the project mentions its name (not imported, not referenced — checked in the sandbox);
//   4. the user's request does not name it (asked-for files are never "scratch").
// Everything else is kept. Kill switch: AGENTV3_SCRATCH_COPY_REMOVE=off. PURE, except `applyScratchCopyNet`.

export function scratchCopyRemovalEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_SCRATCH_COPY_REMOVE ?? '').trim().toLowerCase() !== 'off';
}

/** The builder rule line (layer one). Plain words: what not to do, and what to do instead. */
export const SCRATCH_COPY_RULE = 'Never make a backup or trial copy of a project file inside the project (no `cp x.ts x.ts.backup`, '
  + 'no `xFixed.ts` / `xCorrected.ts` / `xCopy.ts` / `x.bak.ts`): a copy ships with the app and a `.ts` copy is compiled '
  + 'with it. Edit the real file in place — the project is checkpointed, so a bad edit can always be undone.';

const SUFFIX_WORDS = '(?:backup|bak|orig|old)';
/** `world.ts.backup` → `world.ts` */
const APPENDED = new RegExp(`^(.+\\.[A-Za-z0-9]+)\\.${SUFFIX_WORDS}$`, 'i');
/** `world.bak.ts` → `world.ts` */
const INFIX = new RegExp(`^(.+)\\.${SUFFIX_WORDS}(\\.[A-Za-z0-9]+)$`, 'i');
/** `worldFixed.ts`, `world-fixed.ts`, `world_copy.ts` → `world.ts` (the original must exist, so `useOld.ts` alone is safe). */
const RENAMED = /^(.+?)(?:Fixed|Corrected|Copy|Old|Backup|[-_. ](?:fixed|corrected|copy|old|backup))(\.[A-Za-z0-9]+)$/;

const SAFE_PATH = /^[A-Za-z0-9._/-]+$/;

/** The project file this one is a scratch copy of, or null. `exists` answers for workspace-relative paths. PURE. */
export function scratchCopyOriginal(path: string, exists: (p: string) => boolean): string | null {
  const p = String(path ?? '').replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
  if (!p || !SAFE_PATH.test(p) || p.split('/').includes('..')) return null;
  if (/(^|\/)(?:node_modules|\.git|dist|build|\.next|coverage)\//.test(p)) return null;
  const slash = p.lastIndexOf('/');
  const dir = slash >= 0 ? p.slice(0, slash + 1) : '';
  const base = p.slice(slash + 1);
  const candidates: string[] = [];
  const a = APPENDED.exec(base);
  if (a) candidates.push(a[1]!);
  const i = INFIX.exec(base);
  if (i) candidates.push(`${i[1]}${i[2]}`);
  const r = RENAMED.exec(base);
  if (r && r[1]) candidates.push(`${r[1]}${r[2]}`);
  for (const c of candidates) {
    const original = `${dir}${c}`;
    if (original !== p && exists(original)) return original;
  }
  return null;
}

/** The name the mention check looks for: the stem of a code copy (how an import names it), else the whole file name. */
export function scratchCopyToken(path: string): string {
  const base = String(path ?? '').split('/').pop() ?? '';
  if (APPENDED.test(base)) return base;
  return base.replace(/\.[A-Za-z0-9]+$/, '');
}

export interface ScratchCopyDecision {
  /** Candidates that pass the name, authorship and request checks; each still needs the mention check. */
  candidates: Array<{ path: string; original: string; token: string }>;
  /** Scratch-shaped files the user's request names — kept, and said so. */
  askedFor: string[];
}

/** Which files are scratch copies this build made. The mention check is the caller's (it reads the sandbox). PURE. */
export function scratchCopyCandidates(input: {
  listing: readonly string[];
  writtenThisBuild: Iterable<string>;
  existedAtStart: readonly string[];
  request: string;
  env?: NodeJS.ProcessEnv;
}): ScratchCopyDecision {
  if (!scratchCopyRemovalEnabled(input.env)) return { candidates: [], askedFor: [] };
  const norm = (s: string) => String(s ?? '').replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
  const present = new Set(input.listing.map(norm));
  const before = new Set(input.existedAtStart.map(norm));
  const request = String(input.request ?? '').toLowerCase();
  const candidates: ScratchCopyDecision['candidates'] = [];
  const askedFor: string[] = [];
  for (const raw of new Set([...input.writtenThisBuild].map(norm))) {
    if (!present.has(raw) || before.has(raw)) continue;
    const original = scratchCopyOriginal(raw, (p) => present.has(p));
    if (!original) continue;
    const token = scratchCopyToken(raw);
    const base = raw.split('/').pop() ?? raw;
    if (request.includes(base.toLowerCase()) || (token.length >= 4 && request.includes(token.toLowerCase()))) {
      askedFor.push(raw);
      continue;
    }
    candidates.push({ path: raw, original, token });
  }
  return { candidates: candidates.sort((x, y) => x.path.localeCompare(y.path)), askedFor: askedFor.sort() };
}

/** The sandbox command that asks whether any project file mentions `token` (fixed string; deps and output skipped). */
export function mentionGrepCommand(token: string): string | null {
  if (!/^[A-Za-z0-9._-]{3,}$/.test(token)) return null;
  return `grep -rlF --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build --exclude-dir=.next -- '${token}' . 2>/dev/null; echo "NBAI_GREP_EXIT:$?"`;
}

/** Read that command's answer: TRUE when a file other than `path` matched, FALSE on no match, NULL when unknown. PURE. */
export function parseMentionGrep(stdout: string | null | undefined, path: string): boolean | null {
  const out = String(stdout ?? '');
  const exit = /NBAI_GREP_EXIT:(\d+)/.exec(out)?.[1];
  if (exit === '1') return false;
  if (exit !== '0') return null;
  const self = String(path ?? '').replace(/^(?:\.\/)+/, '');
  return out.split('\n').map((l) => l.trim().replace(/^\.\//, '')).some((l) => l && !l.startsWith('NBAI_GREP_EXIT:') && l !== self);
}

/** The report line. '' when there is nothing to say. PURE. */
export function scratchCopyNote(removed: ReadonlyArray<{ path: string; original: string }>, keptMentioned: readonly string[], askedFor: readonly string[]): string {
  const parts: string[] = [];
  if (removed.length) {
    parts.push(`Removed ${removed.length} scratch cop${removed.length === 1 ? 'y' : 'ies'} the builder made of project files and left behind: `
      + `${removed.map((r) => `${r.path} (a copy of ${r.original})`).join(', ')} — nothing in the app referenced them, so nothing on screen changes, `
      + 'and they no longer ship with the project or get compiled with it.');
  }
  if (keptMentioned.length) parts.push(`Kept ${keptMentioned.join(', ')}: named like a scratch copy, but something in the project refers to it.`);
  if (askedFor.length) parts.push(`Kept ${askedFor.join(', ')}: named like a scratch copy, but the request names it.`);
  return parts.join(' ');
}

/** What `applyScratchCopyNet` needs from the dispatcher — narrow on purpose, so a test passes a fake. */
export interface ScratchCopyNetDeps {
  listProjectFiles(): Promise<string[]>;
  writtenThisBuild(): string[];
  /** TRUE when a file other than `path` mentions `token`; FALSE when none does; NULL when it could not be checked. */
  mentionedOutside(path: string, token: string): Promise<boolean | null>;
  removeLeftoverFiles(paths: readonly string[]): Promise<string[]>;
}
export interface ScratchCopyNetReport {
  record(issue: { phase: 'build'; severity: 'info'; code: string; message: string; autoResolved: boolean }): void;
}

/** The end-of-turn net (layer two). Best-effort: any failure removes nothing. Never throws. Returns the removed paths. */
export async function applyScratchCopyNet(
  deps: ScratchCopyNetDeps, report: ScratchCopyNetReport, input: { request: string; existedAtStart: readonly string[] },
  env: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  try {
    if (!scratchCopyRemovalEnabled(env)) return [];
    const written = deps.writtenThisBuild();
    if (written.length === 0) return [];
    const listing = await deps.listProjectFiles();
    const decision = scratchCopyCandidates({ listing, writtenThisBuild: written, existedAtStart: input.existedAtStart, request: input.request, env });
    const remove: Array<{ path: string; original: string }> = [];
    const keptMentioned: string[] = [];
    for (const c of decision.candidates) {
      const mentioned = await deps.mentionedOutside(c.path, c.token).catch(() => null);
      if (mentioned === false) remove.push(c);
      else if (mentioned === true) keptMentioned.push(c.path);
      // null: could not check — kept silently, exactly as before this net existed.
    }
    const gone = remove.length ? new Set(await deps.removeLeftoverFiles(remove.map((r) => r.path))) : new Set<string>();
    const removed = remove.filter((r) => gone.has(r.path));
    const line = scratchCopyNote(removed, keptMentioned, decision.askedFor);
    if (line) report.record({ phase: 'build', severity: 'info', code: 'SCRATCH_COPIES', message: line, autoResolved: true });
    return removed.map((r) => r.path);
  } catch {
    return [];
  }
}
