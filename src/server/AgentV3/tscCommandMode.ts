// Explicit compiler modes, not a general shell-execution proof. A successful version/config/listing
// command did not typecheck. Keep this separate from the output reader: real diagnostics still win.
import ts from 'typescript';
import { TSC_BIN, TSC_ENSURE } from './tscCommand';

export type TscCommandMode = 'checking' | 'not-checking' | 'unknown';

/** Parse argv only, with no filesystem access, config resolution, subprocess or compiler execution. */
export function tscModeFromArgs(args: readonly string[]): TscCommandMode {
  // parseBuildCommand has no readFile override. Reject response files BEFORE either parser, including
  // a response token used as an option value: its meaning cannot be established from this log alone.
  if (args.some((arg) => arg.startsWith('@'))) return 'unknown';
  if (ts.isBuildCommand(args)) {
    const parsed = ts.parseBuildCommand(args);
    if (parsed.errors.length) return 'unknown';
    const o = parsed.buildOptions;
    if (o.help || o.dry || o.clean || o.noCheck) return 'not-checking';
    return o.watch ? 'unknown' : 'checking';
  }
  const parsed = ts.parseCommandLine(args, () => undefined);
  if (parsed.errors.length) return 'unknown';
  const o = parsed.options;
  if (o.version || o.help || o.all || o.init || o.showConfig || o.listFilesOnly || o.noCheck) return 'not-checking';
  return o.watch ? 'unknown' : 'checking';
}

/** A bounded literal-word reader, not a shell parser. Operators/expansion are never executed. */
function literalCommand(input: string): { words: string[]; rawWords: string[]; rest: string; complete: boolean } {
  const words: string[] = [];
  const rawWords: string[] = [];
  let word = '', started = false, start = 0, quote: "'" | '"' | undefined;
  const flush = (end: number) => { if (started) { words.push(word); rawWords.push(input.slice(start, end)); } word = ''; started = false; };
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (!started) start = i;
    if (quote === "'") {
      if (ch === quote) quote = undefined;
      else word += ch;
      continue;
    }
    if (ch === '\\') {
      if (i + 1 === input.length || input[i + 1] === '\n') return { words, rawWords, rest: '', complete: false };
      // Inside double quotes, backslash only escapes these characters. Other backslashes are data.
      if (quote === '"' && !/["\\$`]/.test(input[i + 1])) { word += ch; continue; }
      word += input[++i]; started = true; continue;
    }
    if (ch === '$' || ch === '`') return { words, rawWords, rest: '', complete: false };
    if (quote === '"') {
      if (ch === quote) quote = undefined;
      else word += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; started = true; continue; }
    if (ch === '\n' || ch === '\r' || /[(){}*\[]/.test(ch) || (ch === '~' && !started)) return { words, rawWords, rest: '', complete: false };
    // -? / --? are TypeScript help aliases. Other unquoted question marks could be shell globs.
    if (ch === '?' && !(/^-{1,2}$/.test(word) && (i + 1 === input.length || /\s|[;&|<>]/.test(input[i + 1])))) return { words, rawWords, rest: '', complete: false };
    if (/\s/.test(ch)) { flush(i); continue; }
    if (ch === '#' && !started) return { words, rawWords, rest: '', complete: true };
    if ((!started && input.startsWith('2>&1', i)) || /[;&|<>]/.test(ch)) {
      flush(i); return { words, rawWords, rest: input.slice(i), complete: true };
    }
    word += ch; started = true;
  }
  if (quote) return { words, rawWords, rest: '', complete: false };
  flush(input.length);
  return { words, rawWords, rest: '', complete: true };
}

function shellCommandStart(rawWords: readonly string[]): number {
  let at = 0;
  while (/^[A-Za-z_]\w*=/.test(rawWords[at] ?? '')) at++;
  return at;
}

/** Only transparent, literal invocation forms. A tsc word in echo/node -e data is not executable argv. */
function compilerArgs(words: readonly string[], rawWords: readonly string[]): string[] | undefined {
  let at = shellCommandStart(rawWords);
  if (words[at] === 'exec') { at++; if (words[at] === '--') at++; }
  if (words[at] === 'env' || words[at] === 'cross-env') {
    at++;
    while (/^[A-Za-z_]\w*=/.test(words[at] ?? '')) at++;
  }
  if (words[at] === 'npx') {
    at++;
    while (/^(?:--no-install|--yes|-y)$/.test(words[at] ?? '')) at++;
    if (words[at] === '--') at++;
  }
  if (!/^(?:tsc|(?:\.\/)?node_modules\/\.bin\/tsc)$/.test(words[at] ?? '')) return undefined;
  return words.slice(at + 1);
}

/** The known ensure wrapper can be complete or the report's head + ellipsis + tail representation. */
function withoutCanonicalEnsure(command: string): string {
  const marker = `; ${TSC_BIN} `;
  // The same text may occur INSIDE a quoted project path. Only the delimiter whose prefix matches
  // our actual wrapper is structural; taking the last match would let that path shadow the compiler.
  for (let at = command.indexOf(marker); at >= 0; at = command.indexOf(marker, at + marker.length)) {
    const prefix = command.slice(0, at);
    const parts = prefix.split(' … ');
    const canonical = prefix === TSC_ENSURE || (parts.length === 2 && parts.every(Boolean)
      && parts[0].length + parts[1].length < TSC_ENSURE.length
      && TSC_ENSURE.startsWith(parts[0]) && TSC_ENSURE.endsWith(parts[1]));
    if (canonical) return command.slice(at + 2);
  }
  return command;
}

const OUTPUT_PIPE = /^(?:2>&1\s*)?(?:\|\s*(?:head|tail)(?:\s+(?:-\d+|-n\s+\d+))?\s*)?(?:\|\|\s*true\s*)?$/;

/**
 * Add command context only where literal compiler argv is recoverable. Unknown argv for a recognised
 * compiler abstains. An opaque legacy wrapper returns undefined, preserving the existing recognizer
 * rather than pretending this small reader understands conditionals, substitutions or shell scripts.
 */
export function explicitTscCommandMode(command: string): TscCommandMode | undefined {
  let rest = withoutCanonicalEnsure(command.trim());
  const modes: TscCommandMode[] = [];
  while (rest) {
    const part = literalCommand(rest);
    const args = compilerArgs(part.words, part.rawWords);
    if (args) modes.push(part.complete ? tscModeFromArgs(args) : 'unknown');
    if (!part.complete) return modes.length ? 'unknown' : undefined;
    rest = part.rest.trim();
    // exec replaces this shell. Later && clauses cannot provide a typecheck the exec did not run.
    const execAt = shellCommandStart(part.rawWords);
    if (part.words[execAt] === 'exec') {
      const payload = execAt + (part.words[execAt + 1] === '--' ? 2 : 1);
      if (part.words[payload]?.startsWith('-')) return modes.length ? 'unknown' : undefined;
      // Bare exec (including exec --) replaces nothing and the next && clause still runs.
      if (part.words[payload] && (!rest || rest.startsWith('&&'))) break;
    }
    if (rest.startsWith('&&')) { rest = rest.slice(2).trim(); if (!rest) return modes.length ? 'unknown' : undefined; continue; }
    if (rest && !OUTPUT_PIPE.test(rest)) return modes.length ? 'unknown' : undefined;
    break;
  }
  // One real checking invocation in a supported linear chain is enough; a later version probe is not
  // evidence that the earlier compile disappeared. Unknown compiler args prevent a positive claim.
  if (modes.includes('unknown')) return 'unknown';
  if (modes.includes('checking')) return 'checking';
  return modes.length ? 'not-checking' : undefined;
}

/** Positive eligibility for npm's echoed build script: literal && chaining only, never a substring. */
export function buildScriptChecksTypes(script: string): boolean {
  let rest = script.trim(), checkedBeforeNext = false;
  while (rest) {
    const part = literalCommand(rest);
    if (!part.complete || !part.words.length) return false;
    // These words introduce shell grammar, not a simple command in the supported && chain.
    if (/^(?:!|if|then|else|elif|fi|for|while|until|do|done|case|esac|select|function)$/.test(part.words[0])) return false;
    // exec replaces the shell even when its payload is not tsc, so later clauses are unreachable.
    if (part.words[shellCommandStart(part.rawWords)] === 'exec') return false;
    rest = part.rest.trim();
    if (!rest) return checkedBeforeNext;
    if (!rest.startsWith('&&')) return false;
    const args = compilerArgs(part.words, part.rawWords);
    // An earlier arbitrary command could have printed the bundle marker and then stopped the chain
    // before tsc (the outer pipe can hide that failure). Only compiler clauses may precede the check.
    if (!args && !checkedBeforeNext) return false;
    if (args) {
      const mode = tscModeFromArgs(args);
      if (mode === 'unknown') return false;
      if (mode === 'checking') checkedBeforeNext = true;
    }
    rest = rest.slice(2).trim();
  }
  return false;
}
