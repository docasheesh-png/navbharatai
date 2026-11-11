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
import {
  requestedCapabilities, nativeCapabilityBrief,
} from '../src/server/AgentV3/nativeCapabilities';
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

/** Genuine named-app launches origin/main captured via `open the app` + a name. */
export const NAMED_APP_REVIEW_REPROS = [
  'add a button to open the app Instagram',
  'open the app called Spotify',
  'open the app YouTube from my app',
  'a shortcut to open the app Maps',
  'open the app named Telegram',
  'please open the app Gmail',
  'users can open the app Netflix',
  'open app Instagram',
  'open the app Phone',
  'open the app Camera',
  'Add a shortcut that will open the app YouTube when tapped',
  'open the app Settings on the phone',
  'open the app from the list of installed apps',
  'users should be able to open the app from the list of installed apps',
  'open the app with this package name',
  'open the app with package name com.spotify.music',
  'open the app for Instagram',
  'when the user taps, open the app it is linked to',
  'open the app it is linked to',
  'open the app from my list of installed apps',
  'open the app for my Instagram',
] as const;

/** Casual / lowercase names origin/main captured via `open the app`. */
export const NAMED_APP_CASUAL_REPROS = [
  'open the app iMessage',
  'open the app eBay',
  'open the app instagram',
  'open the app youtube',
  'open the app spotify',
  'open the app gmail',
  'open the app maps',
  'open app spotify',
] as const;

/** Sentence-case / newline / punctuation after singular `open the app` must not match. */
export const NAMED_APP_SENTENCE_CASE_PITFALLS = [
  'When I open the app\nShow the welcome screen',
  'open the app. Then…',
  'open the app. Then show the welcome screen',
  'open the app, Instagram',
  'open the app\nInstagram',
] as const;

/** Same class: the user is asking to open WhatsApp, place a call, or open another app. */
export const SAME_CLASS_OPEN_APPS = [
  'mujhe jarwis chahiye jo mujhe yaad dilaye, bolkar command le, aur whatsapp khole',
  'open WhatsApp',
  'send a WhatsApp message',
  'contact me on WhatsApp',
  'whatsapp kholo',
  'make a call',
  'call mummy',
  'open the apps',
  'app kholo',
  'open apps like YouTube',
  'please open apps',
  'open the app store',
  'open WhatsApp chat with this number',
  'open the app drawer',
  'open apps installed on phone',
  'please open the apps',
  'users should be able to open apps from this screen',
  'khol do',
  'khol do play store listing',
  'open the app store so the user can submit a review',
  'Add a button to open the App Store, and a screenshots carousel on the home page',
  'After we release, a button should open the App Store',
  'open the App Store from the admin console',
  'open the App Store to see if a new release is available',
  'Add an Open App Store button so users can see other apps we published',
  'Build a music console with a button to open the App Store',
  'Add a button to open the App Store after the app is published on the App Store',
  'After the app is published on the App Store, add a button to open the App Store',
  'open the App Store to see the book we published last year on the App Store',
  'open the App Store to see the exclusive special edition we published on the App Store',
  'open the App Store to read the blog post on the editorial page we published on the App Store',
  'open the App Store after it is released on the Play Store',
  'open the App Store after it is released in the Play Store',
  'open the App Store and publish karna',
  'open the App Store version of our game',
  ...NAMED_APP_REVIEW_REPROS,
  ...NAMED_APP_CASUAL_REPROS,
] as const;

export const OPPOSITE_NOT_OPEN_APPS = [
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
  'open the app',
  'when the app opens',
  'open the app to see the dashboard',
  'open the app settings',
  'opening the app',
  'please open the app',
  'after opening the app',
  'I open the app every morning',
  'open the app first',
  'open this app',
  'open the app from my home screen',
  'open the app from home',
  'open the app from the home screen',
  'open the app from login',
  'open the app in a new window',
  'open the app after login',
  'open the app now',
  ...NAMED_APP_SENTENCE_CASE_PITFALLS,
  'publish to App Store',
  'upload to Play Store',
  'Play Store listing',
  'App Store screenshots',
  'ready for app store release',
  'play store pe daalna hai',
  'add an app drawer',
  'navigation app drawer',
  'hamburger app drawer',
  'we will launch to the Play Store next week',
  'launch to the App Store',
  'launch on Play Store',
  'launch on the Play Store',
  'launch in the App Store',
  'launch our play store listing',
  'open a Play Store developer account',
  'open our Play Store console',
  'link to play store page for my own app listing',
  'get it on Play Store',
  'rate us on the Play Store',
  'deep link',
  'hyperlink',
  'add a deep link',
  'add a hyperlink',
  'deep link to the Play Store',
  'a hyperlink to the play store',
  'play store pe khol ke daal dena',
  'link to play store page for our app listing',
  'open the play store page of my app listing',
  // Reviewed App Store presence tails (the one allowed exclusion vs origin/main).
  'open the App Store listing',
  'open the App Store screenshots',
  'open the App Store release',
  'open the App Store release notes',
  'open the App Store listing page',
  'please open the App Store listing page',
  // Q-2649: store forms origin/main did not capture stay unmatched.
  'open other apps',
  'open another app',
  'Open the Play Store',
  'button to open Play Store',
  'redirect to app store',
  'link to play store page',
  'launch the app store',
  'redirect to the Play Store',
  'play store kholo',
  'app store kholo',
  'play store kholna hai',
  'play store khol ke dekho',
  'app store mein kholo',
  'go to the play store',
  'open play store page',
  'open the play store so the user can submit a review',
  'Add a button to open the Play Store, and a screenshots carousel on the home page',
  'After we release, a button should open the Play Store',
  'open the Play Store from the admin console',
  'open the Play Store to see if a new release is available',
  'Add an Open Play Store button so users can see other apps we published',
  'Build a music console with a button to open the Play Store',
  'play store kholo aur daal makhani recipe dikhao',
  'open the play store and submit karna',
  'open the Play Store version of our game',
  'open the Play Store developer page',
  'open the Play Store agreement',
  'open the Play Store review guidelines',
  'open the Play Store data safety form',
  'open the Play Store promo campaign',
  'open the Play Store Connect dashboard',
  'open the Play Store for my developer account',
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

  it('open-apps core still names plural apps and does not recapture singular open-the-app', () => {
    expect(requestedCapabilities('open apps like YouTube').map((c) => c.id)).toContain('open-apps');
    expect(requestedCapabilities('open the app').map((c) => c.id)).not.toContain('open-apps');
  });

  it('#4165 decisions: app settings stay this-app; app drawer and opening-the-app are classified explicitly', () => {
    // "open the app settings" does NOT match. "The app settings" is this application's
    // settings screen (in-app navigation), the same class as "open the app to see…".
    // Contrast "app store" / "app drawer", which are frozen compounds for OS surfaces
    // that acquire or launch other apps — not "the app" + a trailing noun.
    expect(requestedCapabilities('open the app settings').map((c) => c.id)).not.toContain('open-apps');
    // "open the app drawer" DOES match: the Android/iOS app drawer is the launcher
    // surface for installed apps, i.e. the open-apps capability family.
    expect(requestedCapabilities('open the app drawer').map((c) => c.id)).toContain('open-apps');
    // "open apps installed on phone" is a genuine request to launch other apps.
    expect(requestedCapabilities('open apps installed on phone').map((c) => c.id)).toContain('open-apps');
    // "opening the app" / "when the app opens" are this-app lifecycle language.
    expect(requestedCapabilities('opening the app').map((c) => c.id)).not.toContain('open-apps');
    expect(requestedCapabilities('when the app opens').map((c) => c.id)).not.toContain('open-apps');
    // Pair: singular vs plural "please open …"
    expect(requestedCapabilities('please open the app').map((c) => c.id)).not.toContain('open-apps');
    expect(requestedCapabilities('please open apps').map((c) => c.id)).toContain('open-apps');
    // A later "number" after "chat" is not a WhatsApp-number identity field.
    expect(requestedCapabilities('open WhatsApp chat with this number').map((c) => c.id)).toContain('open-apps');
    // Play Store / go-to / link / redirect opens are Q-2649 (origin/main did not match them).
    expect(requestedCapabilities('button to open Play Store').map((c) => c.id)).not.toContain('open-apps');
    expect(requestedCapabilities('redirect to app store').map((c) => c.id)).not.toContain('open-apps');
    expect(requestedCapabilities('link to play store page').map((c) => c.id)).not.toContain('open-apps');
    expect(requestedCapabilities('publish to App Store').map((c) => c.id)).not.toContain('open-apps');
    expect(requestedCapabilities('upload to Play Store').map((c) => c.id)).not.toContain('open-apps');
    expect(requestedCapabilities('Play Store listing').map((c) => c.id)).not.toContain('open-apps');
    expect(requestedCapabilities('App Store screenshots').map((c) => c.id)).not.toContain('open-apps');
    expect(requestedCapabilities('ready for app store release').map((c) => c.id)).not.toContain('open-apps');
    expect(requestedCapabilities('play store pe daalna hai').map((c) => c.id)).not.toContain('open-apps');
    // Bare "app drawer" is risky: builders say it for a navigation/hamburger drawer in THIS app.
    // Require the same verb, so "open the app drawer" still matches and "add an app drawer" does not.
    expect(requestedCapabilities('add an app drawer').map((c) => c.id)).not.toContain('open-apps');
    expect(requestedCapabilities('navigation app drawer').map((c) => c.id)).not.toContain('open-apps');
    expect(requestedCapabilities('hamburger app drawer').map((c) => c.id)).not.toContain('open-apps');
    // launch + to/on/in + store is "ship the app", not "launch the store".
    expect(requestedCapabilities('we will launch to the Play Store next week').map((c) => c.id)).not.toContain('open-apps');
    expect(requestedCapabilities('launch to the App Store').map((c) => c.id)).not.toContain('open-apps');
    expect(requestedCapabilities('launch on Play Store').map((c) => c.id)).not.toContain('open-apps');
    expect(requestedCapabilities('launch our play store listing').map((c) => c.id)).not.toContain('open-apps');
    expect(requestedCapabilities('launch the app store').map((c) => c.id)).not.toContain('open-apps');
    // Store tails that name this app's listing / developer console.
    expect(requestedCapabilities('open a Play Store developer account').map((c) => c.id)).not.toContain('open-apps');
    expect(requestedCapabilities('open our Play Store console').map((c) => c.id)).not.toContain('open-apps');
    // Q-2649: origin/main did not match "link to play store page" (with or without
    // listing language). A get-it-on / rate-us button that points at THIS app's
    // store listing is not a request to open other apps via @capacitor/app-launcher.
    expect(requestedCapabilities('link to play store page').map((c) => c.id)).not.toContain('open-apps');
    expect(requestedCapabilities('link to play store page for my own app listing').map((c) => c.id)).not.toContain('open-apps');
    expect(requestedCapabilities('get it on Play Store').map((c) => c.id)).not.toContain('open-apps');
    expect(requestedCapabilities('rate us on the Play Store').map((c) => c.id)).not.toContain('open-apps');
    expect(requestedCapabilities('deep link').map((c) => c.id)).not.toContain('open-apps');
    expect(requestedCapabilities('hyperlink').map((c) => c.id)).not.toContain('open-apps');
    expect(requestedCapabilities('deep link to the Play Store').map((c) => c.id)).not.toContain('open-apps');
    // Post-nominal Hinglish store+khol and "go to the play store" are Q-2649.
    expect(requestedCapabilities('play store kholo').map((c) => c.id)).not.toContain('open-apps');
    expect(requestedCapabilities('app store kholo').map((c) => c.id)).not.toContain('open-apps');
    expect(requestedCapabilities('play store kholna hai').map((c) => c.id)).not.toContain('open-apps');
    expect(requestedCapabilities('play store khol ke dekho').map((c) => c.id)).not.toContain('open-apps');
    expect(requestedCapabilities('app store mein kholo').map((c) => c.id)).not.toContain('open-apps');
    expect(requestedCapabilities('go to the play store').map((c) => c.id)).not.toContain('open-apps');
    expect(requestedCapabilities('play store pe daalna hai').map((c) => c.id)).not.toContain('open-apps');
    // Named-app launches origin/main captured via `open the app` + a name.
    for (const p of NAMED_APP_REVIEW_REPROS) {
      expect(requestedCapabilities(p).map((c) => c.id), p).toContain('open-apps');
    }
    for (const p of NAMED_APP_CASUAL_REPROS) {
      expect(requestedCapabilities(p).map((c) => c.id), p).toContain('open-apps');
    }
    expect(requestedCapabilities('open the app Settings on the phone').map((c) => c.id)).toContain('open-apps');
    expect(requestedCapabilities('open the app settings').map((c) => c.id)).not.toContain('open-apps');
    for (const p of NAMED_APP_SENTENCE_CASE_PITFALLS) {
      expect(requestedCapabilities(p).map((c) => c.id), JSON.stringify(p)).not.toContain('open-apps');
    }
  });
});
