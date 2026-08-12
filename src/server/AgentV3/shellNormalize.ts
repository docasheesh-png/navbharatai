// AgentV3 — what bash will ACTUALLY run, as opposed to what the command line says.
//
// THE BUG CLASS THIS KILLS. Every shell guard in this engine — the source-destruction guard, the
// command-risk classifier, the dependency-mutation guard — reads a command as literal text and matches
// patterns against it. Bash does not read it that way. Before a single byte reaches `rm`, bash has
// unwrapped nested shells, joined line continuations, removed quotes and escapes from inside words, and
// expanded globs. So the guard and the shell are reading two different commands, and every gap between
// those two readings is a bypass.
//
// Nine of them were confirmed against the live guard on 2026-08-12, all of which delete the app's own
// source while the guard says nothing:
//
//     bash -c "rm -rf src"          sh -c 'rm -rf src'           eval "rm -rf src"
//     node -e "fs.rmSync('src',…)"  python3 -c "shutil.rmtree()" rm --recursive --force src
//     rm -rf src*                   rm -rf s""rc                 rm -rf sr\c
//
// None of these is exotic. `bash -c` and `rm -rf src*` are things a model writes on an ordinary
// Tuesday, and the PaisaTrack failure this guard exists for — the builder wiping `src/components`
// `src/hooks` `src/types` `src/utils` to "fix" two tsc errors — would have gone through unblocked if it
// had reached for any one of them.
//
// THE FIX IS THE CLASS, NOT THE NINE. Adding nine patterns would leave the tenth. Instead, guards stop
// matching the raw line and start matching what bash would see: `shellCommandVariants()` returns the
// original plus every command it hands to another interpreter, and `unquoteToken()` reads a word the way
// bash's quote removal does. One shared normalizer, so the fix cannot drift between the guards the way
// the four copies of safeRelPath once did.
//
// THIS IS NOT A SHELL PARSER, AND MUST NOT BE MISTAKEN FOR ONE. It is deliberately over-inclusive: it
// returns candidate commands for a guard to inspect, and a guard blocking one command too many costs a
// model one retry, while missing one costs the user their app. Anything relying on this for a
// correctness decision rather than a safety decision is using it wrong.
//
// PURE. No I/O, no clock. Bounded recursion. Never throws.

/** How many layers of `sh -c "sh -c '…'"` to unwrap before giving up. Depth beyond this is not a real
 *  build command; it is someone probing the guard, and the outer layers are already flagged. */
const MAX_UNWRAP_DEPTH = 4;

/** How many variants to return, so a pathological input cannot make a guard do unbounded work. */
const MAX_VARIANTS = 24;

/**
 * Join bash line continuations (`\` at end of line) into one line.
 *
 * Without this, `rm -rf \<newline> src` splits into a segment holding the verb and a segment holding the
 * target, and every guard that scans per-segment sees a harmless `rm -rf` and a harmless `src`.
 */
export function joinLineContinuations(command: string): string {
  return String(command ?? '').replace(/\\[ \t]*\r?\n[ \t]*/g, ' ');
}

/**
 * A word as bash sees it after quote removal, escape removal and ANSI-C quoting.
 *
 *   s""rc → src        sr\c → src        $'src' → src        "src" → src        'sr'"c" → src
 *
 * The whole trick in the confirmed bypasses is that these all name `src` while sharing no substring
 * with it. A guard comparing the raw token to a directory name can never see that.
 *
 * `$VAR` and `$(cmd)` are deliberately left alone: their value is unknown here, and inventing one would
 * be worse than leaving the token visibly unexpanded for the caller to treat with suspicion.
 */
export function unquoteToken(token: string): string {
  let t = String(token ?? '');
  // $'...' — ANSI-C quoting. Handled before generic quote removal so the leading `$` goes with it.
  t = t.replace(/\$'((?:[^'\\]|\\.)*)'/g, '$1');
  // $"..." — locale translation; the value is the literal string.
  t = t.replace(/\$"((?:[^"\\]|\\.)*)"/g, '$1');
  let out = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < t.length; i += 1) {
    const c = t[i];
    if (quote === "'") {
      if (c === "'") quote = null;
      else out += c;
      continue;
    }
    if (c === '\\') {
      // Inside double quotes a backslash only escapes a few characters; outside, it escapes anything.
      const next = t[i + 1];
      if (next === undefined) { out += '\\'; break; }
      if (quote === '"' && !['"', '\\', '$', '`', '\n'].includes(next)) { out += c; continue; }
      out += next;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'") {
      if (quote === null) quote = c as '"' | "'";
      else if (quote === c) quote = null;
      else out += c;
      continue;
    }
    out += c;
  }
  return out;
}

/**
 * Shells that take a command as a string argument.
 *
 * The intervening words are matched loosely (`\S+`, lazily, up to four) rather than as flags, because
 * `bash -euo pipefail -c "…"` is the single most common real form and `pipefail` is not a flag. Being
 * loose here can at worst make a guard inspect one extra string.
 */
const SHELL_WRAPPERS = /\b(?:ba|z|k|da)?sh\s+(?:\S+\s+){0,4}?-c\s+/i;
/** `eval` takes its arguments as a command, with or without quotes. */
const EVAL_WRAPPER = /(?:^|[;&|]\s*|\bthen\b\s*|\bdo\b\s*)eval\s+/i;
/**
 * An interpreter shelling out — `execSync('rm -rf src')`, `os.system("…")`.
 *
 * This belongs with the wrappers rather than with the tree-removal detector: the captured string is a
 * COMMAND, not a path, so handing it to a path classifier finds nothing (`rm -rf src` is not a
 * directory name) while handing it back to the command analyzer catches it exactly.
 */
const INTERPRETER_SHELL_OUT = /\b(?:system|execSync|exec|spawnSync|popen|check_output|check_call)\s*\(\s*/i;

/**
 * Pull the command string out of a wrapper: `bash -c "rm -rf src"` → `rm -rf src`.
 *
 * Returns every wrapped command found, unquoted. An unterminated or unquoted wrapper still yields the
 * remainder of the line, because `eval rm -rf src` is as real as `eval "rm -rf src"`.
 */
function extractWrapped(command: string): string[] {
  const out: string[] = [];
  for (const wrapper of [SHELL_WRAPPERS, EVAL_WRAPPER, INTERPRETER_SHELL_OUT]) {
    const re = new RegExp(wrapper.source, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(command))) {
      const rest = command.slice(m.index + m[0].length).trim();
      if (!rest) continue;
      const q = rest[0];
      if (q === '"' || q === "'" || q === '`') {
        // Find the matching close quote, respecting backslash escapes.
        let i = 1;
        let body = '';
        for (; i < rest.length; i += 1) {
          if (rest[i] === '\\' && rest[i + 1] !== undefined) { body += rest[i + 1]; i += 1; continue; }
          if (rest[i] === q) break;
          body += rest[i];
        }
        if (body.trim()) out.push(body.trim());
      } else {
        // Unquoted: the rest of this command, up to a separator that ends it.
        const body = rest.split(/[;\n]|&&|\|\|/)[0].trim();
        if (body) out.push(body);
      }
    }
  }
  return out;
}

/**
 * Every command line a guard must inspect for one input: the original, plus everything it hands to
 * another shell, recursively and bounded.
 *
 * The first element is always the (continuation-joined) original, so a caller that only looks at
 * `variants[0]` degrades to today's behaviour rather than to nothing.
 */
export function shellCommandVariants(command: string, maxDepth = MAX_UNWRAP_DEPTH): string[] {
  const first = joinLineContinuations(command).trim();
  if (!first) return [];
  const seen = new Set<string>([first]);
  const out: string[] = [first];
  let frontier = [first];
  for (let depth = 0; depth < Math.max(0, maxDepth) && out.length < MAX_VARIANTS; depth += 1) {
    const next: string[] = [];
    for (const cmd of frontier) {
      for (const inner of extractWrapped(cmd)) {
        if (seen.has(inner) || out.length >= MAX_VARIANTS) continue;
        seen.add(inner);
        out.push(inner);
        next.push(inner);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return out;
}

/**
 * A recursive tree removal written in an interpreter one-liner rather than in shell.
 *
 * `node -e "require('fs').rmSync('src',{recursive:true})"` is the same catastrophe as `rm -rf src` and
 * shares not one character with it, so no amount of shell-pattern work would ever have caught it. The
 * TARGET is returned so the caller can decide whether it is protected source — this function never
 * decides that itself, because "which paths are the app's own source" belongs in exactly one place.
 */
export function interpreterTreeRemovalTargets(command: string): string[] {
  const cmd = joinLineContinuations(command);
  // Only look inside an actual `-e` / `-c` one-liner; a project file that happens to call rmSync is
  // the app's own code and none of our business.
  if (!/\b(node|nodejs|bun|deno|python[0-9.]*|ruby|perl|php)\b[^\n]*\s(-e|--eval|-c|-p)\b/i.test(cmd)) return [];
  const out: string[] = [];
  const patterns: RegExp[] = [
    /\brm(?:Sync)?\s*\(\s*['"`]([^'"`]+)/gi,                         // fs.rmSync('src', …) / fs.rm('src')
    /\brmdir(?:Sync)?\s*\(\s*['"`]([^'"`]+)/gi,                      // fs.rmdirSync('src', {recursive})
    /\bremove(?:Sync)?\s*\(\s*['"`]([^'"`]+)/gi,                     // fs-extra remove('src')
    /\brmtree\s*\(\s*['"`]([^'"`]+)/gi,                              // shutil.rmtree('src')
    /\brm_rf\s*\(?\s*['"`]([^'"`]+)/gi,                              // FileUtils.rm_rf 'src'
    /\brmtree\s*\(?\s*['"`]([^'"`]+)/gi,                             // File::Path::rmtree
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(cmd))) if (m[1] && !out.includes(m[1])) out.push(m[1]);
  }
  // An interpreter shelling out is handled by shellCommandVariants instead: what it captures is a
  // COMMAND, and a path classifier asked about `rm -rf src` correctly answers "that is not a path".
  return out;
}

/** Glob metacharacters that make a token match more paths than it spells. */
const GLOB_META = /[*?[\]{}]/;

/**
 * `${VAR}` is a variable, not a brace expansion.
 *
 * Treating its braces as glob metacharacters truncated `${PWD}/src` to a literal prefix of `$`, which
 * matches no source directory — so a path that had always been caught started passing. Brace EXPANSION
 * (`src/{a,b}`) keeps its braces and stays a glob.
 */
const blankVariables = (t: string): string => t.replace(/\$\{[^}]*\}/g, '$VAR');

/** Does this token contain a glob? */
export function hasGlob(token: string): boolean {
  return GLOB_META.test(blankVariables(token));
}

/**
 * The literal text a glob is anchored on: `src*` → `src`, `src/**\/*.tsx` → `src/`, `*` → ``.
 *
 * A guard cannot know what a glob expands to without a filesystem, but it always knows what the glob
 * STARTS with, and that is enough to answer "could this possibly match the app's source directory?".
 */
export function globLiteralPrefix(token: string): string {
  const t = unquoteToken(token);
  const at = blankVariables(t).search(GLOB_META);
  return at < 0 ? t : t.slice(0, at);
}
