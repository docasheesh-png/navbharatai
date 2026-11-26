/**
 * Admin 2026-11-26 list #9, the admin's own words as the fixture: "hero marne ke baad ek dam cinematic style me camera
 * zoomin/zoomout ho, aur animation aur 'game over' … game start hone se pahle, pura map ka drone shot". The request is read
 * into GameOptions.cinematics on the first open-world build; the shots themselves are played on the real Game in
 * theGameFeelsRightOnAPhone.test.ts. A user's own shot list is cleaned before it can move a camera.
 */
import { describe, expect, it } from 'vitest';
import { cinematicsWanted, openWorldAppSource } from '../src/server/lib/GameOpenWorldGenerator';
import { gameKitRecipeInput } from '../src/server/AgentV3/gameKitSeed';
import { GAME_CINEMATICS, GAME_CINEMATICS_PATH } from '../src/server/lib/GameCinematicsGenerator';
import { generateGameShell, GAME_SHELL_MODULES } from '../src/server/lib/GameShellGenerator';

const ADMIN = 'hero marne ke baad ek dam cenematic style me camera zoomin/zoomout ho, aur animation aur "game over" ya aise hi kuch aur jaise game start hone se pahle, pura map ka dropn shot';

describe('#9 the shots the user asks for', () => {
  it('reads the admin\'s request: a death cam AND an intro over the map', () => {
    expect(cinematicsWanted(ADMIN)).toEqual({ death: true, intro: true });
    expect(cinematicsWanted('game start hone se pahle drone shot ho')).toEqual({ intro: true });
    expect(cinematicsWanted('when the hero dies, a slow motion camera and game over')).toEqual({ death: true });
    expect(cinematicsWanted('ek open world game banao')).toEqual({});
    expect(cinematicsWanted('hero mar jaye to game over')).toEqual({});   // no camera asked: the plain end card
  });

  it('the first build carries them into App.tsx; none when not asked', () => {
    expect(gameKitRecipeInput('generate_open_world', ['generate_open_world'], 'open world game, ' + ADMIN)).toMatchObject({ cinematics: { death: true, intro: true } });
    expect(gameKitRecipeInput('generate_open_world', ['generate_open_world'], 'open world game')).not.toHaveProperty('cinematics');
    expect(openWorldAppSource({ cinematics: { death: true, intro: true } })).toContain('options={{ cinematics: { death: true, intro: true, introRadius: 400 } }}');
    expect(openWorldAppSource({})).not.toContain('cinematics');
  });

  it('the module ships with every shell game, and a shot list is data that is cleaned before use', () => {
    expect(GAME_SHELL_MODULES).toContain('cinematics');
    expect(Object.keys(generateGameShell(['game']).files)).toContain(GAME_CINEMATICS_PATH);
    expect(GAME_CINEMATICS).toMatch(/export function cleanShots\(list: unknown\): Shot\[\]/);
    expect(GAME_CINEMATICS).toMatch(/seconds: clamp\(r\.seconds, 0\.2, 30\)/);
    expect(GAME_CINEMATICS).toMatch(/list\.slice\(0, 20\)/);
  });
});
