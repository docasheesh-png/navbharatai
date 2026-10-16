// AgentV3 — A SHELL COMMAND THAT CANNOT CHANGE ANYTHING IS NOT WORK.
//
// 🔴 THE REPORT (build `413d29a1`, 2026-10-14 — the MP4→MP3 converter). 171 model calls in 13.4 minutes,
// averaging 52,163 input tokens in and **33 output tokens out**; 166 of them made exactly one tool call and
// 170 of 171 finished with `tool_use` — the model never once tried to stop. Minutes 10–13 are the same
// command over and over:
//
//     : > /tmp/x && node -e 'console.log("noop")'
//
// It cost NavBharatAI **$1.87 of real provider spend** for a build that ended RED and was correctly charged
// ₹0 to the user ("preview is EARNED"). Three separate guards exist that should each have ended it, and not
// one of them could, for the SAME reason.
//
// 🧬 THE CLASS, in this engine's own words — `RepeatProbeGuard`'s header:
//     "🔴 A CALL THAT CANNOT DO ANYTHING IS NOT A CHANGE, and missing that re-broke Q-738 within the hour."
// Q-738 fixed the INSTANCE: `isEmptyCommandCall` recognises a command string that is literally empty. The
// class is "a command that cannot change anything", and a WRITTEN-OUT no-op is the same thing spelled
// differently. Every guard that asks "did anything happen?" was answered yes by a command that did nothing:
//
//   1. `RepeatProbeGuard.noteMutations` — counts a `bash` as a mutation unless the command is empty, and
//      `recordAndCheckRepeat` resets a signature's repeat count whenever the build has mutated since. So the
//      no-op reset ITS OWN repeat count on every call: the loop guard could never reach its threshold, at
//      any repeat count. Not "did not fire" — COULD not fire.
//   2. `RepeatProbeGuard.isNoOpTurn` — consequently never true, so `MAX_NO_OP_TURNS_AFTER_FINAL` could never
//      end a run that does nothing for ever (the exact failure Q-738 was written for).
//   3. `futilityBreaker` — its definition of progress is "a FILE was written, a COMMAND completed, or a PLAN
//      STEP was done", and the route's `noteCommandCompleted` counted every completed command. A no-op exits
//      0, so it completes, so the breaker saw continuous progress for 13.4 minutes of nothing.
//
// 🔭 AND THIS SHAPE HAS BEEN SEEN BEFORE, TWICE, AND WAS WRITTEN DOWN BOTH TIMES:
//   • `repeatedReads.ts` (autopsy "Universal Remote", 2026-09-27): `: > /tmp/empty.css && wc -l /tmp/empty.css`
//     seven times, three minutes, while the user waited.
//   • `devServerLaunchLog.ts`: a model ran `: > /tmp/empty.css && echo done && npm run dev …`.
// Two autopsies described the command and neither gave the engine a way to RECOGNISE it. This module is that
// way, in one place, so the three guards above stop disagreeing about what counts as work.
//
// ⚠️ THE DIRECTION OF THE RISK DECIDES THE DESIGN, so this is deliberately conservative.
//   • A false "real" costs nothing new — it is exactly today's behaviour.
//   • A false "inert" is dangerous: `isNoOpTurn` can end a run after a final steer, so mis-reading a working
//     command as a no-op could stop a build that was genuinely working — the first absolute rule.
// So nothing is inert by default. A command is inert ONLY when every one of its segments matches one of the
// provable forms below, and ANY unrecognised segment, substitution or background job makes the whole command
// real. The test battery proves a wide set of genuine commands — npm, tsc, vite, ffmpeg, git, a redirect into
// `src/`, a `node -e` that touches `fs` — is never inert.
//
// PURE — no clock, no I/O, never throws.

/** Shell constructs whose effect cannot be read from the text, so the command is treated as real. */
const UNKNOWABLE = /\$\(|`|\$\{|<\(/;

/** A background job keeps running after the segment returns, so its effect is not knowable here. */
const BACKGROUNDED = /(^|[^&])&(?!&)/;

/** Paths that cannot be part of the app: the sandbox's scratch area and the null/▸ device files. */
const OUTSIDE_WORKSPACE = /^(?:\/tmp|\/dev|\/var\/tmp)(?:\/|$)/;

/** Reads that answer a question about a path outside the workspace — they change nothing by definition. */
const OUTSIDE_READERS = new Set(['wc', 'cat', 'head', 'tail', 'ls', 'stat', 'file', 'du']);

/** `console.log("x")` / `console.error(1)` and nothing else — a `node -e` body that can only print. */
const PRINT_ONLY = /^console\.(?:log|error|warn|info|debug)\(\s*(?:'[^']*'|"[^"]*"|`[^`$]*`|-?\d+(?:\.\d+)?|true|false|null|undefined)?\s*\)$/;

function argsOf(seg: string): string[] {
  return seg.split(/\s+/).filter(Boolean);
}

/** `node -e '<body>'` / `node --eval "<body>"` whose body can only print. */
function isPrintOnlyNodeEval(seg: string): boolean {
  const m = /^node\s+(?:-e|--eval)\s+(['"])([\s\S]*)\1$/.exec(seg.trim());
  if (!m) return false;
  const body = m[2].trim();
  if (!body) return true;
  // Several print statements are still only printing; one unrecognised statement makes it real.
  return body.split(';').map((s) => s.trim()).filter(Boolean).every((s) => PRINT_ONLY.test(s));
}

/**
 * ONE SEGMENT of a command line: is it provably incapable of changing the workspace?
 *
 * Exported for the tests, which assert each recognised form individually — a battery over the whole command
 * string alone would not show WHICH rule admitted a segment. PURE.
 */
export function isInertSegment(segment: string): boolean {
  const seg = segment.trim();
  if (seg === '') return true; // a trailing `;` or a blank line between two real segments
  if (UNKNOWABLE.test(seg)) return false;

  // `:`, `true`, `false` — shell builtins that exist to do nothing.
  if (/^(?::|true|false)$/.test(seg)) return true;

  // `sleep 3` — it changes nothing (and the clock is bounded elsewhere).
  if (/^sleep\s+\d+(?:\.\d+)?$/.test(seg)) return true;

  // A redirect whose TARGET is outside the workspace: `: > /tmp/x`, `>> /dev/null`. The target decides it,
  // so a redirect into the project (`: > src/App.tsx`) is never inert.
  const redirect = /^:?\s*>{1,2}\s*(\S+)$/.exec(seg);
  if (redirect) return OUTSIDE_WORKSPACE.test(redirect[1]);

  // `echo …` / `printf …` that writes to stdout only. Any redirect makes it a write, so it is excluded here
  // and handled by the rule above only when the target is outside the workspace.
  if (/^(?:echo|printf)\b/.test(seg)) {
    if (/[<>]/.test(seg)) {
      const to = /[^<>]*>{1,2}\s*(\S+)\s*$/.exec(seg);
      return !!to && OUTSIDE_WORKSPACE.test(to[1]);
    }
    return true;
  }

  // A read of a path outside the workspace: `wc -l /tmp/empty.css` (the Universal Remote autopsy's own loop).
  const args = argsOf(seg);
  if (args.length >= 2 && OUTSIDE_READERS.has(args[0]) && !/[<>]/.test(seg)) {
    const paths = args.slice(1).filter((a) => !a.startsWith('-'));
    return paths.length > 0 && paths.every((pth) => OUTSIDE_WORKSPACE.test(pth));
  }

  // `node -e 'console.log("noop")'` — the reported build's own second half.
  if (isPrintOnlyNodeEval(seg)) return true;

  return false; // ← anything unrecognised is REAL. Today's behaviour, and the safe direction.
}

/**
 * Is this whole command provably incapable of changing anything?
 *
 * True only when the command has at least one segment and EVERY segment is inert. A non-string, or a command
 * whose text carries a background job, is not inert (an empty string is — see `isEmptyCommandCall`). PURE.
 */
export function isInertCommand(command: unknown): boolean {
  if (typeof command !== 'string') return false;
  const raw = command.trim();
  if (raw === '') return true;
  if (UNKNOWABLE.test(raw) || BACKGROUNDED.test(raw)) return false;
  // 🔑 THE QUOTED `node -e` BODY IS ASKED FOR WHOLE, BEFORE SPLITTING. The split below is NOT quote-aware,
  // so `node -e 'console.log("a"); console.error("b")'` would be torn in half and neither half would parse.
  // Only this form is tried whole, because its regex is anchored at BOTH ends and closes its own quote: a
  // `node -e 'x' && npm run build` cannot match it. Trying, say, the `echo` rule whole would be unsafe —
  // `echo a && npm run build` starts with `echo` and would read as inert, which is the dangerous direction.
  if (isPrintOnlyNodeEval(raw)) return true;
  // ⚠️ AND A NAIVE SPLIT IS SAFE HERE for everything else, because an unrecognised fragment is REAL: a `;`
  // or `&&` inside a quoted string tears that segment into pieces that match no rule, so the whole command
  // reads real. Mis-splitting can therefore only ever lose a detection, never invent one.
  const segments = raw.split(/&&|\|\||[;|\n]/);
  if (segments.length === 0) return false;
  return segments.every(isInertSegment);
}
