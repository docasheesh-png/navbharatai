import type { TestFramework } from './testRunner';

/** Literal argv only. Unrecognised shell grammar is not evidence that a runner executed. */
function wordsOf(command: string): string[] | null {
  const words: string[] = [];
  let word = '', started = false, quote = '';
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote === "'") {
      if (ch === quote) quote = '';
      else word += ch;
      continue;
    }
    if (ch === '$' || ch === '`') return null;
    if (ch === '\\') {
      const next = command[++i];
      if (!next || next === '\n') return null;
      if (quote === '"' && !/["\\$`]/.test(next)) word += '\\';
      word += next; started = true; continue;
    }
    if (quote === '"') {
      if (ch === quote) quote = '';
      else word += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      // Quoting an entire assignment makes it an executable name, not a shell assignment.
      if (!started && /^[A-Za-z_]\w*=/.test(command.slice(i + 1))) return null;
      quote = ch; started = true; continue;
    }
    if (/[\r\n;|<>(){}*?\[\]#~]/.test(ch)) return null;
    if (ch === '&') {
      if (command[i + 1] !== '&') return null;
      if (started) words.push(word);
      words.push('&&'); word = ''; started = false; i++; continue;
    }
    if (ch === '>') return null;
    if (/\s/.test(ch)) {
      if (started) words.push(word);
      word = ''; started = false;
    } else { word += ch; started = true; }
  }
  if (quote) return null;
  if (started) words.push(word);
  return words;
}

const ASSIGNMENT = /^[A-Za-z_]\w*=/;
const NON_RUN_OPTION = /^(?:--help|-h|--version|--list|--listTests|--collect-only|--co|--watch(?:All)?(?:=true)?|--ui)$/;

/**
 * Identify the executed binary/script, never a dependency name in package-management argv.
 * Accept transparent launchers and a literal `cd dir &&` prefix. Pipes, arbitrary shell chains,
 * substitutions and command strings passed to node/bash remain unverified.
 */
export function testInvocationFramework(command: string): TestFramework | null {
  let words = wordsOf(command.trim());
  if (!words?.length) return null;
  while (words[0] === 'cd' && words[1] && words[1] !== '&&' && words[2] === '&&') words = words.slice(3);
  if (words.includes('&&') || words.some((word) => NON_RUN_OPTION.test(word))) return null;
  let at = 0;
  while (ASSIGNMENT.test(words[at] ?? '')) at++;
  if (words[at] === 'exec') { at++; if (words[at] === '--') at++; }
  if (words[at] === 'env' || words[at] === 'cross-env') {
    at++;
    while (ASSIGNMENT.test(words[at] ?? '')) at++;
  }
  if (words[at] === 'npx' || words[at] === 'bunx') {
    at++;
    while (/^(?:--no-install|--yes|-y)$/.test(words[at] ?? '')) at++;
    if (words[at] === '--') at++;
  } else if (/^(?:npm|pnpm|yarn|bun)$/.test(words[at] ?? '')) {
    at++;
    if (words[at] === 'exec') { at++; if (words[at] === '--') at++; }
    else {
      if (words[at] === 'run') at++;
      return /^test(?::[\w-]+)?$/.test(words[at] ?? '') && !/watch/.test(words[at]) ? 'npm-script' : null;
    }
  }
  if (/^(?:python|python3)$/.test(words[at] ?? '') && words[at + 1] === '-m' && words[at + 2] === 'pytest') at += 2;
  const executable = words[at] ?? '';
  // A path to an executable is valid; a test filename merely containing its name is not.
  const name = executable.slice(executable.lastIndexOf('/') + 1);
  const args = words.slice(at + 1);
  if (/^(?:playwright|vitest|jest)$/.test(name) && args.includes('-v')) return null;
  switch (name) {
    case 'playwright': return args[0] === 'test' ? 'playwright' : null;
    // Bare Vitest runs once under CI. The evidence reader still requires a completed exit and
    // observed results, so a live watch process cannot become a passing receipt.
    case 'vitest': return /^(?:watch|dev|bench|list|init)$/.test(args[0] ?? '') ? null : 'vitest';
    case 'jest': return 'jest';
    case 'pytest': return 'pytest';
    case 'go': return args[0] === 'test' ? 'go' : null;
    default: return null;
  }
}
