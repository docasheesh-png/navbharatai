// BR1963 (report 3591cb97…, 2026-11-08) — "Build a game with indian map" succeeded after
// SANDBOX_UNAVAILABLE (E2B cap of 20) recovered into a workspace whose `ls -la` showed only
// `src/` (no package.json / tsconfig.json / index.html). The seeded kit on disk was
// state.ts + meta.ts + audio/melody (7 files) without events.ts. The builder later wrote a
// stub events module, hit TS2322/TS2349 in meta.ts (void vs () => void), and abandoned the
// kit for a standalone React quiz.
//
// Prevention already on main, locked here against THIS prompt:
//   • #4132 (BR1958 F2, merged 2026-11-09 — the day AFTER this build) refuses to run game
//     recipes without a readable React package.json (prepareGameSeedWorkspace).
//   • #4146 (BR1961 F2) no longer invites the user to "try building again" during recovery.
//   • generateGameRuntime() writes every advertised module; asking only for `meta` still
//     pulls state.ts and events.ts (the historical missing file).
// No production heuristic is changed here (t311u: neighbour lock only).

import { describe, it, expect, vi } from 'vitest';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';
import { gameKitPlan, gameKitWants3D } from '../src/server/AgentV3/gameKitSeed';
import { generateGameRuntime, GAME_RUNTIME_MODULES } from '../src/server/lib/GameRuntimeGenerator';
import { analyzeAppScope } from '../src/server/lib/appScopeAnalyzer';
import { prepareGameSeedWorkspace } from '../src/server/AgentV3/gameSeedWorkspace';
import { sandboxUnavailableNotice } from '../src/server/routes/agentv3';

const PROMPT = 'Build a game with indian map';

describe('BR1963: an India-map game still gets its kit', () => {
  it('is a game, not a 3D scene, and plans the 2D kit', () => {
    expect(analyzeRequirementGaps(PROMPT).domain).toBe('game');
    expect(gameKitWants3D(PROMPT)).toBe(false);
    expect(gameKitPlan(PROMPT)).toEqual([
      'generate_game_runtime',
      'generate_game_vfx',
      'generate_melody',
    ]);
  });

  it('the default runtime includes every advertised module, including events.ts', () => {
    const files = Object.keys(generateGameRuntime().files);
    for (const m of GAME_RUNTIME_MODULES) {
      expect(files).toContain(`src/game/core/${m}.ts`);
    }
  });

  it('asking only for meta still pulls state and events (the historical missing file)', () => {
    const files = Object.keys(generateGameRuntime(['meta']).files);
    expect(files).toContain('src/game/core/meta.ts');
    expect(files).toContain('src/game/core/state.ts');
    expect(files).toContain('src/game/core/events.ts');
  });

  it('scope stays ordinary/direct — a short map-game ask is not LARGE', () => {
    const s = analyzeAppScope(PROMPT);
    expect(s.decision).toBe('direct');
    expect(s.size).toBe('small');
    expect(s.signals.some((x) => /no mega-signal — treated as an ordinary one-shot app/i.test(x))).toBe(true);
  });

  it('a recovered workspace without package.json must recover the starter before any recipe (BR1958 F2 sibling)', async () => {
    const recoverStarter = vi.fn(async () => { /* recovery failed to materialise a manifest */ });
    const readManifest = vi.fn(async () => { throw new Error('ENOENT: package.json'); });
    const r = await prepareGameSeedWorkspace({
      stopped: () => false,
      readManifest,
      recoverStarter,
      takeScaffold: () => ({}),
    });
    expect(recoverStarter).toHaveBeenCalledTimes(1);
    expect(r.ready).toBe(false);
    expect(r.reason).toMatch(/no readable React package manifest/i);
  });

  it('the unavailable notice no longer uses this report\'s goodbye text', () => {
    const n = sandboxUnavailableNotice();
    expect(n).not.toMatch(/please try building again in a little while/i);
    expect(n).not.toMatch(/try building again|try again later|please retry/i);
    expect(n).toMatch(/still trying|as soon as I can/i);
    expect(n).toMatch(/don't need to start the build again|do not need to start the build again/i);
  });
});
