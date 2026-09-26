// AgentV3 — pure helper for the post-build TypeScript compile gate.
//
// Both the fast lane (SimpleBuilder.fastVerify) and the new agentic-loop gate need to answer the same
// question from raw `tsc --noEmit` output: "did the compiler report a real type error?". Keeping that
// decision in ONE pure, unit-tested function stops the two call-sites from drifting apart (one of them
// treating a warning as a failure, or missing a real error) — the same single-parser discipline used
// by ContractMap. PURE & deterministic (string in → boolean out), so it is fully testable.

/**
 * True when `tsc --noEmit` output contains at least one real TypeScript compile error (`error TSxxxx`).
 * Warnings, clean runs, and empty/undefined output are all NOT failures. Pure.
 */
export function hasTscErrors(output: string | null | undefined): boolean {
  if (!output) return false;
  return /error TS\d+/.test(output);
}

/**
 * How many real TypeScript diagnostics the output contains.
 *
 * Lives beside `hasTscErrors` on purpose — same single-parser discipline. A repair is only worth
 * keeping if it made the compiler quieter, and answering "quieter?" needs a COUNT, not a boolean.
 * `hasTscErrors` cannot tell 4 errors from 41, which is exactly how a repair that quadrupled the
 * error count was accepted and written over a working file (real build report 2026-08-23).
 *
 * Counts `error TS####` occurrences. tsc's own trailer ("Found 41 errors in 7 files.") carries no
 * `error TS`, so it cannot inflate the count. Pure.
 */
export function countTscErrors(output: string | null | undefined): number {
  if (!output) return 0;
  return (output.match(/error TS\d+/g) ?? []).length;
}

/**
 * True when `tsc --noEmit` output is the CLI HELP/version page rather than a real compile result —
 * what `tsc` prints when there is no tsconfig.json AND no input files, exiting 0. Treating that as a
 * clean pass is a FALSE pass: the type-check never actually ran (a real report hit exactly this — a
 * config-less project's `tsc` "passed" while runtime types were broken). Callers should ensure a
 * tsconfig exists (so tsc really verifies) instead of trusting this output. Pure.
 */
export function looksLikeTscHelpOutput(output: string | null | undefined): boolean {
  if (!output) return false;
  return /tsc:\s*The TypeScript Compiler|COMMON COMMANDS|Compiles the current project|tsc \[options\]|Version\s+\d+\.\d+\.\d+[\s\S]*Syntax:/.test(output);
}

/**
 * True when the shell never found the compiler at all — `tsc` was not installed, or the path was
 * wrong — so the command printed a SHELL message instead of a compile result.
 *
 * WHY THIS EXISTS (admin report, build f2ff962f, 2026-09-12): the agent ran
 * `./node_modules/.bin/tsc --noEmit 2>&1 | head -40` before `npm install`, got
 * `/bin/bash: line 1: ./node_modules/.bin/tsc: No such file or directory`, and the pipe reported
 * exit 0. That output contains no `error TS`, so every reader here scored it as a CLEAN typecheck —
 * a pass for a compiler that never started. A missing binary is not evidence either way, exactly like
 * the help page above. Matched on the shell's own phrasings (bash, dash/sh, npm), never on a bare
 * word, so a real compile result that mentions "not found" in a message is never swallowed. Pure.
 */
export function looksLikeMissingTscBinary(output: string | null | undefined): boolean {
  if (!output) return false;
  return /(?:^|\n)\s*(?:[\w./-]*sh|bash|zsh):\s*(?:line\s+\d+:\s*|\d+:\s*)?\S*tsc\S*:\s*(?:command\s+)?(?:not found|No such file or directory|Permission denied)/i.test(output)
    || /\btsc:\s*(?:command\s+)?not found\b/i.test(output)
    || /could not determine executable to run/i.test(output);
}

/**
 * The one question every reader of `tsc --noEmit` output must ask first: did the compiler really run?
 * The help page and a missing binary are both "no" — neither is a pass and neither is a failure.
 * Pure.
 */
export function tscNeverRan(output: string | null | undefined): boolean {
  return looksLikeTscHelpOutput(output) || looksLikeMissingTscBinary(output);
}

/**
 * Does this `tsc --noEmit` output PROVE the project compiles? Stricter than `!hasTscErrors` on purpose:
 * zero `error TS` lines is also what a help page, a missing binary and a failed install print, and a
 * "clean" read off any of those would resolve real errors from memory and tell agents "tsc already
 * checked clean" — the claim the verification ledger acts on. Only an output that is none of those
 * counts. An EMPTY output is the genuinely clean case (tsc prints nothing on success). Pure.
 */
export function tscOutputProvesClean(output: string | null | undefined): boolean {
  const out = String(output ?? '');
  // "Did the compiler run?" is asked ONCE, by `tscNeverRan` (help page, missing binary) — this adds only
  // what that question does not cover: an install that failed before tsc could start.
  if (hasTscErrors(out) || tscNeverRan(out)) return false;
  return !/command not found|: not found|No such file or directory|ENOENT|Cannot find module 'typescript'|npm ERR!|npm error/i.test(out);
}

/**
 * True when a shell command LOOKS LIKE a stand-alone typecheck run — `tsc` invoked with `--noEmit`
 * (the check-only flag). Deliberately narrow: a build script that merely contains the substring "tsc"
 * (`npm run build` → `tsc && vite build`, which EMITS) is not the same claim as "a check-only compile
 * ran and we can read its verdict from the output" — only `--noEmit` runs are unambiguous either way.
 * Pure.
 */
export function looksLikeTypecheckCommand(command: string | null | undefined): boolean {
  if (!command) return false;
  return /\btsc\b/.test(command) && /--noEmit\b/.test(command);
}

/**
 * Did the AGENT ITSELF already run a genuine typecheck as part of its own workflow, and what did it
 * find? Scans a build's own recorded shell-command history — the SAME log a build report already
 * shows under `commands` — for the LATEST command that looks like a typecheck (see
 * `looksLikeTypecheckCommand`), and reads its combined stdout+stderr with the SAME parser the
 * deterministic post-build gate trusts (`hasTscErrors`) rather than the command's shell exit code: a
 * piped invocation (`tsc --noEmit | head -40`, seen in a real build report) reports the exit code of
 * the LAST pipeline stage, not tsc's own, so exit code alone cannot be trusted here.
 *
 * WHY THIS EXISTS (production build report, 2026-09-16): the release gate's `typecheck` evidence is
 * populated ONLY by the deterministic G3 gate, which itself only runs when the build is already marked
 * `ok` at that point in the pipeline — so a build the engine had not yet called successful never even
 * attempted G3, and the gate evidence stayed the generic default. In that report the agent had ALREADY
 * run `tsc --noEmit` twice on its own, both clean, visible in the SAME report's own `commands` log —
 * yet the release gate told the user "the typecheck did not run", a claim its own evidence
 * contradicted a few hundred lines above it in the same report. This is the fallback for exactly that
 * gap: when the deterministic gate genuinely never ran, fall back to evidence the agent already
 * produced instead of a fixed "not-run" that can be false.
 *
 * Deliberately conservative in both directions: `undefined` whenever nothing in the log looks like a
 * real, completed typecheck (a build that never touches tsc is not silently promoted), and a command
 * whose output is the tsc HELP page (see `looksLikeTscHelpOutput`) is skipped rather than counted as a
 * clean pass, for the same reason the deterministic gate itself refuses to trust one. Pure.
 */
export function typecheckEvidenceFromCommands(
  commands: ReadonlyArray<{ command: string; stdout?: string | null; stderr?: string | null }>,
): 'passed' | 'failed' | undefined {
  let verdict: 'passed' | 'failed' | undefined;
  for (const c of commands) {
    if (!looksLikeTypecheckCommand(c?.command)) continue;
    const out = `${c.stdout ?? ''}\n${c.stderr ?? ''}`;
    if (tscNeverRan(out)) continue; // never really ran (help page / missing binary) — not evidence either way
    // Latest wins — a later run supersedes an earlier one (the agent may have fixed errors in between).
    verdict = hasTscErrors(out) ? 'failed' : 'passed';
  }
  return verdict;
}
