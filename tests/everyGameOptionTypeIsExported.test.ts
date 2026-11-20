// failedbr #1334 (2026-11-20): the app typed its options from './game/Game' and tsc said "Module './game/Game' declares
// 'LightingPresetName' locally, but it is not exported" — the same for CameraKind and TouchControlsOptions — 4 errors that
// recurred across 4 builds. Every type GameOptions names must be importable from Game.ts. A census, so a NEW option type
// that is imported but not re-exported fails here.
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';

const GAME = Object.entries(generateGameShell().files).find(([p]) => /(^|\/)game\/Game\.ts$/.test(p))![1];
const sf = ts.createSourceFile('Game.ts', GAME, ts.ScriptTarget.Latest, true);

function exportedNames(): Set<string> {
  const out = new Set<string>();
  for (const st of sf.statements) {
    const mods = ts.canHaveModifiers(st) ? ts.getModifiers(st) ?? [] : [];
    const exported = mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (exported && (ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st) || ts.isClassDeclaration(st) || ts.isEnumDeclaration(st)) && st.name) out.add(st.name.text);
    if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) for (const e of st.exportClause.elements) out.add(e.name.text);
  }
  return out;
}

function importedTypeNames(): Set<string> {
  const out = new Set<string>();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause?.namedBindings || !ts.isNamedImports(st.importClause.namedBindings)) continue;
    for (const e of st.importClause.namedBindings.elements) out.add(e.name.text);
  }
  return out;
}

describe('every type GameOptions names is exported from Game.ts (failedbr #1334)', () => {
  it('no imported type in GameOptions is left unexported', () => {
    const options = sf.statements.find((s): s is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(s) && s.name.text === 'GameOptions');
    expect(options).toBeTruthy();
    const used = new Set<string>();
    const visit = (n: ts.Node): void => { if (ts.isTypeReferenceNode(n) && ts.isIdentifier(n.typeName)) used.add(n.typeName.text); ts.forEachChild(n, visit); };
    visit(options!);
    const imported = importedTypeNames();
    const exported = exportedNames();
    const missing = [...used].filter((t) => imported.has(t) && !exported.has(t));
    expect(missing).toEqual([]);
    for (const t of ['LightingPresetName', 'CameraKind', 'TouchControlsOptions']) expect(exported.has(t), t).toBe(true);
  });
  it('playerBody accepts true (the default body) as well as an Object3D or false', () => {
    expect(GAME).toMatch(/playerBody\?: THREE\.Object3D \| boolean;/);
    expect(GAME).toMatch(/if \(options\.playerBody && typeof options\.playerBody === 'object'\)/);
  });
});
