// C3 — "@src/App.tsx make the header sticky": naming the file you mean (ROADMAP §8C).
//
// WHY IT PAYS FOR ITSELF. Without it, a request like "make the header sticky" starts with the builder
// SEARCHING — grep, glob, reading candidates — before it can change anything. That search is billed
// tokens and it is also where accuracy is lost: on a project with three header-ish files it can pick the
// wrong one, and the user pays again for the correction. Naming the file removes both costs at once.
//
// 🔒 A MENTION IS A CLAIM ABOUT THE PROJECT, SO IT IS CHECKED. Only paths that genuinely exist become
// scope. A mention we cannot resolve is REPORTED to the user, never silently dropped — silently ignoring
// "@src/Header.tsx" is indistinguishable from the AI disregarding the request, which is precisely the
// class of "it ignored what I said" complaint this feature exists to end.
//
// Pure — parsing and block assembly, so resolution is a test rather than a guess.

/** Most mentions we will honour in one message. Past this it is not scoping, it is the whole project. */
export const MAX_FILE_MENTIONS = 10;

/**
 * Matches `@` followed by a path-ish token: letters, digits, `_ - . / @` — enough for `@src/App.tsx`,
 * `@package.json` and `@apps/web/src/main.ts`, while stopping at whitespace and at sentence punctuation
 * so "@src/App.tsx, please" does not swallow the comma.
 *
 * Must be preceded by start-of-string or whitespace, so an email address (`me@example.com`) and a
 * decorator (`@Component`) inside pasted code are not read as file mentions.
 */
const MENTION_RE = /(^|\s)@([A-Za-z0-9_./@-]+[A-Za-z0-9_/-]|[A-Za-z0-9_-]+)/g;

/**
 * BR1998: A CODE ANNOTATION IS NOT A FILE MENTION. A user pasted a whole Flutter source file as the
 * message, and its indented `@override` lines passed the whitespace guard above. They matched no file,
 * so the user was told "⚠️ I could not find @override in this project", which is noise about their own
 * code. An UNRESOLVED token is dropped as an annotation only when ALL of these hold (reworked after
 * review; when unsure, the warning stays):
 * 1. it is a bare identifier (no `.`, `/` or `-`) and not a well-known extensionless file name
 *    (`Dockerfile`, `Makefile`, `LICENSE`, `README`, …);
 * 2. it is the first thing on its line;
 * 3. the message as a whole is pasted code: at least 3 lines end in `{`, `}` or `;`, AND code-ending lines
 *    (ending in `{ } ; ( ) [ ] ,`) are at least half of the non-empty lines (a sentence plus a short
 *    snippet is not a paste). The half counts the wider set because Flutter-style code ends most lines
 *    in `(`, `,` or `)`: the report's own paste had 16 of 63 lines ending in `{ } ;` and 61 of 63 in the
 *    wider set;
 * 4. its own line reads as an annotation, not prose: the token is alone, or is followed by annotation
 *    arguments that look like code (`()`, `({`, `("/x")`), or by a code keyword on a line ending in
 *    `{ ; ) ,`, or by a typed declaration (`String name;`). A word such as `ko`, `add`, `को` or
 *    `please` after it keeps the warning;
 * 5. it sits inside the code: walking back over any stacked annotation lines, the previous non-empty
 *    line ends in `{ } ;`; and its own line ends in `{ } ;` or, walking forward the same way, the next
 *    non-empty line does. A neighbour ending in `,` or `)` is never code here (second review: a prose
 *    line ending in a comma, a `- item,` list, or a Hinglish list ending in `(1)`…`(5)`).
 * 6. (third/fourth review, the strict belt) a LONE token, with nothing after it on its line, also needs
 *    a name in `KNOWN_ANNOTATIONS`. Names that are also plausible app files or components (Input, Output,
 *    Component, Test, Entity, Directive, Id, Required, Immutable, Protected, Preview, Inject, and the
 *    same class as Header/Login/App) are NOT in the list. The very next line (no blank line between)
 *    must end in `{ } ;`, or be another known annotation from which a no-blank walk (cap 8 hops)
 *    actually reaches a line ending in `{ } ;`. A stack of known annotations with no declaration after
 *    it keeps the warning. Tokens with code after them on the same line keep rules 4 and 5 — `@Input()`,
 *    `@Component({`, `@Test()` still drop that way, byte-identical.
 * Anything else, including every RESOLVED mention, behaves exactly as before.
 */
const ANNOTATION_TOKEN_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Extensionless names that are real project files; never treated as annotations. Lower-case. */
const WELL_KNOWN_FILES: ReadonlySet<string> = new Set([
  'dockerfile', 'containerfile', 'makefile', 'gnumakefile', 'procfile', 'gemfile', 'rakefile', 'jenkinsfile',
  'vagrantfile', 'brewfile', 'podfile', 'caddyfile', 'justfile', 'pipfile', 'snakefile', 'guardfile',
  'fastfile', 'appfile', 'matchfile', 'berksfile', 'capfile', 'cartfile', 'earthfile', 'tiltfile',
  'taskfile', 'dangerfile', 'thorfile', 'license', 'licence', 'copying', 'notice', 'readme', 'changelog',
  'changes', 'history', 'authors', 'contributors', 'contributing', 'codeowners', 'owners', 'version',
  'todo', 'security', 'install', 'manifest',
]);

/** Ends like a statement or block: at least three are needed. */
const CODE_LINE_RE = /[{};]\s*$/;
/** Ends like any code line: these must be at least half of the non-empty lines. */
const CODE_SHAPED_LINE_RE = /[{};()[\],]\s*$/;
/** Ends like a code line, for rule 4's keyword test only (`@Override public int f() {`, `@Input() a,`). */
const CODE_END_RE = /[{};,)]\s*$/;
const ANNOTATION_LINE_RE = /^\s*@[A-Za-z_][\w.]*(\(.*\))?\s*$/;
const CODE_KEYWORDS: ReadonlySet<string> = new Set([
  'public', 'private', 'protected', 'internal', 'static', 'final', 'abstract', 'override', 'open',
  'suspend', 'fun', 'func', 'fn', 'function', 'void', 'def', 'val', 'var', 'let', 'const', 'class',
  'interface', 'enum', 'struct', 'async', 'export', 'readonly', 'sealed', 'inline', 'lateinit',
]);
const TYPED_DECLARATION_RE = /^[A-Z]\w*(<[^>]*>)?\??(\[\])?\s+[A-Za-z_]\w*\s*[;,)=({]/;

/**
 * Pasted code: at least three lines end in `{`, `}` or `;`, and code-shaped lines (ending in
 * `{ } ; ( ) [ ] ,`) are at least half of the non-empty lines. Pure.
 */
export function looksLikePastedCode(text: string): boolean {
  let statements = 0;
  let shaped = 0;
  let nonEmpty = 0;
  for (const line of String(text ?? '').split('\n')) {
    if (line.trim() === '') continue;
    nonEmpty++;
    if (CODE_LINE_RE.test(line)) statements++;
    if (CODE_SHAPED_LINE_RE.test(line)) shaped++;
  }
  return statements >= 3 && shaped * 2 >= nonEmpty;
}

/** True when only spaces or tabs precede `index` on its line. Pure. */
function atLineStart(text: string, index: number): boolean {
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  return /^[ \t]*$/.test(text.slice(lineStart, index));
}

/** Annotation arguments that look like code: `()`, or containing a quote, brace, bracket, `=` or `:`. */
function codeLikeArguments(rest: string): boolean {
  if (!rest.startsWith('(')) return false;
  const close = rest.indexOf(')');
  const inner = rest.slice(1, close >= 0 ? close : undefined);
  return inner.trim() === '' || /["'`{[=:]/.test(inner);
}

interface Line { text: string; start: number; end: number }

/** The nearest non-empty line ending before `lineStart`, walking back line by line. Pure. */
function previousNonEmptyLine(text: string, lineStart: number): Line | undefined {
  let end = lineStart - 1; // the '\n' that ends the previous line
  while (end >= 0) {
    const start = text.lastIndexOf('\n', end - 1) + 1;
    const l = text.slice(start, end);
    if (l.trim() !== '') return { text: l, start, end };
    end = start - 1;
  }
  return undefined;
}

/** The nearest non-empty line starting after `lineEnd`, walking forward line by line. Pure. */
function nextNonEmptyLine(text: string, lineEnd: number): Line | undefined {
  let start = lineEnd + 1;
  while (start <= text.length && lineEnd < text.length) {
    const nl = text.indexOf('\n', start);
    const end = nl < 0 ? text.length : nl;
    const l = text.slice(start, end);
    if (l.trim() !== '') return { text: l, start, end };
    if (nl < 0) return undefined;
    start = nl + 1;
  }
  return undefined;
}

/** Most stacked annotation lines walked over to find the code they belong to; past this, unsure. */
const MAX_ANNOTATION_HOPS = 8;

/**
 * Rule 5's neighbour test (second review): walking away from the token over any stacked annotation
 * lines, the first other non-empty line must end in `{`, `}` or `;`. A line ending in `,` or `)` is
 * NOT code here (a prose sentence, a list item, a numbered "(1)" item), and a stack of lone `@Name`
 * lines with no code beside it is not code either. Pure.
 */
function codeNeighbour(text: string, from: number, step: (t: string, at: number) => Line | undefined, edge: (l: Line) => number): boolean {
  let at = from;
  for (let hops = 0; hops <= MAX_ANNOTATION_HOPS; hops++) {
    const l = step(text, at);
    if (!l) return false;
    if (!ANNOTATION_LINE_RE.test(l.text)) return CODE_LINE_RE.test(l.text);
    at = edge(l);
  }
  return false;
}

/**
 * Real annotation names (Dart, Java, Kotlin, TypeScript/Angular, Spring, JPA, JUnit), lower-case.
 * Conservative on purpose: names that are also plausible app files or components (Header, Login, App,
 * Home, Profile, Settings, Service, Controller, Input, Output, Component, Test, Entity, Directive, Id,
 * Required, Immutable, Protected, Preview, Inject, …) are NOT here, so a lone `@Name` like that keeps
 * its warning. The rest of the list was audited for the same collision; distinctive annotation-only
 * names (override, composable, autowired, beforeeach, …) stay. An annotation with arguments still drops
 * through the non-lone path and does not consult this list.
 */
export const KNOWN_ANNOTATIONS: ReadonlySet<string> = new Set([
  // Java / Kotlin language and platform
  'override', 'deprecated', 'suppresswarnings', 'functionalinterface', 'safevarargs', 'retention',
  'documented', 'inherited', 'repeatable', 'jvmstatic', 'jvmoverloads', 'jvmfield', 'throws',
  // Jetpack Compose (preview omitted: also a common screen/file name)
  'composable',
  // Angular / TypeScript (component, directive, input, output omitted: common app files)
  'injectable', 'ngmodule', 'hostlistener', 'hostbinding',
  'viewchild', 'viewchildren', 'contentchild',
  // Spring / DI / JPA / validation (inject, entity, id omitted: common app files)
  'autowired', 'restcontroller', 'getmapping', 'postmapping', 'requestmapping', 'pathvariable',
  'requestbody', 'transactional', 'generatedvalue', 'nullable', 'nonnull', 'notnull',
  // JUnit (test omitted: a common file/component name)
  'before', 'after', 'beforeeach', 'aftereach', 'beforeall', 'afterall', 'parameterizedtest',
  'displayname',
  // Dart / Flutter (required, immutable, protected omitted: common words/files)
  'visiblefortesting', 'mustcallsuper', 'pragma', 'jsonkey',
  'jsonserializable', 'freezed', 'riverpod',
]);

/** The immediately following line (no blank). Undefined at EOF or when the next line is blank. Pure. */
function nextImmediateLine(text: string, lineEnd: number): Line | undefined {
  if (lineEnd >= text.length) return undefined;
  const nl = text.indexOf('\n', lineEnd + 1);
  const start = lineEnd + 1;
  const end = nl < 0 ? text.length : nl;
  const l = text.slice(start, end);
  if (l.trim() === '') return undefined;
  return { text: l, start, end };
}

/** A lone `@Name` or `@Name(...)` whose name is in `KNOWN_ANNOTATIONS`. Pure. */
function isKnownAnnotationLine(line: string): boolean {
  if (!ANNOTATION_LINE_RE.test(line)) return false;
  const ann = /^\s*@([A-Za-z_]\w*)/.exec(line);
  return !!ann && KNOWN_ANNOTATIONS.has(ann[1].toLowerCase());
}

/**
 * The very next line (no blank between) ends in `{ } ;`, or is a known annotation from which a
 * no-blank walk (cap 8 hops) actually reaches a line ending in `{ } ;`. A following known annotation
 * is not enough on its own — a stack that never reaches a declaration keeps the warning. Pure.
 */
function annotatesTheNextLine(text: string, lineEnd: number): boolean {
  const first = nextImmediateLine(text, lineEnd);
  if (!first) return false;
  if (CODE_LINE_RE.test(first.text)) return true;
  if (!isKnownAnnotationLine(first.text)) return false;
  let at = first.end;
  for (let hops = 0; hops <= MAX_ANNOTATION_HOPS; hops++) {
    const l = nextImmediateLine(text, at);
    if (!l) return false;
    if (CODE_LINE_RE.test(l.text)) return true;
    if (!isKnownAnnotationLine(l.text)) return false;
    at = l.end;
  }
  return false;
}

/** Rules 4 and 5 above, for the `@` at `at` followed by `token`. Pure. */
function readsAsAnnotation(text: string, at: number, token: string): boolean {
  const lineStart = text.lastIndexOf('\n', at - 1) + 1;
  const nl = text.indexOf('\n', at);
  const lineEnd = nl < 0 ? text.length : nl;
  const line = text.slice(lineStart, lineEnd);
  const rest = text.slice(at + 1 + token.length, lineEnd).trim();
  const firstWord = /^[A-Za-z_]\w*/.exec(rest)?.[0] ?? '';
  const ownLine = rest === ''
    || codeLikeArguments(rest)
    || (CODE_KEYWORDS.has(firstWord) && CODE_END_RE.test(line))
    || TYPED_DECLARATION_RE.test(rest);
  if (!ownLine) return false;
  const codeBefore = codeNeighbour(text, lineStart, previousNonEmptyLine, (l) => l.start);
  if (!codeBefore) return false;
  // THE STRICT BELT FOR A LONE TOKEN (third/fourth review). `@Header` alone between code lines is as
  // likely a missing file as an annotation, so a lone token is dropped only when its name is a real,
  // known annotation (not a name that is also a plausible app file) AND the very next line (no blank
  // line between) ends in `{ } ;`, or is another known annotation from which a no-blank walk reaches a
  // line ending in `{ } ;` — the shape of an annotation sitting on the declaration it marks.
  if (rest === '') return KNOWN_ANNOTATIONS.has(token.toLowerCase()) && annotatesTheNextLine(text, lineEnd);
  return CODE_LINE_RE.test(line) || codeNeighbour(text, lineEnd, nextNonEmptyLine, (l) => l.end);
}

export interface FileMentions {
  /** Mentioned paths that really exist, in the order written, deduped and capped. */
  resolved: string[];
  /** Mentioned tokens that match no file. Told to the user; never silently dropped. */
  unresolved: string[];
}

/**
 * Find the files a message names with `@`.
 *
 * Resolution is forgiving in the ways a person is careless and strict everywhere else: an exact match
 * first, then a case-insensitive match, then a unique basename match (so `@App.tsx` finds
 * `src/App.tsx`). A basename that matches MORE than one file is left UNRESOLVED rather than guessed —
 * picking one of three `index.ts` files silently is worse than asking. Pure.
 */
export function parseFileMentions(prompt: string | null | undefined, knownPaths: readonly string[] | null | undefined): FileMentions {
  const text = String(prompt ?? '');
  const paths = (knownPaths ?? []).filter((p): p is string => typeof p === 'string' && p.length > 0);
  const resolved: string[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();

  const push = (map: Map<string, string[]>, key: string, value: string): void => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };
  const byLower = new Map<string, string[]>();
  const byBase = new Map<string, string[]>();
  for (const p of paths) {
    const clean = p.replace(/^\.\//, '');
    push(byLower, clean.toLowerCase(), p);
    push(byBase, (clean.split('/').pop() ?? clean).toLowerCase(), p);
  }

  let codeLike: boolean | undefined;
  for (const m of text.matchAll(MENTION_RE)) {
    const token = m[2];
    if (!token) continue;
    const key = token.replace(/^\.\//, '').toLowerCase();
    const exact = byLower.get(key);
    // A basename is only usable when it is UNAMBIGUOUS — three index.ts files must not silently
    // become whichever one happened to be listed first.
    const base = byBase.get(key);
    const hit = exact?.[0] ?? (base && base.length === 1 ? base[0] : undefined);
    if (!hit) {
      // BR1998: an annotation in pasted code (`@override`) is not a missing file.
      const at = (m.index ?? 0) + m[1].length;
      if (ANNOTATION_TOKEN_RE.test(token) && !WELL_KNOWN_FILES.has(token.toLowerCase()) && atLineStart(text, at)
        && (codeLike ??= looksLikePastedCode(text)) && readsAsAnnotation(text, at, token)) continue;
      if (!unresolved.includes(token)) unresolved.push(token);
      continue;
    }
    if (seen.has(hit)) continue;
    seen.add(hit);
    if (resolved.length < MAX_FILE_MENTIONS) resolved.push(hit);
  }

  return { resolved, unresolved };
}

/**
 * The prompt block naming the scope. Returns '' when nothing resolved, so the caller can prepend
 * unconditionally.
 *
 * Says "start here", not "only touch these": a sticky header may genuinely need a CSS file the user did
 * not name, and a hard restriction would produce a half-done change that looks like a bug. The point is
 * to remove the SEARCH, not to handcuff the fix. Pure.
 */
export function fileMentionsBlock(mentions: FileMentions | null | undefined): string {
  const resolved = mentions?.resolved ?? [];
  if (resolved.length === 0) return '';
  const list = resolved.map((p) => `- ${p}`).join('\n');
  return [
    'FILES THE USER NAMED — they pointed at these with `@`, so start here instead of searching for the right file:',
    list,
    'Read them first. If the change genuinely needs another file too, edit that as well — this is the starting point, not a restriction.',
  ].join('\n');
}

/**
 * What to tell the user about a mention that matched nothing. '' when everything resolved.
 *
 * Naming the failure is the whole point: a user who typed `@src/Header.tsx` and got a change somewhere
 * else needs to know we could not find their file, not be left thinking the AI ignored them. Pure.
 */
export function unresolvedMentionsNotice(mentions: FileMentions | null | undefined): string {
  const unresolved = mentions?.unresolved ?? [];
  if (unresolved.length === 0) return '';
  const list = unresolved.map((t) => `@${t}`).join(', ');
  return unresolved.length === 1
    ? `⚠️ I could not find ${list} in this project, so I worked from the rest of your message.`
    : `⚠️ I could not find these in this project: ${list} — I worked from the rest of your message.`;
}
