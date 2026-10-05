/**
 * BROWSER CODE RUN UNDER NODE (queue Q-146, recorded with ~10 minutes lost to `window is not defined`).
 *
 * A browser-only app keeps its data in `localStorage`, and its "seed" is code that fills it on first load.
 * The builder ran that seed with `node` / `tsx` to "load sample data", Node threw
 * `ReferenceError: localStorage is not defined`, and the builder then tried shims, polyfills and rewrites —
 * minutes of a paid build spent making browser code run where no browser exists.
 *
 * The answer is never a polyfill: code that touches `window`, `document` or browser storage runs in the
 * app, in the preview, and nowhere else.
 *
 * ── THREE LAYERS, AND THEY WERE BUILT BY TWO SESSIONS ON THE SAME DAY ──────────────────────────────
 *
 * 🔴 The POST-FAILURE hint (`browserCodeInNodeHint`, #3534) reads the command's own output and names the
 * problem the first time Node throws. It is correct and it stays. But it is a HEAL: the failed command,
 * its turn and its seconds are already spent when it speaks, and the fifth rule's step 5 is explicit that
 * a heal is only the last line of defence — *"why did a heal need to run at all?"*
 *
 * So the two layers in front of it make the failure not happen:
 *   1. **At the WRITE** (`browserOnlyWriteNote`) — a script-named file written with browser globals is
 *      told, while the file is open, that it cannot be run with node and where the code belongs. The run
 *      is never attempted. Mechanical, because a prose rule in a 90 KB prompt loses to the habit
 *      (`undefinedClassWriteNote`, `entryFirstWriteNote`, `SPACING_SNAPPED` all learned this).
 *   2. **BEFORE the shell** (`nodeRunTarget` + `shouldRefuseBrowserOnlyRun`) — if it is attempted anyway,
 *      the command is refused unrun, in the shape of the five guards beside it (`ScaffoldGuard`,
 *      `gitCloneGuard`, `PreviewGuard`, `fixNodeModulesTypo`, the empty-command refusal).
 *
 * ⚠️ MERGED INTO ONE MODULE ON PURPOSE (2026-10-05). Layers 1–2 arrived as a separate
 * `BrowserOnlyInNode.ts` while #3534 was still open — the duplication the concurrent-session rules exist
 * to prevent, and it happened because the claim on Q-146 lived in that PR's **diff of
 * `BUILD_REPORT_QUEUE.md`**, not in its title or body. Two modules for one class is how `safeRelPath`
 * grew four drifted copies, so there is now ONE list of globals and all three layers read it.
 *
 * 🔒 THE LIST IS MEASURED, NOT ASSUMED. Every name in `BROWSER_ONLY_GLOBALS` is `undefined` under
 * `node:22-bookworm` — what all three E2B Dockerfiles pin. `navigator` was in the first regex here and is
 * now gone: **node 22 DEFINES it**, so `navigator is not defined` could never have been thrown and the
 * alternative was dead. `fetch` is excluded for the same reason. The test re-measures in the running node,
 * so a future runtime that defines one of these fails CI instead of leaving this module quietly wrong.
 *
 * PURE — no I/O, no clock. Never throws; the dispatcher supplies file content and command output.
 */

/** Globals that do NOT exist in node 22 (measured; see the header). Order is the report's own first. */
export const BROWSER_ONLY_GLOBALS = [
  'window', 'document', 'localStorage', 'sessionStorage', 'alert', 'location', 'XMLHttpRequest', 'indexedDB', 'matchMedia',
] as const;

export type BrowserOnlyGlobal = typeof BROWSER_ONLY_GLOBALS[number];

/** Interpreters that execute a file directly. `npm run <script>` is deliberately not one — see below. */
const RUNNERS = ['node', 'tsx', 'ts-node', 'esrun', 'tsm'];

/** A source file a runner can be pointed at. */
const RUNNABLE = /\.(?:[cm]?tsx?|[cm]?jsx?)$/i;

export interface NodeRunTarget {
  /** The project-relative file the command runs. */
  file: string;
  /** The interpreter it runs under, for the message. */
  runner: string;
}

/**
 * Does this command run a PROJECT FILE directly under node? `null` when it does not. PURE.
 *
 * ⚠️ `npm run <script>` is NOT matched, on purpose. The script's body lives in package.json and may be
 * `vite build`, a chain, or anything else; guessing which file it ends up running is exactly the kind of
 * inference that produces a wrong refusal. The same goes for `node -e`, `--version`, and anything under
 * `node_modules/` — a tool's own binary is not the user's app.
 */
export function nodeRunTarget(command: string): NodeRunTarget | null {
  const cmd = String(command ?? '').trim();
  if (!cmd) return null;
  // One command at a time: a compound command is split so `cd x && npx tsx seed.ts` is still seen.
  for (const part of cmd.split(/&&|\|\||[;|]/)) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    let i = 0;
    if (tokens[i] === 'npx' || tokens[i] === 'pnpm' || tokens[i] === 'bunx' || tokens[i] === 'yarn') i++;
    const runner = (tokens[i] ?? '').replace(/^.*\//, '');
    if (!RUNNERS.includes(runner)) continue;
    i++;
    let file: string | null = null;
    for (; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.startsWith('-')) {
        // `--loader x`, `--import x`, `--require x` consume their value; a bare `-e`/`--eval` means
        // there is no file at all and the guard has nothing to say.
        if (/^(?:-e|--eval|-p|--print)$/.test(t)) return null;
        if (/^--(?:loader|import|require|experimental-loader)$/.test(t)) i++;
        continue;
      }
      const bare = t.replace(/^['"]|['"]$/g, '');
      if (RUNNABLE.test(bare)) { file = bare; }
      break;
    }
    if (!file) continue;
    if (/(^|\/)node_modules\//.test(file)) continue;
    return { file: file.replace(/^\.\//, ''), runner };
  }
  return null;
}

/** Code with comments and string-literal CONTENTS removed, so a word in prose is never a use. PURE. */
export function withoutCommentsAndStrings(source: string): string {
  const src = String(source ?? '');
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i++; }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += quote;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') { i += 2; continue; }
        // A template literal's ${…} can hold real code, so it is kept whole.
        if (quote === '`' && src[i] === '$' && src[i + 1] === '{') {
          let depth = 1;
          out += '${';
          i += 2;
          while (i < src.length && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            if (depth > 0) out += src[i];
            i++;
          }
          out += '}';
          continue;
        }
        if (src[i] === '\n') out += '\n';
        i++;
      }
      out += quote;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

export interface BrowserOnlyUse {
  global: BrowserOnlyGlobal;
  /** 1-indexed line, so the message can point at it. */
  line: number;
  /**
   * Does merely LOADING the file throw?
   *
   * ⚠️ THIS EXISTS SO THE MESSAGE CANNOT OVER-CLAIM, and getting it right took a correction worth
   * recording. A `localStorage.getItem(…)` sitting at module scope obviously throws on load. But the
   * report's own seed does NOT look like that — its browser calls are inside `seedProducts()`, and what
   * sits at module scope is the CALL, `seedProducts();`. So "is the global at depth 0?" answers false
   * for the very file this guard was written for. Both sources count: the global at module scope, or a
   * module-scope call to a function declared in this file. A file that only EXPORTS browser work throws
   * neither way — running it in node defines its exports and exits 0 — and gets the other sentence.
   */
  topLevel: boolean;
}

/**
 * Brace depth per line, 0 at module scope. Not a parser — a counter — and the comments and string
 * contents are already gone by the time it runs, so the usual traps (a brace in a string, a brace in a
 * comment) cannot reach it. PURE.
 */
function braceDepthByLine(lines: readonly string[]): number[] {
  const depth: number[] = [];
  let d = 0;
  for (const line of lines) {
    depth.push(d);
    for (const ch of line) {
      if (ch === '{' || ch === '(' || ch === '[') d++;
      else if (ch === '}' || ch === ')' || ch === ']') d = Math.max(0, d - 1);
    }
  }
  return depth;
}

/**
 * The browser-only globals this file uses with nothing to make them safe in node. PURE.
 *
 * Empty when the file has already been written with node in mind — any `typeof <global>` guard, any
 * `globalThis.<global> =` polyfill, or a test file. Those are the author saying they know; the guard
 * does not argue with them.
 */
export function browserOnlyUses(source: string, path = ''): BrowserOnlyUse[] {
  const file = String(path ?? '');
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(file) || /(^|\/)(?:__tests__|tests?)\//i.test(file)) return [];
  const code = withoutCommentsAndStrings(source);
  if (!code.trim()) return [];
  const uses: BrowserOnlyUse[] = [];
  const lines = code.split('\n');
  const depths = braceDepthByLine(lines);
  // Does any module-scope statement CALL a function this file declares? If so, whatever that function
  // touches is reached the moment node loads the file. See `BrowserOnlyUse.topLevel`.
  const declaredHere = new Set<string>();
  for (const m of code.matchAll(/\b(?:function|const|let|var)\s+(\w+)\s*(?:\(|=\s*(?:async\s*)?(?:\(|function))/g)) {
    declaredHere.add(m[1]);
  }
  let runsOnLoad = false;
  for (let n = 0; n < lines.length && !runsOnLoad; n++) {
    if (depths[n] !== 0) continue;
    for (const m of lines[n].matchAll(/(?<![.\w$])(\w+)\s*\(/g)) {
      if (declaredHere.has(m[1]) && !/\b(?:function|const|let|var|class)\s+$/.test(lines[n].slice(0, m.index))) {
        runsOnLoad = true;
        break;
      }
    }
  }
  for (const g of BROWSER_ONLY_GLOBALS) {
    // The author already handles node for this global ⇒ say nothing about it.
    if (new RegExp(`typeof\\s+${g}\\b`).test(code)) continue;
    // ⚠️ A POLYFILL IS CHECKED AGAINST THE RAW SOURCE, and the first draft checked the stripped copy —
    // which blanks string CONTENTS, so `global['document'] = {}` became `global['']` and the polyfill
    // became invisible. Caught by this module's own test. The dotted form works either way; the
    // bracket form only works on the raw text, so both are asked of it.
    if (new RegExp(`(?:globalThis|global|window)\\s*(?:\\.${g}\\b|\\[\\s*['"\`]${g}['"\`]\\s*\\])\\s*=[^=]`).test(String(source ?? ''))) continue;
    // A member access or a call — never a declaration of the same name (`const window = …`,
    // `function document(` ), never a property of something else (`foo.window`).
    const use = new RegExp(`(?<![.\\w$])${g}\\s*(?:\\.|\\[|\\()`);
    // ⚠️ AN IMPORTED BINDING OF THE SAME NAME IS NOT THE GLOBAL — also found by this module's own test.
    // `import { location } from './router'` is a router's own export, and refusing a command over it
    // would be a WRONG refusal, which is worse than the failure this guard prevents. Destructuring and
    // a parameter of the same name are the same case.
    const declared = new RegExp(
      `\\b(?:const|let|var|function|class)\\s+${g}\\b`                   // const window = …
      + `|\\b${g}\\s*:(?!:)`                                            // { window: … } / a type field
      + `|\\bimport\\b[^;\\n]*\\b${g}\\b[^;\\n]*\\bfrom\\b`             // import { location } from …
      + `|\\b(?:const|let|var)\\s*[{[][^;\\n]*\\b${g}\\b[^;\\n]*[}\\]]` // const { window } = …
      + `|\\b(?:function\\s*\\w*\\s*)?\\([^)\\n]*\\b${g}\\b[^)\\n]*\\)\\s*(?:=>|[:{])`, // a parameter
    );
    if (declared.test(code)) continue;
    for (let n = 0; n < lines.length; n++) {
      if (use.test(lines[n])) { uses.push({ global: g, line: n + 1, topLevel: depths[n] === 0 || runsOnLoad }); break; }
    }
  }
  return uses;
}

/**
 * Should this command be refused? Only when it runs a project file under node AND that file needs a
 * browser. Kill switch `AGENTV3_BROWSER_ONLY_GUARD=off`. PURE.
 */
export function shouldRefuseBrowserOnlyRun(
  target: NodeRunTarget | null,
  content: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): BrowserOnlyUse[] {
  if (String(env.AGENTV3_BROWSER_ONLY_GUARD ?? '').trim().toLowerCase() === 'off') return [];
  if (!target || typeof content !== 'string' || !content) return [];
  return browserOnlyUses(content, target.file);
}

/**
 * 🔑 THE 50/50 HALF — the guard above is the second layer; this is the first.
 *
 * The guard refuses the command, which saves the ten minutes. It does not stop the agent WANTING to run
 * the file, and the fifth rule's step 5 is explicit that a catch is only the last line of defence: the
 * condition to kill is "a script the agent intends to RUN was written using browser globals". So the
 * write that creates such a file says so while the file is open — the mechanical shape this repo keeps
 * finding is the only one that changes behaviour (`undefinedClassWriteNote`, `entryFirstWriteNote`,
 * `SPACING_SNAPPED`, whose own report line records three model calls wasted on the advisory version).
 *
 * ⚠️ NARROW ON PURPOSE. Most app files use `document` and `localStorage` and SHOULD — they run in the
 * browser, and a note on each would be the nag the READ_LOOP escalation exists to replace. It fires only
 * for a file whose own name says it is a script to be executed (a seed, a migration, a backfill, or
 * anything under `scripts/`), which is exactly the file in the report.
 */
const SCRIPT_LIKE = /(^|\/)scripts?\//i;
const SCRIPT_NAME = /(?:^|[/_.-])(?:seed|seeds|seeder|migrate|migration|backfill|import-data|setup|bootstrap|generate|populate)(?:[_.-]|$)/i;

/** Does this path name a file the agent means to RUN, rather than one the app imports? PURE. */
export function looksLikeAScriptToRun(path: string): boolean {
  const p = String(path ?? '').replace(/^\.?\//, '');
  if (!RUNNABLE.test(p)) return false;
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(p)) return false;
  const base = p.replace(/^.*\//, '');
  return SCRIPT_LIKE.test(p) || SCRIPT_NAME.test(base);
}

/** The note handed back on the write itself. '' when there is nothing to say, or the switch is off. PURE. */
export function browserOnlyWriteNote(
  path: string,
  content: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (String(env.AGENTV3_BROWSER_ONLY_GUARD ?? '').trim().toLowerCase() === 'off') return '';
  if (!looksLikeAScriptToRun(path)) return '';
  const uses = browserOnlyUses(content, path);
  if (uses.length === 0) return '';
  const named = uses.map((u) => `\`${u.global}\``).join(', ');
  const storage = uses.some((u) => u.global === 'localStorage' || u.global === 'sessionStorage' || u.global === 'indexedDB');
  return `\n🌐 ${path} uses ${named}, which exist only in a browser — so it CANNOT be run with \`node\` or \`npx tsx\` `
    + '(that fails with "… is not defined", and hand-mocking the browser to get past it recurses into a stack '
    + `overflow). ${storage
      ? 'Browser storage belongs to the browser: export a `seedIfEmpty()` from this file and call it once from '
        + 'the entry (`src/main.tsx` / `src/App.tsx`), so it runs in the preview where the storage really is.'
      : 'Have the app import it so it runs in the preview, or split the pure logic into a node-safe module.'}`;
}

/**
 * The message returned INSTEAD of running it. It must do what the failing command could not: name the
 * one reason, and hand back the paths that work — including, explicitly, "do not mock it", because
 * mocking `window` by hand is the improvisation that turned one failure into four. PURE.
 */
export function browserOnlyRunMessage(target: NodeRunTarget, uses: readonly BrowserOnlyUse[]): string {
  const named = uses.map((u) => `\`${u.global}\` (line ${u.line})`).join(', ');
  const topLevel = uses.filter((u) => u.topLevel);
  const first = (topLevel[0] ?? uses[0])?.global ?? 'window';
  const storage = uses.some((u) => u.global === 'localStorage' || u.global === 'sessionStorage' || u.global === 'indexedDB');
  // One sentence per real outcome — never the wrong one. See `BrowserOnlyUse.topLevel`.
  const headline = topLevel.length > 0
    ? `\`${target.runner} ${target.file}\` would fail with "${first} is not defined".`
    : `\`${target.runner} ${target.file}\` cannot do anything useful — node has no \`${first}\`, so it would `
      + 'either define its exports and exit without running them, or throw as soon as they are called.';
  return [
    `REFUSED (browser-only guard): ${headline}`,
    '',
    `${target.file} uses ${named}. Those exist only in a browser — node does not have them, and no flag`,
    'or version adds them. Running it cannot succeed, so it was not run; nothing was changed.',
    '',
    '⚠️ Do NOT hand-mock the browser (`globalThis.window = {...}`) to get past this. That path recurses',
    'into a stack overflow and costs several more failed commands — it is why this guard exists.',
    '',
    'Do ONE of these instead:',
    ...(storage ? [
      `  1. SEED FROM INSIDE THE APP (the right answer for ${first}). Browser storage belongs to the`,
      '     browser: export a `seedIfEmpty()` from the module and call it once from the entry',
      '     (`src/main.tsx` / `src/App.tsx`). It then runs in the preview, where the storage really is,',
      '     and the data is there for the user on first load.',
      '  2. Or make the data a plain module the app imports (`src/data/seed.ts` exporting an array or',
      '     object, no browser globals) and have the app write it to storage on mount.',
    ] : [
      '  1. Move the browser work into the app itself — a module the entry imports — so it runs in the',
      '     preview, where the browser is.',
      '  2. Or split the file: keep the pure logic in a node-safe module and the browser calls in the app.',
    ]),
    `  3. If you only wanted to CHECK the file, use the typecheck or read it — not ${target.runner}.`,
    '',
    'Then verify it in the preview (the Preview tab), which is where browser code is actually proven.',
  ].join('\n');
}

/** A command that runs a script under a server-side JavaScript runtime. */
const NODE_RUN = /(?:^|[\s;&|(])(?:node|tsx|ts-node|bun|deno|npx\s+(?:tsx|ts-node)|npm\s+run\s+[\w:-]*seed[\w:-]*)\b/;
/**
 * The runtime's own error for a browser global it does not have — built from the ONE measured list
 * above, so the hint and the two preventive layers can never disagree about what a browser global is.
 * `navigator` was an alternative here until 2026-10-05 and was DEAD: node 22 defines it.
 */
const BROWSER_GLOBAL = new RegExp(`ReferenceError:\\s*(${BROWSER_ONLY_GLOBALS.join('|')})\\s+is not defined`);

export function browserCodeInNodeHint(command: string, output: string): string | null {
  if (!NODE_RUN.test(String(command ?? ''))) return null;
  const m = String(output ?? '').slice(0, 20000).match(BROWSER_GLOBAL);
  if (!m) return null;
  return [
    `⚠️ BROWSER CODE, RUN UNDER NODE. \`${m[1]}\` exists only in a browser, so this script can never run here —`,
    'and a polyfill or a shim would only make it APPEAR to work: data written to a fake localStorage in this process',
    'never reaches the app. Code that reads or writes browser storage belongs in the app itself (for sample data:',
    'seed it on the app\'s first load when the store is empty). Do not run it with node again.',
  ].join('\n');
}
