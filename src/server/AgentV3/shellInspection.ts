// IS THIS SHELL COMMAND ONLY LOOKING? (failedbr #2452, 6aed1d6e, 2026-11-18)
//
// 🔴 WHAT HAPPENED. For four minutes a Weak builder made ~35 calls and wrote nothing, and the user stopped it. Almost
// every call was `bash` used as a reader — `cd …; cat …; sed -n 1,80p …; grep -n "^export" … | head`. The exploration
// guard (explorationProgress.ts) counts only read_file / grep / glob and treats any turn with `bash` in it as "not
// exploration", so it never handed the builder back. The same report's release gate then listed a failed read
// (`cd /home/user 2>/dev/null; cat src/App.tsx; …`, the wrong folder, recovered three seconds later) as a
// "build-breaking blocker".
//
// 🧬 ONE DEFINITION, two readers: a command is an inspection when every statement in it only reads — a fixed set of
// read-only programs, no output redirection except to /dev/null, no in-place edits, no -exec/-delete. Conservative by
// construction: anything not recognised is NOT an inspection, so nothing that can change the project is ever excused.
// PURE.

const READ_ONLY_PROGRAMS: ReadonlySet<string> = new Set([
  'cat', 'head', 'tail', 'less', 'more', 'grep', 'egrep', 'fgrep', 'rg', 'ls', 'tree', 'wc', 'find', 'echo', 'printf',
  'pwd', 'cd', 'file', 'stat', 'du', 'sed', 'awk', 'sort', 'uniq', 'cut', 'tr', 'nl', 'column', 'diff', 'true', 'basename',
  'dirname', 'realpath', 'which', 'type', 'sleep',
]);

/**
 * A GET of the app's OWN preview on this machine — `curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/`. Only
 * localhost / 127.0.0.1 / 0.0.0.0, no request body, no method change, no upload, output only to stdout or /dev/null.
 * 🔴 failedbr #2306 (f0d054a4): a failed probe of a dev server that was not up yet (exit 7) was one of SIX
 * "build-breaking blockers" — the sibling of #2452's failed `cat`. A probe reads; it cannot break a build. PURE.
 */
export function isLocalhostProbe(segment: string): boolean {
  const s = String(segment ?? '').trim();
  if (!/^curl\s/.test(s)) return false;
  if (!/\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?(?:[\/\s"']|$)/.test(s)) return false;
  if (/https?:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)/.test(s)) return false; // a second, outside URL
  if (/(?:^|\s)(?:-X|--request|-d|--data[\w-]*|-F|--form|-T|--upload-file|-K|--config|-c|--cookie-jar|-D|--dump-header)\b/.test(s)) return false;
  const out = s.match(/(?:^|\s)(?:-o|--output)\s+(\S+)/);
  if (out && out[1] !== '/dev/null') return false;
  return true;
}

/** Remove quoted regions so separators inside a pattern are not read as structure. */
function unquote(cmd: string): string {
  return cmd.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'[^']*'/g, "''");
}

function segmentIsReadOnly(segment: string): boolean {
  let s = segment.trim();
  if (!s) return true;
  // Shell loop keywords around read-only bodies: `for f in src/*.ts`, `do grep …`, `done`.
  if (/^for\s+\w+\s+in\b/.test(s) || s === 'done' || s === 'do') return true;
  s = s.replace(/^(?:do|then|else)\s+/, '');
  if (/^(?:if|fi|while|until)\b/.test(s)) return false;
  // Redirection: only to /dev/null (stdout or stderr), or fd duplication like 2>&1.
  const withoutNull = s.replace(/\d?>>?\s*\/dev\/null/g, '').replace(/\d?>&\d/g, '');
  if (/[<>]/.test(withoutNull.replace(/<\(/g, '(').replace(/<<-?\s*\w+/g, 'HEREDOC'))) return false;
  if (/HEREDOC|<</.test(s)) return false;
  // Command substitution could run anything.
  if (/\$\(|`/.test(s)) return false;
  if (isLocalhostProbe(withoutNull)) return true;
  const words = withoutNull.trim().split(/\s+/);
  // `VAR=value cmd` prefixes are allowed; the program is the first non-assignment word.
  let i = 0;
  while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++;
  const program = (words[i] || '').replace(/^.*\//, '');
  if (!READ_ONLY_PROGRAMS.has(program)) return false;
  const rest = words.slice(i + 1).join(' ');
  if (program === 'sed' && /(?:^|\s)-[a-zA-Z]*i/.test(rest)) return false;     // sed -i edits in place
  if (program === 'find' && /-(?:exec|execdir|delete|ok|fprint)/.test(rest)) return false;
  if (program === 'awk' && /system\s*\(|print\s*>|printf\s*>/.test(rest)) return false;
  if ((program === 'sort' || program === 'uniq') && /(?:^|\s)-o\b/.test(rest)) return false;
  return true;
}

/** True when every statement and pipeline segment of `command` only reads. Conservative: unknown ⇒ false. PURE. */
export function isReadOnlyInspection(command: string | null | undefined): boolean {
  const cmd = String(command ?? '').trim();
  if (!cmd || cmd.length > 4000) return false;
  // awk's program lives in quotes, which `unquote` removes — judge it on the raw text (a write or a shell-out ⇒ not a read).
  if (/\bawk\b/.test(cmd) && /print[f]?\s*[^;}]*?>|system\s*\(|\|\s*"/.test(cmd)) return false;
  const flat = unquote(cmd);
  // A localhost probe's `curl` is judged by isLocalhostProbe, statement by statement; any other curl stays forbidden.
  const withoutProbes = flat.split(/(;|&&|\|\||\||\n)/).map((seg) => (isLocalhostProbe(seg.replace(/\d?>>?\s*\/dev\/null/g, '')) ? '' : seg)).join('');
  if (/\b(?:rm|mv|cp|mkdir|touch|tee|chmod|chown|ln|npm|npx|pnpm|yarn|node|python3?|curl|wget|git|kill|pkill)\b/.test(withoutProbes.replace(/\b(?:grep|rg|egrep|fgrep)\s+[^|;&]*/g, ''))) return false;
  const segments = flat.split(/;|&&|\|\||\||\n/);
  return segments.every(segmentIsReadOnly);
}
