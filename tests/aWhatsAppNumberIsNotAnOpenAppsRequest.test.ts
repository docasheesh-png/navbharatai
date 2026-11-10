// BR1974 (report a33c9a72f3…, 2026-11-08) — "FIX THE APP STARTING SCREEN AND LOGIN FLOW"
// for an existing Chess Squad app SUCCEEDED (ok=true, not charged) in 9.6 min. The engine treated
// it as an edit (PROJECT_MODE; READY_BEFORE_END: already-in-the-project), RELEASE_GATE GREEN.
// NATIVE_CAPABILITY_BRIEF still fired open-apps: "Enter Your WhatsApp Mobile Number" matched a
// bare `whats\\s*app`, so the builder was told to install @capacitor/app-launcher and added
// WhatsApp/SMS "contact support" the user never asked for (the brief's label also names calling
// and SMS). "when I open the app" is launching THIS app, not opening another one.
//
// The opposite-class and same-class lists below were assembled independently, before the
// open-apps `asks` regex was edited.

import { describe, it, expect } from 'vitest';
import { requestedCapabilities, nativeCapabilityBrief } from '../src/server/AgentV3/nativeCapabilities';
import { analyzeRequest } from '../src/server/AgentV3/RequestAnalyser';
import { analyzeRequirementGaps } from '../src/server/lib/RequirementGapAnalyzer';
import { COMPLEX_APP_SIGNAL, isComplexAppPrompt } from '../src/server/lib/appComplexitySignals';

export const BR1974_PROMPT = `IMPORTANT: FIX THE APP STARTING SCREEN AND LOGIN FLOW

The current app has a problem: whenever I open CHESS SQUAD, it directly displays my personal dashboard. I do not want this behaviour.

Please completely fix the app's starting flow.

1. First Screen – Welcome Page

Every time a new visitor opens the app, show the CHESS SQUAD welcome screen first.

Display these fields:

- CHESS SQUAD logo
- Welcome to CHESS SQUAD
- Enter Your Nickname
- Enter Your WhatsApp Mobile Number
- NEXT button

2. My Personal Entry

My details are:

- Nickname: INDRA_NEXUS
- WhatsApp number: 7093492611
- Points: Unlimited (∞)

Only after I enter BOTH my nickname and mobile number and press NEXT should my personal dashboard open.

3. Other Members

- Other members must enter their own nicknames and WhatsApp mobile numbers.
- After pressing NEXT, they should enter their own personal dashboards.
- Every new member starts with 5 points.
- Allow unlimited members.
- If two members have the same nickname, distinguish them using their mobile numbers.

4. Mandatory Navigation Rules

- The welcome screen must be the default starting page.
- Never automatically open my personal dashboard when the app launches.
- Do not automatically select my nickname.
- Do not redirect visitors directly to the dashboard.
- The dashboard must open only after the visitor enters their details and presses NEXT.
- Provide a way to return to the welcome screen and switch members.
- Keep each member's dashboard and points separate.
- On reopening the app, show the welcome screen as requested.`;

/** Same class: the user is asking to open WhatsApp, place a call, or open another app. */
const SAME_CLASS_OPEN_APPS = [
  'mujhe jarwis chahiye jo mujhe yaad dilaye, bolkar command le, aur whatsapp khole',
  'open WhatsApp',
  'send a WhatsApp message',
  'contact me on WhatsApp',
  'whatsapp kholo',
  'make a call',
  'call mummy',
  'open other apps',
  'open another app',
  'open the apps',
  'app kholo',
] as const;

/**
 * Opposite class: a WhatsApp *number* / *id* is an identity field, and "open the app" means
 * launch this app. Own bypass attempts in both scripts and both directions.
 */
const OPPOSITE_NOT_OPEN_APPS = [
  BR1974_PROMPT,
  'Enter Your WhatsApp Mobile Number',
  'WhatsApp number: 7093492611',
  'whatsapp ka number daalo',
  'mera WhatsApp wala number likho',
  'my WhatsApp ID',
  'WhatsApp no.',
  'WhatsApp phone',
  'Enter your WhatsApp mobile no',
  'when I open the app, show the welcome screen',
  'whenever I open the app',
  'Every time a new visitor opens the app, show the welcome screen',
  'Please completely fix the app starting flow',
] as const;

describe('BR1974: a WhatsApp number field is not a request to open WhatsApp', () => {
  it('the report prompt does not ask for open-apps (or any other native capability)', () => {
    expect(requestedCapabilities(BR1974_PROMPT).map((c) => c.id)).toEqual([]);
    expect(nativeCapabilityBrief(BR1974_PROMPT)).toBe('');
  });

  it('same-class phrases that really ask to open WhatsApp, call, or open other apps still match', () => {
    for (const p of SAME_CLASS_OPEN_APPS) {
      expect(requestedCapabilities(p).map((c) => c.id), p).toContain('open-apps');
    }
  });

  it('opposite-class WhatsApp-number and launch-this-app phrases stay uncaptured', () => {
    for (const p of OPPOSITE_NOT_OPEN_APPS) {
      expect(requestedCapabilities(p).map((c) => c.id), p).not.toContain('open-apps');
    }
  });

  it('Jarwis still gets the open-apps brief (phoneFeatures neighbour)', () => {
    const brief = nativeCapabilityBrief('mujhe jarwis chahiye jo mujhe yaad dilaye, bolkar command le, aur whatsapp khole');
    expect(brief).toContain('@capacitor/app-launcher@7.0.4');
  });

  it('neighbours: Contact-us is still not contacts; a music player still asks for nothing', () => {
    expect(requestedCapabilities('add a Contact us page and show the event location').map((c) => c.id)).toEqual([]);
    expect(requestedCapabilities('music player that I can listen to').map((c) => c.id)).toEqual([]);
    expect(requestedCapabilities('a todo app with dark mode').map((c) => c.id)).toEqual([]);
  });

  it('the report is an edit-shaped login/welcome fix that COMPLEX_APP_SIGNAL reads as dashboard (Q-2647)', () => {
    expect(COMPLEX_APP_SIGNAL.test(BR1974_PROMPT)).toBe(true);
    expect(isComplexAppPrompt(BR1974_PROMPT)).toBe(true);
    expect(analyzeRequirementGaps(BR1974_PROMPT).domain).not.toBe('education');
    const a = analyzeRequest({ prompt: BR1974_PROMPT, buildIntent: 'new_build' } as Parameters<typeof analyzeRequest>[0]);
    expect(a.taskType).toBe('complex_app');
    expect(a.complexityScore).toBeGreaterThanOrEqual(40);
  });
});
