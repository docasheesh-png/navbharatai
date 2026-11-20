// 🔴 THE KIT'S OWN TYPES, HANDED OVER INSTEAD OF GUESSED — Q-909, autopsy `50378049` (2026-10-12).
//
// BlockWorld, a voxel game. NavBharatAI seeded its game kit, and the handoff told the builder exactly
// which functions to call — `<GameCanvas>`, `ctx.follow(vehicle)`, `driveVehicle(…)` — and showed a
// compiling example. What it never said was **what `ctx` IS**. The example touches three of
// `GameContext`'s nine members, so for the rest the model guessed, and guessed our private fields:
//
//   | it reached for | what that actually is |
//   |---|---|
//   | `ctx.canvas` | `private readonly canvas` on `Game` — never on the context |
//   | `ctx.followTarget` | `private followTarget` — the state behind `ctx.follow()` |
//   | `ctx.crosshairTarget` | nothing at all |
//   | `TouchButton` as a string | `{ action: string; label: string }` |
//
// The cost in that one build: **four `read_file` slices of `Game.ts` and two of `touchControls.ts`** —
// the model reverse-engineering a file WE wrote — and the repeated-step nudges that followed.
//
// 🔑 THE FIX IS THE ONE THIS REPO ALREADY USES FOR THE SAME PROBLEM. Project Mode freezes a per-module
// CONTRACT precisely so a later turn imports *"against these EXACT names"* instead of guessing. A
// seeded kit is the same situation — code the builder must use and did not write — and it had no
// contract. This builds one.
//
// 🔒 EXTRACTED FROM THE EMITTED SOURCE, NEVER HAND-WRITTEN. A hand-kept copy of a type is the drift
// this repo has paid for repeatedly (four `safeRelPath`s, two complex-app detectors, five hardcoded
// model ids). The declaration is read out of the very file the recipe writes, so renaming a member
// updates the contract in the same commit, by construction. `tests/aKitTypeIsNotGuessed.test.ts` holds
// a census that fails when the emitted type gains a member the contract does not carry.
//
// PURE. No I/O, no clock, never throws.

import * as ts from 'typescript';

/** Comments only — never code. Block comments first, then whole-line `//` comments. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*\/\//.test(l))
    .join('\n');
}

/**
 * Pull one `export interface X { … }` or `export type X = …;` out of a source file, verbatim minus its
 * comments. Returns null when the name is not declared there — never a guess, and never a partial
 * body: an interface is read to its BALANCED closing brace, so a nested object type cannot truncate it.
 */
export function extractExportedDeclaration(source: string | null | undefined, name: string): string | null {
  return extractDeclaration(source, name);
}

function extractDeclaration(source: string | null | undefined, name: string, parsedSources?: Map<string, ts.SourceFile>): string | null {
  const src = String(source ?? '');
  if (!src || src.length > 1_000_000 || !/^[A-Za-z_$][\w$]*$/.test(name)) return null;

  const iface = new RegExp(`export\\s+interface\\s+${name}\\s*(?:extends\\s+[^{]+)?\\{`).exec(src);
  if (iface) {
    const open = src.indexOf('{', iface.index);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') {
        depth--;
        if (depth === 0) return tidy(src.slice(iface.index, i + 1));
      }
    }
    return null; // unbalanced — say nothing rather than hand over half a type
  }

  const alias = new RegExp(`export\\s+type\\s+${name}\\s*=`).exec(src);
  if (alias) {
    const end = src.indexOf(';', alias.index);
    if (end > 0) {
      const decl = tidy(src.slice(alias.index, end + 1));
      // `keyof typeof PALETTES` names no value a builder can read, so it is spelled out from the very
      // object it is keyed on (autopsy cf1706d2: paletteColor('steel', …), paletteColor('coal', …)).
      const keyed = /=\s*keyof\s+typeof\s+(\w+)\s*;$/.exec(decl);
      const keys = keyed ? objectKeys(src, keyed[1]) : null;
      return keys && keys.length ? `export type ${name} = ${keys.map((k) => `'${k}'`).join(' | ')};` : decl;
    }
  }
  return exportedCallableOrClass(src, name, parsedSources);
}

/** Public callable declarations, from the same source as the types — never guessed aliases.
 * Explicit return types let us omit implementations; inferred members retain labelled actual source.
 * This quotes a declared surface, not an inferred or inherited complete structural type.
 */
function exportedCallableOrClass(source: string, name: string, parsedSources?: Map<string, ts.SourceFile>): string | null {
  try {
    const sf = parsedSources?.get(source) ?? ts.createSourceFile('kit.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    parsedSources?.set(source, sf);
    if ((sf as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length) return null;
    const exported = (node: ts.Node) => ts.canHaveModifiers(node)
      && !!ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    const publicMember = (node: ts.Node) => !(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(
      (m) => m.kind === ts.SyntaxKind.PrivateKeyword || m.kind === ts.SyntaxKind.ProtectedKeyword))
      && !('name' in node && node.name && ts.isPrivateIdentifier(node.name as ts.Node));
    const quote = (node: ts.Node & { body?: ts.ConciseBody; type?: ts.TypeNode }) => {
      if (node.body && (ts.isConstructorDeclaration(node) || node.type)) {
        return tidy(source.slice(node.getStart(sf), node.body.getStart(sf)).trimEnd() + ';');
      }
      // An unannotated return/field is not an inferred type contract. Keep its actual source.
      return (node.body || (ts.isPropertyDeclaration(node) && !node.type) ? '// Actual source; inferred shape not established.\n' : '')
        + tidy(node.getText(sf));
    };
    const functions = sf.statements.filter((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n)
      && n.name?.text === name && exported(n));
    if (functions.length) {
      const signatures = functions.some((n) => !n.body) ? functions.filter((n) => !n.body) : functions;
      return signatures.map(quote).join('\n');
    }
    // BR1955: a string-typed action parameter is unusable without its actual default vocabulary.
    // Quote only the selected exported const, with a literal initializer; never evaluate source.
    for (const statement of sf.statements) {
      if (!ts.isVariableStatement(statement) || !exported(statement)
        || !(statement.declarationList.flags & ts.NodeFlags.Const)) continue;
      const declaration = statement.declarationList.declarations.find((d) => ts.isIdentifier(d.name) && d.name.text === name);
      const literal = (node: ts.Expression): boolean => ts.isStringLiteral(node) || ts.isNumericLiteral(node)
        || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword
        || node.kind === ts.SyntaxKind.NullKeyword
        || (ts.isArrayLiteralExpression(node) && node.elements.every((e) => ts.isExpression(e) && literal(e)))
        || (ts.isObjectLiteralExpression(node) && node.properties.every((e) => ts.isPropertyAssignment(e)
          && !ts.isComputedPropertyName(e.name) && literal(e.initializer)));
      if (declaration?.initializer && literal(declaration.initializer)) return 'export const ' + ts.createPrinter({ removeComments: true }).printNode(ts.EmitHint.Unspecified, declaration, sf) + ';';
    }
    const cls = sf.statements.find((n): n is ts.ClassDeclaration => ts.isClassDeclaration(n)
      && n.name?.text === name && exported(n));
    if (!cls) return null;
    const head = source.slice(cls.getStart(sf), cls.members.pos).replace(/\{\s*$/, '').trimEnd();
    const members = cls.members.filter(publicMember).filter((member) => {
      // An overload implementation is not callable by its union signature. As with functions,
      // quote only declared overloads, and keep constructor/static/instance ownership distinct.
      if (!(ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member)) || !member.body) return true;
      const key = ts.isConstructorDeclaration(member) ? 'constructor' : member.name.getText(sf);
      const isStatic = (node: ts.Node) => ts.canHaveModifiers(node)
        && !!ts.getModifiers(node)?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword);
      return !cls.members.some((other) => other !== member &&
        (ts.isMethodDeclaration(other) || ts.isConstructorDeclaration(other)) && !other.body &&
        (ts.isConstructorDeclaration(other) ? 'constructor' : other.name.getText(sf)) === key &&
        isStatic(other) === isStatic(member));
    }).map((m) => {
      // Initializers of explicitly typed fields add no public contract (and may be enormous).
      if (ts.isPropertyDeclaration(m) && m.type && m.initializer) {
        return tidy(source.slice(m.getStart(sf), m.type.end) + ';');
      }
      return quote(m as ts.ClassElement & { body?: ts.ConciseBody; type?: ts.TypeNode });
    });
    return `${head} {\n${members.map((m) => m.split('\n').map((l) => '  ' + l).join('\n')).join('\n')}\n}`;
  } catch { return null; }
}

/** The top-level keys of `const NAME = { … }` in the source, in order — or null when it cannot be read with certainty. */
function objectKeys(src: string, name: string): string[] | null {
  const m = new RegExp(`const\\s+${name}\\b[^=]*=\\s*\\{`).exec(src);
  if (!m) return null;
  let depth = 1; let i = m.index + m[0].length; const start = i;
  for (; i < src.length && depth > 0; i++) { if (src[i] === '{' || src[i] === '[' || src[i] === '(') depth++; else if (src[i] === '}' || src[i] === ']' || src[i] === ')') depth--; }
  if (depth !== 0) return null;
  const body = src.slice(start, i - 1);
  const keys: string[] = [];
  let d = 0;
  for (const line of body.split('\n')) {
    if (d === 0) { const k = /^\s*['"]?([A-Za-z_$][\w$]*)['"]?\s*:/.exec(line); if (k) keys.push(k[1]); }
    for (const c of line) { if ('{[('.includes(c)) d++; else if ('}])'.includes(c)) d--; }
  }
  return keys;
}

/** Comments out, blank lines collapsed — the shape, with nothing to re-read. */
function tidy(decl: string): string {
  return stripComments(decl)
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l, i, all) => l.trim() !== '' || (i > 0 && i < all.length - 1 && all[i - 1].trim() !== ''))
    .join('\n')
    .replace(/\n{2,}/g, '\n');
}

/** One type the builder must not guess at: where it lives, and why it is in the contract. */
interface ContractEntry {
  /** The emitted file that declares it. */
  file: string;
  /** The exported names to hand over, in the order the builder meets them. */
  names: readonly string[];
}

/**
 * 🔒 THE LIST IS THE POLICY: a type the builder RECEIVES from the kit, or must CONSTRUCT to pass back
 * into it. Each one is a name the reported build guessed wrong. A type the builder only ever gets back
 * from a kit function (a mesh, a vehicle state) is deliberately out — it does not have to spell those.
 */
const CONTRACT: readonly ContractEntry[] = [
  { file: 'src/game/three/buildings.ts', names: ['DoorOccupant', 'HouseDoor', 'EnterableHouseOptions', 'createEnterableHouse', 'houseDoor', 'interactHouseDoor', 'updateHouseDoors'] },
  // What `setup(ctx)` and `update(ctx, dt)` are handed. The reported build guessed three members of it.
  { file: 'src/game/Game.ts', names: ['GameContext', 'GameOptions'] },
  // What `touchControls: { buttons: [...] }` takes. The reported build passed strings.
  { file: 'src/game/ui/touchControls.ts', names: ['TouchButton', 'TouchLayout', 'TouchControlsOptions'] },
  // 1b38d662: livery/color were guessed and Motorcycle was passed as an Object3D instead of .root.
  // failedbr #1298 (2026-11-20): `createCar(...).root` (it returns the Group itself), createVehicleState(vehicle, tuning) and
  // driveVehicle's fifth parameter were guessed — 41 type errors and 2.5 minutes of fixes.
  { file: 'src/game/three/objects.ts', names: ['RoadOptions', 'RailTrackOptions', 'HouseOptions', 'TreeOptions', 'MountainOptions', 'MotorcycleOptions', 'Motorcycle', 'VehicleTuning', 'VehicleState', 'createRoad', 'createHouse', 'createTree', 'createMountain', 'CarOptions', 'createCar', 'createVehicleState', 'driveVehicle'] },
  // failedbr #1298: 'concrete' was passed as a SurfaceKind — a closed list the builder never saw.
  { file: 'src/game/three/surfaces.ts', names: ['SurfaceKind'] },
  // failedbr #1277: `saveState` / `loadState` (the kit's are `save` / `load`) and a `BLOCKFALL_BG` tune were guessed —
  // 14 type errors, and a batch repair that raised them to 18.
  { file: 'src/game/core/state.ts', names: ['GameState', 'state', 'save', 'load', 'hasSave', 'clearSave', 'resetRun'] },
  { file: 'src/audio/tunes.ts', names: ['TUNES', 'CUES'] },
  // cf1706d2 (2026-11-02): sharedMaterial('plastic' | 'rubber', …) and paletteColor('steel' | 'coal', …) —
  // six type errors and five fix-up rounds, because the two closed name lists were never handed over.
  // (RailTrackOptions above: the same build passed { path } to createRailTrack.)
  { file: 'src/game/three/materials.ts', names: ['MaterialKind', 'PaletteName', 'sharedMaterial', 'paletteColor'] },
  // BR1954: Input.bind, EventBus.off, CameraRig.object and wrong factories/signatures were guessed.
  { file: 'src/game/core/input.ts', names: ['ActionMap', 'DEFAULT_ACTIONS', 'Input'] },
  { file: 'src/game/core/events.ts', names: ['EventBus'] },
  { file: 'src/game/three/camera.ts', names: ['CameraRigOptions', 'CameraRig'] },
  { file: 'src/game/three/humanoid.ts', names: ['HumanoidOptions', 'Humanoid', 'createHumanoid'] },
  { file: 'src/game/three/world.ts', names: ['ScatterOptions', 'scatterInstances'] },
];

/** Every name the contract covers, for the census that keeps this honest. */
export const KIT_CONTRACT_NAMES: readonly string[] = CONTRACT.flatMap((e) => e.names);
export const KIT_CONTRACT_FILES: readonly string[] = CONTRACT.map((e) => e.file);

/** The heading, exported so the test pins the exact words the builder reads. */
export const KIT_CONTRACT_HEADING =
  "THE KIT'S TYPES AND PUBLIC APIs — quoted from the supplied source snapshot, not inferred. "
  + 'Do NOT guess a member. This is a selected contract, not an exhaustive export inventory: '
  + 'an unlisted name is not proof of absence. Read the producer for omitted or inferred details:';

/**
 * ⚠️ DELIBERATELY NOT A ```-FENCED BLOCK, and this is load-bearing rather than cosmetic.
 *
 * `tests/aRecipeExampleCompiles.test.ts` compiles EVERY fenced block in a recipe's instructions,
 * standalone, beside the recipe's real output — that is how it caught a `camera: 'thirdPerson'` that
 * did not typecheck. A type contract is not an example: these declarations name `THREE.Scene`,
 * `CharacterController`, `ParticleSystem` and `AppliedLighting` without importing them, because they
 * are being QUOTED from a file that already imports them. Fenced, it failed that test with
 * `TS2503 Cannot find namespace 'THREE'` — correctly, for a block that was never meant to compile
 * alone. So it is indented instead: unambiguous to read, and not mistaken for code to run.
 */
const INDENT = '  ';

/**
 * The contract block for whatever kit files this seed actually wrote. '' when none of them is present
 * (a partial `include` set), because an empty heading would promise a contract and deliver nothing.
 */
export function kitTypeContract(files: Readonly<Record<string, string>> | null | undefined, maxChars = Infinity): string {
  const map = files ?? {};
  const sections: string[] = [];
  // Several selected callables live in one large kit file. Parse that exact immutable source once
  // for this contract only; standalone extraction and later calls retain their original behavior.
  const parsedSources = new Map<string, ts.SourceFile>();
  for (const entry of CONTRACT) {
    const source = map[entry.file];
    if (typeof source !== 'string' || !source) continue;
    const decls = entry.names
      .map((n) => extractDeclaration(source, n, parsedSources))
      .filter((d): d is string => !!d);
    if (decls.length === 0) continue;
    const body = `// ${entry.file}\n${decls.join('\n\n')}`;
    sections.push(body.split('\n').map((l) => (l ? INDENT + l : l)).join('\n'));
  }
  if (sections.length === 0) return '';
  const full = `${KIT_CONTRACT_HEADING}\n${sections.join('\n\n')}`;
  if (full.length <= maxChars) return full;
  const marker = '\nINCOMPLETE API snapshot: declarations omitted by the context budget; read their producer before use.';
  const cap = Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : Infinity;
  let bounded = KIT_CONTRACT_HEADING;
  for (const section of sections) {
    if (bounded.length + section.length + marker.length + 2 <= cap) bounded += '\n\n' + section;
  }
  return (bounded + marker).slice(0, cap);
}
