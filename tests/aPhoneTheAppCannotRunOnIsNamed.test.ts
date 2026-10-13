// A PHONE THE APP CANNOT RUN ON IS NAMED (Q-846, build 46e2d74b; admin 2026-10-12: option a). A racing game "for
// Nokia C2-01" — a 2011 keypad phone, no touch, no WebGL — got a 3D touch game and no word that it cannot run
// there. THE CLASS: a device the user named, silently ignored. Now the user is told, and the build fits the keys.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { namedNonSmartphone, nonSmartphoneBuildRule, nonSmartphoneUserLine } from '../src/server/AgentV3/deviceTarget';
import { gameKitPlan, gameKitWants3D } from '../src/server/AgentV3/gameKitSeed';

describe('which phones it names — precision first', () => {
  it.each([
    ['racing game for Nokia C2-01', 'Nokia C2-01'],
    ['snake game that runs on my nokia 3310', 'nokia 3310'],
    ['ek game banao jo keypad phone pe chale', 'keypad phone'],
    ['a quiz for feature phones', 'feature phones'],
    ['app for KaiOS', 'KaiOS'],
    ['Jio Phone ke liye game', 'Jio Phone'],
    ['nokia asha game', 'nokia asha'],
  ])('%s → %s', (prompt, device) => {
    expect(namedNonSmartphone(prompt)?.device).toBe(device);
  });

  it.each([
    'racing game for Nokia G42',
    'app for my Nokia C32',
    'Nokia X30 photo app',
    'a phone game',
    'mobile shop billing app',
    'smartphone friendly website',
    'a game with buttons for my phone',
    // A device word that is also an app word (found reviewing #3678): none of these names a keypad phone.
    'ek basic phone book app banao',
    'a basic phone directory for my shop',
    'build a basic phone number validator',
    'simple app with a big button phone dialer',
    'basic phone app with login',
    '',
  ])('NEGATIVE: %s is not a keypad phone', (prompt) => {
    expect(namedNonSmartphone(prompt)).toBeNull();
  });
});

describe('what it changes', () => {
  it('🔒 the game kit lays down its 2D layers, never three.js, for a keypad phone', () => {
    expect(gameKitWants3D('racing game for Nokia C2-01')).toBe(false);
    expect(gameKitPlan('racing game for Nokia C2-01', 'vite-react')).not.toContain('generate_game_3d');
    // The same race without the phone is still 3D — the rule touches only the named device.
    expect(gameKitWants3D('racing game')).toBe(true);
  });

  it('the builder is told to build light, 2D and keys-first', () => {
    const rule = nonSmartphoneBuildRule('Nokia C2-01');
    expect(rule).toContain('never three.js or WebGL');
    expect(rule).toContain('number keys (2 up, 4 left, 6 right, 8 down, 5 select)');
    expect(rule).toContain('no control that only works by touch');
  });

  it('the user is told plainly, naming their phone and what was built', () => {
    const line = nonSmartphoneUserLine('Nokia C2-01');
    expect(line).toContain('About Nokia C2-01');
    expect(line).toContain('no web app');
    expect(line).toContain('arrow or number keys');
  });
});

describe('🔒 the wiring', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
  it('the build prompt gets the rule, and the summary gets the line, from the same reading of the request', () => {
    // PIN UPDATED 2026-10-12 (autopsy 9c612cdb, Q-948 — this rule's first fix reached ONE lane): the rule now rides
    // the ONE request-notes list, so the architect, the fast lane, the one-shot lane and the planner all read it.
    // On the weak tier the fast lane writes first; it used to build for a touch screen without ever seeing the rule.
    expect(route).toContain("{ code: 'device', text: keypadPhoneForBuild ? nonSmartphoneBuildRule(keypadPhoneForBuild.device) : '' },");
    expect(route).toContain("buildPrompt = [requestNotesText, buildPrompt].filter(Boolean).join('\\n\\n---\\n\\n');");
    expect(route).toContain('summary: `${result.summary}${nonSmartphoneUserLine(keypadPhone.device)}`');
    expect(route).toContain("code: 'NON_SMARTPHONE_TOLD'");
  });
});
