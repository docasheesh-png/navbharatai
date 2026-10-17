/**
 * A SHARED CONTRACT DECLARES NO NOMINAL ENUM — a fixed set of values becomes an `as const` object and its
 * value-union type, before any file of the app is written (build report 9c612cdb, 2026-10-12, Q-984).
 *
 * 🔴 THE FAILURE. The fast lane's contract call returned
 *
 *     export enum VideoSource { YouTube = 'YouTube', Vimeo = 'Vimeo' }
 *
 * and `src/hooks/useVideoList.ts`, written in its own isolated call, did the obvious thing at line 57:
 * `source: 'YouTube'`. A TypeScript string enum is NOMINAL — no quoted value is ever assignable to it — so
 * the file failed with TS2322 (`Type '"YouTube"' is not assignable to type 'VideoSource'`), the error was
 * handed over with the salvaged files, and the full builder needed two edits to fix code that looked right.
 * Only a consumer that imports the enum AND uses member syntax avoids it, and isolated consumers do not.
 *
 * 🧬 THE CLASS. The contract exists to freeze names across files written in isolation, and a nominal type is
 * the one construct those files cannot satisfy with the natural code. The 2026-06-30 LENS A fix (a YouTube /
 * Vimeo player too) froze member CASING and started asking for enums — it fixed drift in names, never this.
 *
 * THE FIX, BY CONSTRUCTION. `stringEnumsAsConstObjects` rewrites, inside the contract text itself:
 *
 *     export enum VideoSource { YouTube = 'YouTube', Vimeo = 'Vimeo' }
 *   → export const VideoSource = { YouTube: 'YouTube', Vimeo: 'Vimeo' } as const;
 *     export type VideoSource = (typeof VideoSource)[keyof typeof VideoSource];
 *
 * Both `VideoSource.YouTube` and `'YouTube'` compile against that, `Object.values(VideoSource)` lists the
 * values, a switch on either form narrows, and a value outside the set is still TS2322. Converted:
 *   • an enum whose EVERY member has a string initialiser (its values are kept exactly);
 *   • an enum with NO initialiser at all — each member's value becomes its own name. Safe only because the
 *     contract is normalised before any consumer exists: no file ever saw the numbers.
 * Left exactly as written: explicit numeric (`LEFT = -1`), heterogeneous and computed enums, whose runtime
 * values or reverse mapping a conversion would change, and any name declared more than once.
 *
 * ⚠️ AN ENUM MEMBER USED AS A TYPE. `interface AddAction { type: ActionType.Add }` is valid with an enum and
 * TS2702 with the object (`'ActionType' only refers to a type`). So, inside the contract, every such
 * reference to a converted enum becomes `typeof ActionType.Add` — still the single literal type, still a
 * discriminant. A CONSUMER that writes the member as a type in its own file remains a residual (TS2702).
 *
 * PURE: the caller supplies the text; this never reads a file and never throws. Text it does not convert is
 * returned byte-identical. Kill switch: `AGENTV3_CONTRACT_ENUM_AS_CONST=off`.
 */
import * as ts from 'typescript';

/**
 * The rule line for a contract a module or a lane writes where no normaliser runs over it (Project Mode module
 * contracts — each module writes its own file, and later modules consume it in isolation). One wording.
 */
export const CONTRACT_FIXED_VALUES_RULE =
  "A fixed set of values in a contract is an `as const` object with its value-union type, or a string-literal union — "
  + "never an `enum`: a module written later, in isolation, writes the plain value ('active'), and an enum rejects it.";

/**
 * The contract file's header line for one converted enum (Q-1027). PURE.
 *
 * 🔴 WHY THE CONVERSION HAD TO BE SAID AT ALL. `prepareSharedContract` returned `enumsAsConst` — and
 * measured, **nothing read it.** Not the report, not the hand-off, not the prompt, not the contract's own
 * header. The rewrite happened and the FACT of it reached nobody, so the next autopsy could not see it fire
 * and the model could not know it had. A value computed and returned with no reader is indistinguishable
 * from one never computed (the same shape as Q-1011, where the one place a reader would look was empty).
 *
 * 🔑 AND IT IS NOT ONLY BOOKKEEPING. This module's own note names a residual it cannot reach: a CONSUMER
 * that writes a member as a TYPE — `interface AddAction { type: ActionType.Add }` — gets TS2702 against an
 * `as const` object, because the name no longer refers to a type. Telling the model which names were
 * converted, in the file the hand-off says to read first, is what stops that residual being written.
 *
 * Unlike `contractRenameHeaderLine` this is NOT a parse protocol: nothing reads it back, so it is worded for
 * a reader rather than a regex. If a heal ever needs to read it, give it a strict format then.
 */
export function contractEnumHeaderLine(name: string): string {
  return `// as-const: ${name} is an \`as const\` object with a value-union type, not an enum — write the plain value `
    + `('${name}' members are strings), and \`typeof ${name}.Member\` if you need one member as a type.`;
}

/** One sentence naming every converted enum, for a hand-off or a narration. '' when none. PURE. */
export function contractEnumsSentence(names: readonly string[]): string {
  const list = names.filter((n) => typeof n === 'string' && n.trim()).map((n) => n.trim());
  if (list.length === 0) return '';
  return `NavBharatAI rewrote ${list.length === 1 ? 'the enum' : 'the enums'} ${list.join(', ')} in the shared contract as `
    + '`as const` object(s) with a value-union type, so a file written in isolation can use the plain value. Write the '
    + 'value, not a member reference, and never re-declare them as `enum`; a member used as a TYPE must be written '
    + '`typeof Name.Member`.';
}

/** Default ON. `off` leaves every contract enum as the model wrote it (the behaviour before 9c612cdb). */
export function contractEnumAsConstEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.AGENTV3_CONTRACT_ENUM_AS_CONST ?? '').trim().toLowerCase() !== 'off';
}

/** A markdown fence line the contract prompt asked the model not to add. Masked before parsing. */
const FENCE_LINE = /^[ \t]*```[a-zA-Z]*[ \t]*$/gm;

interface Edit { start: number; end: number; text: string }

/** `'it''s'` → a single-quoted literal with `\` and `'` escaped. */
function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;
}

/** The names a top-level statement declares (so a merged or clashing name is never converted). */
function declaredNames(st: ts.Statement): string[] {
  if (ts.isEnumDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)
    || ts.isClassDeclaration(st) || ts.isFunctionDeclaration(st) || ts.isModuleDeclaration(st)) {
    const n = st.name;
    return n && ts.isIdentifier(n) ? [n.text] : [];
  }
  if (ts.isVariableStatement(st)) {
    return st.declarationList.declarations.flatMap((d) => (ts.isIdentifier(d.name) ? [d.name.text] : []));
  }
  return [];
}

/**
 * The `key: value` pairs an enum becomes, or null when it must stay an enum. Each pair keeps the member's
 * leading trivia (indentation, comments), so the object reads like the enum it replaces.
 */
function asConstMembers(decl: ts.EnumDeclaration, sf: ts.SourceFile, text: string): string[] | null {
  if (decl.members.length === 0) return null;
  const withInit = decl.members.filter((m) => m.initializer !== undefined).length;
  if (withInit !== 0 && withInit !== decl.members.length) return null; // heterogeneous or auto-after-string
  const out: string[] = [];
  for (const m of decl.members) {
    let keyText: string;
    let keyValue: string;
    if (ts.isIdentifier(m.name)) { keyText = m.name.text; keyValue = m.name.text; }
    else if (ts.isStringLiteral(m.name)) { keyText = m.name.getText(sf); keyValue = m.name.text; }
    else return null; // computed / numeric member names
    let valueText: string;
    if (m.initializer === undefined) valueText = quote(keyValue);
    else if (ts.isStringLiteral(m.initializer)) valueText = m.initializer.getText(sf);
    else if (ts.isNoSubstitutionTemplateLiteral(m.initializer)) valueText = quote(m.initializer.text);
    else return null; // numeric, computed, a reference to another member — runtime values would change
    const trivia = text.slice(m.pos, m.getStart(sf));
    out.push(`${trivia}${keyText}: ${valueText}`);
  }
  return out;
}

/**
 * Convert the contract's string enums (and enums with no initialisers) to `as const` objects with a
 * same-named value-union type, and rewrite `Enum.Member` in TYPE positions to `typeof Enum.Member`. PURE.
 */
export function stringEnumsAsConstObjects(contract: string): { contract: string; converted: string[] } {
  const text = String(contract ?? '');
  const unchanged = { contract: text, converted: [] as string[] };
  if (!/\benum\b/.test(text)) return unchanged;
  try {
    // A fence line is three backticks — a template literal to the parser, which would swallow the rest of
    // the text. Masked with spaces of the same length, so every offset still points into `text`.
    const masked = text.replace(FENCE_LINE, (m) => ' '.repeat(m.length));
    const sf = ts.createSourceFile('contract.ts', masked, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const counts = new Map<string, number>();
    for (const st of sf.statements) for (const n of declaredNames(st)) counts.set(n, (counts.get(n) ?? 0) + 1);
    const edits: Edit[] = [];
    const converted: string[] = [];
    for (const st of sf.statements) {
      if (!ts.isEnumDeclaration(st)) continue;
      const name = st.name.text;
      if (counts.get(name) !== 1) continue; // merged / clashing declarations: a const cannot merge
      const members = asConstMembers(st, sf, text);
      if (!members) continue;
      const exported = (st.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ? 'export ' : '';
      // Whatever sat between the last member and `}` — a trailing comma, a newline, a comment.
      const tail = text.slice(st.members[st.members.length - 1].end, st.end - 1);
      edits.push({
        start: st.getStart(sf),
        end: st.end,
        text: `${exported}const ${name} = {${members.join(',')}${tail}} as const;\n`
          + `${exported}type ${name} = (typeof ${name})[keyof typeof ${name}];`,
      });
      converted.push(name);
    }
    if (converted.length === 0) return unchanged;
    const names = new Set(converted);
    // `ActionType.Add` used as a TYPE inside the contract — valid for an enum, TS2702 for the object.
    const visit = (node: ts.Node): void => {
      if (ts.isTypeReferenceNode(node) && !node.typeArguments && ts.isQualifiedName(node.typeName)
        && ts.isIdentifier(node.typeName.left) && names.has(node.typeName.left.text)) {
        const at = node.getStart(sf);
        edits.push({ start: at, end: at, text: 'typeof ' });
        return;
      }
      if (ts.isEnumDeclaration(node) && names.has(node.name.text)) return; // being replaced whole
      ts.forEachChild(node, visit);
    };
    visit(sf);
    let out = text;
    for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
    return { contract: out, converted };
  } catch {
    return unchanged;
  }
}
