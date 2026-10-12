/**
 * A NAME THE PLATFORM CHANGES TRAVELS WITH THE CODE, NOT ONLY IN NARRATION (build report 9c612cdb,
 * 2026-10-12, Q-942).
 *
 * 🔴 THE FAILURE. Since build 9762f589, `separateTypeFromComponentNames` renames a contract type that shares a
 * planned component's name — here `VideoList` (the data, `Video[]`) became `VideoListData`, because
 * `src/components/VideoList.tsx` is the component. The rename was told to exactly one reader: the USER, in a
 * narration line ("🏷️ Renamed VideoList → VideoListData …"). No model ever saw it. The written
 * `src/types.ts` carried only `VideoListData` and a generic header; the hand-off to the full builder said
 * "keep their types and export names". The full builder wrote `src/App.tsx` with the natural name in a type
 * position, and once the component existed tsc answered
 *
 *     src/App.tsx(30,37): error TS2749: 'VideoList' refers to a value, but is being used as a type here.
 *     Did you mean 'typeof VideoList'?
 *
 * — with its own suggestion pointing at the WRONG fix (the component's function type, not the data). One
 * read and one ineffective edit later the model found `VideoListData` on its own.
 *
 * 🧬 THE CLASS. The platform silently changes a name a model must later use, and tells only the user. The
 * 9762f589 fix reasoned about the fast lane's own per-file calls, which do receive the renamed contract, and
 * never about a reader that does not: the full builder after a hand-off, and every later edit turn.
 *
 * THE FIX, IN FOUR PLACES, ALL READING ONE RECORD:
 *   1. the contract file's header carries one STRICT line per rename (`contractRenameHeaderLine`) — the file
 *      the hand-off says to read first, and the one every later turn reads;
 *   2. the hand-off names each rename (`contractRenameHandoffLine`, handoffRule.ts);
 *   3. the write-time typecheck's ✏️ advice says which name is which when TS2749 hits a recorded name
 *      (`typeRenameAdvice`), in both the written file's errors and the errors elsewhere;
 *   4. the write door fixes it in files this build wrote (`fixRecordedTypeRenames`), so no model turn is spent.
 *
 * 🔒 THE HEADER IS A PARSE PROTOCOL, SO IT IS STRICT. A line that does not match the exact format — a user's
 * edit, a stray comment — is simply not a rename; and the heal still checks that the contract really
 * declares the new name and that the token tsc pointed at IS the old one. A record can only ever switch the
 * heal OFF, never steer it somewhere wrong.
 *
 * ⚠️ `typeof X` IS SOMETIMES RIGHT. `ComponentProps<VideoList>` produces the identical TS2749 and the same
 * "Did you mean 'typeof VideoList'?" — and there the compiler is right. The heal never touches a type
 * argument of a component-taking utility type, and the advice is conditional (data → the new name; the
 * component's own type → `typeof X`).
 *
 * PURE except for nothing: the caller supplies every text; this module never reads a file and never throws.
 */
import * as ts from 'typescript';
import { posix } from 'node:path';
import type { TscError } from './EndgameRepair';

/** One platform rename: `from` is the component's name, `to` the shared data type's new name. */
export interface ContractRename {
  from: string;
  to: string;
  /** The planned component file `from` names, when known (e.g. `src/components/VideoList.tsx`). */
  component?: string;
}

/** Where the fast lane writes the contract module — `contractFilePath` in SimpleBuilder.ts. */
export const CONTRACT_PATH_CANDIDATES: readonly string[] = ['src/types.ts', 'types.ts'];

/** Kill switch for the write-door heal. Default ON; `off` leaves the error to the model with the ✏️ advice. */
export function contractRenameHealEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_CONTRACT_RENAME_HEAL ?? '').trim().toLowerCase() !== 'off';
}

const ID = '[A-Za-z_$][\\w$]*';
const HEADER_LINE = new RegExp(`^// renamed: (${ID}) -> (${ID}) \\((${ID}) is the component(?: in ([^;()]+))?; the data type is (${ID})\\)$`);

/**
 * The contract file's header line for one rename. The format is a protocol `contractRenamesFromSource`
 * reads back — change both together, and the pinned test with them. PURE.
 */
export function contractRenameHeaderLine(r: ContractRename): string {
  const where = r.component && !/[;()\n]/.test(r.component) ? ` in ${r.component}` : '';
  return `// renamed: ${r.from} -> ${r.to} (${r.from} is the component${where}; the data type is ${r.to})`;
}

/** The renames a contract file's HEADER records — only the leading comment block counts. PURE. */
export function contractRenamesFromSource(source: string | null | undefined): ContractRename[] {
  const out: ContractRename[] = [];
  for (const raw of String(source ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    if (!line.startsWith('//')) break; // the header ends at the first line of code
    const m = HEADER_LINE.exec(line);
    if (!m || m[1] !== m[3] || m[2] !== m[5] || m[1] === m[2]) continue;
    out.push({ from: m[1], to: m[2], ...(m[4] ? { component: m[4].trim() } : {}) });
  }
  return out;
}

/** The renames recorded by whichever contract file is in hand (`sources` maps path → content). PURE. */
export function contractRenamesInSources(sources: Readonly<Record<string, string>>): ContractRename[] {
  for (const path of CONTRACT_PATH_CANDIDATES) {
    const found = contractRenamesFromSource(sources?.[path]);
    if (found.length > 0) return found;
  }
  return [];
}

/** The value name a TS2749 ("'X' refers to a value, but is being used as a type here") is about. PURE. */
export function valueUsedAsTypeName(e: Pick<TscError, 'code' | 'message'>): string | null {
  if (e.code !== 'TS2749') return null;
  return new RegExp(`^'(${ID})' refers to a value, but is being used as a type here`).exec(e.message)?.[1] ?? null;
}

export interface TypeRenameSuggestion { file: string; line: number; col: number; from: string; to: string; component?: string }

/** Every TS2749 whose name is a PLATFORM-RECORDED rename — nothing else. PURE. */
export function suggestedTypeRenames(errors: readonly TscError[], renames: readonly ContractRename[]): TypeRenameSuggestion[] {
  if (renames.length === 0) return [];
  const byFrom = new Map(renames.map((r) => [r.from, r] as const));
  const out: TypeRenameSuggestion[] = [];
  for (const e of errors) {
    const name = valueUsedAsTypeName(e);
    const r = name ? byFrom.get(name) : undefined;
    if (r) out.push({ file: e.file, line: e.line, col: e.col, from: r.from, to: r.to, ...(r.component ? { component: r.component } : {}) });
  }
  return out;
}

/**
 * The ✏️ advice lines for the write-time typecheck — one per (file, name), every line named. The wording is
 * conditional on purpose: the compiler's `typeof X` is right for the component's own type and wrong for the
 * data. PURE.
 */
export function typeRenameAdvice(suggestions: readonly TypeRenameSuggestion[]): string[] {
  const groups = new Map<string, { s: TypeRenameSuggestion; lines: number[] }>();
  for (const s of suggestions) {
    const key = `${s.file}\u0000${s.from}`;
    const g = groups.get(key) ?? { s, lines: [] };
    g.lines.push(s.line);
    groups.set(key, g);
  }
  return [...groups.values()].map(({ s, lines }) => {
    const where = s.component ? ` (${s.component})` : '';
    const at = `line${lines.length > 1 ? 's' : ''} ${[...new Set(lines)].join(', ')}`;
    return `✏️ \`${s.from}\` is the COMPONENT${where}. NavBharatAI renamed the shared DATA type to \`${s.to}\` so the two `
      + `never share a name (the shared types file's header records it). In ${s.file} (${at}): if you mean the data, write `
      + `\`${s.to}\` and import it from the shared types file; only if you mean the component's own type, write \`typeof ${s.from}\`.`;
  });
}

/** A type argument of these takes a COMPONENT — `typeof X` is the right fix there, so the heal never touches it. */
const COMPONENT_TAKING_TYPES = new Set([
  'ComponentProps', 'ComponentPropsWithRef', 'ComponentPropsWithoutRef', 'ComponentRef', 'ElementRef',
  'ReturnType', 'Parameters', 'InstanceType', 'ConstructorParameters', 'PropsWithChildren',
]);

function typeRefName(n: ts.TypeReferenceNode): string {
  const t = n.typeName;
  return ts.isIdentifier(t) ? t.text : t.right.text;
}

/** The identifier starting exactly at `pos`, or null. */
function identifierAt(sf: ts.SourceFile, pos: number): ts.Identifier | null {
  let found: ts.Identifier | null = null;
  const visit = (node: ts.Node): void => {
    if (found || pos < node.getFullStart() || pos >= node.end) return;
    if (ts.isIdentifier(node) && node.getStart(sf) === pos) { found = node; return; }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** A plain type annotation or generic argument naming `id` — and not inside a component-taking utility type. */
function isHealableTypeUse(id: ts.Identifier): boolean {
  const ref = id.parent;
  if (!ref || !ts.isTypeReferenceNode(ref) || ref.typeName !== id || ref.typeArguments) return false;
  for (let n: ts.Node | undefined = ref.parent; n && ts.isTypeNode(n); n = n.parent) {
    if (ts.isTypeReferenceNode(n) && COMPONENT_TAKING_TYPES.has(typeRefName(n))) return false;
  }
  return true;
}

function declaresType(contractSource: string, name: string): boolean {
  return new RegExp(`(?:^|\\n)\\s*export\\s+(?:declare\\s+)?(?:interface|type|enum|class)\\s+${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(contractSource);
}

function importSpecifierFor(fromFile: string, contractPath: string): string {
  let rel = posix.relative(posix.dirname(fromFile), contractPath).replace(/\.tsx?$/, '');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

function resolvesTo(fromFile: string, spec: string, contractPath: string): boolean {
  if (!spec.startsWith('.')) return false;
  const base = contractPath.replace(/\.tsx?$/, '');
  const target = posix.normalize(posix.join(posix.dirname(fromFile), spec)).replace(/\.(?:tsx?|jsx?)$/, '');
  return target === base;
}

export interface TypeRenameFix {
  files: Record<string, string>;
  /** What landed, one entry per error fixed. */
  fixed: TypeRenameSuggestion[];
  /** Per file: the 1-based line after which ONE import line was inserted (every later line moved down by 1). */
  insertedAfterLine: Record<string, number>;
}

/**
 * Replace a recorded old name with the new one where tsc reported TS2749 on it, in a plain type position
 * only, and import the new name from the contract module. PURE.
 *
 * Acts only when: the error is TS2749 on a recorded `from`; the token at tsc's line:col IS `from`; it is a
 * plain type reference (an annotation or a generic argument such as `useState<VideoList>`) and not a type
 * argument of a component-taking utility (`ComponentProps<VideoList>` stays — `typeof` is right there); the
 * contract really declares `to`; and the file declares no `to` of its own. Anything else is left exactly as
 * it was, for the model and the ✏️ advice.
 */
export function fixRecordedTypeRenames(
  files: Readonly<Record<string, string>>,
  errors: readonly TscError[],
  renames: readonly ContractRename[],
  contract: { path: string; source: string },
): TypeRenameFix {
  const out: Record<string, string> = { ...files };
  const fixed: TypeRenameSuggestion[] = [];
  const insertedAfterLine: Record<string, number> = {};
  const suggestions = suggestedTypeRenames(errors, renames).filter((s) => declaresType(contract.source, s.to));
  const byFile = new Map<string, TypeRenameSuggestion[]>();
  for (const s of suggestions) if (typeof files[s.file] === 'string') byFile.set(s.file, [...(byFile.get(s.file) ?? []), s]);
  for (const [file, list] of byFile) {
    try {
      const src = files[file];
      const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, /x$/i.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const edits: Array<{ start: number; end: number; text: string }> = [];
      const landed: TypeRenameSuggestion[] = [];
      for (const s of list) {
        let pos: number;
        try { pos = sf.getPositionOfLineAndCharacter(s.line - 1, s.col - 1); } catch { continue; }
        const id = identifierAt(sf, pos);
        if (!id || id.text !== s.from || !isHealableTypeUse(id)) continue;
        edits.push({ start: id.getStart(sf), end: id.end, text: s.to });
        landed.push(s);
      }
      if (landed.length === 0) continue;
      const names = [...new Set(landed.map((s) => s.to))];
      // A local of the new name would be shadowed or clash — leave the file to the model.
      const locals = new Set<string>();
      sf.statements.forEach((st) => {
        if ((ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st) || ts.isFunctionDeclaration(st)) && st.name) locals.add(st.name.text);
        if (ts.isVariableStatement(st)) st.declarationList.declarations.forEach((d) => { if (ts.isIdentifier(d.name)) locals.add(d.name.text); });
      });
      // The new name must reach the file from the contract module: added to an import of it, or a new one.
      const imports = sf.statements.filter(ts.isImportDeclaration);
      const importedFrom = new Map<string, string>(); // local name -> module specifier
      for (const imp of imports) {
        const spec = ts.isStringLiteral(imp.moduleSpecifier) ? imp.moduleSpecifier.text : '';
        const nb = imp.importClause?.namedBindings;
        if (imp.importClause?.name) importedFrom.set(imp.importClause.name.text, spec);
        if (nb && ts.isNamedImports(nb)) nb.elements.forEach((el) => importedFrom.set(el.name.text, spec));
        if (nb && ts.isNamespaceImport(nb)) importedFrom.set(nb.name.text, spec);
      }
      if (names.some((n) => locals.has(n) || (importedFrom.has(n) && !resolvesTo(file, importedFrom.get(n)!, contract.path)))) continue;
      const missing = names.filter((n) => !importedFrom.has(n));
      let inserted = false;
      if (missing.length > 0) {
        const target = imports.find((imp) => ts.isStringLiteral(imp.moduleSpecifier) && resolvesTo(file, imp.moduleSpecifier.text, contract.path)
          && imp.importClause?.namedBindings && ts.isNamedImports(imp.importClause.namedBindings));
        if (target) {
          const named = target.importClause!.namedBindings as ts.NamedImports;
          const typeOnly = !!target.importClause!.isTypeOnly;
          const specs = missing.map((n) => (typeOnly ? n : `type ${n}`)).join(', ');
          if (named.elements.length > 0) {
            edits.push({ start: named.elements[named.elements.length - 1].end, end: named.elements[named.elements.length - 1].end, text: `, ${specs}` });
          } else {
            const at = named.getStart(sf) + 1; // just inside `{`
            edits.push({ start: at, end: at, text: ` ${specs} ` });
          }
        } else {
          const line = `import type { ${missing.join(', ')} } from '${importSpecifierFor(file, contract.path)}';`;
          const last = imports[imports.length - 1];
          if (last) {
            edits.push({ start: last.end, end: last.end, text: `\n${line}` });
            insertedAfterLine[file] = sf.getLineAndCharacterOfPosition(last.end).line + 1;
          } else {
            edits.push({ start: 0, end: 0, text: `${line}\n` });
            insertedAfterLine[file] = 0;
          }
          inserted = true;
        }
      }
      let next = src;
      for (const e of edits.sort((a, b) => b.start - a.start)) next = next.slice(0, e.start) + e.text + next.slice(e.end);
      if (next === src) { if (inserted) delete insertedAfterLine[file]; continue; }
      out[file] = next;
      fixed.push(...landed);
    } catch { /* a file this cannot parse is left exactly as it was */ }
  }
  return { files: out, fixed, insertedAfterLine };
}

/**
 * The errors still standing once the fixes in `landedFiles` are written: the fixed ones gone, and the rest of
 * a file that gained an import line moved down by one, so every line quoted to the model is still true. PURE.
 */
export function errorsAfterTypeRenames(errors: readonly TscError[], fix: TypeRenameFix, landedFiles: ReadonlySet<string>): TscError[] {
  const gone = new Set(fix.fixed.filter((s) => landedFiles.has(s.file)).map((s) => `${s.file}\u0000${s.line}\u0000${s.col}`));
  const out: TscError[] = [];
  for (const e of errors) {
    if (gone.has(`${e.file}\u0000${e.line}\u0000${e.col}`) && valueUsedAsTypeName(e)) continue;
    const after = landedFiles.has(e.file) ? fix.insertedAfterLine[e.file] : undefined;
    out.push(after !== undefined && e.line > after ? { ...e, line: e.line + 1 } : e);
  }
  return out;
}

/** What the model is told the platform did. '' when nothing landed. PURE. */
export function typeRenameHealNote(fixed: readonly TypeRenameSuggestion[]): string {
  if (fixed.length === 0) return '';
  const groups = new Map<string, { file: string; from: string; to: string; lines: number[] }>();
  for (const s of fixed) {
    const key = `${s.file}\u0000${s.from}`;
    const g = groups.get(key) ?? { file: s.file, from: s.from, to: s.to, lines: [] };
    g.lines.push(s.line);
    groups.set(key, g);
  }
  const parts = [...groups.values()].map((g) => `${g.file} line${g.lines.length > 1 ? 's' : ''} ${[...new Set(g.lines)].join(', ')} (\`${g.from}\` → \`${g.to}\`)`);
  return `\n🔧 Fixed automatically: ${parts.join('; ')} — each used a COMPONENT's name as a data type. NavBharatAI renamed the shared data type `
    + 'so the two never share a name, so the type now uses the new name, imported from the shared types file. Nothing to do for these; '
    + 'write the new name whenever you mean the data.';
}
