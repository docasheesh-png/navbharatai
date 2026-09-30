/**
 * THE REAL MEMBERS OF THE TYPE THE CODE GUESSED AT (autopsy 0bb437b4, 2026-09-30).
 *
 * "Make a racing game". The architect wired the platform's game runtime and melody recipes; the
 * sub-agent that wrote the race screen then called `input.attach()`, `melody.playCue()`,
 * `melody.pause()` and passed `{ volume }` to `play()` — none of which exist. The write-time typecheck
 * quoted the errors back, and the compiler's message ("Property 'playCue' does not exist on type
 * 'MelodyPlayer'") says what is wrong but not what is RIGHT, so the sub-agent spent five minutes and
 * six rounds on it — and edited the platform's own `src/audio/melody.ts` four times to add the methods
 * it had invented, instead of calling the ones that were there.
 *
 * The missing half is one fact the compiler already has and does not print: the members the type
 * really has. This module reads them out of the declaring file, so the note after the write can say
 * "MelodyPlayer has: play(tune, options?), stop(), …". Deterministic, no model call.
 *
 * PURE — the caller supplies file text; this never reads a file and never throws.
 */
import * as ts from 'typescript';
import type { TscError } from './EndgameRepair';

/** A member the code asked for that its type does not have. */
export interface MissingMember {
  file: string;
  member: string;
  type: string;
}

// TS2339 / TS2551: `Property 'x' does not exist on type 'T'` (2551 adds "Did you mean…").
const ON_TYPE_RE = /Property '([^']+)' does not exist on type '([A-Za-z_$][\w$]*)'/;
// TS2353: `Object literal may only specify known properties, and 'x' does not exist in type 'T'`.
const IN_TYPE_RE = /'([^']+)' does not exist in type '([A-Za-z_$][\w$]*)'/;

export function missingMembers(errors: readonly TscError[] | null | undefined): MissingMember[] {
  const out: MissingMember[] = [];
  const seen = new Set<string>();
  for (const e of errors || []) {
    if (!e || !['TS2339', 'TS2551', 'TS2353'].includes(e.code)) continue;
    const m = ON_TYPE_RE.exec(e.message) ?? IN_TYPE_RE.exec(e.message);
    if (!m) continue;
    const key = `${e.file}\u0000${m[1]}\u0000${m[2]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ file: e.file, member: m[1], type: m[2] });
  }
  return out;
}

function paramList(params: ts.NodeArray<ts.ParameterDeclaration>, sf: ts.SourceFile): string {
  return params.map((p) => `${p.name.getText(sf)}${p.questionToken || p.initializer ? '?' : ''}`).join(', ');
}

/**
 * The members `typeName` declares in `source` (a class, an interface or an object type alias), as the
 * code would call them: `play(tune, options?)`, `volume`. Private and `#` members are left out — the
 * caller cannot use them either. `null` when the file does not declare that type.
 */
export function declaredMembers(source: string, typeName: string): string[] | null {
  let sf: ts.SourceFile;
  try {
    sf = ts.createSourceFile('t.tsx', String(source ?? ''), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  } catch { return null; }
  const members: string[] = [];
  const push = (m: ts.Node) => {
    const mods = ts.canHaveModifiers(m) ? ts.getModifiers(m) ?? [] : [];
    if (mods.some((x) => x.kind === ts.SyntaxKind.PrivateKeyword || x.kind === ts.SyntaxKind.ProtectedKeyword)) return;
    const named = m as ts.Node & { name?: ts.PropertyName };
    if (!named.name || ts.isPrivateIdentifier(named.name)) return;
    const name = named.name.getText(sf);
    if (ts.isMethodDeclaration(m) || ts.isMethodSignature(m)) members.push(`${name}(${paramList(m.parameters, sf)})`);
    else if (ts.isPropertyDeclaration(m) || ts.isPropertySignature(m) || ts.isGetAccessorDeclaration(m)) members.push(name);
  };
  for (const stmt of sf.statements) {
    if ((ts.isClassDeclaration(stmt) || ts.isInterfaceDeclaration(stmt)) && stmt.name?.text === typeName) {
      for (const m of stmt.members) {
        if (ts.isConstructorDeclaration(m)) continue;
        push(m);
      }
      return [...new Set(members)];
    }
    if (ts.isTypeAliasDeclaration(stmt) && stmt.name.text === typeName && ts.isTypeLiteralNode(stmt.type)) {
      for (const m of stmt.type.members) push(m);
      return [...new Set(members)];
    }
  }
  return null;
}

/** Where the game and melody recipes write their libraries (GameRuntimeGenerator, MelodyGenerator, …). */
export const RECIPE_LIBRARY_PATH = /^src\/(?:game\/(?:core|three|fx|play|systems)|audio)\//;

/** Relative module specifiers a file imports from — where its types are declared. */
export function relativeImports(source: string): string[] {
  const out: string[] = [];
  const re = /\bfrom\s+['"](\.{1,2}\/[^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(source ?? '')))) out.push(m[1]);
  return [...new Set(out)];
}

/** Candidate on-disk paths for a relative specifier, resolved against the importing file. */
export function resolveCandidates(fromFile: string, spec: string): string[] {
  const dir = String(fromFile).replace(/\\/g, '/').split('/').slice(0, -1);
  const parts = [...dir];
  for (const seg of spec.split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  const base = parts.join('/');
  if (/\.(?:tsx?|jsx?)$/.test(base)) return [base];
  return ['.ts', '.tsx', '/index.ts', '/index.tsx'].map((x) => `${base}${x}`);
}

/**
 * One note per missing member whose type was found: what the type really has. A type found in a file
 * the build did not write (a platform library) also says not to change that file to fit.
 */
export function memberListNote(
  found: ReadonlyArray<MissingMember & { declaredIn: string; members: string[]; library: boolean }>,
): string {
  if (found.length === 0) return '';
  const byType = new Map<string, { declaredIn: string; members: string[]; library: boolean; asked: Set<string> }>();
  for (const f of found) {
    const cur = byType.get(f.type) ?? { declaredIn: f.declaredIn, members: f.members, library: f.library, asked: new Set<string>() };
    cur.asked.add(f.member);
    byType.set(f.type, cur);
  }
  const lines: string[] = [];
  for (const [type, t] of byType) {
    const shown = t.members.slice(0, 20).join(', ');
    lines.push(`📚 \`${type}\` (${t.declaredIn}) has: ${shown || 'no public members'}. `
      + `${[...t.asked].map((a) => `\`${a}\``).join(', ')} ${t.asked.size === 1 ? 'is' : 'are'} not among them — call what is there`
      + (t.library ? `, and do not edit ${t.declaredIn} to add them: it is a NavBharatAI library other code relies on.` : '.'));
  }
  return `\n${lines.join('\n')}`;
}
