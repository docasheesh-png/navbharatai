import { describe, it, expect } from 'vitest';
import {
  extractExportedDeclaration, kitTypeContract, KIT_CONTRACT_NAMES, KIT_CONTRACT_HEADING,
} from '../src/server/lib/kitTypeContract';
import { generateGameShell } from '../src/server/lib/GameShellGenerator';
import { compactRecipeResult, HANDOFF_RECIPE_CHARS } from '../src/server/AgentV3/gameKitSeed';

/**
 * 🧬 THE KIT'S OWN TYPES ARE HANDED OVER, NOT GUESSED — Q-909, autopsy `50378049` (BlockWorld, a voxel
 * game, 2026-10-12).
 *
 * NavBharatAI seeded its game kit before the builder's first call, and the handoff told it exactly which
 * functions to call — `<GameCanvas>`, `ctx.follow(vehicle)`, `driveVehicle(…)` — with a compiling
 * example. What it never said was **what `ctx` IS**. The example touches three of `GameContext`'s nine
 * members, so for the rest the model guessed, and guessed our PRIVATE fields:
 *
 * | it reached for | what that actually is |
 * |---|---|
 * | `ctx.canvas` | `private readonly canvas` on `Game` — never on the context |
 * | `ctx.followTarget` | `private followTarget` — the state behind `ctx.follow()` |
 * | `ctx.crosshairTarget` | nothing at all |
 * | `TouchButton` as a string | `{ action: string; label: string }` |
 *
 * Cost in that one build: **four `read_file` slices of `Game.ts` and two of `touchControls.ts`** — the
 * model reverse-engineering a file WE wrote — plus the repeated-step nudges that followed (Q-912).
 *
 * 🔑 The fix is the one this repo already uses for the same problem: Project Mode freezes a per-module
 * CONTRACT so a later turn imports *"against these EXACT names"*. A seeded kit is the same situation and
 * had no contract.
 *
 * 🔒 **The contract is EXTRACTED from the emitted source, never hand-written** — a hand-kept copy of a
 * type is the drift this repo has paid for repeatedly. The census below is what keeps that promise: it
 * fails when the emitted `GameContext` gains a member the handed-over text does not carry.
 */

const shell = () => generateGameShell();
const files = () => shell().files;

describe('the kit\'s types are handed over, not guessed (Q-909, autopsy 50378049)', () => {
  describe('extractExportedDeclaration — read from the real file, or say nothing', () => {
    it('🔴 pulls GameContext out of the Game.ts the recipe actually writes', () => {
      const decl = extractExportedDeclaration(files()['src/game/Game.ts'], 'GameContext');
      expect(decl).toBeTruthy();
      expect(decl!.startsWith('export interface GameContext {')).toBe(true);
      expect(decl!.trimEnd().endsWith('}')).toBe(true);
    });

    it('strips the comments but keeps every member', () => {
      const decl = extractExportedDeclaration(files()['src/game/Game.ts'], 'GameContext')!;
      expect(decl).not.toContain('CameraRig.follow()'); // a doc comment in the source
      expect(decl).toContain('follow: (object: THREE.Object3D | null) => void;');
      expect(decl).toContain('scene: THREE.Scene;');
    });

    it('reads an interface to its BALANCED brace, so a nested object type cannot truncate it', () => {
      const src = 'export interface A {\n  nested: { x: number };\n  after: string;\n}\nexport const z = 1;';
      const decl = extractExportedDeclaration(src, 'A')!;
      expect(decl).toContain('after: string;');
      expect(decl).not.toContain('export const z');
    });

    it('handles a type alias, and refuses an unbalanced or absent one', () => {
      expect(extractExportedDeclaration("export type L = 'a' | 'b';", 'L')).toBe("export type L = 'a' | 'b';");
      expect(extractExportedDeclaration('export interface A { x: number', 'A')).toBeNull();
      expect(extractExportedDeclaration('interface A { x: number }', 'A')).toBeNull(); // not exported
      expect(extractExportedDeclaration('export interface AB { x: number }', 'A')).toBeNull(); // not a prefix match
      expect(extractExportedDeclaration(null, 'A')).toBeNull();
      expect(extractExportedDeclaration('', '')).toBeNull();
    });
  });

  describe('🔒 THE CENSUS — the contract cannot silently fall behind the type', () => {
    /** Every member name declared on the emitted `GameContext`. */
    const contextMembers = (): string[] => {
      const decl = extractExportedDeclaration(files()['src/game/Game.ts'], 'GameContext')!;
      return [...decl.matchAll(/^\s{2}(\w+)\s*[?:]/gm)].map((m) => m[1]);
    };

    it('🔴 EVERY member of the emitted GameContext is in the block the builder reads', () => {
      const block = kitTypeContract(files());
      const members = contextMembers();
      // The reported build needed more than the example's three; this is why the whole type goes over.
      expect(members.length).toBeGreaterThanOrEqual(9);
      for (const m of members) expect(block).toContain(m);
    });

    it('…and the names the reported build guessed are NOT members, so the contract says so', () => {
      const members = contextMembers();
      for (const guessed of ['canvas', 'followTarget', 'crosshairTarget']) {
        expect(members).not.toContain(guessed);
      }
      // The heading is what turns that absence into an answer instead of a silence.
      expect(kitTypeContract(files())).toContain('If a name is not here, the kit does not have it');
    });

    it('every name the contract claims to cover is really declared where it says', () => {
      const f = files();
      const block = kitTypeContract(f);
      const present = KIT_CONTRACT_NAMES.filter((n) =>
        Object.values(f).some((src) => extractExportedDeclaration(src, n)));
      expect(present.length).toBeGreaterThan(0);
      for (const n of present) expect(block).toContain(n);
    });
  });

  describe('TouchButton — the one the build passed as a string', () => {
    it('🔴 goes over as a TYPE, with both of its fields', () => {
      const f = files();
      const decl = extractExportedDeclaration(f['src/game/ui/touchControls.ts'], 'TouchButton');
      expect(decl).toBeTruthy();
      expect(decl).toContain('action: string;');
      expect(decl).toContain('label: string;');
      expect(kitTypeContract(f)).toContain('TouchButton');
    });
  });

  describe('it reaches the builder — placement, not just presence', () => {
    it('🔴 the contract survives the handoff clip, because it is at the TOP', () => {
      // `gameKitSeed.compactRecipeResult` cuts a recipe's instructions at HANDOFF_RECIPE_CHARS. A
      // contract at the bottom is a contract the builder may never see.
      const compacted = compactRecipeResult(shell().instructions);
      expect(compacted).toContain(KIT_CONTRACT_HEADING);
      expect(compacted.indexOf(KIT_CONTRACT_HEADING)).toBeLessThan(HANDOFF_RECIPE_CHARS);
      expect(compacted).toContain('export interface GameContext {');
    });

    it('it sits BEFORE the usage example, which is the half that was already there', () => {
      const text = shell().instructions;
      const at = text.indexOf(KIT_CONTRACT_HEADING);
      const example = text.indexOf('import { GameCanvas }');
      // ⚠️ BOTH ANCHORS ARE ASSERTED FIRST. A reversion probe that deleted the contract made this case
      // PASS on `-1 < 2000` — the exact "-1 < -1 arithmetic" trap `importPreviewOrdering` warns about,
      // found by probing this very file. An ordering assertion is only as good as its anchors.
      expect(at).toBeGreaterThan(0);
      expect(example).toBeGreaterThan(0);
      expect(at).toBeLessThan(example);
    });

    it('a partial kit emits no empty promise', () => {
      // An `include` set without Game.ts or touchControls.ts must produce no heading at all, rather
      // than a heading with nothing under it.
      expect(kitTypeContract({})).toBe('');
      expect(kitTypeContract({ 'src/game/other.ts': 'export const x = 1;' })).toBe('');
      expect(kitTypeContract(null)).toBe('');
    });

    it('the shell still says everything it said before', () => {
      const text = shell().instructions;
      expect(text).toContain('WHAT THE SHELL ALREADY GUARANTEES');
      expect(text).toContain('ctx.follow(car)');
      expect(text).toContain("touchControls: { buttons: [{ action: 'attack', label: 'Punch' }, …] }");
    });
  });
});
