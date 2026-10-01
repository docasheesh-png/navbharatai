// AgentV3 — a file the USER put in the workspace is never deleted unless the user asked.
//
// 🔴 AUTOPSY 4d538ca3 (2026-10-01). The user had added `Rabni_Roy_AI_Studio_ALL_IN_ONE-7.html` from Code
// Studio, and the build opened with "I noticed you manually edited 1 file in the IDE". Five minutes later
// the model, chasing a readiness score that file was dragging to 0/100, ran
// `rm "Rabni_Roy_AI_Studio_ALL_IN_ONE-7.html"` — exit 0, no guard in the way. The request it was
// answering said *"do not remove any existing working features"*, and the final summary never mentioned
// the deletion; it surfaced only as an admin-side `FILE_DELETED` line.
//
// 🔑 WHY NOTHING STOPPED IT: every delete guard in the bash tool protects APP SOURCE — a directory
// wipe, a bulk delete, a module other files still import. A page the user brought in is none of those,
// so it had no protection at all. The engine already KNEW whose file it was (`ManualEditTracker` had
// told the model, "do NOT overwrite or revert them") and simply never turned that knowledge into a rule.
//
// THE RULE: a `rm` / `unlink` / `git rm` of a path the user put in the workspace (a Code Studio edit or
// upload, remembered durably by `ManualEditTracker.userOwnedFiles`) is REFUSED, unless the current
// request itself asks to delete that file — a delete word AND the file's name or stem. A glob that
// matches one of the user's files counts the same as naming it.
//
// Refusing is the safe direction here: a wrongly-refused delete costs the model one sentence ("the
// user's file — leave it"), while a wrong delete destroys work the user cannot get back.
// Kill switch AGENTV3_USER_FILE_GUARD=off. PURE — no I/O.

const DELETE_WORD = /\b(delete|deleting|remove|removing|erase|rm|unlink|discard|get rid of|throw away|hata|hatao|hata do|hatado|mita|mitao|mita do|nikal|nikalo|nikaal|saaf)\b|हटा|मिटा|ডিলিট|মুছে/i;

/** Kill switch `AGENTV3_USER_FILE_GUARD=off`; default on. */
export function userFileGuardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_USER_FILE_GUARD ?? '').trim().toLowerCase() !== 'off';
}

function normalize(path: string): string {
  return String(path ?? '').replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').replace(/^\/home\/user\/workspace\//, '').replace(/^\/+/, '');
}

function globToRegExp(glob: string): RegExp {
  const body = normalize(glob).split('').map((c) => {
    if (c === '*') return '[^/]*';
    if (c === '?') return '[^/]';
    return /[.+^${}()|[\]\\]/.test(c) ? `\\${c}` : c;
  }).join('');
  return new RegExp(`^${body}$`);
}

/** Does the request itself ask to delete this file (a delete word, and the file's name or stem)? */
export function requestAsksToRemove(request: string | null | undefined, path: string): boolean {
  const text = String(request ?? '');
  if (!text || !DELETE_WORD.test(text)) return false;
  const lower = text.toLowerCase();
  const base = normalize(path).split('/').pop() ?? '';
  if (!base) return false;
  if (lower.includes(base.toLowerCase())) return true;
  const stem = base.replace(/\.[^.]+$/, '').toLowerCase();
  return stem.length >= 3 && lower.includes(stem);
}

/**
 * The user's files a removal would delete without being asked to, in the order found. Empty when the
 * command touches none of them (or the request names each one it removes).
 */
export function unaskedUserFileRemovals(
  targets: { paths: readonly string[]; globs: readonly string[] },
  userFiles: Iterable<string>,
  request: string | null | undefined,
): string[] {
  const owned = new Map<string, string>();
  for (const f of userFiles) {
    const key = normalize(f);
    if (key) owned.set(key, f);
  }
  if (owned.size === 0) return [];
  const hit: string[] = [];
  const consider = (key: string) => {
    if (!owned.has(key) || hit.includes(key)) return;
    if (requestAsksToRemove(request, key)) return;
    hit.push(key);
  };
  for (const p of targets.paths) consider(normalize(p));
  for (const g of targets.globs) {
    const re = globToRegExp(g);
    for (const key of owned.keys()) if (re.test(key)) consider(key);
  }
  return hit;
}

/** The refusal the model receives. Thrown as a tool error by the caller, so it cannot be read as success. */
export function userFileRemovalMessage(paths: readonly string[]): string {
  const shown = paths.slice(0, 5).join(', ');
  const more = paths.length > 5 ? `, +${paths.length - 5} more` : '';
  return `[GOVERNANCE BLOCKED] Refused to delete ${shown}${more} — the user put ${paths.length === 1 ? 'this file' : 'these files'} `
    + 'in the workspace themselves, and this request does not ask to delete it. Leave it exactly as it is. '
    + 'If it is not part of the app, that is fine: the app does not need it removed in order to build, run or pass its checks. '
    + 'If you believe it should go, say so in your reply and let the user decide.';
}
