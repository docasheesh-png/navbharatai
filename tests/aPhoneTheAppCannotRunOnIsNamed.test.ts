// A CLASSIC KEYPAD PHONE THE USER NAMED (Q-846 → Q-868, build 46e2d74b). "Create an racing game for Nokia c 2-01" got a
// 3D touch racer. Q-846 (#3678) read the phone as the TARGET and told the user no web app can run on it; the admin
// corrected that on 2026-10-12 — the user wanted THE CLASSIC GAME THAT CAME ON THAT PHONE. And Q-846's regex never
// matched the real prompt: "c 2-01" has a space. THE CLASS: a phone named as the game's ORIGIN read as its platform,
// and a summary line that asserted what the user meant. Now the regex only DETECTS; the builder is told the likely
// meaning with "unless the request asks otherwise"; the user line says only what is true under every reading.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { namedNonSmartphone, nonSmartphoneBuildRule, nonSmartphoneUserLine } from '../src/server/AgentV3/deviceTarget';
import { gameKitPlan, gameKitWants3D } from '../src/server/AgentV3/gameKitSeed';

/** The build report's own prompt, verbatim (46e2d74b) — a fixture of the real input, not a paraphrase. */
const REAL_PROMPT = 'Create an racing game for Nokia c 2-01';

describe('which phones it names — precision first', () => {
  it.each([
    [REAL_PROMPT, 'Nokia c 2-01'],
    ['racing game for Nokia C2-01', 'Nokia C2-01'],
    ['racing game for Nokia C2 – 01', 'Nokia C2 – 01'],
    ['nokia x2-01 snake game', 'nokia x2-01'],
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
    // Today's Android Nokias: without the dash these are NOT the old C-series (the dash is required on purpose).
    'a racing game for Nokia C200',
    'a racing game for Nokia C20',
    'Nokia X30 photo app',
    'a phone game',
    'mobile shop billing app',
    'smartphone friendly website',
    'a game with buttons for my phone',
    // "feature" next to "mobile" is English, not a phone kind (Q-868 review): the vocabulary is NOT widened.
    'Build a 3D car racing game. The key feature mobile players need is tilt steering.',
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
  it('🔒 the game kit lays down its 2D layers, never three.js, for the REAL prompt', () => {
    expect(gameKitWants3D(REAL_PROMPT)).toBe(false);
    expect(gameKitPlan(REAL_PROMPT, 'vite-react')).not.toContain('generate_game_3d');
    // The same race without the phone is still 3D — the rule touches only the named device.
    expect(gameKitWants3D('racing game')).toBe(true);
  });

  it('🔒 the builder is told the LIKELY meaning (the classic game from that phone) and is free to follow the request', () => {
    const rule = nonSmartphoneBuildRule('Nokia c 2-01');
    expect(rule).toContain('THE CLASSIC GAME THAT CAME ON THAT PHONE');
    expect(rule).toContain('top-down lane racer');
    expect(rule).toContain('original title');
    // The builder, which reads language, decides refusals, owners and non-game apps — not a regex.
    expect(rule).toMatch(/If the request asks for something else/);
    expect(rule).toContain('an app that is not a game');
    // Light and 2D whatever it builds; touch AND keys, never touch-only and never keys-only.
    expect(rule).toContain('never three.js or WebGL');
    expect(rule).toContain('on-screen TOUCH buttons AND the keyboard');
    expect(rule).toContain('number keys 2 up, 4 left, 6 right, 8 down, 5 or Enter to act');
    // The withdrawn target reading is gone from the builder's instructions.
    expect(rule).not.toMatch(/cannot run|no control that only works by touch/i);
  });

  it('🔒 the user line is true under EVERY reading: what was built and where it plays — no intent claim, no "cannot run"', () => {
    const line = nonSmartphoneUserLine('Nokia c 2-01');
    expect(line).toContain('About Nokia c 2-01');
    expect(line).toContain('light and 2D');
    expect(line).toContain('any phone or computer browser');
    expect(line).toContain('touch or the arrow / number keys');
    expect(line).not.toMatch(/cannot run|no web app|can't run|not a game|you (?:meant|wanted)|I read this as/i);
    // White-label: no AI vendor or model name ever reaches the user.
    expect(line).not.toMatch(/claude|anthropic|openai|gpt|gemini|glm|kimi|grok/i);
  });
});

describe('🔒 the wiring — every lane that writes the app hears the same rule', () => {
  const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
  const subAgent = readFileSync('src/server/AgentV3/SubAgent.ts', 'utf8');
  it('the architect: the build prompt opens with the rule, the summary gets the line, from the same reading', () => {
    expect(route).toContain('if (keypadPhoneForBuild) buildPrompt = `${nonSmartphoneBuildRule(keypadPhoneForBuild.device)}');
    expect(route).toContain('summary: `${result.summary}${nonSmartphoneUserLine(keypadPhone.device)}`');
    expect(route).toContain("code: 'NON_SMARTPHONE_TOLD'");
  });
  it('the fast lane: its prompt carries the same rule', () => {
    expect(route).toContain('const keypadPhoneSuffix = keypadPhoneForBuild ? `\\n\\n${nonSmartphoneBuildRule(keypadPhoneForBuild.device)}`');
    expect(route).toMatch(/runSimpleBuild\(\{ prompt: planning\.text \+[^,]*\+ keypadPhoneSuffix,/);
  });
  it('the writing sub-agents: a deviceRule thunk, read only by roles that write files', () => {
    expect(route).toMatch(/deviceRule: \(\) => \{\s*const phone = !isImportTurn \? namedNonSmartphone\(prompt\) : null;\s*return phone \? nonSmartphoneBuildRule\(phone\.device\) : '';/);
    expect(subAgent).toContain("roleExpectsArtifacts(deps.toolsOverride ?? cfg.tools) ? (deps.deviceRule?.() ?? '') : ''");
  });
  it('the planner: its goal carries the same rule', () => {
    expect(route).toContain("const plannerGoalNotes = [unknownNameNote, scriptRequestNote, keypadPhoneForBuild ? nonSmartphoneBuildRule(keypadPhoneForBuild.device) : ''].filter(Boolean)");
  });
  it('an approved plan is ADDED to the build prompt — never rebuilt from the bare request, which dropped every note', () => {
    expect(route).toContain('buildPrompt = `${buildPrompt}\\n\\nApproved plan:\\n');
    expect(route).not.toContain('buildPrompt = `${prompt}\\n\\nApproved plan:\\n');
  });
});
