// A BIG GAME GETS ITS KIT AND ITS BIG MAP, EVEN ON A ROADMAP BUILD (failedbr #2481, 2026-11-21 — admin: "aapne kaha tha, bada
// game banane ko kaha jayega to game engine khud hi library se map utha kar real bade map par game banayega … me to aisa kuch
// nahi hua!!").
//
// 🔑 ROOT CAUSE 1. "ek real gta jaise game banao, bahut bade map par" read LARGE, so the big-app planner wrote step 1: "Create
// a basic Three.js 3D environment … a flat terrain (like a square plane) … a simple player character (can be a cube or
// capsule)". `gameTurnRequest` marked it as a game's milestone, but the kit plan RE-READ the domain from the whole turn and
// the step's words outvoted the game: "real-estate". So: "The game kit was NOT laid down (this request is not a game the kit
// serves)" — no kit, no library map. 🧬 CLASS: a turn's domain decided from the planner's words instead of the user's request.
// Every reader of a turn (kit plan, scene-detail tier, game contract) now asks ONE question, `turnIsGame`.
//
// 🔑 ROOT CAUSE 2. The planner did not know the kit exists. It told the user "large-scale map ke liye dedicated backend
// infrastructure chahiye … browser mein nahi ho sakti" (false) and planned @react-three/fiber + a cube. 🧬 CLASS: the planner
// choosing a world and a stack that contradict what the platform lays down. It is now told the kit (from the same plan the
// seed runs), and a roadmap that brings a second 3D engine to a kit game is refused, like a native stack the user never named.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  gameKitPlan, gameTurnRequest, turnIsGame, wantsSceneDetail, gameTurnHandoff, gamePlannerCapability, gameKitOwnsTheBuild, GAME_MILESTONE_LINE,
} from '../src/server/AgentV3/gameKitSeed';
import { roadmapGuardrail } from '../src/server/lib/megaRoadmap';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
// The REAL request and the REAL step 1 of failedbr #2481, verbatim.
const REQUEST = 'ek real gta jaise game banao, bahut bade map par, user apne charecter ko joystik se control kare';
const STEP1 = 'Create a basic Three.js 3D environment inside the Vite-React app. Add a flat terrain (like a square plane), ambient light, and a simple player character (can be a cube or capsule). Use OrbitControls for camera movement initially. Make sure everything renders properly using React integration with Three.js (use @react-three/fiber and @react-three/drei). No fake visuals – render actual geometry.';

describe('🎮 a game\'s roadmap step is still a game', () => {
  it('the exact #2481 turn: the step\'s own words read as another domain, the turn is still the game', () => {
    const turn = gameTurnRequest(REQUEST, STEP1);
    expect(analyzeRequirementGaps(turn).domain).not.toBe('game');   // the trap the old readers fell into
    expect(turnIsGame(turn)).toBe(true);
  });

  it('so the kit is laid down WITH the big library map', () => {
    const plan = gameKitPlan(gameTurnRequest(REQUEST, STEP1), 'vite-react');
    expect(plan).toEqual(expect.arrayContaining(['generate_game_runtime', 'generate_game_3d', 'generate_athree_map', 'generate_game_shell']));
    expect(gameKitPlan(REQUEST, 'vite-react')).toEqual(plan);   // the step changes nothing about WHICH kit
    expect(gameKitOwnsTheBuild(REQUEST, 'vite-react')).toBe(true);
  });

  it('the scene-detail tier and the game contract read the same answer', () => {
    const turn = gameTurnRequest(REQUEST, STEP1);
    expect(wantsSceneDetail(turn)).toBe(true);
    const handoff = gameTurnHandoff(turn, {}, { writingRun: true, moduleTurn: false, importTurn: false, stopped: false }, {} as NodeJS.ProcessEnv);
    expect(handoff.block).not.toBe('');
  });

  it('an app that is NOT a game never becomes one through its milestone', () => {
    const turn = gameTurnRequest('Build a music streaming app like Spotify', 'A Player screen with a real <audio> element and a playlist');
    expect(turn).not.toContain(GAME_MILESTONE_LINE);
    expect(turnIsGame(turn)).toBe(false);
    expect(gameKitPlan(turn, 'vite-react')).toEqual([]);
  });

  it('🧬 class census: in the kit seed, only the user\'s own request decides the domain', () => {
    const src = read('src/server/AgentV3/gameKitSeed.ts');
    const calls = src.match(/analyzeRequirementGaps\(/g) ?? [];
    expect(calls).toHaveLength(1);   // inside requestIsGame — every turn reader goes through turnIsGame
    expect(src).toMatch(/function requestIsGame[\s\S]{0,200}analyzeRequirementGaps\(/);
  });
});

describe('🗺️ the planner plans ON the kit, never around it', () => {
  it('is told the whole kit, that a big map is never infrastructure, and never a cube on a plane', () => {
    const cap = gamePlannerCapability(REQUEST, 'vite-react');
    expect(cap).toMatch(/BIG map from the platform's map library/);
    expect(cap).toMatch(/NEVER an infrastructure ceiling/);
    expect(cap).toMatch(/never a cube or capsule for the player, never a flat plane/);
    expect(cap).toMatch(/Never @react-three\/fiber/);
    expect(cap).not.toMatch(/already/);   // BR1958: the kit is not seeded yet when the planner runs
    expect(gamePlannerCapability('Build a todo app', 'vite-react')).toBe('');
  });

  it('a roadmap that brings a second 3D engine to a kit game is refused; the user naming it keeps it', () => {
    const steps = [
      { title: 'Basic 3D Environment Setup', goal: 'a 3D world', buildPrompt: STEP1, needsInfra: null },
      { title: 'Character Movement Controls', goal: 'move with the joystick', buildPrompt: 'Add joystick and WASD movement for the player character.', needsInfra: null },
      { title: 'Mini Map Display', goal: 'see the map', buildPrompt: 'Add a minimap in the corner showing the player position.', needsInfra: null },
    ];
    const parsed = { userMessage: 'x', achievableSummary: 'x', note: null, steps };
    expect(roadmapGuardrail(parsed, 'GTA', { framework: 'vite-react', originalRequest: REQUEST, gameKit: true }).roadmap).toBeNull();
    expect(roadmapGuardrail(parsed, 'GTA', { framework: 'vite-react', originalRequest: REQUEST, gameKit: false }).roadmap).not.toBeNull();
    expect(roadmapGuardrail(parsed, 'GTA', { framework: 'vite-react', originalRequest: `${REQUEST}, use @react-three/fiber`, gameKit: true }).roadmap).not.toBeNull();
  });

  it('the route hands the guardrail the kit decision and the planner the kit capability', () => {
    const route = read('src/server/routes/agentv3.ts');
    expect(route).toContain('roadmapGuardrail(rmParsed, scope.famousApp, { framework, originalRequest: originalPrompt, gameKit: gameKitOwnsTheBuild(originalPrompt, framework) });');
    expect(route).toContain('${gamePlannerCapability(prompt, framework)}');
  });
});
