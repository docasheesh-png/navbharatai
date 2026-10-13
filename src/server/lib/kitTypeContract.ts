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
  const src = String(source ?? '');
  if (!src || !name) return null;

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
    if (end > 0) return tidy(src.slice(alias.index, end + 1));
  }
  return null;
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
  // What `setup(ctx)` and `update(ctx, dt)` are handed. The reported build guessed three members of it.
  { file: 'src/game/Game.ts', names: ['GameContext', 'GameOptions'] },
  // What `touchControls: { buttons: [...] }` takes. The reported build passed strings.
  { file: 'src/game/ui/touchControls.ts', names: ['TouchButton', 'TouchLayout', 'TouchControlsOptions'] },
];

/** Every name the contract covers, for the census that keeps this honest. */
export const KIT_CONTRACT_NAMES: readonly string[] = CONTRACT.flatMap((e) => e.names);

/** The heading, exported so the test pins the exact words the builder reads. */
export const KIT_CONTRACT_HEADING =
  "THE KIT'S TYPES — these are read from the files on disk, so do NOT guess a member and do NOT re-read "
  + 'these files to find one. If a name is not here, the kit does not have it:';

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
export function kitTypeContract(files: Readonly<Record<string, string>> | null | undefined): string {
  const map = files ?? {};
  const sections: string[] = [];
  for (const entry of CONTRACT) {
    const source = map[entry.file];
    if (typeof source !== 'string' || !source) continue;
    const decls = entry.names
      .map((n) => extractExportedDeclaration(source, n))
      .filter((d): d is string => !!d);
    if (decls.length === 0) continue;
    const body = `// ${entry.file}\n${decls.join('\n\n')}`;
    sections.push(body.split('\n').map((l) => (l ? INDENT + l : l)).join('\n'));
  }
  if (sections.length === 0) return '';
  return `${KIT_CONTRACT_HEADING}\n${sections.join('\n\n')}`;
}
