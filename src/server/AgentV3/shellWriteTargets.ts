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
  }
  return [...found];
}
