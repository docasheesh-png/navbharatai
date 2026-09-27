// AUTOPSY 6bae5835 (2026-09-27) — "Jarwis", an assistant that "manages everything on my phone" and
// "works on the lock screen". The build was clean, the summary offered a "lock-screen-like welcome
// screen", and nothing told the user what an app built here can and cannot do on a phone. The admin's
// ruling the same day: say plainly what needs the phone app (and how to get it) and what no app can do.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  requestedImpossiblePowers, deviceSummaryNotice, deviceSummaryRecord, DEVICE_POWERS_RULE,
} from '../src/server/AgentV3/devicePowers';

const JARWIS = 'Mujhe ek Ai assistant chahiye jiska naam jarwis ho or vo mere phone me hr chij ko mannage kr ske ,jo me kahu, or vo lock screen pr bhi ache se work kre';
const ids = (p: string) => requestedImpossiblePowers(p).map((x) => x.id);
const PKG = (deps: Record<string, string>) => JSON.stringify({ dependencies: deps });

describe('🔴 the report’s own prompt: both impossible halves are recognised', () => {
  it('lock screen + control of the whole phone', () => {
    expect(ids(JARWIS)).toEqual(['lock-screen', 'control-other-apps']);
  });
  it('and the summary that shipped gets the honest lines', () => {
    const shipped = 'Jarwis taiyar hai! Lock screen jaisa welcome screen, voice orb, tasks aur reminders.';
    const note = deviceSummaryNotice({
      prompt: JARWIS, summary: shipped,
      packageJson: PKG({ '@capacitor-community/speech-recognition': '7.0.1', '@capacitor/local-notifications': '7.0.7' }),
    });
    expect(note).toMatch(/Works in the phone app/);
    expect(note).toMatch(/voice commands/);
    expect(note).toMatch(/ring even when the app is closed/);
    expect(note).toMatch(/More → Download APK/);
    expect(note).toMatch(/connect your GitHub/);
    expect(note).toMatch(/Not possible in any app built here/);
    expect(note).toMatch(/lock screen/);
  });
});

describe('the impossible class, in English and Hinglish', () => {
  const cases: Array<[string, string]> = [
    ['build an assistant that shows on my lock screen', 'lock-screen'],
    ['it should work even when the phone is locked', 'lock-screen'],
    ['phone lock ho tab bhi reminder bole', 'lock-screen'],
    ['an app to control my phone by voice', 'control-other-apps'],
    ['phone ko control karne wala assistant', 'control-other-apps'],
    ['control other apps from one screen', 'control-other-apps'],
    ['turn off wifi and bluetooth at night', 'control-other-apps'],
    ['read my sms and tell me the OTP', 'read-private-phone-data'],
    ['call history padhe aur summary de', 'read-private-phone-data'],
    ['listen for "hey jarwis" even in the background', 'listen-while-closed'],
    ['app band ho tab bhi meri awaaz sune', 'listen-while-closed'],
  ];
  for (const [prompt, power] of cases) it(prompt, () => expect(ids(prompt)).toContain(power));
});

describe('🔒 WHAT THE PHONE APP CAN DO IS NOT CALLED IMPOSSIBLE (2026-09-27)', () => {
  // Opening an app, calling, the torch: the phone app does them (app-launcher, flash).
  for (const p of ['open other apps when I say their name', 'turn on the torch', 'call mummy when I say so', 'open whatsapp']) {
    it(p, () => expect(ids(p)).toEqual([]));
  }
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
  for (const p of ordinary) it(p, () => expect(ids(p)).toEqual([]));
  it('an ordinary build with no plugins gets no notice and no record', () => {
    expect(deviceSummaryNotice({ prompt: 'a todo app', summary: 'Done', packageJson: PKG({ react: '^18' }) })).toBe('');
    expect(deviceSummaryRecord({ prompt: 'a todo app', packageJson: PKG({ react: '^18' }), noticeAdded: false })).toBeNull();
    expect(deviceSummaryNotice({ prompt: '', summary: 'x', packageJson: null })).toBe('');
  });
  it('a plugin that works fully on the web (text-to-speech, location) needs no phone-app line', () => {
    expect(deviceSummaryNotice({ prompt: 'x', summary: 'Done', packageJson: PKG({ '@capacitor-community/text-to-speech': '6.1.0' }) })).toBe('');
  });
});

describe('each half stands down when the model already said it', () => {
  it('the impossible half', () => {
    const pkg = PKG({});
    expect(deviceSummaryNotice({ prompt: JARWIS, summary: 'Lock screen par kaam karne ke liye native Android app chahiye.', packageJson: pkg })).toBe('');
    expect(deviceSummaryNotice({ prompt: JARWIS, summary: 'A web app cannot run on the lock screen.', packageJson: pkg })).toBe('');
  });
  it('the phone-app half', () => {
    const pkg = PKG({ '@capacitor/local-notifications': '7.0.7' });
    expect(deviceSummaryNotice({ prompt: 'reminder app', summary: 'Phone app ke liye More → Download APK dabaiye.', packageJson: pkg })).toBe('');
  });
});

describe('the wiring', () => {
  it('the rule is in the stable system prompt, beside the instance it generalises', () => {
    const src = readFileSync('src/server/AgentV3/systemPrompt.ts', 'utf8');
    expect(src).toMatch(/NO_INVENTED_PEOPLE_RULE,\s*\n\s*DEVICE_POWERS_RULE,/);
    expect(DEVICE_POWERS_RULE).toMatch(/lock screen/);
    expect(DEVICE_POWERS_RULE).toMatch(/More → Download APK/);
  });
  it('the route reads the app’s REAL package.json from the sandbox and adds the notice on a successful build', () => {
    const route = readFileSync('src/server/routes/agentv3.ts', 'utf8');
    expect(route).toContain("await actuator.readFile(workspaceId, 'package.json')");
    expect(route).toContain('deviceSummaryNotice({ prompt, summary: result.summary, packageJson })');
    expect(route).toContain('deviceSummaryRecord({ prompt, packageJson');
  });
  it('the codes are process-only: a request is not a defect in the user’s app', () => {
    for (const f of ['src/server/AgentV3/BuildDiagnostics.ts', 'src/server/AgentV3/buildFindingSuggestions.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src).toContain("'DEVICE_CAPABILITIES_TOLD'");
      expect(src).toContain("'NATIVE_CAPABILITY_BRIEF'");
    }
  });
});
