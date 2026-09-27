// AUTOPSY 6bae5835 (2026-09-27) — "Jarwis", an assistant that "manages everything on my phone" and
// "works on the lock screen". The build was clean, the summary offered a "lock-screen-like welcome
// screen", and nothing told the user that an app built here cannot do either. Sibling of f15a9bcc
// (NO_INVENTED_PEOPLE_RULE), which fixed one instance of this class.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { requestedDevicePowers, devicePowerNotice, devicePowerRecord, DEVICE_POWERS_RULE } from '../src/server/AgentV3/devicePowers';

const JARWIS = 'Mujhe ek Ai assistant chahiye jiska naam jarwis ho or vo mere phone me hr chij ko mannage kr ske ,jo me kahu, or vo lock screen pr bhi ache se work kre';

describe('🔴 the report’s own prompt is recognised, both halves', () => {
  it('lock screen + control of the whole phone', () => {
    expect(requestedDevicePowers(JARWIS)).toEqual(['lock-screen', 'control-phone']);
  });
  it('and the summary that shipped gets the honest line', () => {
    const shipped = 'Jarwis taiyar hai! Lock screen jaisa welcome screen, voice orb, tasks aur reminders.';
    const note = devicePowerNotice(JARWIS, shipped);
    expect(note).toMatch(/runs in the browser/);
    expect(note).toMatch(/lock screen/);
    expect(note).toMatch(/native phone app/);
    // It must never promise that packaging for a phone adds the power.
    expect(note).toMatch(/does not change that/);
  });
});

describe('recognises the class, in English and Hinglish', () => {
  const cases: Array<[string, string]> = [
    ['build an assistant that shows on my lock screen', 'lock-screen'],
    ['it should work even when the phone is locked', 'lock-screen'],
    ['phone lock ho tab bhi reminder bole', 'lock-screen'],
    ['an app to control my phone by voice', 'control-phone'],
    ['phone ko control karne wala assistant', 'control-phone'],
    ['open other apps when I say their name', 'control-phone'],
    ['turn off wifi and bluetooth at night', 'control-phone'],
    ['read my sms and tell me the OTP', 'read-private-phone-data'],
    ['call history padhe aur summary de', 'read-private-phone-data'],
    ['listen for "hey jarwis" even in the background', 'listen-while-closed'],
    ['app band ho tab bhi meri awaaz sune', 'listen-while-closed'],
  ];
  for (const [prompt, power] of cases) it(prompt, () => expect(requestedDevicePowers(prompt)).toContain(power));
});

describe('🔒 PRECISION — ordinary apps never hear this', () => {
  const ordinary = [
    'build a notes app with a lock screen PIN',
    'a todo app with dark mode',
    'manage my mobile shop inventory and bills',
    'mobile repair shop billing app',
    'make the dashboard mobile friendly and manage the mobile layout',
    'a chat app where users can read messages and see notifications',
    'a racing game with mobile controls',
    'save the draft when the app is closed',
    'IoT device control panel for my smart home lights',
    'voice notes app that records when I press the mic',
    'ek billing app banao mobile ke liye',
    'hospital management system with appointments',
    'manage my phone contacts list in the app',
  ];
  for (const p of ordinary) it(p, () => expect(requestedDevicePowers(p)).toEqual([]));
  it('no prompt, no notice; no record', () => {
    expect(devicePowerNotice('', 'x')).toBe('');
    expect(devicePowerNotice(null, 'x')).toBe('');
    expect(devicePowerRecord('a todo app')).toBeNull();
  });
});

describe('it never says it twice', () => {
  it('a summary that already explained the limit gets nothing added', () => {
    expect(devicePowerNotice(JARWIS, 'Lock screen par kaam karne ke liye native Android app chahiye.')).toBe('');
    expect(devicePowerNotice(JARWIS, 'A web app cannot run on the lock screen.')).toBe('');
  });
});

describe('the two halves are wired', () => {
  it('the rule is in the stable system prompt, beside the instance it generalises', () => {
    const src = readFileSync('src/server/AgentV3/systemPrompt.ts', 'utf8');
    expect(src).toMatch(/NO_INVENTED_PEOPLE_RULE,\s*\n\s*DEVICE_POWERS_RULE,/);
    expect(DEVICE_POWERS_RULE).toMatch(/lock screen/);
  });
  it('the route appends the notice on a successful app build, from the USER’s prompt', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain('devicePowerNotice(prompt, result.summary)');
    expect(route).toContain('devicePowerRecord(prompt)');
  });
  it('the code is process-only: a request is not a defect in the user’s app', () => {
    expect(readFileSync('src/server/AgentV3/BuildDiagnostics.ts', 'utf8')).toContain("'DEVICE_POWER_NOT_POSSIBLE'");
    expect(readFileSync('src/server/AgentV3/buildFindingSuggestions.ts', 'utf8')).toContain("'DEVICE_POWER_NOT_POSSIBLE'");
  });
});
