/**
 * failedbr #2481 (2026-11-21, queue Q-3224) — admin: "gta jaisa bada game bnane ko bola, to yeh ghumne wala dabba bana diya!"
 *
 * "ek real gta jaise game banao, bahut bade map par, user apne charecter ko joystik se control kare" was split by the
 * roadmap into step 1 = "a flat terrain (like a square plane), ambient light, and a simple player character (can be a
 * cube or capsule). Use OrbitControls". The kit decision then re-read the DOMAIN of the milestone text — "square plane /
 * terrain" read as REAL ESTATE — so no game kit (character, big map, joystick, camera) was laid down, and the builder
 * drew a purple cube on a green plane. The planner also told the user a big map and traffic "need backend
 * infrastructure … browser mein nahi ho sakti".
 */
import { describe, expect, it } from 'vitest';
import { gameKitPlan, gameTurnRequest, turnIsGame, gameTurnHandoff, GAME_MILESTONE_LINE } from '../src/server/AgentV3/gameKitSeed';
import { roadmapGuardrail, GAME_KIT_CLAUSE, megaRoadmapSystemPrompt } from '../src/server/lib/megaRoadmap';

const P2481 = 'ek real gta jaise game banao, bahut bade map par, user apne charecter ko joystik se control kare';
const STEP1 = 'Create a basic Three.js 3D environment inside the Vite-React app. Add a flat terrain (like a square plane), ambient light, and a simple player character (can be a cube or capsule). Use OrbitControls for camera movement initially. Make sure everything renders properly using React integration with Three.js (use @react-three/fiber and @react-three/drei). No fake visuals – render actual geometry.';

describe('a game\'s milestone still gets the game kit', () => {
  const turn = gameTurnRequest(P2481, STEP1);
  it('the #2481 milestone is a game turn, and the kit (3D, big map) is laid down', () => {
    expect(turn).toContain(GAME_MILESTONE_LINE);
    expect(turnIsGame(turn)).toBe(true);
    const plan = gameKitPlan(turn, 'vite-react');
    expect(plan).toContain('generate_game_3d');
    expect(plan).toContain('generate_game_shell');
  });
  it('the game contract reads it as a game too (the sibling reader)', () => {
    const h = gameTurnHandoff(turn, {}, { writingRun: true, moduleTurn: false, importTurn: false, stopped: false });
    expect(h.block).not.toBe('');
  });
  it('🔒 a music app\'s milestone is not made a game by the marker (failedbr #2271 stays fixed)', () => {
    expect(gameTurnRequest('Build an Indian music streaming app', 'a Player screen with a real <audio> element')).not.toContain(GAME_MILESTONE_LINE);
    expect(turnIsGame('a Player screen with a real <audio> element')).toBe(false);
  });
});

describe('the roadmap never plans a box as a game\'s player, and never calls a big map infrastructure', () => {
  const roadmap = {
    userMessage: 'core first',
    achievableSummary: 'hum ek chhoti open-world jaisi scene banayenge',
    note: 'realistic traffic system, pedestrian AI, complex missions, aur large-scale map ke liye dedicated backend infrastructure chahiye hoti hai jo browser mein nahi ho sakti.',
    steps: [
      { title: 'Basic 3D Environment Setup', goal: 'ground plane aur player', buildPrompt: STEP1, needsInfra: null },
      { title: 'Character Movement Controls', goal: 'WASD ya joystick', buildPrompt: 'Implement keyboard/WASD controls for the player character in the 3D world.', needsInfra: null },
      { title: 'Vehicle Entry/Exit Demo', goal: 'gaadi me baith sake', buildPrompt: 'Place one drivable car nearby the player; E to enter and drive.', needsInfra: 'complex vehicle physics' },
    ],
  };
  const r = roadmapGuardrail(roadmap, 'GTA', { framework: 'vite-react', originalRequest: P2481, gameKit: true, game3D: true });
  it('every step of a game carries the kit clause, and the placeholder is named in the report', () => {
    expect(r.roadmap).not.toBeNull();
    for (const s of r.roadmap!.steps) expect(s.buildPrompt).toContain(GAME_KIT_CLAUSE);
    expect(r.rejected.join(' ')).toMatch(/planned a placeholder player for a game/);
  });
  it('a car is not an infra ceiling for a game, and the false backend note is dropped', () => {
    expect(r.roadmap!.steps.some((s) => s.infraCeiling)).toBe(false);
    expect(r.roadmap!.note).toBeNull();
  });
  it('🔒 a game with online multiplayer keeps its ceiling; a non-game roadmap gets no kit clause', () => {
    const mp = roadmapGuardrail({ ...roadmap, steps: [...roadmap.steps, { title: 'Online Multiplayer', goal: 'friends', buildPrompt: 'Add online multiplayer with a game server and matchmaking.', needsInfra: 'game server' }] }, 'GTA', { framework: 'vite-react', originalRequest: P2481, gameKit: true, game3D: true });
    expect(mp.roadmap!.steps.some((s) => s.infraCeiling)).toBe(true);
    const shop = roadmapGuardrail({ userMessage: 'x', achievableSummary: 'y', note: null, steps: [
      { title: 'Catalog', goal: 'see products', buildPrompt: 'Build a product catalog grid with search.', needsInfra: null },
      { title: 'Cart', goal: 'add to cart', buildPrompt: 'Add a cart drawer with quantities.', needsInfra: null },
      { title: 'Checkout', goal: 'pay', buildPrompt: 'Add a checkout form with UPI.', needsInfra: null },
    ] }, 'Amazon', { framework: 'vite-react', originalRequest: 'Build an Amazon clone shopping app' });
    for (const s of shop.roadmap!.steps) expect(s.buildPrompt).not.toContain(GAME_KIT_CLAUSE);
  });
  it('the planner is told a game\'s step 1 is already playable on the kit', () => {
    expect(megaRoadmapSystemPrompt()).toMatch(/A GAME is built on the platform's own game kit/);
    expect(megaRoadmapSystemPrompt()).toMatch(/only ONLINE MULTIPLAYER needs a server/);
  });
});

// The box "succeeded" because no playtest ran: a react-three-fiber scene matched neither half of the canvas-game check.
import { isCanvasGameProject } from '../src/server/AgentV3/gamePlaytest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
describe('an R3F scene the user asked to be a game is played', () => {
  const files = {
    'src/App.tsx': "import { Canvas } from '@react-three/fiber';\nexport default function App() { return <Canvas><Player /></Canvas>; }",
    'src/components/Player.tsx': "import { useFrame } from '@react-three/fiber';\nexport function Player() { useFrame(() => {}); return <mesh><boxGeometry args={[1, 1, 1]} /></mesh>; }",
  };
  it('a game request\'s R3F scene goes to the playtest', () => {
    expect(isCanvasGameProject(files, { gameRequested: true })).toBe(true);
  });
  it('🔒 the same scene for a non-game (a 3D product viewer) is not a game', () => {
    expect(isCanvasGameProject(files)).toBe(false);
  });
  it('wired: the route asks with the game-turn verdict', () => {
    const route = readFileSync(join(__dirname, '..', 'src/server/routes/agentv3.ts'), 'utf8');
    expect(route).toContain('isCanvasGameProject(playtestFiles, { gameRequested: turnIsGame(gameTurnRequest(prompt, milestoneRequest)) })');
  });
});
