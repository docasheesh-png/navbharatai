// 🔴 A GAME WORD IS A PART OF THE GAME, NOT A SERVICE TO CONNECT TO (failedbr #2279, 2026-11-20).
//
// A 3D racing game's spec ("GO CAR") said "HUD", and UNKNOWN_NAME_IN_REQUEST told the builder HUD named no
// service it knew — so it must not build a client for it and must explain how it read the word. HUD was later
// added to the vehicle list, one word at a time, while NPC, PVP, SFX, VFX, MMO, DLC and the rest of a game spec's
// ordinary vocabulary were all still flagged. The class is the missing FAMILY, so the test is a census of it.
// Reversion: drop the GAME_TERMS loop in unknownName.ts and every census row fails except HUD.

import { describe, it, expect } from 'vitest';
import { unknownNamesInRequest } from '../src/server/AgentV3/unknownName';

const GAME_WORDS = ['HUD', 'NPC', 'NPCS', 'MMO', 'MMORPG', 'PVP', 'PVE', 'MOBA', 'RTS', 'TPS', 'DLC', 'AFK', 'AOE',
  'DPS', 'RNG', 'LOD', 'IAP', 'PBR', 'SFX', 'VFX', 'BGM', 'OST', 'AABB', 'GLSL', 'WASD', 'CTF', 'TDM', 'POV', 'FOV', 'UGC', 'ELO'];

describe('game vocabulary is never an unknown service name', () => {
  it.each(GAME_WORDS)('%s in a game spec is not flagged', (w) => {
    expect(unknownNamesInRequest(`Make a 3D racing game with ${w} support, a leaderboard and touch controls.`)).toEqual([]);
  });
  it("the report's own line: HUD, NPC rivals, PVP races, SFX and VFX together", () => {
    expect(unknownNamesInRequest('Show a HUD with speed and lap. Add NPC rivals, PVP races, punchy SFX and VFX on every crash.')).toEqual([]);
  });
  it('an unknown all-caps word beside them is still caught (the rule still works)', () => {
    expect(unknownNamesInRequest('Make a racing game with a HUD and NPC cars and a ZORBIX mode.')).toEqual(['ZORBIX']);
  });
});

// …and its siblings from failedbr #2208 (an AI music app: "EDM" and "LLM" were both flagged).
describe('music-genre and AI terms are never unknown service names (failedbr #2208)', () => {
  it.each(['EDM', 'LOFI', 'RNB', 'KPOP', 'HIPHOP', 'DAW', 'VST', 'LLM', 'LLMS', 'RAG', 'ASR', 'NLU', 'GAN', 'RNN', 'AGI', 'SDXL'])('%s', (w) => {
    expect(unknownNamesInRequest(`Build an AI music app with ${w} support and a player.`)).toEqual([]);
  });
});

// …and from failedbr #2094 (a Class 9 test-bank app: "100 MCQ questions" was flagged).
describe('exam and classroom terms are never unknown service names (failedbr #2094)', () => {
  it.each(['MCQ', 'MCQS', 'PYQ', 'OMR', 'SGPA', 'HSC', 'SSLC', 'CUET', 'CTET', 'BPSC', 'RRB', 'LKG'])('%s', (w) => {
    expect(unknownNamesInRequest(`Build a Class 9 test app with 100 ${w} questions per subject and results.`)).toEqual([]);
  });
});


// …and from failedbr #1888 (a shop's GST bill: "the CGST and SGST split per slab" was flagged).
describe('Indian tax and invoice terms are never unknown service names (failedbr #1888)', () => {
  it('the real #1888 request names no unknown service', () => {
    expect(unknownNamesInRequest('Build a GST billing app for a shop: show the bill with taxable value, the CGST and SGST split per slab, and the final total in rupees.')).toEqual([]);
  });
  it.each(['CGST', 'SGST', 'IGST', 'UTGST', 'SAC', 'TCS', 'GSTR', 'ITC', 'IRN'])('%s', (w) => {
    expect(unknownNamesInRequest(`Build an invoice app that shows the ${w} amount on every bill.`)).toEqual([]);
  });
});

// …and from failedbr #1533 ("CORS" read as a typo) and #1441 ("15db SNR"), plus the family a sweep found beside them.
describe('engineering vocabulary is never an unknown service name (failedbr #1533, #1441)', () => {
  it('the real #1441 request names no unknown service', () => {
    expect(unknownNamesInRequest('Create an app that can do speech separation  in background noise upto 15db SNR real time using audioflinger')).toEqual([]);
  });
  it.each(['CORS', 'SNR', 'CSRF', 'OAUTH', 'SSO', 'MFA', 'RBAC', 'ORM', 'SSR', 'WASM', 'DSP', 'FFT', 'NOSQL', 'BLE', 'RFID', 'LIDAR', 'SSH', 'UDP', 'WCAG', 'CTR', 'MRR', 'UUID'])('%s', (w) => {
    expect(unknownNamesInRequest(`Build an app with ${w} support for my shop.`)).toEqual([]);
  });
});
