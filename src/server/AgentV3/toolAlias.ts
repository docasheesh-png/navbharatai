/**
 * A TOOL NAME THE MODEL MADE UP IS READ AS THE TOOL IT MEANT (queue Q-145).
 *
 * Cheap models call tools that do not exist: `execute` with a `command` (two autopsies in July), `write`
 * with a `path` and `content`. The dispatcher threw `Unknown tool`, the model spent a turn learning that,
 * and some never recovered. The intent is not in doubt when the input already has the exact shape of a
 * real tool, so the call is run as that tool and the model is told the right name in the same result.
 *
 * 🔒 PRECISION, BY THREE CONDITIONS — all must hold, or nothing is renamed and the old error stands:
 *   1. the name is in the table below (no fuzzy matching: `exec_sql` is not `bash`);
 *   2. the input has the target's REQUIRED fields, as strings;
 *   3. the target is a tool THIS agent was offered — an alias can never give a reviewer a shell.
 * A name the agent was offered is never renamed, whatever it is. PURE.
 */

interface Alias {
  to: string;
  /** Required string fields the input must already carry. */
  needs: readonly string[];
}

const ALIASES: Readonly<Record<string, Alias>> = {
  execute: { to: 'bash', needs: ['command'] },
  exec: { to: 'bash', needs: ['command'] },
  execute_command: { to: 'bash', needs: ['command'] },
  run_command: { to: 'bash', needs: ['command'] },
  shell: { to: 'bash', needs: ['command'] },
  terminal: { to: 'bash', needs: ['command'] },
  run_shell: { to: 'bash', needs: ['command'] },
  bash_command: { to: 'bash', needs: ['command'] },
  write: { to: 'write_file', needs: ['path', 'content'] },
  create_file: { to: 'write_file', needs: ['path', 'content'] },
  write_to_file: { to: 'write_file', needs: ['path', 'content'] },
  save_file: { to: 'write_file', needs: ['path', 'content'] },
  read: { to: 'read_file', needs: ['path'] },
  open_file: { to: 'read_file', needs: ['path'] },
  view_file: { to: 'read_file', needs: ['path'] },
};

/** The real tool a made-up name means, or null when nothing may be renamed. PURE. */
export function resolveToolAlias(name: string, input: unknown, offered: ReadonlySet<string>): string | null {
  const n = String(name ?? '');
  if (!n || offered.has(n)) return null;
  const alias = ALIASES[n];
  if (!alias || !offered.has(alias.to)) return null;
  const obj = input && typeof input === 'object' ? (input as Record<string, unknown>) : null;
  if (!obj) return null;
  for (const field of alias.needs) {
    if (typeof obj[field] !== 'string' || !(obj[field] as string).length) return null;
  }
  return alias.to;
}

/** The line the model reads before the real tool's result, so the next call uses the right name. */
export function toolAliasNote(from: string, to: string): string {
  return `("${from}" is not a tool here; this ran as "${to}". Call "${to}" directly next time.)\n`;
}
