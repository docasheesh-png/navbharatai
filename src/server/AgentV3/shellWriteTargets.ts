/**
 * WHICH FILES DOES A SHELL COMMAND WRITE? — so the green freeze sees the shell too (autopsy 8e124182).
 *
 * 🔴 THE BYPASS, in the model's own words from that report: *"The green freeze is blocking my edits … I
 * need to work around this … maybe I can use `bash`"*. `edit_file` and `replace_symbol` on `src/lib/seed.ts`
 * were both refused on the verified-working app; the model then ran `cat > src/lib/seed.ts << 'EOF'` and
 * the file was replaced. The freeze lives in the actuator's `writeFile`, and a shell redirect never passes
 * through it — so the one guarantee the freeze exists to give ("a working app is not changed by a pass
 * that was not asked to change it") held only for models polite enough to use the file tools. And
 * `POST_GREEN_WRITES`, which reads the same choke point, then reported *"nothing wrote to it afterwards"*.
 *
 * This reads a command for the write targets a shell can express plainly — redirections (`>`, `>>`,
 * `&>`), `tee`, `sed -i` / `perl -i`, the destination of `cp` / `mv` / `install`, and `rm` / `truncate` /
 * `touch` — so the bash tool can ask the freeze about each one, exactly as `writeFile` does.
 *
 * ⚠️ PRECISION OVER RECALL. A false target could refuse a legitimate command, so heredoc bodies and quoted
 * text that is not itself a target are ignored, fd duplications (`2>&1`) are not files, and paths outside
 * the workspace (`/tmp`, `/dev/null`) are dropped. A write this cannot see (a script that writes a file,
 * `node -e`) is not caught — the freeze is a guard against the obvious route, not a sandbox. PURE.
 */

import { shellCommandVariants } from './shellNormalize';
import { FILE_REMOVAL_COMMANDS } from './fileRemovalCommands';

const WORKSPACE_ROOT = '/home/user/workspace';

/** A workspace-relative path, or null when the target is outside the workspace or not a file. */
function toWorkspacePath(raw: string): string | null {
  let p = String(raw ?? '').trim().replace(/^['"]|['"]$/g, '');
  if (!p || p.startsWith('&') || p === '-' || /[$`*?{}]/.test(p)) return null;
  if (p.startsWith(`${WORKSPACE_ROOT}/`)) p = p.slice(WORKSPACE_ROOT.length + 1);
  else if (p.startsWith('/') || p.startsWith('~')) return null;
  p = p.replace(/^(?:\.\/)+/, '');
  if (!p || p === '.' || p.startsWith('../')) return null;
  return p;
}

/** Drop heredoc bodies — their lines are file CONTENT, never commands. */
function withoutHeredocBodies(command: string): string {
  const lines = String(command ?? '').split('\n');
  const out: string[] = [];
  let terminator: string | null = null;
  for (const line of lines) {
    if (terminator !== null) {
      if (line.trim() === terminator) terminator = null;
      continue;
    }
    out.push(line);
    const m = line.match(/<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1/);
    if (m) terminator = m[2];
  }
  return out.join('\n');
}

/** Split a command into simple commands at `;`, `&&`, `||`, `|` and newlines (quotes respected). */
function simpleCommands(command: string): string[][] {
  const parts: string[][] = [];
  let words: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  const pushWord = () => { if (cur) { words.push(cur); cur = ''; } };
  const pushCmd = () => { pushWord(); if (words.length) parts.push(words); words = []; };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = null; else cur += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '\n' || c === ';') { pushCmd(); continue; }
    if (c === '|' || (c === '&' && command[i + 1] === '&')) {
      pushCmd();
      if (command[i + 1] === c) i++;
      continue;
    }
    if (c === '>' || c === '<') {
      // A redirection operator is its own word: `a>b` and `a > b` read the same.
      pushWord();
      let op = c;
      if (command[i + 1] === '>') { op += '>'; i++; }
      if (command[i + 1] === '&') { op += '&'; i++; }
      if (words.length && /^[0-9&]$/.test(words[words.length - 1])) op = words.pop() + op;
      words.push(op);
      continue;
    }
    if (/\s/.test(c)) { pushWord(); continue; }
    cur += c;
  }
  pushCmd();
  return parts;
}

/** Every workspace file a command writes, as far as the shell's own syntax says. PURE. */
export function shellWriteTargets(command: string): string[] {
  const found = new Set<string>();
  const add = (raw: string | undefined) => {
    const p = raw === undefined ? null : toWorkspacePath(raw);
    if (p) found.add(p);
  };
  for (const words of simpleCommands(withoutHeredocBodies(command))) {
    // Redirections anywhere in the command: `>`, `>>`, `1>`, `&>`; never `>&` (an fd duplication).
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (/^(?:[0-9]|&)?>>?$/.test(w)) add(words[i + 1]);
    }
    const args = words.filter((w, i) => !/^(?:[0-9]|&)?[<>]/.test(w) && !/^(?:[0-9]|&)?[<>]/.test(words[i - 1] ?? ''));
    const [cmd, ...rest] = args;
    if (!cmd) continue;
    const name = cmd.split('/').pop() ?? cmd;
    const operands = rest.filter((a) => !a.startsWith('-'));
    if (name === 'tee') operands.forEach(add);
    else if ((name === 'sed' || name === 'perl') && rest.some((a) => /^-[a-zA-Z]*i/.test(a) || a === '--in-place')) {
      // The file operands are the last ones; a sed script is the first non-flag operand.
      const files = name === 'sed' && !rest.some((a) => a === '-e' || a === '-f') ? operands.slice(1) : operands.slice(-1);
      files.forEach(add);
    } else if (name === 'cp' || name === 'mv' || name === 'install') add(operands[operands.length - 1]);
    else if (name === 'rm' || name === 'truncate' || name === 'touch') operands.forEach(add);
    else if (/^(?:node|nodejs|python3?|perl)$/.test(name)) scriptWriteTargets(rest).forEach(add);
  }
  return [...found];
}

/**
 * Files an inline script writes by a LITERAL path — `node -e "fs.writeFileSync('src/a.css', …)"`,
 * `python3 -c "open('src/a.py','w')…"`. A model rewrites a stylesheet this way as readily as with
 * `sed -i` (autopsy 536c8189 used three `node -e` scripts on `src/index.css`), and such a write reached
 * neither the Green Freeze nor the saved project. Only a quoted literal counts — a path built at run time
 * is not knowable from the text, so it is left out rather than guessed (precision over recall).
 */
function scriptWriteTargets(args: readonly string[]): string[] {
  const i = args.findIndex((a) => a === '-e' || a === '-c' || a === '--eval' || /^-[a-zA-Z]*[ec]$/.test(a));
  const script = i >= 0 ? args[i + 1] : undefined;
  if (!script) return [];
  const out: string[] = [];
  const patterns = [
    /\b(?:writeFileSync|writeFile|appendFileSync|appendFile)\(\s*(['"`])([^'"`$]+?)\1/g,
    /\bopen\(\s*(['"])([^'"]+?)\1\s*,\s*['"][wax]/g,
    /\bPath\(\s*(['"])([^'"]+?)\1\s*\)\s*\.\s*write_(?:text|bytes)\(/g,
  ];
  for (const re of patterns) for (const m of script.matchAll(re)) out.push(m[2]);
  return out;
}

/**
 * Which workspace files a command REMOVES — `rm` / `unlink` / `git rm` operands, plus the globs among
 * them (kept apart, because a glob is a pattern to match, not a path). Used to protect files the user put
 * in the workspace (autopsy 4d538ca3 — see userFileGuard.ts). Reads `sh -c "…"` wrappers too, because a
 * delete inside one deletes just as thoroughly. PURE; precision over recall, like `shellWriteTargets`.
 */
export function shellRemovalTargets(command: string): { paths: string[]; globs: string[] } {
  const paths = new Set<string>();
  const globs = new Set<string>();
  for (const variant of shellCommandVariants(String(command ?? ''))) {
    for (const words of simpleCommands(withoutHeredocBodies(variant))) {
      const args = words.filter((w, i) => !/^(?:[0-9]|&)?[<>]/.test(w) && !/^(?:[0-9]|&)?[<>]/.test(words[i - 1] ?? ''));
      let [cmd, ...rest] = args;
      if (!cmd) continue;
      let name = cmd.split('/').pop() ?? cmd;
      if (name === 'git' && rest[0] === 'rm') { name = 'git-rm'; rest = rest.slice(1); }
      if (!FILE_REMOVAL_COMMANDS.has(name) && name !== 'git-rm') continue;
      for (const operand of rest) {
        if (operand.startsWith('-')) continue;
        const raw = operand.replace(/^\.\//, '');
        if (/[*?]/.test(raw) && !/[$`]/.test(raw)) {
          const rel = raw.startsWith(`${WORKSPACE_ROOT}/`) ? raw.slice(WORKSPACE_ROOT.length + 1) : raw;
          if (!rel.startsWith('/') && !rel.startsWith('~') && !rel.startsWith('../')) globs.add(rel);
          continue;
        }
        const p = toWorkspacePath(operand);
        if (p) paths.add(p);
      }
    }
  }
  return { paths: [...paths], globs: [...globs] };
}

/** Folders a build generates or installs into — never the project's own source. */
const NOT_SOURCE = /^(?:node_modules|dist|build|\.git|\.next|\.vite|coverage)\//;

/** At most this many files are read back after one command (a glob-free command rarely names more). */
export const MAX_READ_BACK = 20;

/**
 * The files to read back from the sandbox after a shell command, so a shell write reaches the saved
 * project (ToolDispatcher.recordShellWrites). Removal-only commands are left out, generated folders are
 * never source, and `skip` is a path already read back elsewhere. PURE.
 */
export function shellReadBackTargets(command: string, skip: string | null = null): string[] {
  const removedOnly = new Set(shellRemovalTargets(command).paths);
  return shellWriteTargets(command)
    .filter((p) => p !== skip && !removedOnly.has(p) && !NOT_SOURCE.test(p))
    .slice(0, MAX_READ_BACK);
}

/**
 * WHAT A SHELL COMMAND TOOK OUT OF THE PROJECT (queue Q-246, candy report 7da1cdca).
 *
 * `fileDeletion.ts` drops a deleted file from the saved project, but only for what the delete guard
 * parses: a single SOURCE file (`.ts`, `.tsx`, …) named by `rm`. Everything else a command removes stayed
 * in the build's captured writes, and the final save lets captured writes win over the sandbox scan. So
 * `rm src/old.css`, `rm -rf src/legacy`, `rm src/*.bak.ts` and the source of `mv a.ts b.ts` were all put
 * back into the saved project, and restored into the next sandbox.
 *
 * This returns the operands that may have gone: the `rm` / `unlink` / `git rm` paths and globs, plus the
 * sources of `mv` / `git mv` (every operand but the last; `-t DIR` is not read, precision over recall).
 * The caller matches them against the paths it recorded and asks the sandbox before forgetting any. PURE.
 */
export function shellRemovedOperands(command: string): { paths: string[]; globs: string[] } {
  const removal = shellRemovalTargets(command);
  const paths = new Set(removal.paths);
  const globs = new Set(removal.globs);
  for (const variant of shellCommandVariants(String(command ?? ''))) {
    for (const words of simpleCommands(withoutHeredocBodies(variant))) {
      const args = words.filter((w, i) => !/^(?:[0-9]|&)?[<>]/.test(w) && !/^(?:[0-9]|&)?[<>]/.test(words[i - 1] ?? ''));
      let [cmd, ...rest] = args;
      if (!cmd) continue;
      let name = cmd.split('/').pop() ?? cmd;
      if (name === 'git' && rest[0] === 'mv') { name = 'git-mv'; rest = rest.slice(1); }
      if (name !== 'mv' && name !== 'git-mv') continue;
      if (rest.some((a) => a === '-t' || a.startsWith('--target-directory'))) continue;
      const operands = rest.filter((a) => !a.startsWith('-'));
      for (const src of operands.slice(0, -1)) {
        const p = toWorkspacePath(src);
        if (p) paths.add(p);
      }
    }
  }
  return { paths: [...paths], globs: [...globs] };
}

/** A shell glob as a regex over one path: `*` and `?` never cross a `/`. */
function globRegex(glob: string): RegExp {
  const body = glob.replace(/^\.\//, '').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]');
  return new RegExp(`^${body}$`);
}

/** At most this many recorded paths are checked against the sandbox after one command. */
export const MAX_REMOVAL_PROBES = 200;

/**
 * The recorded paths a command's removed operands name: the path itself, everything under it when it is
 * a folder, and every path a glob matches. Only RECORDED paths are returned, so this can never name a
 * file the build did not save. Generated folders are never source. PURE.
 */
export function removedRecordedPaths(
  removed: { paths: readonly string[]; globs: readonly string[] },
  recorded: Iterable<string>,
): string[] {
  const res = removed.globs.map(globRegex);
  const out: string[] = [];
  for (const raw of recorded) {
    const p = String(raw ?? '');
    if (!p || NOT_SOURCE.test(p)) continue;
    const named = removed.paths.some((r) => p === r || p.startsWith(`${r.replace(/\/+$/, '')}/`)) || res.some((re) => re.test(p));
    if (named && !out.includes(p)) out.push(p);
    if (out.length >= MAX_REMOVAL_PROBES) break;
  }
  return out;
}
