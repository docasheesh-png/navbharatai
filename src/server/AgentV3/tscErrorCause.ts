/**
 * WHAT THE COMPILER ERROR ACTUALLY MEANS — the missing subsystem named by autopsy `baa0b3c7`.
 *
 * 🔴 THE STRUGGLE THIS KILLS, and it is the same one three times.
 *
 * "Make an VPN App" (2026-08-23) spent most of its run fighting six identical `tsc` runs over
 *
 *     src/ErrorBoundary.tsx(29,39): error TS2339: Property 'setState' does not exist on type 'ErrorBoundary'.
 *
 * The file was CORRECT. React's types were not installed, so `React.Component` had no members and a
 * perfectly good class lost `this.props`. The model could not see that from the error, so it did the
 * only thing the message suggests: it rewrote the file. Four times. Then it deleted a different
 * component to make that component's errors go away, leaving an empty directory behind. Four
 * "repeated step is not making progress" nudges fired and changed nothing, because the nudge can
 * detect a loop without being able to say WHAT to do differently. The answer was one install away
 * and **nothing in the engine knew it**.
 *
 * The same signature had already cost the dukaan stock app (2026-08-12) and the School ERP build
 * (autopsy e706e068). Each was answered with a point fix for its own instance — a banner in the
 * template, `@types/react` added to the scaffold, a `vite-env.d.ts` writer. Every one of those is
 * right and none of them is this: **a template that ships the types cannot help an IMPORTED project,
 * a project whose `package.json` the model rewrote, or a framework we did not scaffold.** What was
 * missing is the mapping itself.
 *
 * 🔑 THE BOUNDARY, and it is deliberately narrow — this is not a hint bag.
 *
 * Every signature here is one where **the compiler is missing a DECLARATION, and the code is fine**.
 * That is the one class whose error text points the model at the wrong file by construction: TypeScript
 * reports the symptom where the symbol is USED, so the remedy (install a package, declare a type) is
 * nowhere in the message and the code under the cursor looks broken. A genuine code error needs no
 * translation — the model reads it and fixes it, which is the ordinary path and must stay untouched.
 * **Do not add a signature here whose remedy is "change the code".**
 *
 * 🔒 PRECISION FIRST, because advice is a steer and a wrong steer costs a round. The React-member case
 * is genuinely AMBIGUOUS — this repo has both causes on record: the types are missing (baa0b3c7), or
 * the class never extended `React.Component` at all (`looksLikeBrokenErrorBoundary`, the dukaan app).
 * So when the source is in hand the two are told apart and the advice is exact; when it is not, the
 * advice says both, cheapest check first, rather than guessing. An honest "check this, then that"
 * beats a confident wrong answer — and both readings still beat rewriting the file a fourth time.
 *
 * 🔎 FIVE CALL SITES, and the fifth was found by rule 3 AFTER the first four were wired — it is the one
 * that REPEATS. The fast lane's repair loop (`SimpleBuilder`) runs up to `maxRepairs` times climbing a
 * strategy ladder, so a missing-declaration error aims every rung of that ladder at a file that was never
 * wrong: the four-rewrites-of-one-file shape itself. Annotating only the tidy `typecheck` tool would have
 * missed both it and the report that prompted all this, whose own rootCause line is a BASH command
 * (`$ ./node_modules/.bin/tsc --noEmit 2>&1 → exit 2`). The two sites that hold file text — the write-time
 * note and the two repair loops — get the exact answer; the two that do not get the hedged one.
 *
 * PURE — no I/O, no clock, never throws. The callers supply whatever source they already hold; none
 * of them reads a file for this.
 */
import type { TscError } from './EndgameRepair';
import { VITE_ENV_DTS_PATH } from './viteEnvTypes';

/** One diagnosed cause. `id` is stable for tests and telemetry; `advice` is what the model is told. */
export interface TscCause {
  id: string;
  advice: string;
}

/** At most this many causes are ever emitted, so a note explains and never floods. */
export const MAX_CAUSES = 3;

/** The instance members a React class gets ONLY from React's own type declarations. */
const REACT_CLASS_MEMBER_RE =
  /^Property '(props|state|setState|context|refs|forceUpdate)' does not exist on type '([^']+)'/;

/** `Property 'env' does not exist on type 'ImportMeta'` — Vite's client types, not React's. */
const IMPORT_META_ENV_RE = /^Property 'env' does not exist on type 'ImportMeta'/;

/** TS7026 and friends: JSX itself is untyped, which only ever means React's types are absent. */
const JSX_UNTYPED_RE = /JSX element implicitly has type 'any' because no interface 'JSX\.IntrinsicElements' exists/;

/** TS7016 — tsc names the `@types` package itself; the value here is surfacing its own suggestion. */
const NO_DECLARATION_FILE_RE = /^Could not find a declaration file for module '([^']+)'/;

/** TS2307 — the module is not there at all. */
const CANNOT_FIND_MODULE_RE = /^Cannot find module '([^']+)'/;

/**
 * TS2305 — the module WAS found and does not export the symbol.
 *
 * tsc writes the specifier double-quoted inside single quotes: `Module '"../data"' has no exported
 * member 'seedQuestionBank'`. Both halves are captured because the remedy needs the specifier (which
 * file was actually read) and the symbol (which file really has it).
 */
const NO_EXPORTED_MEMBER_RE = /^Module '"([^"]+)"' has no exported member '([^']+)'/;

/** File extensions TypeScript resolves, in the order it tries them. */
const TS_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'] as const;

/**
 * Resolve a RELATIVE specifier against the importing file — `src/hooks/x.ts` + `../data` → `src/data`.
 *
 * Extension-less and pure: the caller appends the candidates it wants to test. Returns '' for anything
 * that is not relative, so a package specifier can never be mistaken for a path in this project.
 */
export function resolveRelativeSpecifier(fromFile: string, specifier: string): string {
  const spec = String(specifier ?? '').trim();
  if (!spec.startsWith('.')) return '';
  const from = String(fromFile ?? '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
  const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
  const parts = dir ? dir.split('/') : [];
  for (const seg of spec.split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') { parts.pop(); continue; }
    parts.push(seg);
  }
  return parts.join('/');
}

const REACT_TYPES_INSTALL = 'npm install --save-dev @types/react @types/react-dom';

/**
 * Does this source declare `name` as a class that really does extend a React component base?
 *
 * The question the ambiguity turns on: a class that DOES extend `React.Component` and still has no
 * `this.props` is a project missing React's types; a class that extends nothing never had them to
 * lose. Matched on the declaration itself, so a mention of the name elsewhere in the file cannot
 * answer for it. Returns null when the file does not declare the class at all — "we did not look"
 * must not read as "it does not extend".
 */
export function extendsReactComponent(source: string, name: string): boolean | null {
  const src = String(source ?? '');
  if (!src.trim() || !name) return null;
  const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const decl = new RegExp(`\\bclass\\s+${safe}\\b([^{]*)\\{`).exec(src);
  if (!decl) return null;
  return /\bextends\s+(?:React\s*\.\s*)?(?:Component|PureComponent)\b/.test(decl[1] || '');
}

/** A bare package specifier — not a relative path and not the `@/…` alias every scaffold here maps to src. */
function isBarePackage(specifier: string): boolean {
  const s = String(specifier ?? '').trim();
  if (!s || s.startsWith('.') || s.startsWith('/') || s.startsWith('@/')) return false;
  return /^[a-z0-9@]/i.test(s);
}

/** The npm package a specifier belongs to (`lodash/fp` → `lodash`, `@scope/pkg/x` → `@scope/pkg`). */
export function packageOfSpecifier(specifier: string): string {
  const parts = String(specifier ?? '').split('/');
  return parts[0]?.startsWith('@') && parts.length > 1 ? `${parts[0]}/${parts[1]}` : (parts[0] ?? '');
}

/**
 * The causes behind a set of compiler errors — empty when none of them is a missing declaration.
 *
 * `sources` is whatever file text the caller already holds, keyed by path. It tells the two
 * React-member causes apart AND decides the index-shadow cause, which is claimed only when both
 * candidate files are genuinely present in it — a caller holding one file simply says less, never
 * something weaker-evidenced. (⚠️ This line used to read "used ONLY to tell the two React-member
 * causes apart"; it is a live input to a third cause since 2026-09-19.) Deduplicated by `id`, so ten
 * errors from one missing package produce one line, and capped at `MAX_CAUSES`. PURE, never throws.
 */
export function tscErrorCauses(
  errors: readonly TscError[] | null | undefined,
  sources: Readonly<Record<string, string>> = {},
): TscCause[] {
  const out: TscCause[] = [];
  const seen = new Set<string>();
  const add = (id: string, advice: string) => {
    if (seen.has(id) || out.length >= MAX_CAUSES) return;
    seen.add(id);
    out.push({ id, advice });
  };
  const sourceFor = (file: string): string => {
    const want = String(file ?? '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
    for (const [p, c] of Object.entries(sources || {})) {
      if (String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '') === want) return String(c ?? '');
    }
    return '';
  };

  for (const e of errors || []) {
    if (out.length >= MAX_CAUSES) break;
    const message = String(e?.message ?? '');

    // Vite's client types — checked BEFORE the React member rule, because `ImportMeta` matches neither
    // but shares the "Property 'x' does not exist" shape and a reader would expect the specific one to win.
    if (IMPORT_META_ENV_RE.test(message)) {
      add('vite-client-types-missing',
        `The app reads \`import.meta.env\` but nothing declared Vite's client types, so the compiler says `
        + `\`env\` is not a property of \`ImportMeta\`. The code is correct. Create \`${VITE_ENV_DTS_PATH}\` `
        + `containing \`/// <reference types="vite/client" />\` — a types-only file with no runtime effect.`);
      continue;
    }

    const member = REACT_CLASS_MEMBER_RE.exec(message);
    if (member) {
      const [, prop, className] = member;
      const verdict = extendsReactComponent(sourceFor(e.file), className);
      if (verdict === true) {
        add('react-types-missing',
          `\`${className}\` DOES extend React.Component, so \`this.${prop}\` is valid code and the class is `
          + `not the problem — React's type declarations are missing from this project, which leaves `
          + `\`React.Component\` with no members at all. Do NOT rewrite or delete \`${e.file}\`; it will fail `
          + `again identically. Run \`${REACT_TYPES_INSTALL}\` and re-run the typecheck.`);
      } else if (verdict === false) {
        add('react-class-not-extended',
          `\`${className}\` uses \`this.${prop}\` but does not extend React.Component, so it is not a React `
          + `class component. Fix the declaration — \`class ${className} extends React.Component<Props, State>\` `
          + `— rather than the line the compiler pointed at.`);
      } else {
        add('react-member-missing',
          `\`Property '${prop}' does not exist on type '${className}'\` has exactly two causes, and rewriting `
          + `the file is neither. Check them in this order: (1) does \`${className}\` extend React.Component? `
          + `If not, make it. (2) If it does, the code is correct and React's type declarations are missing — `
          + `run \`${REACT_TYPES_INSTALL}\`.`);
      }
      continue;
    }

    if (JSX_UNTYPED_RE.test(message)) {
      add('react-types-missing-jsx',
        `JSX itself is untyped here, which only happens when React's type declarations are absent — no `
        + `amount of editing the component will fix it. Run \`${REACT_TYPES_INSTALL}\` and re-run the typecheck.`);
      continue;
    }

    const noDecl = NO_DECLARATION_FILE_RE.exec(message);
    if (noDecl && isBarePackage(noDecl[1])) {
      const pkg = packageOfSpecifier(noDecl[1]);
      add(`types-package-missing:${pkg}`,
        `\`${pkg}\` ships no types of its own, so the import is fine and the compiler simply has nothing to `
        + `read. Run \`npm install --save-dev @types/${pkg.replace(/^@/, '').replace(/\//g, '__')}\`; if no such `
        + `package exists, declare the module instead — do not change the import.`);
      continue;
    }

    const missing = CANNOT_FIND_MODULE_RE.exec(message);
    if (missing && isBarePackage(missing[1])) {
      const pkg = packageOfSpecifier(missing[1]);
      add(`dependency-missing:${pkg}`,
        `\`${pkg}\` is imported but is not installed in this project. Add it — \`npm install ${pkg}\` — rather `
        + `than removing the import or writing a local stand-in for it.`);
      continue;
    }

    // 🔴 A RELATIVE specifier that is not there — THE ERROR THAT BOUGHT A PLACEHOLDER (autopsy
    // 64bc1b6e, 2026-09-19). The line this replaces read: *"a different cause with a different remedy,
    // already handled by the endgame's own `referencedMissingModules`. Only bare packages land here."*
    // Every clause was true and the conclusion was wrong, because it reasoned about WHERE the remedy
    // lives and not about WHEN the pressure is applied. `writeTypecheckNote` says *"fix them NOW, in
    // this turn, before writing the next file"* the instant the import is written — long before any
    // endgame — so at that moment the model held the compiler's raw words and NO remedy.
    //
    // What it did with them is in its own reasoning, quoted from that build: *"I can see the three
    // pages the other task is supposed to create aren't present yet … I should create minimal
    // placeholder pages so the build passes. The other task can overwrite them with real content."*
    // It then wrote three 231-byte stubs over files a CONCURRENT sub-agent was assigned to build.
    //
    // ⚠️ The write lock cannot catch this and says so: `parallelBuild.ts` promises only that same-path
    // writes serialise — *"worst case … degrades to serial-write order, never corruption"*. True, and
    // beside the point: the damage is not corruption, it is a placeholder WINNING a race against real
    // content. So the remedy has to arrive before the placeholder is written, which is here.
    if (missing) {
      const spec = missing[1] ?? '';
      const target = resolveRelativeSpecifier(e?.file ?? '', spec);
      add(`missing-file:${target || spec}`,
        `\`${spec}\` is a FILE this project does not have yet${target ? ` (it would be \`${target}\`)` : ''} — `
        + `not a package, so installing something cannot fix it. Write the real file, or correct the import path. `
        + `⛔ NEVER write a placeholder/stub just to clear this error: another task may be writing the real file, `
        + `and a stub can overwrite it — the user then gets an empty screen where their feature should be.`);
      continue;
    }

    // 🔎 `X.ts` AND `X/index.ts` BOTH EXIST, so the import reads the one nobody meant (same autopsy).
    // `../data` resolved to `src/data.ts` while the symbol lived in `src/data/index.ts`; the compiler
    // says only "has no exported member", every `grep` and `cat` of the index shows the export present,
    // and the contradiction is unresolvable from the message. It cost 11 shell commands and ~60 seconds
    // — including a `cat … | xxd` hunting for an invisible character — and was settled only by
    // `tsc --listFiles`, which is the one command that names BOTH files.
    //
    // 🔒 CLAIMED ONLY ON EVIDENCE. The shadow is asserted when the caller's own `sources` really
    // contains both candidates (the endgame and the fast-lane repair hold the whole tree). A caller
    // holding one file — the write-time check — says nothing rather than guessing, because "both exist"
    // is the entire content of the advice and a guess at it would send the model to the wrong file.
    const noMember = NO_EXPORTED_MEMBER_RE.exec(message);
    if (noMember) {
      const base = resolveRelativeSpecifier(e?.file ?? '', noMember[1] ?? '');
      if (base) {
        const fileWins = TS_EXTENSIONS.map((x) => `${base}${x}`).find((c) => sourceFor(c) !== '');
        const indexLoses = TS_EXTENSIONS.map((x) => `${base}/index${x}`).find((c) => sourceFor(c) !== '');
        if (fileWins && indexLoses) {
          add(`index-shadowed:${base}`,
            `Both \`${fileWins}\` and \`${indexLoses}\` exist, and TypeScript resolves \`${noMember[1]}\` to the `
            + `FILE — so \`${noMember[2]}\` is being looked for in \`${fileWins}\`, not in the index you can see it in. `
            + `Import from \`${noMember[1]}/index\` explicitly, or move the export into \`${fileWins}\`. `
            + `Do not keep re-reading the index: it is not the file being read.`);
          continue;
        }
      }
    }
  }
  return out;
}

/**
 * The block appended to whatever the model is about to read — '' when nothing was diagnosed.
 *
 * Headed unmistakably, because it is OUR analysis sitting beside the compiler's own words and the two
 * must never be mistaken for each other (the same reasoning `SCRIPT_DIAG_MARKER` is built on).
 */
export function tscCauseNote(causes: readonly TscCause[]): string {
  if (!causes || causes.length === 0) return '';
  const lines = causes.map((c) => `• ${c.advice}`).join('\n');
  return `\n\n🔎 WHAT THESE ERRORS ACTUALLY MEAN (NavBharatAI's analysis, not compiler output):\n${lines}`;
}
