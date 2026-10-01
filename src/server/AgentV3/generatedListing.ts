// AgentV3 — a file listing the model ran in a shell, minus the folders that are never the app's source.
//
// 🔴 AUTOPSY 8257ca59 (2026-10-01). The green repair ran `find . -maxdepth 3 -type f \( -name '*.tsx' … \)`
// and got back `dist/assets/…`, then `node_modules/browserslist/…`, `node_modules/csstype/…` and dozens
// more — installed packages and build output, read into the model's context on every later turn. The
// `glob` tool and every workspace listing already skip these folders (`lib/generatedDirs.ts`, the ONE
// list); a listing made in a shell was the one door that did not.
//
// So the shell's answer to a LISTING command (`find`, `ls -R`, `tree`, `du`) has those lines taken out and
// the model is told how many and why. 🔒 Never when the command itself names one of those folders — then
// the folder is what was asked for — and never for any other command, whose output is evidence. PURE.

import { LIST_PRUNE_DIRS, isListPrunedPath } from '../lib/generatedDirs';

/** Fewer pruned lines than this are left as they are: a short listing costs nothing to read. */
export const MIN_PRUNED_LINES = 5;

const LISTING = /(?:^|[\s;&|(])(?:find|tree|du)\s|(?:^|[\s;&|(])ls\s+(?:-[A-Za-z]*R|--recursive)/;

/** Whether a command lists files (and does not ask about a pruned folder by name). PURE. */
export function isPrunableListing(command: string): boolean {
  const c = String(command ?? '');
  if (!LISTING.test(c)) return false;
  return !LIST_PRUNE_DIRS.some((d) => new RegExp(`(?:^|[\\s/'"=])${d.replace(/\./g, '\\.')}(?:[\\s/'"]|$)`).test(c));
}

/**
 * The listing with installed-package and build-output lines removed, and a note saying so — or the output
 * unchanged. PURE.
 */
export function pruneGeneratedListing(command: string, stdout: string): { stdout: string; pruned: number } {
  const text = String(stdout ?? '');
  if (!isPrunableListing(command)) return { stdout: text, pruned: 0 };
  const lines = text.split('\n');
  const kept: string[] = [];
  let pruned = 0;
  for (const line of lines) {
    const path = line.trim().replace(/^\.\//, '').split(/\s+/).pop() ?? '';
    if (path && isListPrunedPath(path.replace(/^\.\//, ''))) pruned++;
    else kept.push(line);
  }
  if (pruned < MIN_PRUNED_LINES) return { stdout: text, pruned: 0 };
  return {
    stdout: `${kept.join('\n')}\n[${pruned} line(s) inside node_modules, dist and other generated folders were left out — `
      + 'they are installed packages and build output, not this app\'s source. The glob tool skips them; name the folder in the command if you really need it.]',
    pruned,
  };
}
