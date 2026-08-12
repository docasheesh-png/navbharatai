// AgentV3 — Autonomous Governance: command-risk classification (Layer 58 v1).
//
// Before the build agent runs a shell command, this PURE, deterministic classifier
// flags operations that are irreversible, destructive, or dangerous (remote code
// execution, credential exfiltration). The dispatcher uses it to (a) annotate the
// command's result with an honest governance warning so the agent knows what it
// just did, and (b) write a decision-audit episode to project memory — an
// accountable trail of every risky action taken. It does NOT block execution on its
// own (hard gating stays with the existing human-approval system); it makes risky
// behaviour visible and auditable, which is the foundation governance must provide
// before any higher autonomy is enabled.
//
// Conservative by design: patterns target unambiguously risky commands so benign
// build/test/git commands are never flagged.

import {
  shellCommandVariants, unquoteToken, hasGlob, globLiteralPrefix, interpreterTreeRemovalTargets,
} from './shellNormalize';

export type RiskLevel = 'high' | 'medium' | 'none';

export interface CommandRisk {
  level: RiskLevel;
  reasons: string[];
}

interface Rule {
  level: 'high' | 'medium';
  test: RegExp;
  reason: string;
}

// HIGH — irreversible damage, remote code execution, or secret exfiltration.
const HIGH_RULES: Rule[] = [
  { level: 'high', test: /\brm\s+(-[a-z]*\s+)*-[a-z]*[rf][a-z]*\b[^|&;]*\s(\/|~|\$HOME|\/\*|\.\s*$|\*\s*$)/i, reason: 'recursive delete of a root/home/wildcard path (irreversible)' },
  { level: 'high', test: /--no-preserve-root/i, reason: 'rm --no-preserve-root (removes the entire filesystem)' },
  { level: 'high', test: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, reason: 'fork bomb' },
  { level: 'high', test: /\b(mkfs|fdisk|dd)\b[^\n]*\b(of=)?\/dev\//i, reason: 'writes directly to a disk device (data loss)' },
  { level: 'high', test: />\s*\/dev\/sd[a-z]/i, reason: 'redirect to a raw disk device' },
  { level: 'high', test: /\b(curl|wget|fetch)\b[^\n|]*\|[^\n]*\b(sh|bash|zsh|python[0-9.]*|node)\b/i, reason: 'pipes downloaded content straight into a shell/interpreter (remote code execution)' },
  { level: 'high', test: /\b(printenv|env|cat)\b[^\n]*\|[^\n]*\b(curl|wget|nc|netcat)\b/i, reason: 'pipes environment/secrets to the network (exfiltration)' },
  { level: 'high', test: /\b(cat|cp|scp)\b[^\n]*(\.ssh\/|id_rsa|id_ed25519|\.aws\/credentials|\.netrc)/i, reason: 'reads/copies private keys or credentials' },
  // SECURITY Phase 2.4 — a BARE env dump (`printenv`, `env` as a standalone command, optionally piped/
  // redirected) exposes EVERY server secret (ANTHROPIC_API_KEY, SECRET_ENCRYPTION_KEY, …) into the
  // command output → the build report, transcript and model context. Blocked. Note the negative
  // lookahead: `env FOO=bar cmd` (env used to SET a var for a real command) is NOT a dump and stays
  // allowed — only `env`/`printenv` with no command after it matches.
  { level: 'high', test: /(^|[;&|]\s*)(printenv|env)\s*($|[|;&>])/i, reason: 'dumps all environment variables (exposes every server secret)' },
  // Reading a dotenv file (`.env`, `.env.local`, …) with any text tool leaks its secrets the same way.
  // TEMPLATE files are excluded — `.env.example` / `.env.sample` / `.env.template` / `.env.dist` hold
  // VARIABLE NAMES and no values. That is the whole point of them, this engine has a tool that
  // GENERATES one, and reading it is how a build learns which variables an app needs. Blocking that was
  // a false positive that refused ordinary work, and a guard which refuses ordinary work gets fought
  // until something gives.
  { level: 'high', test: /\b(cat|less|more|head|tail|nl|xxd|od|strings|grep|awk|sed)\b[^\n|]*(^|[\s/'"=])\.env(?!\.(example|sample|template|dist|defaults?)\b)(\.[A-Za-z0-9_.-]+)?\b/i, reason: 'reads a .env secrets file (exposes stored keys)' },
  { level: 'high', test: /\bchmod\s+(-[a-z]*\s+)*777\s+(\/|~|\$HOME)\b/i, reason: 'chmod 777 on a root/home path (insecure + dangerous)' },
  { level: 'high', test: /\bsudo\b/i, reason: 'runs with elevated privileges (sudo)' },
  { level: 'high', test: /\bgit\s+push\b[^\n]*(--force\b|\s-f\b)/i, reason: 'force-push rewrites remote history (can destroy others\' commits)' },
];

// MEDIUM — destructive or impactful but local/recoverable, or unexpected network use.
const MEDIUM_RULES: Rule[] = [
  { level: 'medium', test: /\brm\s+(-[a-z]*\s+)*-[a-z]*[rf][a-z]*\b/i, reason: 'recursive/forced delete (verify the path)' },
  { level: 'medium', test: /\bgit\s+reset\s+--hard\b/i, reason: 'git reset --hard discards uncommitted work' },
  { level: 'medium', test: /\bgit\s+clean\s+-[a-z]*f/i, reason: 'git clean -f deletes untracked files' },
  { level: 'medium', test: /\bnpm\s+(install|i)\b[^\n]*\s(-g|--global)\b/i, reason: 'global npm install (affects the whole environment)' },
  { level: 'medium', test: /\b(kill|pkill|killall)\b[^\n]*-9\b/i, reason: 'force-kills processes (-9)' },
  { level: 'medium', test: /\b(curl|wget)\b[^\n]*\bhttps?:\/\//i, reason: 'outbound network fetch to an external host' },
  { level: 'medium', test: /\btee\b[^\n]*\s\/(etc|usr|bin|boot|lib)\b|>\s*\/(etc|usr|bin|boot|lib)\//i, reason: 'writes into a system directory' },
];

/**
 * Classify a shell command's risk. Returns the highest level matched and the
 * concrete reasons. PURE & deterministic.
 *
 * Classifies every command bash would really run, not just the line as written — `sh -c "sudo rm -rf
 * /"` is exactly as dangerous as `sudo rm -rf /`, and matching only the outer text let the wrapper act
 * as a cloak. (Note for anyone reading the header above: a HIGH verdict IS blocked at the dispatcher.
 * That header used to say otherwise and was simply out of date.)
 */
export function classifyCommandRisk(command: string): CommandRisk {
  const cmd = (command || '').trim();
  if (!cmd) return { level: 'none', reasons: [] };
  const variants = shellCommandVariants(cmd);

  const highReasons = [...new Set(
    variants.flatMap((v) => HIGH_RULES.filter((r) => r.test.test(v)).map((r) => r.reason)),
  )];
  if (highReasons.length) return { level: 'high', reasons: highReasons };

  const medReasons = [...new Set(
    variants.flatMap((v) => MEDIUM_RULES.filter((r) => r.test.test(v)).map((r) => r.reason)),
  )];
  if (medReasons.length) return { level: 'medium', reasons: medReasons };

  return { level: 'none', reasons: [] };
}

// Source directories that hold GENERATED APP CODE. Destroying one during a build destroys the app's own
// work. Real failure (deep-test "PaisaTrack", 2026-07-15): to "fix" two trivial tsc errors (an unused
// import + a type cast), the builder ran `rm -rf src/components src/hooks src/types src/utils`, wiping the
// feature components → the delivered app had orphaned/missing features yet still shipped as a glowing
// success. The correct action was to fix the two specific errors in-file. This guard makes that entire
// CLASS of self-destruction impossible — no matter which shell idiom the agent reaches for.
const SOURCE_DIR_RE =
  /^(src|app|components|pages|hooks|lib|utils|util|types|type|features|feature|store|stores|context|contexts|services|service|api|routes|styles|assets|models|state|store|containers|views|layouts|widgets)$/i;
// Regenerable / recoverable targets that are ALWAYS safe to delete recursively.
const SAFE_DELETE_RE =
  /^(node_modules|dist|build|out|coverage|\.next|\.nuxt|\.svelte-kit|\.vite|\.cache|\.turbo|\.parcel-cache|tmp|\.tmp|logs|\.expo)$/i;
// Script/component file extensions — the app's actual code. Deleting/blanking these is the destructive-
// consolidation signature (the builder wiping its own module set to restructure), NOT boilerplate asset
// cleanup (.css/.svg/.json). A glob of these (`*.tsx`) is likewise a source-wide target.
const SOURCE_CODE_EXT_RE = /\.(tsx?|jsx?|mjs|cjs|vue|svelte|astro)$/i;
// Deleting this many source-code FILES in a single command is a bulk source wipe, not stale-file cleanup.
// ONE genuinely-stale file stays allowed (the message tells the agent to do exactly that, one at a time).
const BULK_SOURCE_DELETE_THRESHOLD = 2;

/** Does a normalized path live in a source location (a `src/`-rooted path, or a bare source-dir segment)? */
function isUnderSourceLocation(norm: string): boolean {
  const parts = norm.split('/');
  if (parts[0].toLowerCase() === 'src') return true;
  return parts.some((p) => SOURCE_DIR_RE.test(p));
}

/**
 * The path a shell arg really names, after bash's own quote and escape removal.
 *
 * Stripping only the OUTER quotes was a confirmed bypass: `rm -rf s""rc` and `rm -rf sr\c` both delete
 * `src` while sharing no substring with it, so a comparison against the literal token could never match.
 * Returns '' for a pure flag or an empty arg.
 */
function cleanPathArg(rawArg: string): string {
  if (rawArg.startsWith('-')) return '';
  return unquoteToken(rawArg).replace(/\/+$/, '');
}

/** Source directory names, for deciding whether a glob could reach one. */
const SOURCE_DIR_NAMES = [
  'src', 'app', 'components', 'pages', 'hooks', 'lib', 'utils', 'util', 'types', 'type', 'features',
  'feature', 'store', 'stores', 'context', 'contexts', 'services', 'service', 'api', 'routes',
  'styles', 'assets', 'models', 'state', 'containers', 'views', 'layouts', 'widgets',
];

/**
 * Could this glob token expand onto the app's own source?
 *
 * `rm -rf src*` was a confirmed bypass: the token is not `src`, so nothing matched, and the command
 * deletes `src` anyway. A guard cannot expand a glob without a filesystem, but it always knows the
 * literal prefix the glob is anchored on, and "is that a prefix of a source directory name" answers the
 * question well enough to refuse. Over-inclusive on purpose — `rm -rf c*` at a workspace root is not
 * cleanup anybody needs, and the cost of refusing it is one retry.
 */
function globCouldHitSource(token: string): boolean {
  const prefix = globLiteralPrefix(token).replace(/^\.\//, '');
  const parts = prefix.split('/');
  // A complete leading segment that is regenerable settles it: `node_modules/*`, `dist/**`.
  if (parts.slice(0, -1).some((p) => SAFE_DELETE_RE.test(p))) return false;
  if (parts.length > 1 && isUnderSourceLocation(parts.slice(0, -1).join('/'))) return true;
  const last = (parts[parts.length - 1] || '').toLowerCase();
  // A bare `*` is already handled as a whole-project wipe by the caller.
  if (!last) return false;
  if (SAFE_DELETE_RE.test(last)) return false;
  return SOURCE_DIR_NAMES.some((d) => d.startsWith(last));
}

/**
 * Classify a raw shell path argument as protected generated source, or null (safe to touch).
 * Returns 'dir' for a source DIRECTORY at ANY depth (bare `components`, `src`, or `src/features/auth`),
 * and 'file' for a source-CODE file under a source location. Regenerable targets (node_modules/dist/…)
 * and boilerplate assets (.css/.svg/.json) are null. Pure & deterministic.
 */
function classifySourceTarget(rawPath: string): 'dir' | 'file' | null {
  const path = cleanPathArg(rawPath);
  if (!path) return null;
  // A bare `.`/`*`/`src/*` at the workspace root wipes the whole project.
  if (path === '.' || path === './' || path === '*' || path === './*') return 'dir';
  // A glob names more paths than it spells. Decide on what it is anchored on, before the exact-name
  // tests below (which a glob can never satisfy) get a chance to wave it through.
  if (hasGlob(path)) {
    if (!globCouldHitSource(path)) return null;
    // `src/*.tsx` names source FILES; `src*` names a source DIRECTORY. The distinction matters because
    // the caller gates directory deletion on a recursive flag, which a file glob does not need.
    return SOURCE_CODE_EXT_RE.test(path) ? 'file' : 'dir';
  }
  const norm = path.replace(/^\.\//, '');
  const parts = norm.split('/');
  if (parts.some((p) => SAFE_DELETE_RE.test(p))) return null; // node_modules/dist/.vite/… — always allowed
  const last = parts[parts.length - 1];
  const hasExt = /\.[a-z0-9]+$/i.test(last);
  if (hasExt) {
    // A source-code file, whether under src/ or a bare entry file (App.tsx, main.tsx) at the root.
    if (SOURCE_CODE_EXT_RE.test(last) && (isUnderSourceLocation(norm) || parts.length === 1)) return 'file';
    return null; // an asset / config / doc file — not protected against a single delete
  }
  // No extension → a directory. Protected if it is (or is under) a source location.
  if (SOURCE_DIR_RE.test(norm) || isUnderSourceLocation(norm)) return 'dir';
  return null;
}

/** True when a `mv` destination lands OUTSIDE the workspace (absolute, home, parent, /dev/null, /tmp). */
function isOutsideWorkspace(rawDest: string): boolean {
  const d = rawDest.replace(/^['"]|['"]$/g, '');
  return /^(\/|~|\.\.\/|\/tmp\b|\/dev\/null\b)/.test(d) || d === '/dev/null';
}

/**
 * Detect a build-agent command that DESTROYS generated app source, and return the first offending target
 * (a short human-readable label), or null. Pure & deterministic. This closes the ENTIRE class of
 * self-destruction — every idiom an LLM reaches for to "restructure" or "clean up" its own module tree,
 * all of which produce the same catastrophe (source deleted mid-build → broken imports → build fails):
 *
 *   A. Directory teardown at ANY depth   — `rm -rf src/features/auth`, `rmdir src/hooks`, `npx rimraf src/lib`.
 *   B. Bulk source-FILE deletion         — `rm a.tsx b.tsx`, `find src -name '*.tsx' -delete`, `ls src/*.tsx | xargs rm`,
 *                                          `for f in src/*.tsx; do rm "$f"; done`, `rm $(find src -name '*.tsx')`.
 *   C. Source-file blanking              — `: > src/App.tsx`, `> src/App.tsx`, `echo '' > src/App.tsx`,
 *                                          `truncate -s 0 src/App.tsx`, `cp /dev/null src/App.tsx`.
 *   D. Move source OUT of the workspace  — `mv src/components /tmp/old`.
 *   E. Git working-tree wipes            — `git rm -r src`, `git clean -fd`, `git checkout -- .`, `git reset --hard`.
 *
 * Precise by construction so it NEVER blocks legitimate cleanup: deleting ONE stale source file by name is
 * allowed; regenerable targets (node_modules/dist/.vite/…) are always allowed; asset cleanup (.css/.svg)
 * never counts; writing REAL content via a redirect (`echo "code" > f`) is allowed (only blanking is
 * blocked); renaming a file WITHIN the workspace (`mv a.tsx b.tsx`) is allowed. Scans the WHOLE command,
 * not just segment starts, so a destructive verb hidden in a loop body / pipe / `-exec` is still caught.
 */
export function destructiveSourceDeletionTarget(command: string): string | null {
  // WHAT BASH WILL RUN, not what the line says. `bash -c "rm -rf src"`, `sh -c '…'` and `eval "…"` were
  // all confirmed bypasses of everything below, purely because the destructive verb was not at the start
  // of any segment of the OUTER line. Each wrapped command is inspected on its own terms.
  for (const variant of shellCommandVariants(command)) {
    const hit = destructiveInOneCommand(variant);
    if (hit) return hit;
  }
  // A tree removal written in JavaScript or Python is the same catastrophe as `rm -rf`, and shares no
  // shell syntax with it — no amount of pattern work on the shell side would ever have caught it.
  for (const target of interpreterTreeRemovalTargets(command)) {
    if (classifySourceTarget(target)) return `${target} (interpreter one-liner)`;
  }
  return null;
}

/** The single-command analysis. `destructiveSourceDeletionTarget` applies it to every unwrapped variant. */
function destructiveInOneCommand(command: string): string | null {
  const cmd = (command || '').trim();
  if (!cmd) return null;

  // === D/E-adjacent whole-command idioms first (these hide the destructive verb mid-command) ===

  // find … -delete  |  find … -exec rm/unlink/shred {}  — wipes matching files in bulk.
  if (/\bfind\b/.test(cmd) && /(-delete\b|-exec\s+(rm|unlink|shred)\b)/.test(cmd)) {
    // Fires when find targets source: a source-code -name/-path glob, OR a source search root.
    if (/-(name|path|iname|ipath)\s+['"]?[^'"]*\.(tsx?|jsx?|mjs|cjs|vue|svelte|astro)\b/i.test(cmd)) {
      return `find … -delete (source-code files)`;
    }
    const roots = cmd.replace(/^.*?\bfind\b/i, '').trim().split(/\s+/).filter(Boolean);
    for (const r of roots) {
      if (r.startsWith('-')) break; // reached the first predicate — roots are done
      if (r === '.' || r === './') continue; // a bare `.` root is governed by the -name predicate (checked above)
      if (classifySourceTarget(r) === 'dir') return `find ${r} … -delete`;
    }
  }

  // … | xargs [flags] rm/unlink/shred/rimraf — the producer names the files; block when source is in play.
  if (/\|\s*xargs\b[^\n|]*\b(rm|unlink|shred|rimraf)\b/i.test(cmd)) {
    if (isUnderSourceLocation(cmd.replace(/^\.\//, '')) || /\bsrc\b|\.(tsx?|jsx?|vue|svelte|astro)\b/i.test(cmd)) {
      return `xargs rm (piped source files)`;
    }
  }

  // for f in <source glob>; do … rm/unlink … done — loop deletion over a source glob.
  if (/\bfor\b[^\n;]*\bin\b[^\n;]*;\s*do\b/i.test(cmd) && /\b(rm|unlink|shred)\b/.test(cmd)) {
    const inList = /\bfor\b[^\n;]*\bin\b([^\n;]*);\s*do\b/i.exec(cmd)?.[1] ?? '';
    if (/\bsrc\b/.test(inList) || /\.(tsx?|jsx?|vue|svelte|astro)\b/i.test(inList) ||
        inList.trim().split(/\s+/).some((t) => classifySourceTarget(t))) {
      return `for-loop rm over source (${inList.trim().slice(0, 40)})`;
    }
  }

  // Source-file blanking: bare/`:` redirect, empty echo/printf redirect, truncate -s 0, cp/cat /dev/null.
  const blankRes: RegExp[] = [
    /(?:^|[;&|]|\bdo\b|\bthen\b)\s*:?\s*>\s*(\S+)/,                 // `: > f`  or bare `> f`
    /\becho\s*(?:''|"")?\s*>\s*(\S+)/,                              // `echo > f` / `echo '' > f`
    /\bprintf\s*(?:''|"")?\s*>\s*(\S+)/,                            // `printf '' > f`
    /\btruncate\s+-s\s*0\s+(\S+)/,                                  // `truncate -s 0 f`
    /\bcp\s+\/dev\/null\s+(\S+)/,                                   // `cp /dev/null f`
    /\bcat\s+\/dev\/null\s*>\s*(\S+)/,                              // `cat /dev/null > f`
  ];
  for (const re of blankRes) {
    const hit = re.exec(cmd);
    if (hit && classifySourceTarget(hit[1]) === 'file') return `blank ${hit[1]}`;
  }

  // Command-substitution rm — `rm $(find src …)` / rm `find src…`. The literal args aren't source paths,
  // but the substitution expands to them. Checked on the WHOLE command (the segment splitter consumes the
  // `(` of `$(`, so it must run before segmentation). Fires when rm is paired with a source-referencing sub.
  if (/\brm\b/i.test(cmd) && /(\$\(|`)/.test(cmd) &&
      /\b(find|src|components|hooks|pages|lib|utils|features|services|routes)\b/i.test(cmd)) {
    return `rm $(…) expanding to source`;
  }

  // git working-tree wipes (a generated workspace's source is untracked / uncommitted).
  if (/\bgit\s+clean\b[^\n]*\s-[a-z]*f/i.test(cmd)) return `git clean (deletes untracked source)`;
  if (/\bgit\s+reset\b[^\n]*--hard\b/i.test(cmd)) return `git reset --hard (discards generated source)`;
  if (/\bgit\s+checkout\b\s+(--\s+)?(\.|\.\/|src)(?=[/\s]|$)/i.test(cmd)) return `git checkout (discards generated source)`;
  if (/\bgit\s+rm\b/i.test(cmd)) {
    const after = cmd.replace(/^.*?\bgit\s+rm\b/i, '').trim().split(/\s+/);
    for (const a of after) { const c = classifySourceTarget(a); if (c) return `git rm ${a}`; }
  }

  // === Per-segment verb scan: rm / rmdir / rimraf / mv, wherever they appear (loops, chains, subshells) ===
  const segments = cmd.split(/[;&|\n()]+|&&|\|\||\bdo\b|\bthen\b/);
  for (const seg of segments) {
    const s = seg.trim();

    // rmdir / rimraf / npx rimraf <dir …> — directory teardown (no recursive flag needed).
    const dirDel = /^(?:npx\s+)?(?:rmdir|rimraf)\s+(.+)$/i.exec(s);
    if (dirDel) {
      for (const raw of dirDel[1].trim().split(/\s+/)) {
        if (classifySourceTarget(raw) === 'dir') return cleanPathArg(raw) || raw;
      }
      continue;
    }

    // mv <source dir/file> <dest OUTSIDE workspace> — relocating source out of the tree destroys it.
    const mvMatch = /^mv\s+(.+)$/i.exec(s);
    if (mvMatch) {
      const args = mvMatch[1].trim().split(/\s+/).filter((a) => !a.startsWith('-'));
      if (args.length >= 2) {
        const dest = args[args.length - 1];
        if (isOutsideWorkspace(dest)) {
          for (const src of args.slice(0, -1)) {
            if (classifySourceTarget(src)) return `mv ${cleanPathArg(src) || src} → ${dest}`;
          }
        }
      }
      continue;
    }

    const rmMatch = /^rm\s+(.+)$/i.exec(s);
    if (!rmMatch) continue;
    const args = rmMatch[1].trim().split(/\s+/);
    // Long flags count too. `rm --recursive --force src` was a confirmed bypass purely because the
    // short-flag pattern `-[a-z]*[rR]` cannot match `--recursive`.
    const hasRecursive = args.some((a) => /^-[a-z]*[rR]/.test(a) || /^--(recursive|dir)$/i.test(a));

    // Recursive delete of a source DIRECTORY at any depth.
    if (hasRecursive) {
      for (const raw of args) {
        if (classifySourceTarget(raw) === 'dir') return cleanPathArg(raw) || raw;
      }
    }

    // A GLOB over source files is bulk deletion by definition — `rm src/*.tsx` needs no second argument
    // to wipe a module set, so it must not have to clear the two-file threshold below.
    const globArg = args.find((a) => !a.startsWith('-') && hasGlob(a) && classifySourceTarget(a) === 'file');
    if (globArg) return cleanPathArg(globArg) || globArg;

    // Bulk delete of source-code FILES (≥ threshold) in one rm — the "wipe my module set" signature.
    const sourceFileArgs = args.map(cleanPathArg).filter((p) => p && classifySourceTarget(p) === 'file');
    if (sourceFileArgs.length >= BULK_SOURCE_DELETE_THRESHOLD) return sourceFileArgs[0];
  }
  return null;
}

/**
 * The single source FILES an `rm` command would delete — the deletes the bulk guard deliberately allows
 * (its own message even says "If ONE file is genuinely stale, delete just that single file by name").
 *
 * ROOT CAUSE this enables (admin 2026-08-02: "galat tarah se file delete ho hi na"): allowing every single
 * delete is right for a genuinely stale file and CATASTROPHIC for a file other modules still import — the
 * module vanishes, every importer breaks, and the app dies instantly. The caller pairs this list with the
 * project's real import graph and refuses ONLY the deletes that would orphan a live importer, so honest
 * cleanup keeps working while a build-killing delete becomes impossible. Pure; never throws.
 */
export function singleSourceDeleteTargets(command: string): string[] {
  const out: string[] = [];
  // Same reasoning as the guard above: a delete inside `sh -c "…"` deletes just as thoroughly.
  for (const cmd of shellCommandVariants(command)) {
    for (const seg of cmd.split(/[;&|\n()]+|&&|\|\||\bdo\b|\bthen\b/)) {
      const m = /^(?:rm|unlink)\s+(.+)$/i.exec(seg.trim());
      if (!m) continue;
      for (const raw of m[1].trim().split(/\s+/)) {
        if (raw.startsWith('-')) continue;
        const p = cleanPathArg(raw);
        if (p && classifySourceTarget(p) === 'file' && !out.includes(p)) out.push(p);
      }
    }
  }
  for (const target of interpreterTreeRemovalTargets(command)) {
    if (classifySourceTarget(target) === 'file' && !out.includes(target)) out.push(target);
  }
  return out;
}

/** The honest refusal for deleting a source file that other modules still import. Pure. */
export function importedFileDeletionMessage(target: string, importers: readonly string[]): string {
  const shown = importers.slice(0, 5);
  const more = importers.length - shown.length;
  return (
    `[GOVERNANCE BLOCKED] Refused to delete "${target}" — ${importers.length} file(s) in this project still ` +
    `import it: ${shown.join(', ')}${more > 0 ? `, +${more} more` : ''}. Deleting it would break every one of ` +
    `them instantly and the app would stop building. If this module really must go, FIRST update those ` +
    `importers to stop using it, then delete it. If you only wanted to change its contents, edit the file ` +
    `instead of removing it.`
  );
}

/** The honest, actionable refusal shown to the build agent when it tries to destroy generated app source. */
export function destructiveSourceDeletionMessage(target: string): string {
  return (
    `[GOVERNANCE BLOCKED] Refused to destroy generated app source ("${target}") — deleting, blanking, moving ` +
    `away, or git-wiping source almost always destroys working features and leaves broken imports (a known ` +
    `build-killing failure mode). Do NOT delete or restructure source to fix a compile/import error. Instead, ` +
    `FIX the specific error in the file it reports — e.g. add the missing export, correct the import path, ` +
    `remove the unused import — and re-run the check. If ONE file is genuinely stale, delete just that single ` +
    `file by name.`
  );
}

/**
 * TOOL-path sibling of the shell guard: detect a `write_file` / `write_files_batch` / `edit_file` call that
 * BLANKS an existing, populated source file (new content empty or whitespace-only over a file that had real
 * code). Same net effect as `rm` — the module vanishes and its importers break — but it bypasses the shell
 * guard entirely (confirmed vector, StudySync autopsy 2026-07-16). Pure & deterministic. Returns true ONLY
 * when the file already held substantive content: a first-time create (`existing` empty) and a legitimate
 * rewrite (new content non-empty) both return false, so real builds are never blocked.
 */
export function isDestructiveEmptyOverwrite(path: string, existingContent: string, newContent: string): boolean {
  if (classifySourceTarget(path) !== 'file') return false; // only guard real source-code files
  const hadContent = (existingContent || '').trim().length > 0;
  const nowEmpty = (newContent || '').trim().length === 0;
  return hadContent && nowEmpty;
}

/** The honest refusal shown when a tool call would blank a populated source file. */
export function emptyOverwriteMessage(path: string): string {
  return (
    `[GOVERNANCE BLOCKED] Refused to overwrite "${path}" with empty content — blanking a populated source ` +
    `file deletes its code and breaks every file that imports it (a known build-killing failure mode). If you ` +
    `need to change this file, write its FULL new content; if it is genuinely obsolete, remove exactly one ` +
    `stale file by name instead of emptying it.`
  );
}

/** A short, honest governance advisory appended to a risky command's result. */
export function governanceNote(risk: CommandRisk): string {
  if (risk.level === 'none') return '';
  const label = risk.level === 'high' ? 'HIGH-risk' : 'medium-risk';
  return `⚠️ Governance: this command is ${label} — ${risk.reasons.join('; ')}. Recorded to the decision-audit trail.`;
}
